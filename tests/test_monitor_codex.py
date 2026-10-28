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


def test_claude_e_grok_contagem_e_hierarquia(tmp_path):
    root = Path(__file__).resolve().parents[1]
    script = r"""
const fs=require('fs'), path=require('path');
const {collectClaude,collectGrok}=require(process.argv[1]); const root=process.argv[2];
const write=(f,items)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,items.map(x=>JSON.stringify(x)).join('\n')+'\n');};
const claude=path.join(root,'claude'), grok=path.join(root,'grok');
write(path.join(claude,'project','s1.jsonl'),[
 {type:'user',message:{content:'Olá'}},
 {type:'assistant',message:{id:'m1',content:[{type:'text',text:'Oi'}],usage:{input_tokens:10,output_tokens:2,cache_read_input_tokens:3}}},
 {type:'assistant',message:{id:'m1',content:[{type:'text',text:'Mais'}],usage:{input_tokens:10,output_tokens:5,cache_read_input_tokens:3}}},
]);
write(path.join(claude,'project','s1','subagents','agent-a.jsonl'),[{type:'assistant',message:{id:'child',content:[{type:'text',text:'Subagente'}],usage:{input_tokens:2,output_tokens:1}}}]);
const dir=path.join(grok,'project','g1');
write(path.join(dir,'updates.jsonl'),[
 {params:{_meta:{promptId:'p1'},update:{sessionUpdate:'user_message_chunk',content:{text:'Pergunta'}}}},
 {params:{_meta:{promptId:'p1'},update:{sessionUpdate:'agent_message_chunk',content:{text:'Res'}}}},
 {params:{_meta:{promptId:'p1'},update:{sessionUpdate:'agent_message_chunk',content:{text:'posta'}}}},
 {params:{update:{sessionUpdate:'turn_completed',prompt_id:'p1',usage:{inputTokens:100,outputTokens:10,cachedReadTokens:20}}}},
 {params:{update:{sessionUpdate:'turn_completed',prompt_id:'p1',usage:{inputTokens:100,outputTokens:10,cachedReadTokens:20}}}}
]);
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify({info:{id:'g1'}}));
(async()=>{
 const c=(await collectClaude(claude)).sessions; const p=c.find(s=>s.id==='claude:s1');
 if(p.children.length!==1 || p.usage.total!==18 || p.usage.output!==5 || !p.events.some(e=>e.content==='Olá')) throw Error('Claude: vínculo ou consumo incorreto');
 const g=(await collectGrok(grok)).sessions[0];
 if(g.events[1].content!=='Resposta' || g.usage.total!==110 || g.usage.cacheRead!==20) throw Error('Grok: mensagens ou contagem incorretas');
 if((await collectGrok(path.join(root,'missing'))).sessions.length!==0) throw Error('pasta inexistente');
})().catch(e=>{console.error(e);process.exit(1)});
"""
    result = subprocess.run(["node", "-e", script, str(root / "other-sessions.js"), str(tmp_path)], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_tokens_codex_sao_a_ultima_leitura_acumulada(tmp_path):
    root = Path(__file__).resolve().parents[1]
    script = r"""
const fs=require('fs'),path=require('path');const {CodexReader}=require(process.argv[1]);const f=path.join(process.argv[2],'rollout-test.jsonl');
const meta={type:'session_meta',payload:{id:'abc'}};
const usage=(i,o)=>({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:i,output_tokens:o,total_tokens:i+o,cached_input_tokens:4}}}});
fs.writeFileSync(f,[meta,usage(10,2),usage(15,3)].map(JSON.stringify).join('\n')+'\n');
new CodexReader().collect(process.argv[2]).then(r=>{if(r.sessions[0].usage.total!==18 || r.sessions[0].usage.input!==15) throw Error('total acumulado contado incorretamente');}).catch(e=>{console.error(e);process.exit(1)});
"""
    result = subprocess.run(["node", "-e", script, str(root / "codex-sessions.js"), str(tmp_path)], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_visualizacao_nativa_leitura_atualizacao_e_hierarquia():
    root = Path(__file__).resolve().parents[1]
    script = r"""
const Module=require('module'); const original=Module._load;
class Emitter { constructor(){this.calls=[];this.event=()=>{};} fire(value){this.calls.push(value);} dispose(){} }
const mock={EventEmitter:Emitter,TreeItem:class{constructor(label,state){this.label=label;this.collapsibleState=state}},TreeItemCollapsibleState:{None:0,Collapsed:1},ThemeIcon:class{constructor(id){this.id=id}},Uri:{from:o=>o},workspace:{openTextDocument:async uri=>({uri})},window:{showTextDocument:async()=>{}}};
Module._load=function(name,...rest){return name==='vscode'?mock:original.call(this,name,...rest)};
const {NativeView,conversationText}=require(process.argv[1]);
const secret='gAAAAA'+'a'.repeat(120)+'==';
const parent={id:'codex:p',source:'Codex',events:[{type:'USER_INPUT',content:'Olá'},{type:'CODEX_CALL',name:'send_message',args:{message:secret,target:'c'}}],children:[{id:'codex:c',role:'Revisor'}],usage:{total:7,input:5,output:2,label:'registrado'}};
const child={id:'codex:c',parent:'codex:p',source:'Codex',role:'Revisor',events:[{type:'PLANNER_RESPONSE',content:'Resposta'}],children:[]};
(async()=>{
 let selected='';const view=new NativeView(id=>selected=id);
 view.update([parent,child],['codex:c'],'');
 if(view.getChildren().length!==1 || view.getChildren(view.getChildren()[0])[0].role!=='Revisor') throw Error('hierarquia');
 if(!view.getTreeItem(view.getChildren(view.getChildren()[0])[0]).description.includes('nova')) throw Error('notificação');
 const text=conversationText(parent,[parent,child]);
 if(!text.includes('Olá') || !text.includes('Tokens registrados') || !text.includes('Conteúdo protegido') || text.includes(secret)) throw Error('texto ou proteção');
 await view.open('codex:c'); if(selected!=='codex:c' || !view.provideTextDocumentContent({query:'codex:c'}).includes('Resposta')) throw Error('abertura');
 child.events.push({type:'PLANNER_RESPONSE',content:'Mensagem nova'}); view.update([parent,child],[],'');
 if(view.documentEmitter.calls.length!==1 || !view.provideTextDocumentContent({query:'codex:c'}).includes('Mensagem nova')) throw Error('atualização');
 view.close({scheme:'agent-monitor',query:'codex:c'}); if(view.openUris.size) throw Error('fechamento');
})().catch(e=>{console.error(e);process.exit(1)});
"""
    result = subprocess.run(["node", "-e", script, str(root / "native-view.js")], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
