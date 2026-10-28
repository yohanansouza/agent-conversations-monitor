const vscode = require('vscode');
const os = require('os');
const path = require('path');
const { collectSessions } = require('./sessions');
const { CodexReader } = require('./codex-sessions');
const { Notifications } = require('./notifications');
const { collectClaude, collectGrok } = require('./other-sessions');

class Monitor {
  constructor(context) {
    this.context = context; this.view = null; this.timer = null; this.running = false;
    this.codex = new CodexReader(); this.notifications = new Notifications();
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.statusItem.command = 'antigravityMonitor.open';
    this.statusItem.tooltip = 'Abrir novas conversas no Monitor de agentes';
    context.subscriptions.push(this.statusItem);
  }
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'view.js'));
    const formatScript = view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'format.js'));
    const markedScript = view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'marked.umd.js'));
    const markdownScript = view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'markdown.js'));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'view.css'));
    const nonce = require('crypto').randomBytes(16).toString('hex');
    view.webview.html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"></head><body><header><strong>Monitor de Agentes</strong><button id="refresh" title="Atualizar agora">↻</button></header><p class="hint">Codex · Antigravity CLI · Claude Code · Grok Build</p><div id="new-conversations" aria-live="polite"></div><select id="source" aria-label="Filtrar por origem"><option value="">Todas as origens</option><option value="Codex">Codex</option><option value="Antigravity">Antigravity</option><option value="Claude">Claude</option><option value="Grok">Grok</option></select><input id="search" placeholder="Filtrar conversas e agentes" aria-label="Filtrar conversas"><div id="status" role="status">Carregando…</div><div id="app"></div><script nonce="${nonce}" src="${formatScript}"></script><script nonce="${nonce}" src="${markedScript}"></script><script nonce="${nonce}" src="${markdownScript}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
    view.webview.onDidReceiveMessage(message => {
      if (message.type === 'refresh') this.refresh();
      if (message.type === 'read' && typeof message.id === 'string') { this.notifications.read(message.id); this.updateStatus(); this.refresh(); }
    }, null, this.context.subscriptions);
    view.onDidChangeVisibility(() => { if (view.visible) this.refresh(); });
    view.onDidDispose(() => { this.view = null; });
    this.refresh();
  }
  start() {
    this.stop();
    const seconds = Math.max(1, Math.min(60, vscode.workspace.getConfiguration('antigravityMonitor').get('refreshSeconds', 3)));
    this.timer = setInterval(() => this.refresh(), seconds * 1000);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  updateStatus() {
    const count = this.notifications.list().length;
    if (count) { this.statusItem.text = `$(bell) ${count} ${count === 1 ? 'nova conversa' : 'novas conversas'}`; this.statusItem.show(); }
    else this.statusItem.hide();
  }
  async refresh() {
    if (this.running) return;
    this.running = true;
    try {
      const config = vscode.workspace.getConfiguration('antigravityMonitor');
      const brain = config.get('brainPath') || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
      const codexPath = config.get('codexPath') || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
      const claudePath = config.get('claudePath') || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
      const grokPath = config.get('grokPath') || path.join(process.env.GROK_HOME || path.join(os.homedir(), '.grok'), 'sessions');
      const results = await Promise.allSettled([collectSessions(brain), this.codex.collect(codexPath), collectClaude(claudePath), collectGrok(grokPath)]);
      const warnings = [];
      const sessions = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const name = ['Antigravity', 'Codex', 'Claude', 'Grok'][i];
        if (result.status === 'rejected') { warnings.push(`${name}: ${result.reason.message}`); continue; }
        if (result.value.warning) warnings.push(`${name}: ${result.value.warning}`);
        if (!result.value.warning) this.notifications.update(name, result.value.sessions);
        sessions.push(...result.value.sessions.map(s => ({ ...s, source: name })));
      }
      sessions.sort((a, b) => b.modified - a.modified);
      this.updateStatus();
      this.view?.webview.postMessage({ type: 'sessions', sessions, unread: this.notifications.list(), warning: warnings.join(' · ') });
    } catch (error) { this.view?.webview.postMessage({ type: 'error', message: error.message }); }
    finally { this.running = false; }
  }
}

function activate(context) {
  const monitor = new Monitor(context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('antigravityMonitor.view', monitor));
  context.subscriptions.push(vscode.commands.registerCommand('antigravityMonitor.open', () => vscode.commands.executeCommand('antigravityMonitor.view.focus')));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('antigravityMonitor')) { monitor.start(); monitor.refresh(); } }));
  context.subscriptions.push({ dispose: () => monitor.stop() });
  monitor.start();
  monitor.refresh();
}
exports.activate = activate;
