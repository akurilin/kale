# Claude Code IDE Integration Protocol

How Claude Code CLI communicates with editors (VS Code, Cursor, JetBrains, Neovim, etc.)
to detect open files, selections, and diagnostics. This document captures the protocol
details needed to replicate this integration for Kale's custom editor.

## Architecture Overview

The IDE extension runs a **local WebSocket server** that speaks MCP (Model Context Protocol)
over JSON-RPC 2.0. Claude Code CLI is the **client** that connects to it. This is the
inverse of a typical MCP setup — the IDE is the server, not the client.

## Service Discovery via Lock File

When the IDE extension starts, it spins up a WebSocket server on a random port (range
10000–65535) and writes a lock file to:

```
~/.claude/ide/<port>.lock
```

Lock file contents:

```json
{
  "pid": 12345,
  "workspaceFolders": ["/path/to/project"],
  "ideName": "VS Code",
  "transport": "ws",
  "authToken": "550e8400-e29b-41d4-a716-446655440000"
}
```

Claude Code CLI **scans this directory** on startup to discover any running IDE server.
The `authToken` is sent via the `x-claude-code-ide-authorization` HTTP header during
the WebSocket handshake.

### Environment Variables (IDE-launched terminals)

When the extension launches Claude Code from the IDE's integrated terminal (rather than
the CLI connecting independently), it sets two environment variables:

```
ENABLE_IDE_INTEGRATION=true
CLAUDE_CODE_SSE_PORT=<port>
```

This tells the CLI exactly which port to connect to without scanning the lock file directory.

## WebSocket Handshake

```
GET ws://localhost:<port>/
x-claude-code-ide-authorization: <authToken from lock file>
```

## MCP Tools Exposed by the IDE

Once connected, Claude Code can call these tools on the IDE server via JSON-RPC 2.0:

| Tool                  | Purpose                                                    |
|-----------------------|------------------------------------------------------------|
| `getCurrentSelection` | Selected text + line/char coordinates in the focused editor |
| `getLatestSelection`  | Most recent selection across any editor tab                 |
| `getOpenEditors`      | All open tabs with file paths and metadata                  |
| `getDiagnostics`      | LSP errors/warnings per file (TypeScript, Pylance, etc.)    |
| `openFile`            | Ask the IDE to open a specific file                         |
| `openDiff`            | Show proposed changes in the IDE's diff viewer (blocking)   |
| `checkDocumentDirty`  | Check if a file has unsaved changes                         |
| `saveDocument`        | Save a file                                                 |
| `close_tab`           | Close a specific tab                                        |
| `closeAllDiffTabs`    | Close all diff tabs                                         |
| `executeCode`         | Execute code in a Jupyter kernel (for notebook files)       |

### Example: getDiagnostics call

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "tools/call",
  "params": {
    "name": "getDiagnostics",
    "arguments": { "uri": "file:///Users/alex/code/kale/src/main.ts" }
  }
}
```

## Two-Way Communication

### Push: IDE to Claude (proactive notifications)

The extension monitors editor events (cursor movement, selection change, active tab switch)
with a **~50ms debounce**. On change, it sends a `workspace/didChangeActiveEditor` MCP
notification to Claude Code containing:

- Current file path
- Selected text
- Position range (start/end line and column)

The extension also injects **system reminder messages** into Claude's context, e.g.:
> "The user opened the file [path] in the IDE. This may or may not be related to the current task."

### Pull: Claude to IDE (on-demand queries)

Claude Code can call `getCurrentSelection` or `getLatestSelection` at any time to fetch
the current editor state. These return:

- Absolute file path
- Line/column range
- The actual selected text

## @-mentions and File References

When the user presses `Option+K` (Mac) / `Alt+K` (Windows/Linux) with text selected in
VS Code, the extension inserts an `@file.ts#5-10` reference into the prompt. Under the
hood, this sends an `at_mentioned` MCP notification from the IDE to Claude Code, passing
the file path and line range explicitly alongside the message.

## Implementation Plan for Kale

To make Claude Code aware of what the user has open/selected in Kale's editor:

### Step 1: Start a WebSocket server

Spin up a WebSocket server on a random port in the 10000–65535 range from the Electron
main process.

### Step 2: Write the lock file

Write to `~/.claude/ide/<port>.lock`:

```json
{
  "pid": <electron process pid>,
  "workspaceFolders": ["<open project path>"],
  "ideName": "Kale",
  "transport": "ws",
  "authToken": "<generated uuid>"
}
```

Clean up the lock file on app exit.

### Step 3: Implement JSON-RPC 2.0 MCP tool handlers

At minimum, implement:

- `getCurrentSelection` — return file path, selection range, and selected text from
  the active editor pane
- `getOpenEditors` — return list of open file tabs
- `getDiagnostics` — return any available diagnostics (can start with empty array)

### Step 4: Send proactive notifications

When the user changes their selection or switches files, send
`workspace/didChangeActiveEditor` notifications over the WebSocket with the updated
editor state.

### Step 5: Handle auth

Validate the `x-claude-code-ide-authorization` header on incoming WebSocket connections
against the `authToken` in the lock file.

## Reference Implementations

- **[claudecode.nvim](https://github.com/coder/claudecode.nvim)** — Neovim implementation
  with a `PROTOCOL.md` documenting the full spec. Best reference for third-party integration.
- **[claude-code-ide.el](https://github.com/manzaltu/claude-code-ide.el)** — Emacs
  implementation that independently arrived at the same architecture.

## Sources

- [Claude Code VS Code Docs](https://code.claude.com/docs/en/vs-code)
- [Claude Code JetBrains Docs](https://code.claude.com/docs/en/jetbrains)
- [claudecode.nvim PROTOCOL.md](https://github.com/coder/claudecode.nvim)
- [MCP Transports Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
