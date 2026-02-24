# kale

## Current State

This repository is an Electron Forge + Vite + TypeScript (v5.9.3) desktop app with a
React renderer shell.

What works right now:

- `npm start` runs Electron Forge and opens a single-window markdown workspace.
- Prettier is configured for repository formatting (`npm run format`, `npm run format:check`).
- Startup window size defaults to `2560x1440` and can be overridden with `KALE_WINDOW_WIDTH` / `KALE_WINDOW_HEIGHT`.
- The app can open a markdown file from the UI (`Open...`) and remembers the last opened file across restarts.
- The top bar includes a `Restore Git` action that discards local changes for the current file and restores it from the repository `HEAD` version (requires `git` on `PATH`).
- On first run (or if the remembered file is unavailable), the app seeds a writable default markdown file in Electron `userData` from `data/what-the-best-looks-like.md`.
- Editing happens in a single CodeMirror 6 pane with Obsidian-style live preview behavior (markdown markers hide outside the active context while formatted text remains visible).
- Markdown heading levels (ATX and setext) now receive level-specific live-preview typography via CodeMirror line decorations, so H1/H2/H3 no longer render identically.
- The editor overrides CodeMirror's default heading underline highlight so markdown headings read like document typography instead of links.
- The default app view now combines the markdown editor (left, ~75%) and a PTY-backed terminal pane (right, ~25%) in a single window.
- The document pane now includes an MVP inline-comment workflow: selecting text and using `Add Comment` inserts hidden HTML comment markers into the markdown, highlights the anchored range, and shows an editable comment card in a right-side comments sidebar.
- The renderer UI shell is React-based while the CodeMirror editor remains an imperative CM6 integration inside a React component.
- The terminal implementation is now split into a reusable embedded `TerminalPane` component and a standalone `TerminalView` wrapper used by `VITE_KALE_VIEW=terminal`.
- The project now targets TypeScript `5.9.3` for modern type-system features and improved React typing support.
- Autosave runs 5 seconds after typing stops (and also attempts a save on blur/close).
- The active markdown file is watched in the Electron main process with `chokidar`; external edits trigger an automatic renderer reload, and app-originated saves now use a short watcher suppression window to avoid autosave self-reload churn (unsaved-local-edit protection is still not implemented).
- A separate isolated terminal prototype view can be loaded with `VITE_KALE_VIEW=terminal npm start` for PTY terminal development/testing.
- The terminal prototype now uses a PTY-backed process session and `xterm.js` rendering for interactive CLI compatibility.
- The embedded terminal currently launches `claude` directly (not a shell) with a prose-editing `--append-system-prompt` and `--dangerously-skip-permissions` for Kale-specific assistant behavior.
- The Claude appended system prompt is loaded from `prompts/claude-system-prompt.md` at app startup, and the app exits immediately if that file is missing or empty.
- The Claude prompt file supports simple token substitution for `@@KALE:ACTIVE_FILE_PATH@@`, populated per terminal session from the active markdown file path (with a first-run fallback to the app's resolved current markdown file).
- The app also exits at startup if the `claude` CLI command is not available on `PATH`, because the terminal workflow depends on Claude Code.
- The terminal prototype defaults its working directory to `data/what-the-best-looks-like.md`'s directory for predictable local testing.
- In the combined app view, the embedded terminal automatically restarts in the active document's folder when the user opens or switches files.
- Terminal prototype error paths were hardened so failed session starts and failed input sends report correctly in the `xterm.js` output/status UI without crashing.
- Packaging/making is configured through Electron Forge for:
  - Windows (`squirrel`)
  - macOS (`zip`)
  - Linux (`deb`, `rpm`)
- Electron fuses are configured for a more locked-down packaged app profile.

What is not implemented yet:

- The broader workflows from `docs/prd.md` (agent orchestration, snapshots, comment sidecars, skills, multi-doc project handling) are not yet wired into `src/`.
- The inline comments feature is MVP-only: it currently uses a top-bar `Add Comment` action (not right-click context menu), a docked sidebar (not per-highlight floating bubbles), and permissive raw-character anchoring with basic malformed-marker tolerance.
- The known editor persistence issues tracked in `docs/todos.md` are not fixed yet (packaged save path and close/save race).

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
- `src/renderer/TerminalPane.tsx`: reusable embedded PTY terminal pane component used by the main app and prototype terminal view.
- `src/renderer/TerminalView.tsx`: isolated terminal prototype wrapper view that reuses `TerminalPane`.
- `docs/`: product and architecture documentation (requirements, decisions, planning notes).
- `docs/todos.md`: tracked known issues and deferred fixes.
- `mockups/`: static UI mockups/prototypes used to explore interaction and visual direction.
- `prompts/`: runtime prompt assets (including the Claude appended system prompt used by the terminal session launcher).
- `data/`: example markdown files the app can edit
- `AGENTS.md`: repository-specific agent instructions (with `CLAUDE.md` symlinked to it at the repo root).
