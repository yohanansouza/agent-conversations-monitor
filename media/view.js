const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
const status = document.getElementById('status');
const search = document.getElementById('search');
const source = document.getElementById('source');
const notificationArea = document.getElementById('new-conversations');
let sessions = [];
let selected = '';
let query = '';
let fingerprint = '';
let unread = [];
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const sourceClass = name => name === 'Codex' ? 'codex' : 'antigravity';
const badge = name => el('span', name, `badge ${sourceClass(name)}`);
function clean(text) {
  return String(text || '').replace(/<USER_REQUEST>\s*/g, '').replace(/\s*<\/USER_REQUEST>[\s\S]*/g, '').replace(/^The following is a <SYSTEM_MESSAGE>[\s\S]*?<SYSTEM_MESSAGE>\s*/, '').replace(/\s*<\/SYSTEM_MESSAGE>\s*$/, '').trim();
}
function title(session) {
  const event = session.events.find(e => e.type === 'USER_INPUT' && e.content);
  return event ? clean(event.content).replace(/\s+/g, ' ').slice(0, 110) : `Conversa ${session.id.slice(0, 8)}`;
}
function render() {
  const listScroll = app.querySelector('.list')?.scrollTop || 0;
  const pageScroll = window.scrollY;
  const parent = new Map();
  for (const s of sessions) for (const c of s.children) parent.set(c.id, { id: s.id, role: c.role });
  const roots = sessions.filter(s => (!source.value || s.source === source.value) && !parent.has(s.id));
  if (!selected || !sessions.some(s => s.id === selected)) selected = roots[0]?.id || sessions[0]?.id || '';
  notificationArea.replaceChildren();
  if (unread.length) {
    notificationArea.append(el('strong', `${unread.length} ${unread.length === 1 ? 'nova conversa' : 'novas conversas'}`));
    for (const id of unread) {
      const s = sessions.find(item => item.id === id);
      if (!s) continue;
      const notice = el('button', '', 'notice');
      notice.append(badge(s.source), document.createTextNode(` ${parent.get(id)?.role || title(s)}`));
      notice.onclick = () => openSession(id);
      notificationArea.append(notice);
    }
  }
  app.replaceChildren();
  if (!sessions.length) { app.append(el('p', 'Nenhuma conversa encontrada.', 'empty')); return; }
  const list = el('section', '', 'list');
  const map = new Map(sessions.map(s => [s.id, s]));
  function addSession(s, label, depth, visited) {
    if (visited.has(s.id)) return;
    visited = new Set(visited); visited.add(s.id);
    const haystack = `${title(s)} ${s.id} ${label} ${s.events.map(e => e.content || '').join(' ')}`.toLowerCase();
    const descendants = s.children.map(c => map.get(c.id)).filter(Boolean);
    if (!query || haystack.includes(query) || descendants.some(c => `${title(c)} ${c.id}`.toLowerCase().includes(query))) {
      const button = el('button', '', 'session' + (s.id === selected ? ' selected' : ''));
      button.style.marginLeft = `${Math.min(depth, 4) * 12}px`;
      const meta = el('small', '', 'session-meta');
      meta.append(badge(s.source), document.createTextNode(` · ${new Date(s.modified).toLocaleString('pt-BR')} · ${s.id.replace(/^codex:/, '').slice(0, 8)}`));
      button.append(el('span', label || title(s)), meta);
      button.onclick = () => openSession(s.id);
      list.append(button);
    }
    for (const c of s.children) { const child = map.get(c.id); if (child) addSession(child, c.role, depth + 1, visited); }
  }
  for (const s of roots) addSession(s, '', 0, new Set());
  app.append(list);
  const current = map.get(selected);
  if (!current) return;
  const detail = el('section', '', `detail ${sourceClass(current.source)}`);
  const heading = el('div', '', 'detail-heading');
  heading.append(badge(current.source), el('h2', parent.get(current.id)?.role || title(current)));
  detail.append(heading, el('p', `ID: ${current.id.replace(/^codex:/, '')}`, 'id'));
  if (current.truncated) detail.append(el('p', 'Exibindo os 2.000 eventos mais recentes desta sessão.', 'hint'));
  if (parent.has(current.id)) detail.append(el('p', `Agente principal: ${parent.get(current.id).id}`, 'id'));
  function resolveRecipient(value) {
    const normalized = String(value).replace(/^codex:/, '');
    const parentId = parent.get(current.id)?.id;
    if (parentId && parentId.replace(/^codex:/, '') === normalized) return 'agente principal';
    const other = sessions.find(s => s.id.replace(/^codex:/, '') === normalized || s.agentPath === value);
    if (!other) return value;
    if (other.id === current.id) return 'este agente';
    return parent.get(other.id)?.role || (value === '/root' ? 'agente principal' : title(other));
  }
  let count = 0;
  for (const event of current.events) {
    const items = [];
    if ((event.content || event.hasProtectedContent) && event.type !== 'GENERIC') {
      const kind = event.type === 'USER_INPUT' ? 'Pedido' : event.type === 'CODEX_AGENT_MESSAGE' ? `Mensagem: ${resolveRecipient(event.author || 'agente')} → ${resolveRecipient(event.recipient || 'agente')}` : event.type === 'SYSTEM_MESSAGE' ? 'Mensagem entre agentes / sistema' : 'Resposta';
      const outgoing = event.type === 'CODEX_AGENT_MESSAGE' ? event.author === current.agentPath : !['USER_INPUT', 'SYSTEM_MESSAGE'].includes(event.type);
      const formatted = event.type === 'SYSTEM_MESSAGE' ? monitorFormat.formatSystemMessage(event.content, resolveRecipient) : event.type === 'CODEX_AGENT_MESSAGE' ? monitorFormat.formatAgentMessage(event.content, event.hasProtectedContent, resolveRecipient, event.raw) : null;
      items.push([kind, formatted ? formatted.text : clean(event.content), outgoing ? 'outgoing' : 'incoming', formatted?.raw]);
    }
    if (event.type === 'CODEX_CALL') {
      const formatted = monitorFormat.formatCall(event.name, event.args || {}, resolveRecipient);
      items.push([event.name === 'spawn_agent' ? 'Chamada de subagente' : event.name === 'followup_task' ? 'Tarefa ao subagente' : 'Mensagem enviada', formatted.text, 'outgoing', formatted.raw]);
    }
    for (const call of event.tool_calls || []) {
      if (['invoke_subagent', 'send_message'].includes(call.name)) {
        const formatted = monitorFormat.formatCall(call.name, call.args || {}, resolveRecipient);
        items.push([call.name === 'invoke_subagent' ? 'Chamada de subagente' : 'Mensagem enviada', formatted.text, 'outgoing', formatted.raw]);
      }
    }
    if (event.type === 'GENERIC' && /Created the following subagent/.test(event.content || '')) {
      const id = event.content.match(/"conversationId"\s*:\s*"([^"]+)"/)?.[1];
      items.push(['Subagente criado', id ? `Agente: ${resolveRecipient(id)}\n\nID: ${id}` : 'Novo subagente criado. Consulte os detalhes técnicos.', 'incoming', event.content]);
    }
    for (const [kind, content, direction, raw] of items) {
      if (!content) continue;
      const card = el('article', '', `event ${direction}`);
      const date = event.created_at ? new Date(event.created_at).toLocaleString('pt-BR') : '';
      card.append(el('strong', kind), el('small', date), monitorMarkdown.render(content, document, marked));
      if (raw !== undefined) {
        const details = el('details', '', 'raw-details');
        details.append(el('summary', 'Detalhes técnicos'), el('pre', typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)));
        card.append(details);
      }
      detail.append(card); count++;
    }
  }
  if (!count) detail.append(el('p', 'Ainda não há mensagens exibíveis neste registro.', 'empty'));
  app.append(detail);
  list.scrollTop = listScroll;
  window.scrollTo(0, pageScroll);
}
function openSession(id) {
  selected = id;
  source.value = '';
  search.value = '';
  query = '';
  if (unread.includes(id)) { unread = unread.filter(item => item !== id); vscode.postMessage({ type: 'read', id }); }
  render();
}
search.addEventListener('input', () => { query = search.value.toLowerCase().trim(); render(); });
source.addEventListener('change', () => { selected = ''; render(); });
document.getElementById('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
window.addEventListener('message', ({ data }) => {
  if (data.type === 'error') { status.textContent = `Erro ao ler registros: ${data.message}`; return; }
  if (data.type !== 'sessions') return;
  status.textContent = data.warning || `${data.sessions.length} conversas encontradas · atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
  const next = JSON.stringify([data.sessions, data.unread]);
  if (fingerprint !== next) { fingerprint = next; sessions = data.sessions; unread = data.unread || []; render(); }
});
