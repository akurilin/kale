# kale

## Current State

This repository is an Electron Forge + Vite + TypeScript desktop app with a
React renderer shell.

What works right now:

- `npm start` runs Electron Forge and opens a single-window markdown workspace.
- Prettier is configured for repository formatting (`npm run format`, `npm run format:check`).
- Startup window size defaults to `2560x1440` and can be overridden with `KALE_WINDOW_WIDTH` / `KALE_WINDOW_HEIGHT`.
- The app can open a markdown file from the UI (`Open...`) and remembers the last opened file across restarts.
- On first run (or if the remembered file is unavailable), the app seeds a writable default markdown file in Electron `userData` from `data/what-the-best-looks-like.md`.
- Editing happens in a single CodeMirror 6 pane with Obsidian-style live preview behavior (markdown markers hide outside the active context while formatted text remains visible).
- The renderer UI shell is React-based while the CodeMirror editor remains an imperative CM6 integration inside a React component.
- Autosave runs 5 seconds after typing stops (and also attempts a save on blur/close).
- Packaging/making is configured through Electron Forge for:
  - Windows (`squirrel`)
  - macOS (`zip`)
  - Linux (`deb`, `rpm`)
- Electron fuses are configured for a more locked-down packaged app profile.

What is not implemented yet:

- The broader workflows from `docs/prd.md` (agent orchestration, snapshots, comment sidecars, skills, multi-doc project handling) are not yet wired into `src/`.
- The known editor persistence issues tracked in `docs/todos.md` are not fixed yet (packaged save path and close/save race).

## Run Commands

- Start in development: `npm start`
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
- `docs/`: product and architecture documentation (requirements, decisions, planning notes).
- `docs/todos.md`: tracked known issues and deferred fixes.
- `mockups/`: static UI mockups/prototypes used to explore interaction and visual direction.
- `data/`: example markdown files the app can edit
- `AGENTS.md`: repository-specific agent instructions (with `CLAUDE.md` symlinked to it at the repo root).
