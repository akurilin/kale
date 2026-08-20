# Codex Provider Research

## Status

- Research date: August 20, 2026
- Local Codex CLI checked: `codex-cli 0.147.0`
- Local authentication checked: ChatGPT sign-in is active
- Scope: offer Codex as a user-selected alternative to Claude Code
- Recommendation: add Codex through the existing PTY terminal first, then add a standard MCP adapter for live editor context
- Implementation: the first terminal release is present on this branch through `npm start -- --agent claude|codex`

## Decision

Codex can run in Kale with a small first change because the terminal pane is already a general PTY and xterm.js host. The first release does not need the Codex SDK or a new chat UI.

The current Claude integration has two separate parts:

1. The terminal process starts Claude Code with Kale instructions.
2. A Claude-specific IDE server gives Claude live file and selection context.

Codex can replace the first part with a provider launch profile. Codex cannot use the second part as it exists. The current server uses Claude's lock-file discovery, WebSocket transport, and authentication header. For full context parity, Kale must also offer its editor tools through a standard MCP transport that Codex can load.

The delivery order is:

1. Add process-start agent selection and a Codex CLI launch profile. **Complete on this branch.**
2. Keep the current Claude IDE adapter.
3. Add a standard local MCP adapter for Codex.
4. Consider Codex App Server only if Kale replaces the terminal with a native assistant UI.

## Official Codex Capabilities

The official documentation supports the proposed design:

- The Codex CLI is a stable interactive terminal UI. It works against a local repository and accepts an optional initial prompt. It can use ChatGPT sign-in or API-key sign-in. See [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) and [Authentication](https://learn.chatgpt.com/docs/auth).
- CLI flags can set the working directory, sandbox mode, approval policy, configuration overrides, and alternate-screen behavior. See [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
- The `developer_instructions` configuration key can add Kale instructions to one session. The `mcp_servers` configuration keys can define a local stdio or streamable HTTP MCP server. See [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference).
- Codex App Server is the supported protocol for a deep product integration with authentication, history, approvals, and streamed events. Its default transport is JSONL over stdio. Its WebSocket transport is experimental. See [Codex App Server](https://learn.chatgpt.com/docs/app-server).
- `codex mcp-server` exposes Codex to another MCP host. It does not give the Codex terminal access to Kale. See [Use Codex with the Agents SDK](https://learn.chatgpt.com/docs/mcp-server).

## Manual Smoke Test

The existing QA command override was sufficient to run Codex in Kale without a code change:

```text
KALE_TERMINAL_COMMAND=codex
KALE_TERMINAL_ARGS_JSON=["--sandbox","read-only","--ask-for-approval","never","--no-alt-screen"]
```

The August 20, 2026 test gave these results:

- Codex showed its normal workspace-trust prompt in Kale.
- The Codex terminal UI rendered correctly in the current xterm.js pane.
- Kale sent terminal input, and Codex returned `READY`.
- `--no-alt-screen` worked in the embedded pane.
- Shift+Enter inserted a second composer line and did not submit the prompt. Codex did not need Kale's Claude-specific key remap in this test.
- The four Kale preset buttons were enabled for the Codex process.
- The read-only temporary Markdown file did not change.
- Process cleanup stayed inside the instance-scoped QA terminal.

The full Electron distribution package was not part of this smoke test. Electron Forge completed the Vite bundles but stayed in its package file-copy step. The CDP test used the fresh `.vite/build` output through the supported `--skip-build` option.

## First Release Implementation

This branch now includes the first terminal release:

- `npm start -- --agent claude` and `npm start -- --agent codex` select the terminal agent. Claude remains the default.
- The Codex profile validates `codex --version` and starts Codex with `workspace-write`, `on-request` approvals, and `--no-alt-screen`.
- Both agents receive the same provider-neutral Kale prompt with the resolved active file path.
- Codex does not use the Claude-specific Shift+Enter remap.
- Existing shell, custom-command, and `claude-safe` QA profiles continue to work when `--agent` is absent.

Live Codex selection context and an exact one-file write boundary remain deferred.

## Current Kale Fit

### Parts that can stay

- `TerminalPane` already renders any interactive process through xterm.js.
- The terminal IPC API already supports start, input, resize, kill, output, and exit.
- The main process already starts the PTY with the active file directory as `cwd`.
- File switching already stops the old agent process and starts a new process for the new file.
- Preset buttons already send plain text and Enter to the active process.
- The file watcher and three-way merge already accept edits from an external agent.

### Parts that are Claude-specific

| Area                 | Current branch behavior                             | Remaining work                                                                  |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Provider profile     | `claude`, `claude-safe`, `codex`, shell, or custom  | Add a persisted in-app selector if process-start selection is not sufficient    |
| Install check        | Checks only the selected agent CLI                  | Add authentication-specific startup guidance                                    |
| Startup instructions | Uses provider-specific flags with one shared prompt | None for active-file context                                                    |
| Default permissions  | Codex uses `workspace-write` and `on-request`       | Decide whether Kale needs an exact one-file write boundary                      |
| Terminal rendering   | Codex uses `--no-alt-screen`                        | Verify on all target platforms                                                  |
| Multiline input      | Claude uses its remap; Codex uses native input      | Rename the cross-process keyboard mode field to remove its Claude-specific name |
| Editor discovery     | Writes `~/.claude/ide/<port>.lock`                  | Codex does not use this discovery path                                          |
| Editor MCP transport | Claude-specific WebSocket plus header               | Add standard streamable HTTP MCP for Codex, or a stdio bridge                   |
| Product text         | Uses “agent” for shared behavior                    | Continue provider-neutral wording in new features                               |

## Recommended CLI Launch

Kale should keep the user's selected Codex model and account settings. It must not force a model. A proposed command shape is:

```text
codex \
  --sandbox workspace-write \
  --ask-for-approval on-request \
  --no-alt-screen \
  -c developer_instructions=<Kale instructions>
```

The PTY `cwd` remains the active file directory. Kale can also pass `--cd <directory>` for explicit behavior, but this duplicates the PTY setting.

The Kale instructions reuse the current writing rules and comment-marker rules. They include the absolute active file path through `prompts/agent-system-prompt.md`.

The CLI override is better than a generated `AGENTS.md` file because Kale must not change a user's repository only to start an agent. Kale should also not edit the user's global Codex configuration.

### Authentication and installation

Codex supports ChatGPT and API-key sign-in. Kale should:

- check `codex --version` when Codex is selected;
- show `codex login status` guidance when authentication fails;
- link to the official install and authentication pages;
- keep the app usable when one provider is missing and another provider is installed;
- never read or copy Codex credential files.

Provider selection now controls the startup check, so Kale only requires the selected CLI. Claude remains the default for existing users.

## Editor Context Options

### Option 1: active-file instructions only

This is the smallest release. The developer instructions give Codex the active file path. Codex can read and edit the file on disk. Preset prompts that say “this document” will work because the prompt identifies the file.

Limit: Codex does not know the live selection. Manual text typed inside the Codex TUI cannot be safely rewritten by Kale because the TUI owns composer state.

### Option 2: add selection text to Kale preset prompts

Kale can add the current file path, range, and selected text to prompts that Kale sends through preset buttons. This gives useful selection behavior without a protocol change.

Limit: it does not apply to text that the user types directly into the terminal. It can also copy a large selection into terminal input.

### Option 3: standard MCP adapter for Codex

This is the recommended parity step.

Kale should keep one provider-neutral editor-state service and expose it through two adapters:

```text
renderer selection
        |
        v
editor-state service
        |
        +--> Claude IDE WebSocket adapter + ~/.claude lock file
        |
        +--> standard local MCP HTTP adapter for Codex
```

The Codex adapter should:

- bind only to `127.0.0.1` on a random port;
- use streamable HTTP MCP;
- require a random bearer token;
- expose `getCurrentSelection`, `getLatestSelection`, `getOpenEditors`, and `getDiagnostics`;
- pass its dynamic URL and token environment-variable name through per-process `-c mcp_servers.kale.*` overrides;
- stop when Kale stops;
- use current MCP protocol types, preferably through the official MCP TypeScript SDK instead of more custom protocol code.

The launch profile can add configuration with this shape:

```text
-c mcp_servers.kale.url="http://127.0.0.1:<port>/mcp"
-c mcp_servers.kale.bearer_token_env_var="KALE_CODEX_MCP_TOKEN"
-c mcp_servers.kale.required=true
```

Kale can add an instruction that tells Codex to call the selection tool when a user refers to the current selection. MCP tool access is on demand. A selection-change notification does not by itself put new text into the model context.

### Stdio bridge alternative

Codex can start a stdio MCP server through `mcp_servers.<id>.command`. Kale could package a small bridge process that connects back to Electron over a local authenticated socket.

This design avoids an HTTP listener. It adds process packaging, reconnect, and cross-platform IPC work. The local HTTP adapter is the simpler fit for the current Electron main process.

## Codex App Server Option

Codex App Server is the best fit for a future native assistant pane. Kale would start `codex app-server` over stdio and act as its client. Kale would then own:

- thread start and resume;
- per-turn file and selection input;
- model and reasoning controls;
- sandbox and approval requests;
- streaming assistant text;
- command progress and file-change events;
- diff display, interruption, and error states.

This route can give a better writing UI than a terminal. It is not the first recommendation because Kale already has a working terminal, the integration surface is much larger, and the App Server command is currently marked experimental.

The Codex SDK is for programmatic or automated runs. It is not necessary for the interactive terminal option.

## Security and File Scope

Kale's current “only edit the active file” rule is a prompt rule. Claude currently starts with a permission bypass, so this is not a hard boundary.

For Codex, the first release should improve the default:

- use `workspace-write`, not `danger-full-access`;
- use `on-request` approvals in the interactive TUI;
- do not enable the dangerous bypass flag;
- keep network search at the user's Codex default;
- sanitize the inherited child-process environment before broader release;
- do not include secrets in process arguments or terminal metadata.

`workspace-write` still allows writes in the working directory. It does not enforce one writable file. Exact single-file enforcement needs one of these designs:

- a temporary one-file workspace with reviewed synchronization back to the real file;
- a controlled edit tool that Kale owns;
- an OS sandbox policy with an exact file allowlist;
- a native App Server workflow that reviews and applies changes instead of giving direct file access.

## Implementation Status

### Completed: Codex in the terminal

1. Added spec-first tests for start argument parsing, profile resolution, and provider launch arguments.
2. Added the user-facing `--agent claude|codex` start option.
3. Added a Codex terminal profile with safe default flags.
4. Moved prompt loading and active-file token replacement to provider-neutral code.
5. Made CLI validation depend on the selected provider.
6. Kept the Claude-only Shift+Enter behavior disabled for Codex.
7. Updated product text, prerequisites, architecture notes, and QA instructions.

### Deferred improvements

1. Replace `usesClaudeCodeShiftEnterRemap` with a provider-neutral keyboard-input mode.
2. Add a persisted provider selection and an in-app selector if needed.
3. Add standard MCP support for live Codex editor context.

Primary files:

- `src/main/terminal-launch-profile.ts`
- `src/main/terminal-launch-profile.test.ts`
- `src/main/terminal-session-service.ts`
- `src/main/agent-launch-command.ts`
- `scripts/start-kale.mjs`
- `prompts/agent-system-prompt.md`
- `README.md`
- `ARCHITECTURE.md`

### Context parity release

1. Add protocol tests for a standard MCP initialize, tool list, and tool call.
2. Extract the editor state from the Claude IDE lifecycle.
3. Keep the Claude discovery adapter unchanged for compatibility.
4. Add the authenticated local streamable HTTP adapter.
5. Add dynamic Codex MCP launch overrides.
6. Add local end-to-end coverage that verifies Codex can call `getCurrentSelection`.

Primary files:

- `src/main/ide-integration-service.ts`
- `src/ide-server/*`
- a new standard MCP server module
- `src/main/terminal-session-service.ts`
- `src/main.ts`

## Test Plan

Follow the repository's spec-first and red-green-refactor rules.

### Unit tests

- Claude remains the default for an existing configuration.
- Codex profile resolution is explicit and rejects unknown provider names.
- Codex launch arguments include the safe default sandbox and approval policy.
- Codex launch arguments contain resolved Kale instructions and no unresolved path token.
- A Codex session does not use the Claude Shift+Enter mode.
- Provider-specific install errors name the correct command and official help page.
- Standard MCP returns the current file, selection, open editor, and diagnostics data.
- MCP rejects a missing or incorrect bearer token.

### CI-safe end-to-end tests

- Use a fake terminal program to assert provider selection, restart, prompt presets, and keyboard routing without a real account.
- Keep existing editor, autosave, merge, and terminal collapse tests unchanged.

### Developer-local end-to-end tests

- Start `npm start -- --agent codex` against a temporary Markdown file.
- Handle first-run sign-in or workspace trust as an explicit local prerequisite.
- Verify prompt entry, Shift+Enter behavior, resize, and process cleanup.
- In read-only mode, verify a preset can return analysis without a file change.
- In workspace-write mode, verify one requested edit reaches disk and Kale reloads it.
- With the context adapter, select text in CodeMirror and verify Codex reads the same text through MCP.

## Open Product Choices

These choices remain open for later releases:

- Whether Kale also needs a persisted, in-app agent selector.
- Whether a persisted selection applies globally or only to the current document.
- Whether a later release includes live selection parity.
- Whether Kale can continue to accept directory-wide writes or needs a stronger file boundary.

## Conclusion

Kale can offer Codex without a new assistant architecture. The first useful release is a provider-aware Codex CLI profile in the existing terminal. The main parity gap is live editor context, not terminal rendering or file editing. A standard authenticated MCP adapter closes that gap while the Claude adapter continues to use its existing discovery protocol.

Codex App Server is the correct later path only if Kale wants a native chat, approval, progress, and diff experience instead of an embedded terminal.
