# kale

[![CI](https://github.com/akurilin/kale/actions/workflows/ci.yml/badge.svg)](https://github.com/akurilin/kale/actions/workflows/ci.yml)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/akurilin/kale)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

An agentic word processor for technical essay writers. Combines the aesthetics of the best writing tools with the power of Claude Code, git, and Markdown.

Annotate your draft with comments — "find a link for this claim", "this paragraph reads clunky", "is this actually true?" — and Claude acts on them when you're ready. Or let Claude generate comments as an editor and writing coach, helping you refine your prose.

Kale integrates with Claude Code through its IDE MCP server (activated with `/ide`) and lets you select lines for Claude to focus on, the same way VS Code and Cursor do.

Born from the workflow behind [kuril.in](https://www.kuril.in/), packaged into the tool I wished existed.

Top-bar document actions support both opening existing files and creating new markdown files (`.md`) via a native `New...` save dialog, then immediately switching the editor to the selected file.

![Kale — document editor with inline comments and integrated Claude Code terminal](assets/readme-screenshot.jpg)

## Technology

This repository is an Electron Forge + Vite + TypeScript (v5.9.3) desktop app with a React renderer shell.

## Run Commands

- Start in development: `npm start`
- Start in development and explicitly open docked DevTools: `KALE_OPEN_DEVTOOLS=1 npm start`
- Start in development with a custom window size: `KALE_WINDOW_WIDTH=1800 KALE_WINDOW_HEIGHT=1100 npm start` (requested dimensions are clamped to the active display work area)
- Start in development with a forced startup markdown file path (overrides persisted last-opened-file for that app session): `KALE_STARTUP_MARKDOWN_FILE_PATH=/tmp/kale-repro.md npm start`
- Capture a screenshot of an already-running `kale` Electron window into `/tmp` as a JPG: `scripts/capture_npm_start_window.sh` (optional args: capture delay seconds, output path). The script prints the generated file path.
- Run unit tests: `npm test`
- Run unit tests in watch mode: `npm run test:watch`
- Run E2E test (builds the app first): `npm run test:e2e`
- Format files: `npm run format`
- Check formatting: `npm run format:check`
- Lint: `npm run lint`
- Package app: `npm run package`
- Build distributables: `npm run make`

## Architecture

Project architecture and repository-structure documentation now lives in [`ARCHITECTURE.md`](ARCHITECTURE.md).
Update that file whenever the implementation changes.
