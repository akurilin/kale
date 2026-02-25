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
- Prioritize a macOS-first implementation; Linux can follow later, and Windows is not a Phase 1 target

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

Note: exact CLI flags and streaming formats should be re-verified against the installed Claude Code version at implementation time.

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

Note: SDK capabilities, hooks, and session-storage behavior should be verified against the currently targeted SDK version during implementation.

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

Phase 1 intentionally operates on the real file (no sandbox copy). That keeps implementation simple and preserves Claude Code's normal session behavior, but it also means file-safety boundaries are mostly soft constraints in the first version.

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

This is a future hardening option, not part of the current Phase 1 plan.

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

Phase 1 scope is macOS-first. Linux support can be attempted later; Windows is out of scope for the initial implementation.

Recommended guardrails for the first version:

- Run `claude` in the directory of the active file (`cwd = path.dirname(filePath)`)
- Pass Kale-specific behavior guidance via appended system prompt
- Restrict available tools where the CLI allows it
- Default to a prose-editing mode that avoids broad shell access

This gives us fast user feedback on whether the right-pane workflow feels good.

### Phase 1 file-write behavior ("at your own peril")

Kale will not attempt to lock the editor while Claude Code is running in Phase 1. Claude operates directly on the authoritative file, and the user can continue editing at the same time.

This is an intentional prototype tradeoff (not an oversight), but it means concurrent edits can race. Kale should surface this clearly in the UI (for example, with a warning in the terminal view) and treat conflict handling as a later improvement.

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

## Session Lifecycle (Decided)

Each open file gets its own persistent Claude Code session. Sessions survive app restarts and persist indefinitely until the user explicitly resets.

### How Claude Code CLI sessions work

The Claude Code CLI stores sessions as JSONL files at `~/.claude/projects/<encoded-path>/<session-uuid>.jsonl`. The encoded path replaces `/` with `-` (e.g., `/Users/alex/code/kale` becomes `-Users-alex-code-kale`).

This path/layout is treated here as currently observed behavior and should be re-verified against the Claude Code version Kale targets.

There is no server-side session state. The CLI reads the JSONL file, reconstructs the full message history, and sends it to the stateless Anthropic Messages API on every resume. Prompt caching makes replaying the unchanged conversation prefix cheap. Automatic compaction kicks in when history exceeds the context window, summarizing older turns while preserving recent ones.

Key CLI flags for session management:

- `claude --resume <uuid>` — resume a specific session by UUID
- `claude -p "prompt" --resume <uuid>` — resume in headless mode (scriptable)
- `claude --fork-session` — branch from a resumed session into a new one
- `claude --session-id <uuid>` — use a specific UUID for a new session

Flag names and semantics should be re-verified against the installed Claude Code version before implementation work starts.

### Kale's session-to-file mapping

Kale maintains a mapping from document path to Claude Code session UUID. This can be a single JSON file in Kale's app data directory:

```json
{
  "/Users/alex/writing/essay.md": "550e8400-e29b-41d4-a716-446655440000",
  "/Users/alex/writing/notes.md": "6fa459ea-ee8a-3ca4-894e-db77e160355e"
}
```

### Working directory constraint

Claude Code sessions are tied to the working directory. The CLI stores session files under `~/.claude/projects/<encoded-cwd>/` and only looks for them there. There is no `--cwd` flag — the only way to control it is to set `cwd` when spawning the process. If you resume a session from a different directory than where it was created, the CLI cannot find it and fails.

This working-directory behavior should be validated with the current Claude Code version before hard-coding UX assumptions around session resume.

This means Kale must always spawn `claude` with `cwd` set to `path.dirname(filePath)` for the active document, and must use the same directory consistently for a given file to make session resumption work.

The encoded path replaces `/` with `-` (e.g., `/Users/alex/writing` becomes `-Users-alex-writing`).

### Session resume flow

When the user opens a file:

1. Look up the UUID mapping for that file path
2. If a UUID exists, derive the expected JSONL path: `~/.claude/projects/<encoded-dirname>/<uuid>.jsonl`
3. If the JSONL file exists — spawn `claude` with `cwd` set to `path.dirname(filePath)` and `--resume <uuid>`; optionally parse the JSONL to populate the pane with conversation history
4. If the JSONL file is missing (user deleted it, CLI cleanup, different machine, etc.) — drop the stale mapping, start a fresh session, store the new UUID
5. If no mapping exists at all — start a fresh session, store the new UUID

### Session reset

"Reset session" from the user's perspective is: delete the UUID mapping for that file and start a fresh session on the next interaction. The old JSONL file stays on disk (Claude Code's normal cleanup handles it).

### Displaying conversation history

Two options, in order of safety:

1. **Collect messages as they stream in** during the current app session. Sufficient for showing "what happened since you opened the pane." Safer because it doesn't depend on internal file formats.
2. **Read the CLI's JSONL file** to show full history across app restarts. More complete but couples Kale to Claude Code's internal format, which could change between CLI versions.

Option 1 is recommended for Phase 1. Option 2 can be explored later if full history display becomes important.

Phase 1 should prefer streamed runtime events over JSONL parsing to minimize coupling to Claude Code internals.

### Note on the Agent SDK

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) uses the same JSONL format and the same `~/.claude/projects/` storage location. The difference is the integration model: the SDK is a TypeScript library you import, while the CLI is a process you spawn. The session resume mechanism is the same under the hood (client-side replay to a stateless API). If Kale moves to the Agent SDK in Phase 2, the session mapping approach described here carries over directly.

This is an assumption to verify against the SDK version Kale targets; Kale should treat SDK/CLI on-disk storage details as non-contractual unless explicitly documented.

## Development and Testing Strategy (Decided)

### Terminology

The app uses **views** as top-level screen alternatives, and **panes** as subdivisions within a view. The current app uses the editor view and embeds the Claude Code terminal as a pane in that view.

### Embedded terminal pane development

The terminal pane remains decoupled from the editor internals at the component level, but it is now mounted inside the main app view rather than behind a separate renderer-root switch. Development and testing happen through the normal `npm start` app flow.

### Why component decoupling

The editor and terminal have no reason to know about each other:

- The editor is a CodeMirror instance that reads/writes a markdown file.
- The terminal is a PTY-backed Claude Code session.
- The only future connection point is **context injection** (passing file path / content / selection from editor to terminal), which belongs in a thin coordination layer with a narrow interface above both components, not inside either one.
- For Claude's edits flowing back to the editor: Claude writes directly to the file on disk, and the editor picks up changes through its existing file-watching/reload mechanism. No coupling needed.

This means both panes can be developed, tested, and iterated on independently, while still allowing a shared coordination layer in product mode.

In product mode, the coordination layer is expected to pass editor-derived context (for example: active file path, selection, cursor, and document state) into the terminal/agent flow without coupling the terminal pane to editor internals.

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
6. Audit `node-pty` compatibility with current Electron version (if Phase 1 PTY approach is chosen)
7. Define the user interaction model (text prompt? selection-based? slash commands?)
8. Re-verify which assumptions in this document are based on observed Claude CLI/SDK behavior versus documented contracts, and update the implementation plan if needed

### Resolved decisions

- **Session lifecycle**: One persistent session per file, stored as a UUID mapping. See "Session Lifecycle" section above.
- **Session storage**: Rely on Claude Code CLI's built-in JSONL storage. Kale only stores the file-to-UUID mapping.
- **Session resume**: Check if the JSONL file exists before resuming; fall back to a fresh session if the file is missing.
- **Session reset**: User-triggered; deletes the mapping and starts fresh.
- **Conversation history display**: Phase 1 collects messages as they stream in (no dependency on internal JSONL format).
- **View terminology**: Top-level screens are "views". The current terminal implementation is an embedded pane in the editor view.
- **Isolated development**: Removed. Terminal development now happens in the main app view (`npm start`).
- **Working directory**: Claude Code must always be spawned with `cwd` set to the directory of the active file. Sessions are tied to the cwd and cannot be resumed from a different directory (no `--cwd` flag exists).
- **Phase 1 file access model**: Claude edits the authoritative file directly (no sandbox copy). Concurrent user edits are allowed in Phase 1 ("at your own peril").
- **Phase 1 platform target**: macOS first. Linux may follow later; Windows is not a Phase 1 target.
