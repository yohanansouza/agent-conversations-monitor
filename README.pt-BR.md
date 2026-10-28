# Monitor de Agentes

[English](README.md) · **Português**

Extensão independente para acompanhar, no VS Code, registros locais de conversas do Codex, Antigravity CLI, Claude Code e Grok Build. O painel apresenta agentes e subagentes em uma lista, organiza mensagens em balões e avisa quando detecta novas conversas. **Grok Build é experimental**: validado com dados de exemplo, ainda não em uma instalação real.

Este é um projeto comunitário **não oficial**, sem vínculo ou endosso da OpenAI, Google, Anthropic ou xAI.

## Instalação

Requisitos: VS Code 1.90 ou superior e registros locais de um dos agentes compatíveis. A extensão não instala nem configura esses agentes.

1. Abra [Releases](https://github.com/yohanansouza/agent-conversations-monitor/releases/latest) e baixe o arquivo `.vsix` da versão mais recente.
2. No VS Code, abra **Extensões** com `Ctrl+Shift+X` (macOS: `Cmd+Shift+X`).
3. Clique no menu **...** da seção de extensões, escolha **Install from VSIX...** e selecione o arquivo baixado.
4. Se solicitado, reinicie as extensões ou o VS Code. Abra o ícone **Monitor de agentes** na barra lateral.

Como alternativa, execute `code --install-extension caminho/do/arquivo.vsix` em um terminal onde o comando `code` esteja configurado. Instalar uma nova versão do VSIX é um processo manual; o projeto não está publicado no Marketplace.

## Uso

- Filtre conversas por origem e escolha o agente ou subagente para ler suas mensagens.
- Pedidos e mensagens recebidas aparecem à direita; respostas e mensagens enviadas pelo agente selecionado, à esquerda. Cada origem tem sua cor e etiqueta.
- Quando os dados estão disponíveis, o painel exibe tokens registrados por agente, incluindo entrada, saída e cache conforme a origem. Não é uma fatura, estimativa de custo ou medição garantida de consumo total; cache e raciocínio podem ter regras diferentes entre fontes. Não some valores de agentes sem verificar se as métricas se sobrepõem.
- A lista resume o total de tokens; o quadro **Tokens registrados** mantém os valores detalhados. O painel identifica modelos e níveis de esforço encontrados nos registros, inclusive diferentes combinações na mesma sessão. Quando algum campo não é registrado, aparece como indisponível; os dados históricos podem ser incompletos.
- Mensagens são apresentadas com Markdown. Chamadas estruturadas são formatadas para leitura, com o registro disponível em **Detalhes técnicos**.
- O monitor atualiza os registros a cada três segundos. Novas conversas ou subagentes geram avisos clicáveis no painel e na barra de status; mensagens novas em conversas existentes não geram avisos.

Também é possível abrir o painel pela paleta de comandos: **Antigravity Monitor: Abrir visualizador**.

### Modo nativo (alternativa ao chat)

No ícone **Monitor de agentes**, abra **Conversas (modo nativo)** ou execute **Monitor de Agentes: Abrir visualização nativa** na paleta de comandos. Selecione uma conversa para abri-la em um documento somente para leitura; expanda os agentes para ver seus subagentes. O texto e os tokens disponíveis são atualizados junto com os registros, e conversas novas são marcadas na lista. O botão de atualização força uma nova leitura.

Esse modo usa a lista e o editor nativos do VS Code, sem depender da webview do chat. Mostra texto simples (a sintaxe Markdown pode permanecer visível) e não apresenta os detalhes técnicos originais. Ele não corrige erros de webview em outras extensões. O monitor não reinicia o VS Code automaticamente.

## Configuração

No VS Code, procure estas opções nas configurações:

- `antigravityMonitor.refreshSeconds`: intervalo de atualização, entre 1 e 60 segundos.
- `antigravityMonitor.codexPath`: pasta dos registros do Codex. Vazio usa `CODEX_HOME/sessions` ou `~/.codex/sessions`.
- `antigravityMonitor.brainPath`: pasta `brain` do Antigravity CLI. Vazio usa `~/.gemini/antigravity-cli/brain`.
- `antigravityMonitor.claudePath`: pasta `projects` do Claude Code. Vazio usa `CLAUDE_CONFIG_DIR/projects` ou `~/.claude/projects`.
- `antigravityMonitor.grokPath`: pasta `sessions` do Grok Build. Vazio usa `GROK_HOME/sessions` ou `~/.grok/sessions`.

O monitor consulta os arquivos também quando o painel está fechado. Conversas existentes na inicialização não são consideradas novas; avisos não lidos não persistem após reiniciar o VS Code.

## Privacidade e limitações

O código da extensão lê os arquivos locais configurados e não envia as conversas para serviços externos. Esses arquivos podem conter informações confidenciais: quem tiver acesso ao computador e ao painel poderá visualizá-las. Links HTTP/HTTPS tornam-se clicáveis; clicar em um deles abre seu destino. HTML é exibido como texto e imagens remotas não são carregadas.

O monitor depende de formatos internos dos agentes, que podem mudar. Atualizações aparecem após serem gravadas no disco e podem ter atraso. Sessões em nuvem, arquivadas ou criadas por outras interfaces podem não aparecer, e algumas sessões contêm contexto herdado. O painel exibe os 2.000 eventos mais recentes de cada sessão Codex.

Conteúdos identificados como protegidos ou com o padrão de token codificado observado são substituídos por um aviso; o registro original permanece em **Detalhes técnicos**. A extensão não decifra o conteúdo e não garante identificar todos os formatos. Ela não comprova que uma chamada ao Antigravity veio do Codex nem determina com certeza se um agente está ativo.

## Desenvolvimento

O pacote VSIX pode ser gerado localmente com Python 3:

```sh
python build_vsix.py
```

O arquivo é gerado em `dist/`. Para executar os testes, instale Python, pytest e Node.js e rode `python -m pytest tests/test_monitor_codex.py -q`. O parser Markdown Marked 17.0.5 está incluído sob sua própria licença em [media/marked-LICENSE.md](media/marked-LICENSE.md).

## Licença

O projeto usa a [licença MIT](LICENSE). Dependências de terceiros mantêm suas respectivas licenças.
