# kale

This repository is an Electron Forge + Vite + TypeScript (v5.9.3) desktop app with a
React renderer shell.

## Run Commands

- Start in development: `npm start`
- Start in development with a custom window size: `KALE_WINDOW_WIDTH=1800 KALE_WINDOW_HEIGHT=1100 npm start`
- Capture a screenshot of an already-running `kale` Electron window into `/tmp`: `scripts/capture_npm_start_window.sh` (optional args: capture delay seconds, output path). The script prints the generated file path.
- Run tests: `npm test`
- Run tests in watch mode: `npm run test:watch`
- Format files: `npm run format`
- Check formatting: `npm run format:check`
- Lint: `npm run lint`
- Package app: `npm run package`
- Build distributables: `npm run make`

## Folder Overview

- `src/`: application source code for the Electron main process, preload layer, and renderer entry.
- `src/renderer/main.tsx`: renderer entry that mounts the React app shell.
- `src/renderer/`: extracted renderer modules for CodeMirror extensions, save/autosave controller logic, and line-level three-way merge.
- `src/renderer/DocumentCommentsPane.tsx`: document editor + inline comments orchestration (selection comment action, anchor-based floating comment layout/packing, sidebar wiring, autofocus handoff).
- `src/renderer/MarkdownEditorPane.tsx`: imperative CodeMirror wrapper that exposes editor content and range-anchor geometry to the React layout layer.
- `src/renderer/InlineCommentsSidebar.tsx`: presentational floating comments rail renderer (absolute-positioned card slots in the right column).
- `src/renderer/InlineCommentCard.tsx`: individual comment card UI (textarea auto-size, delete action, autofocus, resize reporting for layout).
- `src/renderer/line-merge.ts`: pure line-level three-way merge function for reconciling concurrent user and external (Claude) edits to the same document. Uses `node-diff3`; conflicts resolve in favor of the disk version.
- `src/renderer/inline-comments.ts`: parser/helpers for hidden HTML comment markers used as the canonical inline-comment source of truth.
- `src/renderer/TerminalPane.tsx`: reusable embedded PTY terminal pane component used by the main app, including preset prompt buttons that inject common Claude requests into the active terminal session and submit them automatically.
- `docs/`: product and architecture documentation (requirements, decisions, planning notes).
- `docs/todos.md`: tracked known issues and deferred fixes.
- `mockups/`: static UI mockups/prototypes used to explore interaction and visual direction.
- `prompts/`: runtime prompt assets (including the Claude appended system prompt used by the terminal session launcher).
- `data/`: example markdown files the app can edit
- `src/types/`: ambient TypeScript declarations for packages whose types cannot be resolved by `moduleResolution: "node"`.
- `AGENTS.md`: repository-specific agent instructions (with `CLAUDE.md` symlinked to it at the repo root).

## File Sync Architecture

The editor and the filesystem stay in sync through content-based comparison rather than timing heuristics:

1. **Save path**: user types → save controller debounces (5s) → writes to disk via IPC.
2. **File watcher**: main process uses chokidar to watch the active file and broadcasts every change to the renderer (150ms debounce for deduplication only).
3. **Self-save detection**: when a file-change notification arrives, the renderer compares the disk content to `saveController.getLastSavedContent()`. If they match, the notification is the echo-back from the app's own save and is ignored.
4. **External change with three-way merge**: if the disk content differs from the last saved content, a genuine external change occurred. When the editor has unsaved user edits, `mergeDocumentLines(base, ours, theirs)` reconciles both sets of changes at line granularity — non-conflicting edits from both sides are preserved, and conflicts resolve in favor of the disk version (external wins). If the merge preserved user edits, a save is scheduled automatically to persist the merged result.
5. **Post-replacement save sync**: `markContentAsSavedFromLoad` runs after the CodeMirror dispatch (not before), so any save timers created by keystrokes during the async reload gap are cleared at the right moment. When a merge produced content that differs from disk, the save controller's `lastSavedContent` is set to the actual disk content so it correctly detects the merged editor content as dirty.
