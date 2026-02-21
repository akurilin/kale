# kale

## Current State

This repository is an Electron Forge + Vite + TypeScript desktop app.

What works right now:
- `npm start` runs Electron Forge and opens a single-window markdown workspace.
- The app is hardcoded to edit and save `data/what-the-best-looks-like.md`.
- Editing happens in a single CodeMirror 6 pane with Obsidian-style live preview behavior (markdown markers hide outside the active context while formatted text remains visible).
- Autosave runs 5 seconds after typing stops (and also attempts a save on blur/close).
- Packaging/making is configured through Electron Forge for:
  - Windows (`squirrel`)
  - macOS (`zip`)
  - Linux (`deb`, `rpm`)
- Electron fuses are configured for a more locked-down packaged app profile.

What is not implemented yet:
- The broader workflows from `docs/prd.md` (agent orchestration, snapshots, comment sidecars, skills, multi-doc project handling) are not yet wired into `src/`.

## Run Commands

- Start in development: `npm start`
- Lint: `npm run lint`
- Package app: `npm run package`
- Build distributables: `npm run make`

## Folder Overview

- `src/`: application source code for the Electron main process, preload layer, and renderer entry.
- `docs/`: product and architecture documentation (requirements, decisions, planning notes).
- `mockups/`: static UI mockups/prototypes used to explore interaction and visual direction.
- `data/`: writing samples and agent instruction/context files used for content and workflow experiments.
