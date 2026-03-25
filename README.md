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

![Kale — document editor with inline comments and integrated Claude Code terminal](assets/readme-screenshot.jpg?v=2)

## Prerequisites

- [Node.js](https://nodejs.org/) v22 or later
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — powers the built-in terminal (`npm install -g @anthropic-ai/claude-code`)
- [Git](https://git-scm.com/) — used for file history, branch switching, and single-file commits

## Getting Started

```bash
git clone https://github.com/akurilin/kale.git
cd kale
npm install
npm start
```

This launches the app in development mode. On first launch, Kale opens a default scratch document. Use **File > Open** or **File > New** to work with your own Markdown files.

## Usage

### Writing

Kale is a Markdown editor. Open any `.md` file and start writing. Formatting is rendered inline as you type — headings, bold, italic, links, and code all preview live without a separate preview pane. On wider windows, the prose column stays centered on the pane and only shifts left when needed to keep inline comments visible.

### Inline Comments

Select text and add a comment to annotate your draft. Comments are stored directly in the Markdown file as HTML comment markers, so they travel with the file and work with git diffs. On wide windows, comment cards stay beside the prose column instead of drifting to the far edge of the pane.

Use comments to leave instructions for Claude ("find a citation for this", "rewrite this paragraph") or as personal notes.

### Claude Code Terminal

The right side of the window is an embedded Claude Code terminal. Claude can see your document context through the IDE MCP integration — select text in the editor and Claude knows what you're focused on.

Use the preset prompt buttons or type directly in the terminal to interact with Claude.

Collapsing or expanding the terminal only changes the workspace split inside Kale. The native window size stays fixed.

### Terminal Overrides For QA

Kale launches `claude` by default, but QA/debug sessions can swap the terminal command without editing the app code:

- `KALE_TERMINAL_PROFILE=claude-safe npm start` launches Claude without dangerous permission bypass and with tools disabled.
- `KALE_TERMINAL_PROFILE=shell npm start` launches an interactive shell instead of Claude.
- `KALE_TERMINAL_COMMAND=/bin/cat KALE_TERMINAL_ARGS_JSON='["-v"]' npm start` launches an arbitrary command with explicit JSON arguments.

The same overrides work with the CDP QA launcher. For example:

```bash
KALE_TERMINAL_PROFILE=claude-safe scripts/start-with-cdp.sh --instance claude-safe-qa
```

`KALE_TERMINAL_ARGS_JSON` is only used together with `KALE_TERMINAL_COMMAND`, and it must be a JSON array of strings so test launches stay deterministic across shells and platforms.

### Repository File Explorer

When the active file is inside a git repository, Kale shows a collapsible file explorer on the left side of the workspace rooted at that repository's top-level directory.

The explorer lists markdown files from the repository filesystem, including untracked files, and lets you expand folders and open another document with a single click. If the active file is not inside a git repository, the explorer stays unavailable.

Collapsing or expanding the explorer also keeps the native window size unchanged.

### Git Integration

Kale is git-aware. If your Markdown file is inside a git repo, you can:

- **Save (commit)**: commits just the active file with a stock message. The Save action is enabled only when the active file lives in a git repository and has changes to commit.
- **Reset**: restores the file from the latest commit
- **Switch branches**: move between branches without leaving the editor

### Keyboard Shortcuts

| Shortcut                   | Action                   |
| -------------------------- | ------------------------ |
| `Cmd/Ctrl+B`               | Bold                     |
| `Cmd/Ctrl+I`               | Italic                   |
| `Cmd/Ctrl+Option/Alt+1..6` | Heading level 1–6        |
| `Cmd/Ctrl+S`               | Save (commit)            |
| `Cmd/Ctrl+Enter`           | Finish editing a comment |

## Building Distributables

To package the app for your platform:

```bash
npm run make
```

This produces platform-specific distributables in the `out/` directory.

## Testing

- `npm test` runs the unit test suite.
- `npm run test:e2e` runs the CI-safe E2E suite.
- `npm run test:e2e:local` runs developer-local E2E scenarios, including Claude-dependent regressions such as the safe-mode `Shift+Enter` repro. This suite is intentionally kept out of CI because it requires local Claude Code access and may stay red while a Claude-only bug is being fixed.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed documentation of the codebase structure, runtime architecture, and design decisions.

Implementation notes and feature plans live in [`docs/`](docs/), including the repository explorer plan in [`docs/repository-file-explorer-pane-plan.md`](docs/repository-file-explorer-pane-plan.md).

## License

[MIT](LICENSE)
