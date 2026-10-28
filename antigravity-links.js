const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BUFFER = 512 * 1024;

function requestInfo(payload) {
  const name = payload.name || '';
  const input = payload.type === 'function_call' ? payload.arguments : payload.input;
  if (typeof input !== 'string') return null;
  let command = '', sessionId = null;
  if (name === 'exec_command' || name === 'write_stdin') {
    let args; try { args = JSON.parse(input); } catch { return null; }
    command = name === 'exec_command' ? args.cmd : '';
    sessionId = name === 'write_stdin' ? args.session_id : null;
  } else if (name === 'exec' && payload.type === 'custom_tool_call') {
    // Aceita somente o comando literal da chamada exec_command; nunca executa código dos logs.
    if ((input.match(/\btools\.[A-Za-z_][A-Za-z0-9_]*\s*\(/g) || []).length !== 1) return null;
    const call = input.match(/tools\.exec_command\s*\(\s*\{\s*cmd\s*:\s*("(?:\\.|[^"\\])*")/);
    if (call) { try { command = JSON.parse(call[1]); } catch { return null; } }
    const continuation = input.match(/tools\.write_stdin\s*\(\s*\{\s*session_id\s*:\s*(\d+)/);
    if (continuation) sessionId = Number(continuation[1]);
  }
  if (typeof command === 'string' && /^\s*(?:&\s*)?(?:agy(?:\.exe|\.cmd)?|"[^"\r\n]*[\\/]agy(?:\.exe|\.cmd)?"|'[^'\r\n]*[\\/]agy(?:\.exe|\.cmd)?')\s/i.test(command)
      && !/(?:^|\s)(?:--continue|-c|--conversation)(?:\s|=|$)/i.test(command)) return {type:'launch'};
  if (Number.isSafeInteger(sessionId) && sessionId > 0) return {type:'continuation', sessionId};
  return null;
}
function objects(text) {
  if (typeof text !== 'string' || text.length > MAX_BUFFER) return [];
  const found = [];
  try { const value = JSON.parse(text); if (value && typeof value === 'object' && !Array.isArray(value)) return [value]; } catch { /* JSONL */ }
  for (const line of text.split(/\r?\n/)) {
    try { const value = JSON.parse(line); if (value && typeof value === 'object' && !Array.isArray(value)) found.push(value); } catch { /* parcial ou texto */ }
  }
  return found;
}
function envelopes(output) {
  const texts = typeof output === 'string' ? [output] : Array.isArray(output) ? output.filter(x => x && typeof x.text === 'string').map(x => x.text) : [];
  return texts.flatMap(objects);
}
class CallTracker {
  constructor() { this.pending = new Map(); this.processes = new Map(); this.ids = new Set(); }
  request(payload) {
    if (typeof payload.call_id !== 'string') return;
    const info = requestInfo(payload);
    if (info && (info.type === 'launch' || this.processes.has(info.sessionId))) this.pending.set(payload.call_id, info);
    if (this.pending.size > 1000) this.pending.delete(this.pending.keys().next().value);
  }
  result(payload) {
    const info = this.pending.get(payload.call_id); if (!info) return;
    this.pending.delete(payload.call_id);
    let process = info.type === 'continuation' ? this.processes.get(info.sessionId) : {buffer:''};
    if (!process) return;
    for (const envelope of envelopes(payload.output)) {
      if (typeof envelope.output === 'string') {
        process.buffer = (process.buffer + envelope.output).slice(-MAX_BUFFER);
        for (const item of objects(process.buffer)) {
          const id = item.conversation_id || item.conversationId;
          if (typeof id === 'string' && UUID.test(id)) this.ids.add(id.toLowerCase());
        }
      }
      // Algumas ferramentas retornam diretamente o resultado JSON do agy.
      const id = envelope.conversation_id || envelope.conversationId;
      if (typeof id === 'string' && UUID.test(id)) this.ids.add(id.toLowerCase());
      if (Number.isSafeInteger(envelope.session_id) && envelope.session_id > 0) this.processes.set(envelope.session_id, process);
      if (info.type === 'continuation' && Number.isInteger(envelope.exit_code)) this.processes.delete(info.sessionId);
    }
    if (this.processes.size > 200) this.processes.delete(this.processes.keys().next().value);
  }
}
function linkSessions(sessions) {
  const owners = new Map();
  const byId = new Map(sessions.map(s => [s.id, s]));
  const alreadyChild = new Set(sessions.filter(s => s.source === 'Antigravity').flatMap(s => (s.children || []).map(c => c.id)));
  for (const parent of sessions) if (parent.source === 'Codex') for (const id of parent.antigravityIds || []) {
    const matches = owners.get(id) || new Set(); matches.add(parent.id); owners.set(id, matches);
  }
  for (const [id, ownerIds] of owners) {
    const target = byId.get(id);
    if (ownerIds.size !== 1 || target?.source !== 'Antigravity' || alreadyChild.has(id)) continue;
    const parent = byId.get([...ownerIds][0]);
    if (parent && !(parent.children || []).some(c => c.id === id)) parent.children.push({id, role:'', relation:'Sessão Antigravity iniciada pelo Codex'});
  }
}
module.exports = {CallTracker, requestInfo, linkSessions};
