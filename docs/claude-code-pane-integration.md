# Claude Code Right-Pane Integration Plan

## Why This Exists

This note captures integration options for embedding a Claude Code-powered assistant pane in Kale so we can resume implementation planning later without redoing the research.

The goal is a right-side pane that gives users Claude Code-level power while staying focused on the currently open file (especially a single markdown document).

## Goals

- Show a Claude Code session inside the app UI (right pane)
- Allow interactive user input/output in real time
- Keep the agent focused on the current file when possible
- Avoid unintended edits to sibling markdown files
- Start with a fast prototype, then move toward stronger control

## Core Integration Options

## 1. Embed the Existing Claude Code CLI in a Terminal Pane (Fastest)

Use a PTY-backed terminal inside Electron and spawn the user's installed `claude` CLI.

### Technical shape

- Renderer: `xterm.js` for terminal rendering/input
- Main process: `node-pty` to spawn and manage a real PTY session
- Preload IPC bridge for:
  - `start`
  - `input`
  - `resize`
  - `kill`
  - streamed output events

### Why this is useful

- Fastest path to a working prototype
- Reuses the user's existing Claude Code install and authentication
- Preserves familiar terminal workflow and behavior

### Limitations

- Hard to strictly enforce single-file-only behavior
- Behavior control is mostly prompt/tool/cwd based (soft constraints)
- Output is terminal text, which is harder to structure into app-native UI

## 2. Run Claude Code Headlessly (`-p`) and Stream JSON (More Structured)

Use Claude Code in non-interactive mode with structured output events (`--output-format stream-json`) and build a custom right-pane UI.

### Why this is useful

- Easier to present events/messages in a clean app UI
- Easier to inject current-file context on every request
- Better foundation for app-specific UX like diff review and approvals

### Limitations

- Less like a "real terminal" experience
- Requires building a session UI model in Kale
- Multi-turn session behavior needs explicit app orchestration

## 3. Use the Claude Agent SDK (Best Long-Term Product Architecture)

Use the Anthropic Claude Agent SDK (TypeScript) to run Claude Code-style agent workflows with stronger app-level control.

### Why this is useful

- Strongest control over tools and permissions
- Better streaming integration for a rich side pane
- Cleaner foundation for file-aware workflows (selection-based edits, approvals)
- Supports policy enforcement in code instead of relying on prompts

### Limitations

- More engineering work than terminal embedding
- We need to design the interaction model rather than inheriting the CLI UX

## File-Scoped Containment Strategy (Important)

Prompt instructions alone are not enough to keep the agent restricted to one file. We should use layered controls.

### Soft controls (good but not sufficient)

- Set `cwd` close to the target file
- Add strong system/app prompts describing Kale's file-focused behavior
- Re-inject file-focused instructions on every turn (instead of only once)
- Prefer limited tools and disallow shell access for prose-editing mode

### Hard controls (preferred)

- Restrict tools to edit/read operations only when possible
- Use allowlists/disallowlists for tools
- In SDK mode, implement permission checks (`canUseTool`) that deny reads/writes outside the active file or allowlist

### Strongest containment (sandbox copy)

Create a per-file temporary working directory and copy (or selectively sync) only the active file into it, then run Claude there.

Benefits:

- Prevents accidental edits to sibling files by construction
- Keeps agent exploration local to a safe workspace
- Lets Kale review and sync approved changes back to the real file

Tradeoff:

- Requires file sync / patch apply logic

## Instruction Persistence and Context Drift

Initial prompt instructions can be compacted or fall out of a sliding context window over time.

To reduce drift:

- Keep durable instructions in Claude Code config files (`CLAUDE.md` / `.claude/CLAUDE.md`) where applicable
- Re-append Kale-specific behavior instructions each turn in headless/SDK flows
- Treat prompts as guidance, not enforcement
- Enforce boundaries in tool permission logic whenever possible

## Recommended Phased Approach for Kale

## Phase 1: Validate UX Quickly (PTY + Claude CLI)

Build a real terminal pane that runs `claude` through `node-pty`.

Recommended guardrails for the first version:

- Start each session in a per-file sandbox directory
- Pass Kale-specific behavior guidance via appended system prompt
- Restrict available tools where the CLI allows it
- Default to a prose-editing mode that avoids broad shell access

This gives us fast user feedback on whether the right-pane workflow feels good.

## Phase 2: Product-Grade Assistant Pane (Agent SDK)

Move from terminal embedding to a structured assistant pane using the Claude Agent SDK.

Target capabilities:

- File-aware context injection (file content, cursor, selection)
- Streaming structured events in the right pane
- Diff previews and explicit apply/reject controls
- Hard file/path permission enforcement
- Better telemetry and session state management

## Electron Architecture Notes

## For PTY Terminal Embedding

- Run the PTY in the Electron main process (not renderer)
- Use preload IPC to expose a narrow terminal/session API
- Stream PTY bytes to the renderer and write user keystrokes back to the PTY
- Support terminal resize and process lifecycle cleanup

Why main process:

- Better security and OS process control
- Avoids giving the renderer broad local execution access

## For Structured Agent Pane

Use an app-managed request/response loop (Claude Code headless or Agent SDK):

- Build request from current file + selection + app instructions
- Stream events into the pane UI
- Review proposed changes as diffs
- Apply only approved edits to the real file

This aligns better with Kale's "writing tool + agent" product direction than a permanent terminal UI.

## Product/Compliance Note to Revisit

Before shipping broadly, verify Anthropic product and auth requirements for the chosen integration path.

- Embedding the user's local `claude` CLI may be different from shipping a third-party in-app Claude login experience
- Agent SDK integrations may require API-key/cloud-auth patterns and compliance with Anthropic developer policies

This should be checked again when implementation starts.

## Resume Checklist

When we resume this work:

1. Confirm current Claude Code CLI flags and capabilities (`tools`, JSON streaming, system prompt append)
2. Decide Phase 1 vs Phase 2 implementation target
3. Define Kale's file-scoping policy (prompt-only vs sandbox vs enforced permissions)
4. Design the IPC contract for the right pane
5. Build a minimal prototype and test with a single markdown file workflow
