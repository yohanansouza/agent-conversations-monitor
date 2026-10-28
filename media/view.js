const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
const listContainer = document.getElementById('list-container');
const chatContainer = document.getElementById('chat-container');
const status = document.getElementById('status');
const search = document.getElementById('search');
const source = document.getElementById('source');
const kind = document.getElementById('kind');
const notificationArea = document.getElementById('new-conversations');
const separateViews = document.body?.classList.contains('mode-filters') || document.body?.classList.contains('mode-sessions') || document.body?.classList.contains('mode-chat');
let sessions = [];
let selected = '';
let query = '';
let fingerprint = '';
let unread = [];
let expanded = new Set(Array.isArray(vscode.getState()?.expandedIds) ? vscode.getState().expandedIds : []);
let listHeight = Number.isFinite(vscode.getState()?.listHeight) ? vscode.getState().listHeight : null;
const sectionIds = ['filters-panel', 'conversations-panel', 'chat-panel'];
for (const id of sectionIds) {
  const section = document.getElementById(id);
  const stored = vscode.getState()?.sections?.[id];
  if (!separateViews && typeof stored === 'boolean') section.open = stored;
  section.addEventListener('toggle', () => {
    const state = vscode.getState() || {};
    if (separateViews || state.sections?.[id] === section.open) return;
    vscode.setState({ ...state, sections: { ...(state.sections || {}), [id]: section.open } });
  });
}
function applyListHeight(height, persist = true) {
  listHeight = Math.max(70, Math.min(Math.max(70, window.innerHeight - 120), height));
  const list = app.querySelector('.list');
  if (list) { list.style.height = `${listHeight}px`; list.style.maxHeight = 'none'; }
  if (persist) vscode.setState({ ...(vscode.getState() || {}), listHeight });
}
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const sourceClass = name => ({Codex:'codex',Antigravity:'antigravity',Claude:'claude',Grok:'grok'}[name] || 'codex');
const badge = name => el('span', name, `badge ${sourceClass(name)}`);
function clean(text) {
  return String(text || '').replace(/<USER_REQUEST>\s*/g, '').replace(/\s*<\/USER_REQUEST>[\s\S]*/g, '').replace(/^The following is a <SYSTEM_MESSAGE>[\s\S]*?<SYSTEM_MESSAGE>\s*/, '').replace(/\s*<\/SYSTEM_MESSAGE>\s*$/, '').trim();
}
function title(session) {
  const event = session.events.find(e => e.type === 'USER_INPUT' && e.content);
  return event ? clean(event.content).replace(/\s+/g, ' ').slice(0, 110) : `Conversa ${session.id.slice(0, 8)}`;
}
function render() {
  if (document.body?.classList.contains('mode-filters')) return;
  const listScroll = app.querySelector('.list')?.scrollTop || 0;
  const pageScroll = window.scrollY;
  const parent = monitorTree.build(sessions).parent;
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
  listContainer.replaceChildren(); chatContainer.replaceChildren();
  if (!sessions.length) { listContainer.append(el('p', 'Nenhuma conversa encontrada.', 'empty')); return; }
  const list = el('section', '', 'list');
  const map = new Map(sessions.map(s => [s.id, s]));
  const tree = monitorTree.rows(sessions, {kind:kind.value || 'all', source:source.value, query, expanded, title});
  for (const entry of tree.rows) {
    const s = entry.session;
    const row = el('div', '', 'tree-row');
    row.style.marginLeft = `${Math.min(entry.depth, 6) * 12}px`;
    if (entry.hasChildren) {
      const toggle = el('button', entry.expanded ? '▾' : '▸', 'tree-toggle');
      toggle.setAttribute('aria-label', `${entry.expanded ? 'Recolher' : 'Expandir'} ${entry.role || title(s)}`);
      toggle.setAttribute('aria-expanded', String(entry.expanded));
      toggle.onclick = () => { if (expanded.has(s.id)) expanded.delete(s.id); else expanded.add(s.id); vscode.setState({...(vscode.getState() || {}), expandedIds:[...expanded]}); render(); };
      row.append(toggle);
    } else row.append(el('span', '', 'tree-spacer'));
    const button = el('button', '', 'session' + (s.id === selected ? ' selected' : ''));
    const meta = el('small', '', 'session-meta');
    const category = entry.agent ? 'Agente' : 'Chat';
    meta.append(badge(s.source), document.createTextNode(` · ${category} · ${new Date(s.modified).toLocaleString('pt-BR')} · ${monitorFormat.compactTokens(s.usage?.total)}`));
    button.append(el('span', entry.role || title(s)), meta);
    if (entry.relation) button.append(el('small', entry.relation, 'session-models'));
    if (entry.agent && !map.has(entry.parentId)) button.append(el('small', 'Vínculo principal indisponível', 'session-models'));
    if (entry.agent && kind.value === 'agents' && map.has(entry.parentId)) button.append(el('small', `Vinculado a: ${title(map.get(entry.parentId))}`, 'session-models'));
    if (s.models?.length) button.append(el('small', monitorFormat.modelLabels(s.models).join(' | '), 'session-models'));
    button.onclick = () => openSession(s.id);
    row.append(button); list.append(row);
  }
  if (!tree.rows.length) list.append(el('p', 'Nenhum registro corresponde aos filtros.', 'empty'));
  listContainer.append(list);
  if (!separateViews && listHeight !== null) applyListHeight(listHeight, false);
  const splitter = el('div', '', 'list-splitter');
  splitter.setAttribute('role', 'separator');
  splitter.setAttribute('aria-label', 'Ajustar altura da lista de conversas');
  splitter.setAttribute('aria-orientation', 'horizontal');
  splitter.setAttribute('tabindex', '0');
  splitter.title = 'Arraste para ajustar a altura da lista. Use as setas para cima e para baixo pelo teclado.';
  splitter.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY, startHeight = list.getBoundingClientRect().height;
    const move = e => applyListHeight(startHeight + e.clientY - startY, false);
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); if (listHeight !== null) applyListHeight(listHeight); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
  });
  splitter.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    applyListHeight(list.getBoundingClientRect().height + (event.key === 'ArrowDown' ? 20 : -20));
  });
  if (!separateViews) listContainer.append(splitter);
  if (document.body?.classList.contains('mode-sessions')) { list.scrollTop = listScroll; return; }
  const current = map.get(selected);
  if (!current) return;
  const detail = el('section', '', `detail ${sourceClass(current.source)}`);
  const heading = el('div', '', 'detail-heading');
  heading.append(badge(current.source), el('h2', parent.get(current.id)?.role || title(current)));
  detail.append(heading, el('p', `ID: ${current.id.replace(/^codex:/, '')}`, 'id'));
  detail.append(el('p', `Modelos e esforços registrados: ${monitorFormat.modelLabels(current.models).join(' | ')}`, 'id'));
  if (current.usage) {
    const u = current.usage; const fmt = n => Number.isFinite(n) ? n.toLocaleString('pt-BR') : 'indisponível';
    const parts = [`Total: ${fmt(u.total)}`, `Entrada: ${fmt(u.input)}`, `Saída: ${fmt(u.output)}`];
    if (Number.isFinite(u.cacheRead)) parts.push(`Leitura em cache: ${fmt(u.cacheRead)}`);
    else if (current.source === 'Antigravity') parts.push('Leitura em cache: indisponível');
    if (Number.isFinite(u.cacheWrite)) parts.push(`Criação de cache: ${fmt(u.cacheWrite)}`);
    const box = el('div', '', 'usage'); box.append(el('strong', 'Tokens registrados'), el('p', parts.join(' · ')), el('small', u.label)); detail.append(box);
  } else detail.append(el('p', 'Tokens: indisponível nos registros deste agente.', 'hint'));
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
  chatContainer.append(detail);
  list.scrollTop = listScroll;
  window.scrollTo(0, pageScroll);
}
function openSession(id) {
  selected = id;
  vscode.postMessage({type:'uiState', selected:id});
  if (unread.includes(id)) { unread = unread.filter(item => item !== id); vscode.postMessage({ type: 'read', id }); }
  render();
}
search.addEventListener('input', () => { query = search.value.toLowerCase().trim(); vscode.postMessage({type:'uiState', query:search.value}); render(); });
source.addEventListener('change', () => { selected = ''; vscode.postMessage({type:'uiState', source:source.value, selected:''}); render(); });
kind.addEventListener('change', () => { vscode.postMessage({type:'uiState', kind:kind.value}); render(); });
document.getElementById('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
window.addEventListener('message', ({ data }) => {
  if (data.type === 'uiState') {
    const nextSource = data.source || '', nextQuery = data.query || '', nextSelected = data.selected || '', nextKind = ['all','chats','agents'].includes(data.kind) ? data.kind : 'all';
    if (source.value !== nextSource || search.value !== nextQuery || selected !== nextSelected || kind.value !== nextKind) {
      source.value = nextSource; search.value = nextQuery; kind.value = nextKind; query = nextQuery.toLowerCase().trim(); selected = nextSelected; render();
    }
    return;
  }
  if (data.type === 'error') { status.textContent = `Erro ao ler registros: ${data.message}`; return; }
  if (data.type !== 'sessions') return;
  status.textContent = data.warning || `${data.sessions.length} conversas encontradas · atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
  const next = JSON.stringify([data.sessions, data.unread]);
  if (fingerprint !== next) { fingerprint = next; sessions = data.sessions; unread = data.unread || []; render(); }
});
vscode.postMessage({type:'ready'});
