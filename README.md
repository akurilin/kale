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

## Repository Structure

```text
kale/
├── data/
│   ├── AGENTS.md
│   ├── CLAUDE.md -> AGENTS.md
│   └── what-the-best-looks-like.md
├── docs/
│   ├── adrlog.md
│   └── prd.md
├── mockups/
│   └── main.md
├── src/
│   ├── index.css
│   ├── main.ts
│   ├── preload.ts
│   └── renderer.ts
├── forge.config.ts
├── index.html
├── package.json
├── tsconfig.json
├── vite.main.config.ts
├── vite.preload.config.ts
└── vite.renderer.config.ts
```

### Directory Notes

- `src/`: Electron app source (main process, preload, renderer entry).
- `docs/`: product documentation and planning artifacts.
- `mockups/`: UI mockups/prototypes.
- `data/`: content and agent policy files used for writing/editor workflow experiments.
