# ARCHITECTURE

This file is the canonical reference for Kale's architecture and repository structure.
Keep architecture updates here instead of expanding architecture details in `README.md` or `AGENTS.md`.

## Product Summary

Kale is a desktop markdown writing tool built on Electron + React + CodeMirror.
It combines:

- A prose-first markdown editor with inline comments persisted directly in markdown.
- Git-aware file actions (`Reset`, branch switching, single-file commit save).
- A PTY-backed Claude Code terminal pane.
- A local IDE MCP WebSocket server so Claude Code can query live editor selection/context.

## Runtime Architecture

Kale has three process layers:

1. **Main process (`src/main.ts` + `src/main/*`)**
   - Electron lifecycle orchestration.
   - File I/O, git subprocesses, file watching.
   - PTY lifecycle management.
   - IDE MCP server lifecycle.
2. **Preload bridge (`src/preload.ts`)**
   - Narrow typed IPC boundary via `contextBridge`.
3. **Renderer (`src/renderer/*`)**
   - React UI shell + CodeMirror editor + floating inline comments + xterm terminal UI.

### Startup Sequence

1. `app.setName('kale')` normalizes `userData` path across launch methods.
2. Optional `KALE_USER_DATA_DIR` override is applied early (used by E2E isolation).
3. Services are created:
   - markdown file service
   - terminal session service
   - IDE integration service
4. IPC handlers are registered for markdown/terminal/IDE/window APIs.
5. On `ready`:
   - Terminal runtime validation runs unless `KALE_SKIP_TERMINAL_VALIDATION=1`.
   - Main window is created.
   - IDE server startup is attempted (non-fatal if it fails).
6. On `window-all-closed`, services shut down before quit (except standard macOS behavior).

## Main Process Services

### Window Service (`src/main/window.ts`)

- Creates `BrowserWindow` and loads Vite dev URL or packaged renderer file.
- Supports headless mode via `KALE_HEADLESS=1`.
- Supports optional dev tools via `KALE_OPEN_DEVTOOLS=1`.
- Supports startup size overrides via `KALE_WINDOW_WIDTH` / `KALE_WINDOW_HEIGHT` (clamped to display work area).
- Exposes `window:adjust-width-by` IPC, clamped to min window size and display bounds.

### Markdown File Service (`src/main/markdown-file-service.ts`)

Owns active-file state, settings persistence, file watcher lifecycle, and git file operations.

#### Active File Resolution Order

1. Existing cached path (if readable).
2. `KALE_STARTUP_MARKDOWN_FILE_PATH` override (created if missing).
3. `lastOpenedFilePath` from `userData/settings.json`.
4. `userData/simple.md` (seeded from bundled `data/simple.md`, or empty on fallback).

#### Watch + Broadcast

- Uses chokidar to watch the active file.
- Debounces `change/add` notifications by 150ms (dedupe only).
- Broadcasts `editor:external-markdown-file-changed` to renderer windows.

#### Git Operations for Active File

- **Reset**: restores active file from `HEAD` (`git restore`, fallback to `git checkout HEAD -- <file>`).
- **Branch state**: reports current branch, detached-head short SHA, branch list, and whether active file is modified.
- **Switch branch**:
  - validates target branch name
  - ensures active file exists on target branch
  - optional pre-switch discard of current file changes
  - uses `git switch`, fallback to `git checkout`
- **Save (commit)**:
  - stages/commits only the active file in that file's repository
  - stock commit message: `Edits to <filename>`
  - returns `didCreateCommit=false` when there are no changes

### Terminal Session Service (`src/main/terminal-session-service.ts`)

Owns PTY spawn/IO/resize/kill and Claude startup prerequisites.

- Validates `claude` CLI via `claude --version`.
- Preloads `prompts/claude-system-prompt.md`.
- Builds launch command:
  - `claude --dangerously-skip-permissions --append-system-prompt <resolved prompt>`
- Resolves active file path token in prompt template (`@@KALE:ACTIVE_FILE_PATH@@`).
- Spawns PTY with renderer-provided initial rows/cols for correct first-frame full-screen CLI rendering.
- Streams `terminal:process-data` and `terminal:process-exit` events to renderer.

### IDE Integration Service (`src/main/ide-integration-service.ts`)

Coordinates renderer selection events with the IDE MCP server.

- Starts/stops/restarts IDE server when workspace folders change.
- Caches latest editor selection.
- Broadcasts debounced (`50ms`) `selection_changed` notifications to Claude clients.
- Serializes workspace-folder updates to avoid racey restarts.

## IDE MCP Server (`src/ide-server/*`)

Implements MCP-over-WebSocket for Claude Code IDE integration.

- Binds random localhost port in `10000..65535` (with retry loop).
- Authenticates WebSocket upgrade with header:
  - `x-claude-code-ide-authorization`
- Writes discovery lock file:
  - `~/.claude/ide/<port>.lock`
  - fields: `pid`, `workspaceFolders`, `ideName`, `transport`, `authToken`
- Handles JSON-RPC methods:
  - `initialize`
  - `tools/list`
  - `prompts/list` (empty)
  - `resources/list` (empty)
  - `tools/call`
- Exposed tools:
  - `getCurrentSelection`
  - `getLatestSelection`
  - `getOpenEditors`
  - `getDiagnostics` (currently returns empty from provider)

## IPC Surface

### Markdown IPC

- `editor:load-markdown`
- `editor:create-markdown-file`
- `editor:open-markdown-file`
- `editor:save-markdown`
- `editor:restore-current-markdown-from-git`
- `editor:commit-current-markdown-file`
- `editor:get-current-markdown-git-branch-state`
- `editor:switch-current-markdown-git-branch`
- event: `editor:external-markdown-file-changed`

### Terminal IPC

- `terminal:start-session`
- `terminal:send-input`
- `terminal:resize-session`
- `terminal:kill-session`
- events:
  - `terminal:process-data`
  - `terminal:process-exit`

### IDE + Window IPC

- `ide:selection-changed` (renderer -> main push)
- `window:adjust-width-by`

## Renderer Architecture

### App Shell (`src/renderer/App.tsx`)

Owns document lifecycle and top-level UI orchestration:

- Bootstraps active markdown file.
- Schedules autosave through save controller.
- Handles new/open/restore/branch-switch/commit actions.
- Handles terminal-pane collapse/expand and native width resize requests.
- Pushes selection updates to IDE integration.
- Maintains live editor word count state for the document header badge.
- Flushes save on blur/beforeunload.

### Document + Inline Comments (`src/renderer/DocumentCommentsPane.tsx`)

- Composes `MarkdownEditorPane` + floating `InlineCommentsSidebar`.
- Parses inline comments from markdown as source of truth.
- Positions comment cards by anchor geometry with overlap-avoidance packing.
- Owns comment create/update/delete interactions via editor imperative API.

### CodeMirror Editor (`src/renderer/MarkdownEditorPane.tsx`)

Owns one long-lived `EditorView` instance and exposes an imperative handle.

- Full-document replacement preserves cursor line/column and scroll position.
- Emits selection details for IDE integration.
- Provides inline comment operations:
  - create from selection
  - update marker payload in place
  - delete marker pair in place

### CodeMirror Extensions (`src/renderer/codemirror-extensions.ts`)

- Markdown live-preview marker hiding.
- Inactive-line link live-preview concealment for inline links, Hugo shortcode link destinations, and autolinks.
- Heading + quote line decorations.
- Inline comment marker hiding/highlight decorations.
- Atomic marker ranges + guarded Backspace/Delete behavior.
- Boundary-aware whitespace insertion at comment edges (`Space`, `Tab`, `Enter`).
- Markdown formatting shortcuts:
  - `Mod-b` toggle bold
  - `Mod-i` toggle italic

### Save Controller (`src/renderer/save-controller.ts`)

- 5-second debounced autosave (`scheduleSave`).
- Immediate save path (`saveNow` / `flushPendingSave`).
- Tracks `lastSavedContent` for self-save vs external-change detection.

## File Sync and Merge Behavior

The renderer keeps editor + disk synchronized by content comparison, not timestamps:

1. User edits schedule debounced save.
2. Main watcher emits file-change event for all writes (including own writes).
3. Renderer compares reloaded disk content against `lastSavedContent`.
   - equal => self-save echo, ignore
   - different => real external change
4. If unsaved editor edits exist, three-way merge runs:
   - `base = lastSavedContent`
   - `ours = current editor content`
   - `theirs = disk content`
5. Merge uses line-level `diff3`; conflicts resolve in favor of `theirs` (disk).
6. If merge output differs from disk, merged content is scheduled for save.

## Inline Comment Data Model

Inline comments are persisted in markdown via hidden HTML marker pairs:

- Start marker:
  - `<!-- @comment:<id> start | "<json-encoded text>" -->`
- End marker:
  - `<!-- @comment:<id> end -->`

Key rules:

- IDs are random opaque values (`c_<hex>`).
- Overlapping/nested comment creation is blocked.
- Malformed/orphaned markers are ignored by parser (fail-safe behavior).
- Comment text payload is JSON-encoded and sanitizes `--` to reduce marker breakage.

## Terminal Pane Architecture (`src/renderer/TerminalPane.tsx`)

- Uses xterm.js + FitAddon in renderer.
- Auto-starts/restarts session when target file context changes.
- Measures stable geometry before start and sends initial PTY rows/cols.
- Mirrors xterm resize into PTY via `terminal:resize-session`.
- Includes preset prompt buttons that write prompt + Enter to active session.

## Repository Structure

Top-level layout and responsibilities:

- `src/main.ts`: main-process bootstrap and lifecycle wiring.
- `src/main/`: window, markdown file, terminal session, IDE integration services.
- `src/preload.ts`: contextBridge IPC API exposure.
- `src/shared-types.ts`: cross-process payload contracts.
- `src/ide-server/`: MCP WebSocket server + lock-file + RPC handlers.
- `src/renderer/`: React app shell, CodeMirror integration, terminal pane, API wrappers.
- `tests/e2e/`: Playwright Electron scenarios + shared harness.
- `scripts/`: CDP launcher and screenshot utilities.
- `prompts/`: Claude system prompt template.
- `data/`: bundled sample markdown source.
- `docs/`: product/protocol/planning docs.

## Test Coverage Shape

- Unit tests (Vitest):
  - `src/renderer/line-merge.test.ts`
  - `src/renderer/codemirror-extensions.test.ts`
- E2E tests (Playwright + Electron):
  - happy path inline comment persistence
  - boundary whitespace around inline comment anchors
  - comment typing scroll stability
  - comment deletion scroll stability
  - terminal pane collapse/expand + window width behavior

## Important Environment Variables

- `KALE_USER_DATA_DIR`: override Electron userData path.
- `KALE_SKIP_TERMINAL_VALIDATION=1`: skip Claude CLI check.
- `KALE_STARTUP_MARKDOWN_FILE_PATH`: force startup file.
- `KALE_HEADLESS=1`: hide BrowserWindow and suppress DevTools.
- `KALE_OPEN_DEVTOOLS=1`: open docked DevTools.
- `KALE_WINDOW_WIDTH`, `KALE_WINDOW_HEIGHT`: startup size overrides.
- `KALE_CDP_PORT`: CDP port override in `scripts/start-with-cdp.sh`.

## Current Tradeoffs / Known Constraints

- Terminal output/exit events are currently broadcast to all renderer windows; per-window session ownership is not yet enforced.
- Terminal session control IPC currently trusts `sessionId` without sender-based authorization.
- Terminal spawn currently forwards full `process.env` (not yet sanitized).
- IDE diagnostics tool currently returns an empty list.
