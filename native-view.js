const vscode = require('vscode');
const format = require('./media/format');

function clean(value) {
  const text = String(value || '').replace(/<USER_REQUEST>\s*/g, '').replace(/\s*<\/USER_REQUEST>[\s\S]*/g, '').replace(/^The following is a <SYSTEM_MESSAGE>[\s\S]*?<SYSTEM_MESSAGE>\s*/, '').replace(/\s*<\/SYSTEM_MESSAGE>\s*$/, '').trim();
  return format.isProtectedToken(text) ? '[Conteúdo protegido ou codificado indisponível para leitura.]' : text;
}
function title(session) {
  const first = (session.events || []).find(e => e.type === 'USER_INPUT' && e.content);
  return first ? clean(first.content).replace(/\s+/g, ' ').slice(0, 110) : session.role || `Conversa ${session.id.slice(0, 12)}`;
}
function conversationText(session, sessions) {
  if (!session) return 'Esta conversa não está mais disponível nos registros locais.';
  const lines = [`${session.source} — ${title(session)}`, `ID: ${session.id}`];
  if (session.parent) lines.push(`Agente principal: ${session.parent}`);
  lines.push(`Modelos e esforços registrados: ${format.modelLabels(session.models).join(' | ')}`);
  const u = session.usage;
  if (u) {
    const num = n => Number.isFinite(n) ? n.toLocaleString('pt-BR') : 'indisponível';
    lines.push(`Tokens registrados: total ${num(u.total)} · entrada ${num(u.input)} · saída ${num(u.output)}`);
    if (Number.isFinite(u.cacheRead)) lines.push(`Leitura em cache: ${num(u.cacheRead)}`);
    else if (session.source === 'Antigravity') lines.push('Leitura em cache: indisponível');
    if (Number.isFinite(u.cacheWrite)) lines.push(`Criação de cache: ${num(u.cacheWrite)}`);
    if (u.label) lines.push(u.label);
  } else lines.push('Tokens: indisponível nos registros deste agente.');
  if (session.truncated) lines.push('Exibindo os 2.000 eventos mais recentes.');
  const resolve = value => {
    const target = sessions.find(s => s.id.replace(/^codex:/, '') === String(value).replace(/^codex:/, '') || s.agentPath === value);
    if (target?.id === session.id) return 'este agente';
    if (target?.id === session.parent || value === '/root') return 'agente principal';
    return target?.role || (target ? title(target) : value);
  };
  const add = (kind, content, date) => {
    if (!content) return;
    const stamp = date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toLocaleString('pt-BR') : '';
    lines.push('', '────────────────────────────────────────');
    if (kind || stamp) lines.push([kind, stamp].filter(Boolean).join(' · '));
    lines.push('', content);
  };
  for (const event of session.events || []) {
    if ((event.content || event.hasProtectedContent) && event.type !== 'GENERIC') {
      const kind = event.type === 'CODEX_AGENT_MESSAGE' ? 'Mensagem entre agentes' : event.type === 'SYSTEM_MESSAGE' ? 'Mensagem entre agentes / sistema' : '';
      const formatted = event.type === 'SYSTEM_MESSAGE' ? format.formatSystemMessage(event.content, resolve) : event.type === 'CODEX_AGENT_MESSAGE' ? format.formatAgentMessage(event.content, event.hasProtectedContent, resolve, event.raw) : null;
      add(kind, formatted ? formatted.text : clean(event.content), event.created_at);
    }
    if (event.type === 'CODEX_CALL') add(event.name === 'spawn_agent' ? 'Chamada de subagente' : 'Mensagem enviada', format.formatCall(event.name, event.args || {}, resolve).text, event.created_at);
    for (const call of event.tool_calls || []) if (['invoke_subagent', 'send_message'].includes(call.name)) add(call.name === 'invoke_subagent' ? 'Chamada de subagente' : 'Mensagem enviada', format.formatCall(call.name, call.args || {}, resolve).text, event.created_at);
  }
  if (lines.length < 5) lines.push('', 'Ainda não há mensagens exibíveis neste registro.');
  return lines.join('\n') + '\n';
}
class NativeView {
  constructor(onOpen) {
    this.onOpen = onOpen; this.sessions = []; this.unread = new Set(); this.openUris = new Map();
    this.treeEmitter = new vscode.EventEmitter(); this.onDidChangeTreeData = this.treeEmitter.event;
    this.documentEmitter = new vscode.EventEmitter(); this.onDidChange = this.documentEmitter.event;
  }
  update(sessions, unread, warning) {
    this.sessions = sessions; this.unread = new Set(unread); this.warning = warning;
    this.treeEmitter.fire();
    for (const [id, entry] of this.openUris) {
      const text = conversationText(sessions.find(s => s.id === id), sessions);
      if (text !== entry.text) { entry.text = text; this.documentEmitter.fire(entry.uri); }
    }
  }
  getChildren(element) {
    const map = new Map(this.sessions.map(s => [s.id, s]));
    if (element) return (element.session.children || []).map(c => map.get(c.id) && {session:map.get(c.id), role:c.role}).filter(Boolean);
    const childIds = new Set(this.sessions.flatMap(s => (s.children || []).map(c => c.id)));
    return this.sessions.filter(s => !childIds.has(s.id)).map(session => ({session}));
  }
  getTreeItem(element) {
    const s = element.session;
    const hasChildren = (s.children || []).some(c => this.sessions.some(child => child.id === c.id));
    const item = new vscode.TreeItem(element.role || title(s), hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = s.id; item.description = `${s.source} · ${format.compactTokens(s.usage?.total)}${this.unread.has(s.id) ? ' · nova' : ''}`;
    item.tooltip = `${s.source} · ${s.id}\n${format.modelLabels(s.models).join('\n')}\nSelecione para abrir a conversa nativa.`;
    item.iconPath = new vscode.ThemeIcon(this.unread.has(s.id) ? 'bell-dot' : 'comment-discussion');
    item.command = {command:'antigravityMonitor.openNativeConversation', title:'Abrir conversa', arguments:[s.id]};
    return item;
  }
  provideTextDocumentContent(uri) { return conversationText(this.sessions.find(s => s.id === uri.query), this.sessions); }
  async open(id) {
    const uri = vscode.Uri.from({scheme:'agent-monitor', path:'/Conversa do agente.txt', query:id});
    this.openUris.set(id, {uri, text:conversationText(this.sessions.find(s => s.id === id), this.sessions)});
    this.onOpen(id);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {preview:true, preserveFocus:false});
  }
  close(uri) { if (uri.scheme === 'agent-monitor') this.openUris.delete(uri.query); }
  dispose() { this.treeEmitter.dispose(); this.documentEmitter.dispose(); }
}
module.exports = {NativeView, conversationText};
