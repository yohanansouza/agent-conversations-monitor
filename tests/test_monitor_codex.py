"""Regressão para atualização incremental dos registros do monitor do Codex."""
import subprocess
from pathlib import Path


def test_monitor_reconstroi_subagentes_e_atualiza_linhas_parciais(tmp_path):
    root = Path(__file__).resolve().parents[1]
    module = root / "codex-sessions.js"
    script = r"""
const fs = require('fs');
const path = require('path');
const { CodexReader } = require(process.argv[1]);
const root = process.argv[2];
const parent = 'parent-id';
const child = 'child-id';
const line = value => JSON.stringify(value) + '\n';
const file = path.join(root, 'rollout-parent.jsonl');
fs.writeFileSync(file, line({type:'session_meta',payload:{id:parent,source:'vscode'}}));
fs.writeFileSync(path.join(root,'rollout-child.jsonl'), line({type:'session_meta',payload:{id:child,source:{subagent:{thread_spawn:{parent_thread_id:parent,agent_nickname:'Revisor'}}}}}));
(async () => {
  const reader = new CodexReader();
  let result = await reader.collect(root);
  const p = result.sessions.find(s => s.id === 'codex:parent-id');
  if (!p || p.children[0]?.role !== 'Revisor') throw Error('vínculo ausente');
  const message = line({type:'response_item',timestamp:'2026-01-01T00:00:00Z',payload:{type:'agent_message',author:'/root',recipient:'/root/revisor',content:[{text:'mensagem ao revisor'}]}});
  const middle = Math.floor(message.length / 2);
  fs.appendFileSync(file, message.slice(0, middle));
  result = await reader.collect(root);
  if (result.sessions.find(s => s.id === 'codex:parent-id').events.length) throw Error('linha parcial exibida');
  fs.appendFileSync(file, message.slice(middle));
  result = await reader.collect(root);
  const events = result.sessions.find(s => s.id === 'codex:parent-id').events;
  if (events.length !== 1 || events[0].content !== 'mensagem ao revisor') throw Error('mensagem incremental incorreta');
  result = await reader.collect(root);
  if (result.sessions.find(s => s.id === 'codex:parent-id').events.length !== 1) throw Error('mensagem duplicada');
})().catch(error => { console.error(error); process.exit(1); });
"""
    result = subprocess.run(
        ["node", "-e", script, str(module), str(tmp_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_notificacoes_ignoram_historico_e_mantem_nao_lidas():
    root = Path(__file__).resolve().parents[1]
    module = root / "notifications.js"
    script = r"""
const { Notifications } = require(process.argv[1]);
const n = new Notifications();
n.update('Codex', [{id:'antiga'}]);
if (n.list().length) throw Error('histórico não deve gerar notificação');
n.update('Codex', [{id:'antiga'}, {id:'nova'}, {id:'outra'}]);
if (n.list().length !== 2) throw Error('conversas novas não detectadas');
n.read('nova');
n.update('Codex', [{id:'antiga'}, {id:'nova'}, {id:'outra'}]);
if (n.list().join() !== 'outra') throw Error('leitura não preservada');
n.update('Antigravity', [{id:'antiga-antigravity'}]);
if (n.list().join() !== 'outra') throw Error('baseline da segunda origem falhou');
"""
    result = subprocess.run(
        ["node", "-e", script, str(module)], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr


def test_formatacao_de_mensagens_preserva_texto_e_detalhes():
    root = Path(__file__).resolve().parents[1]
    module = root / "media" / "format.js"
    script = r"""
const { formatCall, formatSystemMessage } = require(process.argv[1]);
const args = { Message: '"OLA DOIS"', Recipient: '"123"', extra: 'preservado' };
const formatted = formatCall('send_message', args, id => id === '123' ? 'agente principal' : id);
if (formatted.text !== 'OLA DOIS\n\nPara: agente principal') throw Error(formatted.text);
if (formatted.raw.extra !== 'preservado') throw Error('detalhes perdidos');
const sys = '<SYSTEM_MESSAGE>\n[Message] timestamp=2026-01-01Z sender=123 priority=HIGH content=Olá\nsegunda linha\n</SYSTEM_MESSAGE>';
const received = formatSystemMessage(sys, id => id === '123' ? 'agente principal' : id);
if (received.text !== 'De: agente principal\n\nOlá\nsegunda linha' || received.raw !== sys) throw Error('mensagem recebida incorreta');
const fallback = formatCall('send_message', { unfamiliar: 'x' }, x => x);
if (!fallback.text.includes('detalhes') || fallback.raw.unfamiliar !== 'x') throw Error('dados desconhecidos perdidos');
"""
    result = subprocess.run(
        ["node", "-e", script, str(module)], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr


def test_conteudo_protegido_e_mensagens_entre_agentes(tmp_path):
    root = Path(__file__).resolve().parents[1]
    reader = root / "codex-sessions.js"
    formatter = root / "media" / "format.js"
    script = r"""
const fs = require('fs');
const path = require('path');
const { CodexReader } = require(process.argv[1]);
const { formatCall, formatAgentMessage, isProtectedToken } = require(process.argv[2]);
const root = process.argv[3];
const token = 'gAAAAA' + 'a'.repeat(120) + '==';
const header = 'Message Type: NEW_TASK\nTask name: /root/revisor\nSender: /root\nPayload:\n';
const payload = {type:'agent_message', author:'/root', recipient:'/root/revisor', content:[{type:'input_text',text:header},{type:'encrypted_content',encrypted_content:token}]};
fs.writeFileSync(path.join(root,'rollout-test.jsonl'),
 JSON.stringify({type:'session_meta',payload:{id:'filho',source:{subagent:{thread_spawn:{parent_thread_id:'pai'}}}}})+'\n'+
 JSON.stringify({type:'response_item',timestamp:'2026-01-01T00:00:00Z',payload})+'\n');
(async () => {
 const sessions = (await new CodexReader().collect(root)).sessions;
 const event = sessions[0].events[0];
 if (!event.hasProtectedContent || event.raw.content[1].encrypted_content !== token) throw Error('registro protegido não preservado');
 const shown = formatAgentMessage(event.content, event.hasProtectedContent, () => 'agente principal', event.raw);
 if (!shown.text.includes('Nova tarefa') || !shown.text.includes('De: agente principal') || !shown.text.includes('Conteúdo protegido') || shown.text.includes(token)) throw Error('tarefa protegida exibida incorretamente');
 if (shown.raw.content[1].encrypted_content !== token) throw Error('dados originais perdidos');
 const call = formatCall('send_message', {message:token,target:'/root'}, () => 'agente principal');
 if (call.text.includes(token) || !call.text.includes('Conteúdo protegido') || call.raw.message !== token) throw Error('token enviado não foi ocultado');
 const plain = formatAgentMessage(header+'Revise os sinais.', false, x => x, {content:'original'});
 if (!plain.text.includes('Revise os sinais.') || plain.text.includes('Conteúdo protegido')) throw Error('texto legível perdido');
 if (isProtectedToken('gAAAAA curto') || isProtectedToken('a'.repeat(200))) throw Error('texto comum detectado incorretamente');
})().catch(error => {console.error(error); process.exit(1)});
"""
    result = subprocess.run(
        ["node", "-e", script, str(reader), str(formatter), str(tmp_path)],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr


def test_renderizacao_markdown_segura_e_legivel():
    root = Path(__file__).resolve().parents[1] / "media"
    script = r"""
const { render, safeUrl } = require(process.argv[1]);
const marked = require(process.argv[2]);
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this._text = ''; }
  append(...nodes) { this.children.push(...nodes); }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
}
const doc = { createElement: tag => new Element(tag), createTextNode: text => { const n = new Element('#text'); n.textContent = text; return n; } };
const md = '**Aprovado com ressalvas**, após correções.\n\n- Conversão do `PatchTST`\n- Custos\n\n```py\nprint(1)\n```\n\n[site](https://example.com) [inseguro](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n| A | B |\n|---|---|\n| x | y |';
const result = render(md, doc, marked);
const all = [];
function visit(n) { all.push(n); n.children.forEach(visit); } visit(result);
function has(tag, text) { return all.some(n => n.tag === tag && n.textContent.includes(text)); }
if (!has('strong', 'Aprovado com ressalvas') || !has('li', 'Conversão') || !has('code','PatchTST') || !has('pre','print(1)') || !has('table','xy')) throw Error('formatação não renderizada');
if (all.some(n => n.tag === 'img' || n.tag === 'script')) throw Error('HTML executável criado');
if (!result.textContent.includes('<img src=x onerror=alert(1)>')) throw Error('HTML literal não preservado');
if (all.filter(n => n.tag === 'a').length !== 1 || all.find(n => n.tag === 'a').href !== 'https://example.com/') throw Error('link inseguro ou link seguro incorreto');
if (safeUrl('javascript:alert(1)') || safeUrl('file:///C:/test') || !safeUrl('https://example.com')) throw Error('validação de URL incorreta');
"""
    result = subprocess.run(
        ["node", "-e", script, str(root / "markdown.js"), str(root / "marked.umd.js")],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
