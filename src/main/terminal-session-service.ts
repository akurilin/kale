import { app, BrowserWindow, type IpcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import * as nodePty from 'node-pty';

import type {
  ResizeTerminalSessionRequest,
  StartTerminalSessionRequest,
  StartTerminalSessionResponse,
  TerminalProcessExitEvent,
} from '../shared-types';

const execFileAsync = promisify(execFile);
const KALE_PROMPT_ACTIVE_FILE_PATH_TOKEN = '@@KALE:ACTIVE_FILE_PATH@@';

type TerminalSessionServiceDependencies = {
  ensureCurrentMarkdownFilePath: () => Promise<string>;
};

// Terminal service is created once by main and owns PTY process state so only
// narrow IPC commands can reach the local shell/Claude CLI process objects.
export const createTerminalSessionService = (
  dependencies: TerminalSessionServiceDependencies,
) => {
  let bundledClaudeSystemPromptMarkdownText: string | null = null;
  const terminalSessionsById = new Map<string, nodePty.IPty>();

  // Prompt assets are resolved from the packaged app root so dev and packaged
  // builds use the same logical path and startup fails consistently if missing.
  const getBundledClaudeSystemPromptMarkdownFilePath = () =>
    path.resolve(app.getAppPath(), 'prompts', 'claude-system-prompt.md');

  // Claude launches depend on the bundled prompt template, so startup preloads
  // and validates it once instead of paying file I/O on every new session.
  const loadBundledClaudeSystemPromptMarkdownOrThrow = async () => {
    const promptFilePath = getBundledClaudeSystemPromptMarkdownFilePath();
    const promptMarkdownText = (
      await fs.readFile(promptFilePath, 'utf8')
    ).trim();
    if (!promptMarkdownText) {
      throw new Error(`Claude system prompt file is empty: ${promptFilePath}`);
    }

    bundledClaudeSystemPromptMarkdownText = promptMarkdownText;
  };

  // Session launch command construction depends on startup preload, so this
  // guard makes the failure mode explicit if startup wiring regresses.
  const getRequiredBundledClaudeSystemPromptMarkdownText = () => {
    if (bundledClaudeSystemPromptMarkdownText) {
      return bundledClaudeSystemPromptMarkdownText;
    }

    throw new Error(
      `Claude system prompt not loaded. Expected startup preload from ${getBundledClaudeSystemPromptMarkdownFilePath()}.`,
    );
  };

  // Prompt templates intentionally support only a small token set so prompt
  // interpolation remains auditable and fails hard on unexpected placeholders.
  const buildClaudeSystemPromptFromTemplate = (activeFilePath: string) => {
    const promptTemplate = getRequiredBundledClaudeSystemPromptMarkdownText();
    const promptText = promptTemplate.replaceAll(
      KALE_PROMPT_ACTIVE_FILE_PATH_TOKEN,
      activeFilePath,
    );

    const unresolvedTokenMatch = promptText.match(/@@KALE:[A-Z0-9_]+@@/);
    if (unresolvedTokenMatch) {
      throw new Error(
        `Unresolved Claude system prompt token: ${unresolvedTokenMatch[0]}`,
      );
    }

    return promptText;
  };

  // Kale's primary workflow depends on the Claude CLI binary, so startup checks
  // PATH reachability before the UI opens to avoid later confusing failures.
  const ensureClaudeCliIsInstalledOrThrow = async () => {
    try {
      await execFileAsync('claude', ['--version'], {
        windowsHide: true,
      });
    } catch (error) {
      const commandError = error as NodeJS.ErrnoException & { stderr?: string };
      const stderrText = commandError.stderr?.trim();
      const failureDetail =
        stderrText ||
        commandError.message ||
        'Unknown Claude CLI startup check error';

      throw new Error(
        `Claude CLI is required but was not found or could not be executed via PATH. Install Claude Code and ensure the 'claude' command is available. Details: ${failureDetail}`,
      );
    }
  };

  // Session IDs stay opaque and renderer-generated IDs are avoided so main can
  // remain the authority for PTY process lookup and lifecycle management.
  const createTerminalSessionId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  // Terminal launches always append Kale-specific prose guidance and derive the
  // target file from the active editor when the renderer omits a path.
  const resolveTerminalLaunchCommand = async (
    request: StartTerminalSessionRequest,
  ) => {
    const activeFilePathForPrompt = request.targetFilePath.trim()
      ? request.targetFilePath.trim()
      : await dependencies.ensureCurrentMarkdownFilePath();

    return {
      command: 'claude',
      args: [
        '--dangerously-skip-permissions',
        '--append-system-prompt',
        buildClaudeSystemPromptFromTemplate(activeFilePathForPrompt),
      ],
    };
  };

  // PTYs are spawned in main so renderers can stream I/O while process creation
  // remains centralized and easier to lock down as the terminal feature evolves.
  const startTerminalSession = async (
    request: StartTerminalSessionRequest,
  ): Promise<StartTerminalSessionResponse> => {
    const { command, args } = await resolveTerminalLaunchCommand(request);
    const sessionId = createTerminalSessionId();

    try {
      const terminalProcess = nodePty.spawn(command, args, {
        cwd: request.cwd,
        // TODO(terminal-prototype): This prototype passes the full Electron process
        // environment through so the spawned CLI starts with familiar PATH/tooling.
        // Before shipping a broader terminal surface, build a sanitized env because
        // this inherits Electron/dev-process vars and any sensitive shell vars.
        env: process.env,
        name: 'xterm-color',
        cols: 120,
        rows: 40,
      });

      terminalSessionsById.set(sessionId, terminalProcess);

      const sendChunkToRenderers = (chunkText: string) => {
        // TODO(terminal-prototype): We intentionally broadcast terminal events to
        // every window during the single-window prototype phase and rely on the
        // renderer to filter by sessionId. This becomes a footgun in multi-window
        // flows because non-owner windows receive terminal output/session metadata.
        // Track session owner webContents and send only to that window before
        // enabling editor+terminal multi-window usage.
        for (const browserWindow of BrowserWindow.getAllWindows()) {
          browserWindow.webContents.send('terminal:process-data', {
            sessionId,
            chunk: chunkText,
          });
        }
      };

      terminalProcess.onData((chunkText) => {
        sendChunkToRenderers(chunkText);
      });

      terminalProcess.onExit(({ exitCode, signal }) => {
        terminalSessionsById.delete(sessionId);
        const exitEvent: TerminalProcessExitEvent = {
          sessionId,
          exitCode,
          signal: signal ?? null,
        };
        // TODO(terminal-prototype): Same broadcast limitation as process-data above.
        // Route exits only to the session owner webContents once sessions are
        // tracked per-window in main.
        for (const browserWindow of BrowserWindow.getAllWindows()) {
          browserWindow.webContents.send('terminal:process-exit', exitEvent);
        }
      });

      return {
        ok: true,
        sessionId,
        pid: terminalProcess.pid,
        cwd: request.cwd,
        targetFilePath: request.targetFilePath,
        command,
        args,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown terminal start error';
      return {
        ok: false,
        errorMessage,
        command,
        args,
      };
    }
  };

  // Centralized lookup keeps terminal IPC responses predictable after a process
  // exits and prevents renderer actions from throwing uncaught errors in main.
  const getTerminalSession = (sessionId: string) =>
    terminalSessionsById.get(sessionId);

  // The terminal service registers its own IPC surface so main.ts can remain an
  // orchestrator instead of mixing PTY lifecycle logic with app lifecycle code.
  const registerIpcHandlers = (ipcMain: IpcMain) => {
    ipcMain.handle(
      'terminal:start-session',
      async (
        _event,
        request: StartTerminalSessionRequest,
      ): Promise<StartTerminalSessionResponse> => startTerminalSession(request),
    );

    ipcMain.handle(
      'terminal:send-input',
      async (_event, sessionId: string, data: string) => {
        // TODO(terminal-prototype): Session control IPC currently trusts any renderer
        // that knows a sessionId. This is acceptable for the isolated prototype, but
        // terminal control is security-sensitive. When we support multiple windows or
        // broader renderer surfaces, authorize by event.sender/webContents ownership.
        const terminalSession = getTerminalSession(sessionId);
        if (!terminalSession) {
          return { ok: false, errorMessage: 'No active terminal session' };
        }

        terminalSession.write(data);
        return { ok: true };
      },
    );

    ipcMain.handle(
      'terminal:resize-session',
      async (_event, request: ResizeTerminalSessionRequest) => {
        const terminalSession = getTerminalSession(request.sessionId);
        if (!terminalSession) {
          return { ok: false, errorMessage: 'No active terminal session' };
        }

        const safeColumns = Math.max(1, Math.floor(request.cols));
        const safeRows = Math.max(1, Math.floor(request.rows));
        terminalSession.resize(safeColumns, safeRows);
        return { ok: true };
      },
    );

    ipcMain.handle(
      'terminal:kill-session',
      async (_event, sessionId: string) => {
        const terminalSession = getTerminalSession(sessionId);
        if (!terminalSession) {
          return { ok: false, errorMessage: 'No active terminal session' };
        }

        terminalSession.kill();
        return { ok: true };
      },
    );
  };

  // Startup validates required Claude CLI dependencies and prompt assets before
  // windows open so terminal failures are visible and deterministic.
  const prepareRuntimeOrThrow = async () => {
    await ensureClaudeCliIsInstalledOrThrow();
    await loadBundledClaudeSystemPromptMarkdownOrThrow();
  };

  // App shutdown kills any surviving PTYs so child processes do not outlive the
  // Electron main process and stale session IDs cannot be reused after restart.
  const shutdown = async () => {
    for (const terminalSession of terminalSessionsById.values()) {
      terminalSession.kill('SIGTERM');
    }
    terminalSessionsById.clear();
  };

  return {
    prepareRuntimeOrThrow,
    registerIpcHandlers,
    shutdown,
  };
};
