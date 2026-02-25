# kale

This repository is an Electron Forge + Vite + TypeScript (v5.9.3) desktop app with a
React renderer shell.

## Run Commands

- Start in development: `npm start`
- Start isolated terminal prototype view: `VITE_KALE_VIEW=terminal npm start`
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
- `src/renderer/TerminalPane.tsx`: reusable embedded PTY terminal pane component used by the main app and prototype terminal view.
- `src/renderer/TerminalView.tsx`: isolated terminal prototype wrapper view that reuses `TerminalPane`.
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
4. **External change reload**: if the disk content differs from the last saved content, it is a genuine external change (e.g. Claude writing from the terminal) and the editor reloads.
5. **Post-replacement save sync**: `markContentAsSavedFromLoad` runs after the CodeMirror dispatch (not before), so any save timers created by keystrokes during the async reload gap are cleared at the right moment.
6. **Three-way merge** (pending integration): `mergeDocumentLines(base, ours, theirs)` in `line-merge.ts` can reconcile non-conflicting edits at line granularity, with disk-wins conflict resolution. The merge function and its 35-test suite are implemented and ready to wire into the reload path.
