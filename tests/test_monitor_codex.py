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
 {type:'assistant',message:{id:'m1',model:'claude-sonnet-5',content:[{type:'text',text:'Oi'}],usage:{input_tokens:10,output_tokens:2,cache_read_input_tokens:3}}},
 {type:'assistant',message:{id:'m1',content:[{type:'text',text:'Mais'}],usage:{input_tokens:10,output_tokens:5,cache_read_input_tokens:3}}},
]);
write(path.join(claude,'project','s1','subagents','agent-a.jsonl'),[{type:'assistant',message:{id:'child',content:[{type:'text',text:'Subagente'}],usage:{input_tokens:2,output_tokens:1}}}]);
const dir=path.join(grok,'project','g1');
write(path.join(dir,'updates.jsonl'),[
 {params:{_meta:{promptId:'p1'},update:{sessionUpdate:'user_message_chunk',content:{text:'Pergunta'}}}},
 {params:{_meta:{promptId:'p1'},update:{sessionUpdate:'agent_message_chunk',content:{text:'Res'}}}},
 {params:{_meta:{promptId:'p1'},update:{sessionUpdate:'agent_message_chunk',content:{text:'posta'}}}},
 {params:{update:{sessionUpdate:'turn_completed',prompt_id:'p1',usage:{inputTokens:100,outputTokens:10,cachedReadTokens:20,modelUsage:{'grok-test':{}}}}}},
 {params:{update:{sessionUpdate:'turn_completed',prompt_id:'p1',usage:{inputTokens:100,outputTokens:10,cachedReadTokens:20}}}}
]);
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify({info:{id:'g1'}}));
(async()=>{
 const c=(await collectClaude(claude)).sessions; const p=c.find(s=>s.id==='claude:s1');
 if(p.children.length!==1 || p.usage.total!==18 || p.usage.output!==5 || p.models[0]?.model!=='claude-sonnet-5' || p.models[0]?.effort!==null || !p.events.some(e=>e.content==='Olá')) throw Error('Claude: vínculo, modelo ou consumo incorreto');
 const g=(await collectGrok(grok)).sessions[0];
 if(g.events[1].content!=='Resposta' || g.usage.total!==110 || g.usage.cacheRead!==20 || g.models[0]?.model!=='grok-test') throw Error('Grok: mensagens, modelo ou contagem incorretas');
 if((await collectGrok(path.join(root,'missing'))).sessions.length!==0) throw Error('pasta inexistente');
})().catch(e=>{console.error(e);process.exit(1)});
"""
    result = subprocess.run(["node", "-e", script, str(root / "other-sessions.js"), str(tmp_path)], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_modelos_e_esforcos_por_turno_e_tokens_resumidos(tmp_path):
    root = Path(__file__).resolve().parents[1]
    script = r"""
const fs=require('fs'),path=require('path');const {CodexReader}=require(process.argv[1]);const f=require(process.argv[2]);
const file=path.join(process.argv[3],'rollout-models.jsonl');
const line=x=>JSON.stringify(x)+'\n';
fs.writeFileSync(file,line({type:'session_meta',payload:{id:'model-test'}})+line({type:'turn_context',payload:{model:'gpt-6.1-sol',effort:'medium'}})+line({type:'turn_context',payload:{model:'gpt-6.1-sol',effort:'medium'}})+line({type:'turn_context',payload:{model:'gpt-6.1-terra',effort:'high'}}));
(async()=>{
 const reader=new CodexReader();let s=(await reader.collect(process.argv[3])).sessions[0];
 if(s.models.length!==2 || s.models[0].model!=='gpt-6.1-sol' || s.models[1].effort!=='high') throw Error('modelos não preservados');
 fs.appendFileSync(file,line({type:'turn_context',payload:{model:'gpt-6-luna'}}));
 s=(await reader.collect(process.argv[3])).sessions[0];
 if(s.models.length!==3 || s.models[2].effort!==null) throw Error('modelo incremental ou esforço ausente');
 if(f.compactTokens(1200000)!=='1,2 mi tokens' || f.compactTokens(null)!=='tokens indisponíveis' || f.compactTokens(0)!=='0 tokens') throw Error('resumo de tokens incorreto');
 if(!f.modelLabels(s.models)[2].includes('esforço: indisponível') || !f.modelLabels([])[0].includes('indisponíveis')) throw Error('campo ausente');
})().catch(e=>{console.error(e);process.exit(1)});
"""
    result = subprocess.run(["node", "-e", script, str(root / "codex-sessions.js"), str(root / "media" / "format.js"), str(tmp_path)], capture_output=True, text=True, check=False)
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


def test_antigravity_distingue_cache_ausente_zero_e_parcial(tmp_path):
    root = Path(__file__).resolve().parents[1]
    script = r"""
const fs=require('fs'),path=require('path');const {collectSessions}=require(process.argv[1]);
const root=process.argv[2];
function session(id,entries){const dir=path.join(root,id,'.system_generated','logs');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'transcript.jsonl'),entries.map(JSON.stringify).join('\n')+'\n');}
session('00000000-0000-0000-0000-000000000001',[{input_tokens:10,output_tokens:2}]);
session('00000000-0000-0000-0000-000000000002',[{input_tokens:10,output_tokens:2,cache_read_tokens:0}]);
session('00000000-0000-0000-0000-000000000003',[{input_tokens:10,output_tokens:2,cache_read_tokens:4},{input_tokens:5,output_tokens:1}]);
session('00000000-0000-0000-0000-000000000004',[{type:'USER_INPUT',content:'teste'}]);
(async()=>{const r=await collectSessions(root);const find=n=>r.sessions.find(s=>s.id.endsWith(n)).usage;
 if(find('1').cacheRead!==null || find('2').cacheRead!==0 || find('3').cacheRead!==4 || !find('3').label.includes('parcial') || find('4')!==null) throw Error('contagem de cache ou ausência incorreta');
})().catch(e=>{console.error(e);process.exit(1)});
"""
    result = subprocess.run(["node", "-e", script, str(root / "sessions.js"), str(tmp_path)], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_divisor_mantem_altura_apos_atualizacao():
    root = Path(__file__).resolve().parents[1]
    script = r"""
const vm=require('vm'),fs=require('fs');let saved=null;const listeners={};
class Element {constructor(tag){this.tag=tag;this.children=[];this.events={};this.style={};this.value='';this.scrollTop=0;this.attrs={};this.open=true;} append(...xs){this.children.push(...xs)} replaceChildren(){this.children=[]} addEventListener(n,f){this.events[n]=f} setAttribute(k,v){this.attrs[k]=v} getBoundingClientRect(){return {height:parseFloat(this.style.height)||150}} querySelector(selector){for(const child of this.children){if(selector==='.'+child.className)return child;const result=child.querySelector?.(selector);if(result)return result;}return null}}
const nodes={};for(const id of ['app','status','search','source','kind','new-conversations','refresh','list-container','chat-container','filters-panel','conversations-panel','chat-panel'])nodes[id]=new Element('div');nodes.kind.value='all';
nodes.app.append(nodes['list-container'],nodes['chat-container']);
const doc={getElementById:id=>nodes[id],createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
const api={getState:()=>saved,setState:x=>{saved=x},postMessage:()=>{}};
const win={innerHeight:800,scrollY:0,scrollTo:()=>{},addEventListener:(n,f)=>listeners[n]=f,removeEventListener:(n,f)=>{if(listeners[n]===f)delete listeners[n]}};
const ctx={document:doc,window:win,acquireVsCodeApi:()=>api,monitorFormat:require(process.argv[2]),monitorTree:require(process.argv[3]),monitorMarkdown:{render:()=>new Element('p')},marked:{},Intl,Date,Number,Map,Set};
vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),ctx);
const data={type:'sessions',sessions:[{id:'a',source:'Codex',modified:Date.now(),events:[],children:[],usage:null}],unread:[]};
listeners.message({data});
let splitter=nodes.app.querySelector('.list-splitter');if(!splitter || splitter.attrs.role!=='separator')throw Error('divisor ausente');
splitter.events.pointerdown({button:0,clientY:200,preventDefault(){}});listeners.pointermove({clientY:300});listeners.pointerup();
if(saved.listHeight!==250 || nodes.app.querySelector('.list').style.height!=='250px')throw Error('arraste não persistiu');
data.sessions[0].modified++;listeners.message({data});if(nodes.app.querySelector('.list').style.height!=='250px')throw Error('altura perdida ao atualizar');
splitter=nodes.app.querySelector('.list-splitter');splitter.events.keydown({key:'ArrowUp',preventDefault(){}});
if(saved.listHeight!==230)throw Error('ajuste pelo teclado falhou');
nodes['filters-panel'].open=false;nodes['filters-panel'].events.toggle();
nodes['chat-panel'].open=false;nodes['chat-panel'].events.toggle();
data.sessions[0].modified++;listeners.message({data});
if(saved.sections['filters-panel']!==false || saved.sections['chat-panel']!==false || nodes['filters-panel'].open || nodes['chat-panel'].open || saved.listHeight!==230)throw Error('estado das seções não preservado');
nodes['chat-panel'].open=true;nodes['chat-panel'].events.toggle();
if(!saved.sections['chat-panel'] || saved.sections['filters-panel']!==false)throw Error('seção não reabriu de forma independente');
let info=nodes['chat-container'].querySelector('.conversation-info');
if(!info || !info.open)throw Error('informações não iniciaram abertas');
info.open=false;info.events.toggle();
data.sessions[0].modified++;listeners.message({data});
info=nodes['chat-container'].querySelector('.conversation-info');
if(info.open || saved.conversationInfoOpen!==false || saved.listHeight!==230)throw Error('informações não permaneceram recolhidas');
info.open=true;info.events.toggle();if(!saved.conversationInfoOpen)throw Error('informações não reabriram');
"""
    result = subprocess.run(["node", "-e", script, str(root / "media" / "view.js"), str(root / "media" / "format.js"), str(root / "media" / "tree.js")], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_visualizacoes_sincronizam_filtros_e_selecao():
    root = Path(__file__).resolve().parents[1]
    script = r"""
const vm=require('vm'),fs=require('fs');const contexts=[];let shared={source:'',query:'',selected:'',kind:'all'};
class Element {constructor(tag){this.tag=tag;this.children=[];this.events={};this.style={};this.value='';this.scrollTop=0;this.open=true;this.className=''} append(...xs){this.children.push(...xs)} replaceChildren(){this.children=[]} addEventListener(n,f){this.events[n]=f} setAttribute(){} getBoundingClientRect(){return {height:150}} querySelector(selector){for(const child of this.children){if(selector==='.'+child.className)return child;const result=child.querySelector?.(selector);if(result)return result;}return null}}
const raw=fs.readFileSync(process.argv[1],'utf8');
function create(mode){
 const nodes={};for(const id of ['app','status','search','source','kind','new-conversations','refresh','list-container','chat-container','filters-panel','conversations-panel','chat-panel'])nodes[id]=new Element('div');nodes.kind.value='all';nodes.app.append(nodes['list-container'],nodes['chat-container']);
 const handlers={};const doc={body:{classList:{contains:name=>name==='mode-'+mode}},getElementById:id=>nodes[id],createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
 const api={getState:()=>null,setState:()=>{},postMessage:message=>{if(message.type==='uiState'){for(const key of ['source','query','selected','kind'])if(typeof message[key]==='string')shared[key]=message[key];for(const c of contexts)c.handlers.message({data:{type:'uiState',...shared}});}}};
 const win={innerHeight:800,scrollY:0,scrollTo:()=>{},addEventListener:(n,f)=>handlers[n]=f,removeEventListener:()=>{}};
 const ctx=vm.createContext({document:doc,window:win,acquireVsCodeApi:()=>api,monitorFormat:require(process.argv[2]),monitorTree:require(process.argv[3]),monitorMarkdown:{render:()=>new Element('p')},marked:{},Intl,Date,Number,Map,Set});vm.runInContext(raw,ctx);const c={nodes,handlers,ctx};contexts.push(c);return c;
}
const filters=create('filters'),list=create('sessions'),chat=create('chat');
const data={type:'sessions',sessions:[{id:'a',source:'Codex',modified:1,events:[{type:'USER_INPUT',content:'Primeira'}],children:[{id:'child',role:'Revisor'}]},{id:'child',parent:'a',source:'Codex',modified:1,events:[],children:[]},{id:'b',source:'Claude',modified:2,events:[{type:'USER_INPUT',content:'Segunda'}],children:[]}],unread:[]};
for(const c of contexts)c.handlers.message({data});
let items=list.nodes['list-container'].querySelector('.list').children;if(items.length!==2)throw Error('lista inicial');items[1].children.at(-1).onclick();
if(shared.selected!=='b' || vm.runInContext('selected',chat.ctx)!=='b')throw Error('chat não acompanhou seleção');
filters.nodes.kind.value='agents';filters.nodes.kind.events.change();
items=list.nodes['list-container'].querySelector('.list').children;if(items.length!==1 || shared.kind!=='agents')throw Error('filtro de agentes não sincronizado');
items[0].children.at(-1).onclick();if(shared.selected!=='child' || shared.kind!=='agents' || vm.runInContext('selected',chat.ctx)!=='child')throw Error('seleção do agente limpou filtro ou não atualizou chat');
filters.nodes.kind.value='all';filters.nodes.kind.events.change();
filters.nodes.source.value='Codex';filters.nodes.source.events.change();
items=list.nodes['list-container'].querySelector('.list').children;if(items.length!==1 || shared.source!=='Codex' || vm.runInContext('source.value',chat.ctx)!=='Codex')throw Error('filtro não sincronizado');
filters.nodes.search.value='nada';filters.nodes.search.events.input();
items=list.nodes['list-container'].querySelector('.list').children;if(items.length!==1 || items[0].className!=='empty' || shared.query!=='nada')throw Error('busca não sincronizada');
"""
    result = subprocess.run(["node", "-e", script, str(root / "media" / "view.js"), str(root / "media" / "format.js"), str(root / "media" / "tree.js")], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_arvore_filtra_chats_agentes_e_vinculos_ausentes():
    root = Path(__file__).resolve().parents[1]
    script = r"""
const {rows}=require(process.argv[1]);
const sessions=[
 {id:'chat',source:'Codex',events:[],children:[{id:'agente',role:'Revisor'}]},
 {id:'agente',parent:'chat',source:'Codex',events:[],children:[{id:'sub',role:'Testador'}]},
 {id:'sub',parent:'agente',source:'Codex',events:[{content:'procurado'}],children:[]},
 {id:'orfao',parent:'ausente',source:'Codex',role:'Isolado',events:[],children:[]},
 {id:'outro',source:'Claude',events:[],children:[]}
];
const ids=opts=>rows(sessions,{...opts,title:s=>s.id}).rows.map(r=>r.session.id).join(',');
if(ids({})!=='chat,orfao,outro')throw Error('raízes recolhidas ou órfão ausente');
if(ids({expanded:new Set(['chat','agente'])})!=='chat,agente,sub,orfao,outro')throw Error('hierarquia');
if(ids({kind:'chats'})!=='chat,outro')throw Error('filtro chats');
if(ids({kind:'agents',expanded:new Set(['agente'])})!=='agente,sub,orfao')throw Error('filtro agentes ou órfão');
if(ids({kind:'agents'})!=='agente,orfao')throw Error('agentes recolhidos');
if(ids({query:'procurado'})!=='chat,agente,sub')throw Error('busca deve revelar ancestrais');
if(ids({source:'Claude'})!=='outro')throw Error('origem');
const cycle=[{id:'x',source:'Codex',parent:'y',children:[],events:[]},{id:'y',source:'Codex',parent:'x',children:[],events:[]}];
if(!rows(cycle,{}).rows.length)throw Error('ciclo ocultou todos os registros');
"""
    result = subprocess.run(["node", "-e", script, str(root / "media" / "tree.js")], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_vinculos_antigravity_exigem_chamada_e_resultado_correspondentes(tmp_path):
    root = Path(__file__).resolve().parents[1]
    script = r"""
const fs=require('fs'),path=require('path');const {CodexReader}=require(process.argv[1]);const {linkSessions,requestInfo}=require(process.argv[2]);const {build}=require(process.argv[3]);
const dir=process.argv[4], id='aaaaaaaa-1111-2222-3333-444444444444', asyncId='bbbbbbbb-1111-2222-3333-444444444444', absent='cccccccc-1111-2222-3333-444444444444', ambiguous='dddddddd-1111-2222-3333-444444444444', other='eeeeeeee-1111-2222-3333-444444444444';
const line=x=>JSON.stringify(x)+'\n';const meta=x=>({type:'session_meta',payload:{id:x}});
const call=(id,cmd)=>({type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:id,input:'const r=await tools.exec_command({cmd:'+JSON.stringify(cmd)+'});text(JSON.stringify(r))'}});
const out=(id,value)=>({type:'response_item',payload:{type:'custom_tool_call_output',call_id:id,output:[{type:'input_text',text:JSON.stringify(value)}]}});
const output=id=>JSON.stringify({conversation_id:id,status:'SUCCESS'});
const f=path.join(dir,'rollout-parent.jsonl');fs.writeFileSync(f,[meta('parent'),
 call('a','agy --output-format json --print="oi"'),out('a',{output:output(id),exit_code:0}),
 call('b','agy --output-format json --print="oi"'),out('b',{output:'',session_id:123}),
 {type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'poll',input:'const r=await tools.write_stdin({session_id:123,chars:""});text(JSON.stringify(r))'}},
 out('poll',{output:output(asyncId),exit_code:0}),
 call('missing','agy --output-format json --print="oi"'),out('missing',{output:output(absent),exit_code:0}),
 call('ambiguous','agy --output-format json --print="oi"'),out('ambiguous',{output:output(ambiguous),exit_code:0}),
 call('resume','agy --conversation 123 --print="oi"'),out('resume',{output:output(other),exit_code:0}),
 {type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'wrong',input:'const r=await tools.exec_command({cmd:"echo agy"});text(JSON.stringify(r))'}},out('wrong',{output:output(other),exit_code:0})
].map(line).join(''));
fs.writeFileSync(path.join(dir,'rollout-other.jsonl'),[meta('other'),call('z','agy --print="oi"'),out('z',{output:output(ambiguous),exit_code:0})].map(line).join(''));
(async()=>{
 const reader=new CodexReader();const c=(await reader.collect(dir)).sessions;const p=c.find(x=>x.id==='codex:parent');
 if(!p.antigravityIds.includes(id)||!p.antigravityIds.includes(asyncId)||p.antigravityIds.includes(other))throw Error('identificação de chamadas');
 const s=[...c,...[id,asyncId,ambiguous,other].map(id=>({id,source:'Antigravity',children:[],events:[]}))];
 s.find(x=>x.id===id).children.push({id:other,role:'Subagente'});
 linkSessions(s);let ids=p.children.map(x=>x.id);
 if(!ids.includes(id)||!ids.includes(asyncId)||ids.includes(absent)||ids.includes(ambiguous)||ids.includes(other))throw Error('vínculo inseguro: '+ids);
 const graph=build(s);if(graph.parent.get(id)?.id!=='codex:parent'||graph.parent.get(other)?.id!==id)throw Error('hierarquia cruzada');
 if(requestInfo({type:'custom_tool_call',name:'exec',input:'tools.exec_command({cmd:"agy --print oi"}); tools.exec_command({cmd:"echo oi"})'}))throw Error('chamadas agrupadas ambíguas');
 const later='ffffffff-1111-2222-3333-444444444444';
 fs.appendFileSync(f,[call('late','agy --print="oi"'),out('late',{output:output(later),exit_code:0})].map(line).join(''));
 const refreshed=(await reader.collect(dir)).sessions.find(x=>x.id==='codex:parent');if(!refreshed.antigravityIds.includes(asyncId)||!refreshed.antigravityIds.includes(later))throw Error('atualização incremental');
})().catch(e=>{console.error(e);process.exit(1)});
"""
    result = subprocess.run(["node", "-e", script, str(root / "codex-sessions.js"), str(root / "antigravity-links.js"), str(root / "media" / "tree.js"), str(tmp_path)], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
