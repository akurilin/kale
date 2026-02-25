# kale

This repository is an Electron Forge + Vite + TypeScript (v5.9.3) desktop app with a
React renderer shell.

## Run Commands

- Start in development: `npm start`
- Start isolated terminal prototype view: `VITE_KALE_VIEW=terminal npm start`
- Start in development with a custom window size: `KALE_WINDOW_WIDTH=1800 KALE_WINDOW_HEIGHT=1100 npm start`
- Capture a screenshot of an already-running `kale` Electron window into `/tmp`: `scripts/capture_npm_start_window.sh` (optional args: capture delay seconds, output path). The script prints the generated file path.
- Format files: `npm run format`
- Check formatting: `npm run format:check`
- Lint: `npm run lint`
- Package app: `npm run package`
- Build distributables: `npm run make`

## Folder Overview

- `src/`: application source code for the Electron main process, preload layer, and renderer entry.
- `src/renderer/main.tsx`: renderer entry that mounts the React app shell.
- `src/renderer/`: extracted renderer modules for CodeMirror extensions and save/autosave controller logic.
- `src/renderer/DocumentCommentsPane.tsx`: document editor + inline comments orchestration (selection comment action, anchor-based floating comment layout/packing, sidebar wiring, autofocus handoff).
- `src/renderer/MarkdownEditorPane.tsx`: imperative CodeMirror wrapper that exposes editor content and range-anchor geometry to the React layout layer.
- `src/renderer/InlineCommentsSidebar.tsx`: presentational floating comments rail renderer (absolute-positioned card slots in the right column).
- `src/renderer/InlineCommentCard.tsx`: individual comment card UI (textarea auto-size, delete action, autofocus, resize reporting for layout).
- `src/renderer/inline-comments.ts`: parser/helpers for hidden HTML comment markers used as the canonical inline-comment source of truth.
- `src/renderer/TerminalPane.tsx`: reusable embedded PTY terminal pane component used by the main app and prototype terminal view.
- `src/renderer/TerminalView.tsx`: isolated terminal prototype wrapper view that reuses `TerminalPane`.
- `docs/`: product and architecture documentation (requirements, decisions, planning notes).
- `docs/todos.md`: tracked known issues and deferred fixes.
- `mockups/`: static UI mockups/prototypes used to explore interaction and visual direction.
- `prompts/`: runtime prompt assets (including the Claude appended system prompt used by the terminal session launcher).
- `data/`: example markdown files the app can edit
- `AGENTS.md`: repository-specific agent instructions (with `CLAUDE.md` symlinked to it at the repo root).
