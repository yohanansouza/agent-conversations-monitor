const fs = require('fs').promises;
const path = require('path');

async function filesBelow(root, predicate) {
  const found = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && predicate(e.name)) found.push(p);
    }
  }
  await walk(root); return found;
}
function parseLines(text) { return text.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
function contentText(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(c => c && c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n') : '';
}
function numeric(value) { return Number.isFinite(value) && value >= 0 ? value : 0; }
async function collectClaude(root) {
  const files = await filesBelow(root, n => n.endsWith('.jsonl'));
  const sessions = [];
  for (const file of files) {
    const parts = path.relative(root, file).split(path.sep);
    const isChild = parts.length >= 4 && parts.at(-2) === 'subagents' && parts.at(-1).startsWith('agent-');
    if (!(parts.length === 2 || isChild)) continue;
    let stat, records; try { [stat, records] = await Promise.all([fs.stat(file), fs.readFile(file, 'utf8').then(parseLines)]); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const sessionId = isChild ? parts.at(-3) : path.basename(file, '.jsonl');
    const id = isChild ? `claude:${sessionId}:${path.basename(file, '.jsonl')}` : `claude:${sessionId}`;
    const parent = isChild ? `claude:${sessionId}` : '';
    const events = []; const usageById = new Map(); const modelNames = new Set();
    for (const record of records) {
      if (!['user', 'assistant'].includes(record.type) || !record.message) continue;
      const m = record.message; const text = contentText(m.content);
      if (record.type === 'assistant' && typeof m.model === 'string' && m.model.trim() && !m.model.startsWith('<')) modelNames.add(m.model.trim());
      if (text && !record.isMeta) events.push({ type: record.type === 'user' ? 'USER_INPUT' : 'PLANNER_RESPONSE', content: text, created_at: record.timestamp });
      if (record.type === 'assistant' && Array.isArray(m.content)) for (const item of m.content) {
        if (item.type === 'tool_use' && ['Agent', 'Task'].includes(item.name)) events.push({type:'CODEX_CALL',name:'spawn_agent',args:item.input || {},created_at:record.timestamp});
      }
      if (record.type === 'assistant' && m.id && m.usage && Number.isFinite(m.usage.input_tokens) && m.usage.input_tokens >= 0 && Number.isFinite(m.usage.output_tokens) && m.usage.output_tokens >= 0) usageById.set(m.id, m.usage);
    }
    let usage = null;
    if (usageById.size) {
      usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, label: 'Consumo registrado do agente; entrada não inclui cache.' };
      for (const u of usageById.values()) { usage.input += numeric(u.input_tokens); usage.output += numeric(u.output_tokens); usage.cacheRead += numeric(u.cache_read_input_tokens); usage.cacheWrite += numeric(u.cache_creation_input_tokens); }
      usage.total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    }
    sessions.push({ id, parent, source: 'Claude', role: isChild ? path.basename(file, '.jsonl') : '', modified: stat.mtimeMs, events: events.slice(-2000), truncated: events.length > 2000, children: [], usage, models:[...modelNames].map(model => ({model, effort:null})) });
  }
  const map = new Map(sessions.map(s => [s.id, s]));
  for (const s of sessions) if (s.parent && map.has(s.parent)) map.get(s.parent).children.push({id:s.id,role:s.role});
  return { sessions, warning: '' };
}
async function collectGrok(root) {
  const files = await filesBelow(root, n => n === 'updates.jsonl');
  const sessions = [];
  for (const file of files) {
    let stat, records; try { [stat, records] = await Promise.all([fs.stat(file), fs.readFile(file, 'utf8').then(parseLines)]); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    let summary = {}; try { summary = JSON.parse(await fs.readFile(path.join(path.dirname(file), 'summary.json'), 'utf8')); } catch { /* opcional */ }
    const rawId = String(summary.info?.id || path.basename(path.dirname(file)));
    const events = []; const turns = new Map(); const modelNames = new Set();
    for (const record of records) {
      const params = record.params || record; const update = params.update || {}; const type = update.sessionUpdate || update.session_update;
      const content = update.content?.text;
      if (['user_message_chunk','agent_message_chunk'].includes(type) && typeof content === 'string') {
        const kind = type === 'user_message_chunk' ? 'USER_INPUT' : 'PLANNER_RESPONSE';
        const previous = events.at(-1); const prompt = update._meta?.promptIndex ?? params._meta?.promptId ?? params._meta?.prompt_id ?? '';
        if (previous && previous.type === kind && previous.prompt === prompt) previous.content += content;
        else events.push({ type: kind, content, prompt, created_at: params._meta?.timestamp || (typeof record.timestamp === 'number' ? record.timestamp * 1000 : record.timestamp) });
      }
      if (type === 'turn_completed' && update.usage && (update.prompt_id || update.promptId)) {
        turns.set(update.prompt_id || update.promptId, update.usage);
        for (const model of Object.keys(update.usage.modelUsage || {})) if (model.trim()) modelNames.add(model);
      }
    }
    let usage = null;
    if (turns.size && [...turns.values()].every(u => Number.isFinite(u.inputTokens) && Number.isFinite(u.outputTokens))) {
      usage = { input:0, output:0, cacheRead:0, label:[...turns.values()].some(u => u.usageIsIncomplete) ? 'Consumo parcial por turno; entrada inclui cache.' : 'Consumo registrado por turno; entrada inclui cache.' };
      for (const u of turns.values()) { usage.input += numeric(u.inputTokens); usage.output += numeric(u.outputTokens); usage.cacheRead += numeric(u.cachedReadTokens); }
      usage.total = usage.input + usage.output;
    }
    const parentId = summary.parent_session_id;
    sessions.push({id:`grok:${rawId}`, parent:parentId ? `grok:${parentId}` : '', source:'Grok', modified:stat.mtimeMs, events:events.slice(-2000), truncated:events.length>2000, children:[], usage, models:[...modelNames].map(model => ({model, effort:null})), role:summary.agent_name || 'Sessão derivada'});
  }
  const map = new Map(sessions.map(s=>[s.id,s]));
  for (const s of sessions) if (s.parent && map.has(s.parent)) map.get(s.parent).children.push({id:s.id,role:s.role});
  return {sessions,warning:''};
}
module.exports = {collectClaude,collectGrok};
