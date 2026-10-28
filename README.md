# Agent Monitor

**English** · [Português brasileiro](README.pt-BR.md)

An independent VS Code extension for viewing locally recorded conversations from Codex, Antigravity CLI, Claude Code, and Grok Build. It groups agents and subagents, displays messages in chat bubbles, and alerts you when new conversations appear. **Grok Build support is experimental** and has been tested with synthetic fixtures, not a real installation.

This community project is **unofficial** and is not affiliated with or endorsed by OpenAI, Google, Anthropic, or xAI.

## Install

Requirements: VS Code 1.90 or later and local records from a supported agent. This extension does not install or configure the agents.

1. Download the `.vsix` file from the [latest release](https://github.com/yohanansouza/agent-conversations-monitor/releases/latest).
2. Open **Extensions** in VS Code with `Ctrl+Shift+X` (macOS: `Cmd+Shift+X`).
3. Select **... → Install from VSIX...** and choose the downloaded file.
4. Restart extensions or VS Code if prompted. Open **Monitor de agentes** in the activity bar.

Alternatively, run `code --install-extension path/to/file.vsix`. Updates from GitHub releases must be installed manually; the extension is not published on the VS Code Marketplace.

## Features

- Use the four independent **Filtros**, **Conversas encontradas**, **Chat**, and **Conversas (modo nativo)** views. The VS Code **...** menu shows or hides each view, and the view dividers resize them. Filters and conversation selection are synchronized between views.
- Filter the conversation list to show all records, chats only, or agents only. Expand chats and agents to browse recorded child relationships; search reveals matching descendants and their ancestors. Agents whose parent record is unavailable are identified without inventing a connection. The type filter applies to the conversation list; the native view remains independent.
- Antigravity sessions can appear under the Codex chat that started them when an explicit `agy` invocation returns a conversation ID matching local records. Ambiguous invocations, resumed conversations, missing logs, and unrecognized formats remain independent; not every invocation can be identified.
- Filter sessions by provider, browse agent and subagent relationships, and read messages with Markdown formatting.
- New conversations produce clickable notices in the panel and status bar. New messages within an existing session do not trigger notices.
- Where records contain usage data, show per-agent input, output, cache and total tokens. These are recorded values, not a bill or guaranteed account-wide total; cache and reasoning conventions differ by provider. Agent totals may overlap.
- The conversation list shows a compact token total while the detailed usage panel remains available. Recorded model and reasoning-effort combinations are shown per session where available; absent fields are marked unavailable and historical records may be incomplete.
- Antigravity CLI totals sum only entries that record input and output; zero cache differs from unavailable cache, and partially recorded cache is labelled as partial. Model and effort are shown only when recorded by the source.
- Protected content and recognized encoded tokens are hidden behind an explanatory notice; original records remain in **Detalhes técnicos**. The monitor does not decrypt them.
- **Native fallback:** Open **Conversas (modo nativo)** in the activity bar, or run **Monitor de Agentes: Abrir visualização nativa** from the command palette. Select a conversation to read it in a read-only native editor and expand agents to browse subagents. Messages and available token counts refresh from the local records, and new conversations are marked in the list. This view does not rely on the chat webview, displays plain text (Markdown syntax may remain visible), and does not show the original technical details. It cannot fix webview errors in other extensions and does not automatically restart VS Code.

## Configuration

Search VS Code settings for:

- `antigravityMonitor.refreshSeconds`: polling interval, 1–60 seconds.
- `antigravityMonitor.codexPath`: Codex sessions directory; defaults to `CODEX_HOME/sessions` or `~/.codex/sessions`.
- `antigravityMonitor.brainPath`: Antigravity CLI brain directory; defaults to `~/.gemini/antigravity-cli/brain`.
- `antigravityMonitor.claudePath`: Claude Code projects directory; defaults to `CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects`.
- `antigravityMonitor.grokPath`: Grok Build sessions directory; defaults to `GROK_HOME/sessions` or `~/.grok/sessions`.

Polling continues while VS Code is open, including when the panel is hidden. Existing sessions at startup are not announced as new, and unread notifications are not retained after restart.

## Privacy and limitations

The extension reads configured local files and does not transmit conversation content to external services. Those records can contain sensitive information visible to anyone with access to your computer and the panel. HTTP/HTTPS links are clickable and open their destination; HTML is rendered as text, and remote images are not loaded.

Providers use internal formats that may change. Records can be delayed, missing, protected, or inherited from earlier contexts. Cloud, archived, and other application sessions may not appear. Only the latest 2,000 Codex events per session are displayed. Usage fields can be missing, incomplete, or differ between providers; unavailable values are not estimated. The monitor cannot reliably determine whether an agent is active.

Claude Code has been checked against locally available session files. Grok Build support is based on documented ACP session updates and synthetic examples; other Grok clients and future schema changes are not guaranteed to work.

## Development

Run `python build_vsix.py` to create a VSIX under `dist/`. Run `python -m pytest tests/test_monitor_codex.py -q` with Python, pytest, and Node.js installed. The bundled Markdown parser Marked 17.0.5 has its own [license](media/marked-LICENSE.md).

The project is licensed under the [MIT License](LICENSE); third-party dependencies retain their own licenses.
