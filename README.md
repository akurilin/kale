# kale

## Current State

This repository is currently an Electron Forge + Vite + TypeScript scaffold.

What works right now:
- `npm start` runs Electron Forge and opens a single desktop window.
- The renderer loads a basic static `index.html` page with a "Hello World" message.
- DevTools opens automatically on app launch.
- Packaging/making is configured through Electron Forge for:
  - Windows (`squirrel`)
  - macOS (`zip`)
  - Linux (`deb`, `rpm`)
- Electron fuses are configured for a more locked-down packaged app profile.

What is not implemented yet:
- The core product workflows described in `docs/prd.md` (WYSIWYG Markdown editing, agent orchestration, snapshots, comments sidecars, skills, etc.) are not yet wired into `src/`.

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
