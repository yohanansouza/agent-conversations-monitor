const fs = require('fs').promises;
const path = require('path');
const { StringDecoder } = require('string_decoder');

function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(item => typeof item === 'string' ? item : (item.text || '')).filter(Boolean).join('\n');
}

function record(state, line) {
  let item;
  try { item = JSON.parse(line); } catch { return; }
  const p = item.payload || {};
  if (item.type === 'session_meta' && !state.meta) {
    const spawn = p.source?.subagent?.thread_spawn;
    state.meta = { id: p.id, parent: spawn?.parent_thread_id, role: spawn?.agent_nickname || spawn?.agent_path || spawn?.agent_role || 'Subagente', path: spawn?.agent_path };
    return;
  }
  if (item.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) {
    const u = p.info.total_token_usage;
    if (Number.isFinite(u.input_tokens) && Number.isFinite(u.output_tokens) && Number.isFinite(u.total_tokens)) state.usage = { input:u.input_tokens, output:u.output_tokens, total:u.total_tokens, cacheRead:u.cached_input_tokens, label:'Total registrado da sessão; entrada inclui cache e saída inclui raciocínio quando registrado.' };
    return;
  }
  if (item.type !== 'response_item') return;
  const event = { created_at: item.timestamp };
  if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
    event.type = p.role === 'user' ? 'USER_INPUT' : 'PLANNER_RESPONSE';
    event.content = textContent(p.content);
    if (p.role === 'user' && /^(# AGENTS\.md instructions|<environment_context>|<external_codex_apps_open_page>)/.test(event.content.trim())) return;
  } else if (p.type === 'agent_message') {
    event.type = 'CODEX_AGENT_MESSAGE';
    event.content = textContent(p.content);
    event.author = p.author; event.recipient = p.recipient;
    event.hasProtectedContent = Array.isArray(p.content) && p.content.some(item => item && item.type === 'encrypted_content');
    event.raw = p;
  } else if (p.type === 'function_call' && ['spawn_agent', 'send_message', 'followup_task'].includes(p.name)) {
    let args; try { args = JSON.parse(p.arguments || '{}'); } catch { args = {}; }
    event.type = 'CODEX_CALL'; event.name = p.name; event.args = args;
  } else return;
  if (!event.content && !event.name && !event.hasProtectedContent) return;
  state.events.push(event);
  if (state.events.length > 2000) { state.events.shift(); state.truncated = true; }
}

class CodexReader {
  constructor() { this.cache = new Map(); }
  async readFile(file, stat) {
    let state = this.cache.get(file);
    if (!state || stat.size < state.offset || (stat.mtimeMs !== state.mtime && stat.size === state.offset)) {
      state = { offset: 0, remainder: '', decoder: new StringDecoder('utf8'), meta: null, events: [], truncated: false };
      this.cache.set(file, state);
    }
    if (stat.size > state.offset) {
      const handle = await fs.open(file, 'r');
      try {
        const buf = Buffer.alloc(256 * 1024);
        while (state.offset < stat.size) {
          const { bytesRead } = await handle.read(buf, 0, Math.min(buf.length, stat.size - state.offset), state.offset);
          if (!bytesRead) break;
          state.offset += bytesRead;
          const parts = (state.remainder + state.decoder.write(buf.subarray(0, bytesRead))).split('\n');
          state.remainder = parts.pop();
          for (const line of parts) record(state, line);
        }
      } finally { await handle.close(); }
    }
    state.mtime = stat.mtimeMs;
    return state;
  }
  async collect(root) {
    const files = [];
    const walk = async dir => {
      let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) files.push(file);
      }
    };
    await walk(root);
    const alive = new Set(files);
    for (const key of this.cache.keys()) if (!alive.has(key)) this.cache.delete(key);
    const sessions = [];
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        const state = await this.readFile(file, stat);
        if (!state.meta?.id) continue;
        sessions.push({ id: `codex:${state.meta.id}`, source: 'Codex', modified: stat.mtimeMs, events: state.events, children: [], parent: state.meta.parent ? `codex:${state.meta.parent}` : '', role: state.meta.role, agentPath: state.meta.path || '/root', truncated: state.truncated, usage: state.usage || null });
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    const byId = new Map(sessions.map(s => [s.id, s]));
    for (const s of sessions) if (s.parent && byId.has(s.parent)) byId.get(s.parent).children.push({ id: s.id, role: s.role });
    return { sessions, warning: '' };
  }
}
module.exports = { CodexReader, textContent };
