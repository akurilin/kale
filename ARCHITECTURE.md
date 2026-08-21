# ARCHITECTURE

This file is the canonical reference for Kale's architecture and repository structure.
Keep architecture updates here instead of expanding architecture details in `README.md` or `AGENTS.md`.

## Product Summary

Kale is a desktop markdown writing tool built on Electron + React + CodeMirror.
It combines:

- A prose-first markdown editor with inline comments persisted directly in markdown.
- A git-rooted repository file explorer for markdown documents.
- Git-aware file actions (`Reset`, single-file commit save).
- A PTY-backed agent terminal pane for Claude Code, Codex, or Pi.
- Local IDE context adapters for Claude Code and Pi.

## Runtime Architecture

Kale has three process layers:

1. **Main process (`src/main.ts` + `src/main/*`)**
   - Electron lifecycle orchestration.
   - File I/O, git subprocesses, file watching.
   - PTY lifecycle management.
   - IDE context adapter lifecycle.
2. **Preload bridge (`src/preload.ts`)**
   - Narrow typed IPC boundary via `contextBridge`.
3. **Renderer (`src/renderer/*`)**
   - React UI shell + CodeMirror editor + floating inline comments + xterm terminal UI.

### Startup Sequence

1. For development starts, `scripts/start-kale.mjs` consumes `--agent claude|codex|pi`, sets the terminal profile, and forwards all other arguments to Electron Forge. Claude is the default. The `start:claude`, `start:codex`, and `start:pi` npm scripts provide short aliases.
2. `app.setName('kale')` normalizes `userData` path across launch methods.
3. Optional `KALE_USER_DATA_DIR` override is applied early (used by E2E isolation).
4. Services are created:
   - markdown file service
   - terminal session service
   - IDE integration service
5. IPC handlers are registered for markdown/terminal/IDE/spellcheck/window APIs.
6. On `ready`:
   - Terminal runtime validation runs unless `KALE_SKIP_TERMINAL_VALIDATION=1`.
   - IDE context adapters start before the renderer can launch an agent.
   - Main window is created.
7. On `window-all-closed`, services shut down before quit (except standard macOS behavior).

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
- **Commit**:
  - stages/commits only the active file in that file's repository
  - stock commit message: `Edits to <filename>`
  - returns `didCreateCommit=false` when there are no changes

#### Repository Explorer Support

- Resolves the active file's git repository root with `git rev-parse --show-toplevel`.
- Builds a filesystem-backed markdown tree rooted at that repository.
- Exposes direct open-by-path activation for explorer clicks.
- Broadcasts active markdown file path changes to renderer subscribers.

### Terminal Session Service (`src/main/terminal-session-service.ts`)

Owns PTY spawn/IO/resize/kill and selected-agent startup prerequisites.

- Defaults to Claude. `npm start -- --agent claude|codex|pi` selects the user-facing agent.
- QA can override the profile with:
  - `KALE_TERMINAL_PROFILE=claude-safe`
  - `KALE_TERMINAL_PROFILE=codex`
  - `KALE_TERMINAL_PROFILE=pi`
  - `KALE_TERMINAL_PROFILE=shell`
  - `KALE_TERMINAL_COMMAND=<command>`
  - `KALE_TERMINAL_ARGS_JSON='["arg1","arg2"]'`
- Validates only the selected agent with `claude --version`, `codex --version`, or `pi --version`.
- Preloads the provider-neutral `prompts/agent-system-prompt.md` for agent profiles.
- Resolves the active file path token in the prompt template (`@@KALE:ACTIVE_FILE_PATH@@`).
- Builds the default launch command as:
  - `claude --dangerously-skip-permissions --append-system-prompt <resolved prompt>`
- Builds the safe Claude QA command as:
  - `claude --permission-mode default --tools "" --append-system-prompt <resolved prompt>`
- Builds the Codex command as:
  - `codex --sandbox workspace-write --ask-for-approval on-request --no-alt-screen -c developer_instructions=<resolved prompt>`
- Builds the Pi command without provider or model flags:
  - `pi --append-system-prompt <resolved prompt> --extension <bundled Kale extension>`
- Passes the authenticated Pi context endpoint only in the Pi child process environment.
- Uses the Claude Shift+Enter keyboard remap only for Claude profiles. Codex and Pi handle multiline input directly.
- Spawns PTY with renderer-provided initial rows/cols for correct first-frame full-screen CLI rendering.
- Streams `terminal:process-data` and `terminal:process-exit` events to renderer.

### Spellcheck Service (`src/main/spellcheck-service.ts`)

Registers the `spellcheck:add-to-dictionary` IPC handler, which calls
`session.defaultSession.addWordToSpellCheckerDictionary`. This is the only
spellcheck operation requiring main-process authority — all other checking
runs in the preload via `webFrame.isWordMisspelled` / `getWordSuggestions`.

### IDE Integration Service (`src/main/ide-integration-service.ts`)

Coordinates renderer selection events with all IDE context adapters.

- Starts and stops the Pi loopback context server.
- Starts, stops, and restarts the Claude IDE server when workspace folders change.
- Caches latest editor selection.
- Broadcasts debounced (`50ms`) `selection_changed` notifications to Claude clients.
- Gives Pi an authenticated endpoint that returns the active file and cached selection on each request.
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

## Pi IDE Context Provider (`src/pi-ide-server/*`, `integrations/pi/*`)

Implements prompt-time selection context through Pi's public extension API.

- Starts an HTTP server on an operating-system-selected loopback port.
- Requires a random per-process token in the `x-kale-ide-authorization` header.
- Passes the URL and token only to the Pi PTY child process.
- Polls the endpoint every 300 milliseconds to show the current selected line count in Pi's footer.
- Requests a new snapshot during Pi's `before_agent_start` event.
- Adds the active file, exact selected text, 0-based end-exclusive range, and selected line count only to the system prompt for the current turn.
- Sends an explicit no-selection state when the selection is empty.
- Does not set Pi provider or model flags, so Pi uses its saved configuration.

The raw TypeScript extension is an external package resource because Pi runs outside Electron and cannot read files from `app.asar`.

## IPC Surface

### Markdown IPC

- `editor:load-markdown`
- `editor:create-markdown-file`
- `editor:open-markdown-file`
- `editor:open-markdown-file-at-path`
- `editor:save-markdown`
- `editor:get-current-file-repository-markdown-tree`
- `editor:restore-current-markdown-from-git`
- `editor:commit-current-markdown-file`
- `editor:get-current-markdown-git-branch-state`
- `editor:switch-current-markdown-git-branch`
- event: `editor:external-markdown-file-changed`
- event: `editor:current-markdown-file-path-changed`

### Terminal IPC

- `terminal:start-session`
- `terminal:send-input`
- `terminal:resize-session`
- `terminal:kill-session`
- events:
  - `terminal:process-data`
  - `terminal:process-exit`

### Spellcheck IPC

- `spellcheck:add-to-dictionary`

### IDE + Window IPC

- `ide:selection-changed` (renderer -> main push)
- `window:adjust-width-by`

## Renderer Architecture

### App Shell (`src/renderer/App.tsx`)

Owns document lifecycle and top-level UI orchestration:

- Bootstraps active markdown file.
- Schedules autosave through save controller.
- Handles new/open/restore/commit actions.
- Handles explorer-driven file switches through the same save-before-switch flow.
- Keeps Git commits behind the explicit top-bar **Commit** button and does not map `Cmd+S`/`Ctrl+S` to Git.
- Treats `Saved` status as transient UI feedback (auto-clears after a short delay) so repeated saves remain visually noticeable.
- Handles explorer-pane collapse/expand, terminal-pane collapse/expand, divider drags, and native width resize requests.
- Pushes selection updates to IDE integration.
- Maintains live editor word count state for the document header badge.
- Flushes save on blur/beforeunload.

### Repository File Explorer (`src/renderer/RepositoryFileExplorerPane.tsx`)

- Loads repo-tree data through the preload markdown bridge.
- Keeps its own folder expansion, focus, and active-file reveal state.
- Listens for active-file path changes from main instead of depending on sibling props.
- Requests file opens through the app shell so save-before-switch behavior stays centralized.

### Document + Inline Comments (`src/renderer/DocumentCommentsPane.tsx`)

- Composes `MarkdownEditorPane` + floating `InlineCommentsSidebar`.
- Parses inline comments from markdown as source of truth.
- Positions comment cards by anchor geometry with overlap-avoidance packing.
- Owns comment create/update/delete interactions via editor imperative API.
- Owns one active-comment ID (`0..1`) synchronized across editor highlight and sidebar card focus.
- Routes bidirectional activation:
  - clicking highlighted text focuses the corresponding comment card
  - focusing/clicking a comment card activates the referenced editor highlight
- Clears active comment state on any pointer interaction outside the current active comment card/range.
- Handles comment-edit completion shortcut (`Cmd/Ctrl+Enter`) to defocus active comment state.

### CodeMirror Editor (`src/renderer/MarkdownEditorPane.tsx`)

Owns one long-lived `EditorView` instance and exposes an imperative handle.

- Full-document replacement preserves cursor line/column and scroll position.
- Emits selection details for IDE integration.
- Provides inline comment operations:
  - create from selection
  - update marker payload in place
  - delete marker pair in place

### Spellcheck Extension (`src/renderer/spellcheck-extension.ts`)

Self-contained CM6 linter that spell-checks prose using the Electron/macOS
system dictionary. Walks the Markdown syntax tree to skip frontmatter, code
blocks, inline code, URLs, and HTML. Caches per-word results so only newly
typed words cross the contextBridge on subsequent runs. Includes a custom
red wavy underline theme and "Add to dictionary" lint actions.

### CodeMirror Extensions (`src/renderer/codemirror-extensions.ts`)

- Markdown live-preview marker hiding.
- Inactive-line link live-preview concealment for inline links, Hugo shortcode link destinations, and autolinks.
- Heading + quote line decorations.
- Inline comment marker hiding/highlight decorations.
- Active inline comment decoration state via a dedicated CodeMirror state field/effect.
- Active comment range emphasis for the selected inline comment only.
- Atomic marker ranges + guarded Backspace/Delete behavior.
- Boundary-aware whitespace insertion at comment edges (`Space`, `Tab`, `Enter`).
- Markdown formatting shortcuts:
  - `Mod-b` toggle bold
  - `Mod-i` toggle italic
  - `Mod-Alt-1..6` convert selected lines to heading levels `#`..`######`

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
- Uses the keyboard-input mode returned by the selected agent profile.

## Repository Structure

Top-level layout and responsibilities:

- `src/main.ts`: main-process bootstrap and lifecycle wiring.
- `src/main/`: window, markdown file, agent launch, terminal session, and IDE integration services.
- `src/preload.ts`: contextBridge IPC API exposure.
- `src/shared-types.ts`: cross-process payload contracts.
- `src/ide-server/`: MCP WebSocket server + lock-file + RPC handlers.
- `src/renderer/`: React app shell, CodeMirror integration, terminal pane, API wrappers.
- `tests/e2e/`: Playwright Electron scenarios + shared harness.
- `scripts/`: development start wrapper and instance-scoped CDP QA session launcher (headless by default).
- `prompts/`: provider-neutral agent system prompt template.
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
  - comment active-focus synchronization + Cmd/Ctrl+Enter defocus behavior
  - terminal pane collapse/expand + window width behavior
  - repository file explorer open/collapse behavior
  - repository file explorer non-git suppression behavior

## Important Environment Variables

- `KALE_USER_DATA_DIR`: override Electron userData path.
- `KALE_SKIP_TERMINAL_VALIDATION=1`: skip the selected agent CLI check.
- `KALE_STARTUP_MARKDOWN_FILE_PATH`: force startup file.
- `KALE_HEADLESS=1`: hide BrowserWindow and suppress DevTools.
- `KALE_OPEN_DEVTOOLS=1`: open docked DevTools.
- `KALE_WINDOW_WIDTH`, `KALE_WINDOW_HEIGHT`: startup size overrides.
- `KALE_CDP_PORT`: CDP port override in `scripts/start-with-cdp.sh` (optional).
- `KALE_QA_INSTANCE_ID`: instance label propagated by `scripts/start-with-cdp.sh` for QA runs.

## Current Tradeoffs / Known Constraints

- Terminal output/exit events are currently broadcast to all renderer windows; per-window session ownership is not yet enforced.
- Terminal session control IPC currently trusts `sessionId` without sender-based authorization.
- Terminal spawn currently forwards full `process.env` (not yet sanitized).
- IDE diagnostics tool currently returns an empty list.
