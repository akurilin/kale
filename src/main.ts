//
// This is the Electron main process entry that owns window lifecycle and
// filesystem-backed markdown load/open/save IPC handlers for the renderer.
//
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { watch as watchWithChokidar, type FSWatcher } from 'chokidar';
import started from 'electron-squirrel-startup';
import * as nodePty from 'node-pty';

import type {
  ExternalMarkdownFileChangedEvent,
  LoadMarkdownResponse,
  OpenMarkdownFileResponse,
  ResizeTerminalSessionRequest,
  RestoreMarkdownFromGitResponse,
  StartTerminalSessionRequest,
  StartTerminalSessionResponse,
  TerminalBootstrapResponse,
  TerminalProcessExitEvent,
} from './shared-types';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const BUNDLED_SAMPLE_MARKDOWN_FILE = path.resolve(
  app.getAppPath(),
  'data',
  'what-the-best-looks-like.md',
);
// We store the active document in userData by default so packaged apps never try
// to write back into the app bundle / asar.
const DEFAULT_USER_FILE_NAME = 'what-the-best-looks-like.md';
const SETTINGS_FILE_NAME = 'settings.json';
const DEFAULT_WINDOW_WIDTH = 2560;
const DEFAULT_WINDOW_HEIGHT = 1440;
const SELF_SAVE_WATCHER_SUPPRESSION_MS = 1000;
const execFileAsync = promisify(execFile);
// The Electron main process is a singleton in this app, so runtime-only mutable
// state stays module-scoped here until the file is split into service modules.
const appRuntimeState: {
  currentMarkdownFilePath: string | null;
  bundledClaudeSystemPromptMarkdownText: string | null;
  terminalSessionsById: Map<string, nodePty.IPty>;
  activeMarkdownFileWatcher: FSWatcher | null;
  watchedMarkdownFilePath: string | null;
  pendingExternalMarkdownChangeBroadcastTimeout: ReturnType<
    typeof setTimeout
  > | null;
  recentAppSaveSuppressUntilByFilePath: Map<string, number>;
} = {
  // In-memory cache for the active file path. We still re-validate on use
  // because the file can be moved/deleted outside the app between operations.
  currentMarkdownFilePath: null,
  // Cache the bundled Claude system prompt once at startup so terminal session
  // launches do not perform filesystem I/O on the hot path.
  bundledClaudeSystemPromptMarkdownText: null,
  terminalSessionsById: new Map<string, nodePty.IPty>(),
  activeMarkdownFileWatcher: null,
  watchedMarkdownFilePath: null,
  pendingExternalMarkdownChangeBroadcastTimeout: null,
  recentAppSaveSuppressUntilByFilePath: new Map<string, number>(),
};

type AppSettings = {
  lastOpenedFilePath?: string;
};

const parseWindowDimension = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getSettingsFilePath = () =>
  path.join(app.getPath('userData'), SETTINGS_FILE_NAME);

// This resolves the prompt asset path from the packaged app root so dev and
// production builds can load the same logical file location.
const getBundledClaudeSystemPromptMarkdownFilePath = () =>
  path.resolve(app.getAppPath(), 'prompts', 'claude-system-prompt.md');

// Claude sessions should start with Kale-specific prose guidance every time, so
// startup fails fast if the prompt asset is missing instead of degrading later.
const loadBundledClaudeSystemPromptMarkdownOrThrow = async () => {
  const promptFilePath = getBundledClaudeSystemPromptMarkdownFilePath();
  const promptMarkdownText = (await fs.readFile(promptFilePath, 'utf8')).trim();
  if (!promptMarkdownText) {
    throw new Error(`Claude system prompt file is empty: ${promptFilePath}`);
  }

  appRuntimeState.bundledClaudeSystemPromptMarkdownText = promptMarkdownText;
};

// Terminal session launch is synchronous with respect to command construction,
// so this getter ensures startup completed the required prompt-file preload.
const getRequiredBundledClaudeSystemPromptMarkdownText = () => {
  if (appRuntimeState.bundledClaudeSystemPromptMarkdownText) {
    return appRuntimeState.bundledClaudeSystemPromptMarkdownText;
  }

  throw new Error(
    `Claude system prompt not loaded. Expected startup preload from ${getBundledClaudeSystemPromptMarkdownFilePath()}.`,
  );
};

const KALE_PROMPT_ACTIVE_FILE_PATH_TOKEN = '@@KALE:ACTIVE_FILE_PATH@@';

// Kale's core workflow depends on the Claude CLI, so startup validates that the
// `claude` executable is reachable on PATH before opening the application UI.
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

// Prompt templates live in repo data, so token replacement stays intentionally
// small and strict to avoid accidental interpolation behavior.
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

const readSettings = async (): Promise<AppSettings> => {
  try {
    const raw = await fs.readFile(getSettingsFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as AppSettings;
    return parsed ?? {};
  } catch {
    // Treat missing/corrupt settings as first-run and recover automatically.
    return {};
  }
};

const writeSettings = async (settings: AppSettings) => {
  const settingsPath = getSettingsFilePath();
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
};

const canReadFile = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

// Only the active editor document needs a watcher in this prototype, so this
// helper tears down prior state before switching to a new file path.
const stopWatchingActiveMarkdownFile = async () => {
  const previousWatchedMarkdownFilePath =
    appRuntimeState.watchedMarkdownFilePath;
  if (appRuntimeState.pendingExternalMarkdownChangeBroadcastTimeout) {
    clearTimeout(appRuntimeState.pendingExternalMarkdownChangeBroadcastTimeout);
    appRuntimeState.pendingExternalMarkdownChangeBroadcastTimeout = null;
  }

  appRuntimeState.watchedMarkdownFilePath = null;
  if (previousWatchedMarkdownFilePath) {
    appRuntimeState.recentAppSaveSuppressUntilByFilePath.delete(
      previousWatchedMarkdownFilePath,
    );
  }
  if (!appRuntimeState.activeMarkdownFileWatcher) {
    return;
  }

  const watcherToClose = appRuntimeState.activeMarkdownFileWatcher;
  appRuntimeState.activeMarkdownFileWatcher = null;
  await watcherToClose.close();
};

// Renderer-initiated saves should not immediately echo back through the file
// watcher because that reload loop replaces the editor document mid-typing.
const markMarkdownFilePathAsRecentlySavedByApp = (filePath: string) => {
  appRuntimeState.recentAppSaveSuppressUntilByFilePath.set(
    filePath,
    Date.now() + SELF_SAVE_WATCHER_SUPPRESSION_MS,
  );
};

// File-watch notifications are only useful for external writes, so a short
// suppression window filters out the app's own save events after IPC writes.
const shouldSuppressExternalChangeBroadcastForFilePath = (filePath: string) => {
  const suppressUntil =
    appRuntimeState.recentAppSaveSuppressUntilByFilePath.get(filePath);
  if (!suppressUntil) {
    return false;
  }

  if (Date.now() < suppressUntil) {
    return true;
  }

  appRuntimeState.recentAppSaveSuppressUntilByFilePath.delete(filePath);
  return false;
};

// The main process owns file watching so renderers receive simple change
// notifications without gaining direct filesystem watch capabilities.
const broadcastExternalMarkdownFileChanged = (filePath: string) => {
  const eventPayload: ExternalMarkdownFileChangedEvent = { filePath };
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    browserWindow.webContents.send(
      'editor:external-markdown-file-changed',
      eventPayload,
    );
  }
};

// Chokidar smooths over platform-specific save behavior, so this watcher treats
// change/add events as a reload signal for the single active markdown file.
const ensureWatchingActiveMarkdownFile = async (filePath: string) => {
  if (
    appRuntimeState.watchedMarkdownFilePath === filePath &&
    appRuntimeState.activeMarkdownFileWatcher
  ) {
    return;
  }

  await stopWatchingActiveMarkdownFile();
  appRuntimeState.watchedMarkdownFilePath = filePath;

  const scheduleExternalChangeBroadcast = () => {
    if (appRuntimeState.pendingExternalMarkdownChangeBroadcastTimeout) {
      clearTimeout(
        appRuntimeState.pendingExternalMarkdownChangeBroadcastTimeout,
      );
    }

    appRuntimeState.pendingExternalMarkdownChangeBroadcastTimeout = setTimeout(
      () => {
        appRuntimeState.pendingExternalMarkdownChangeBroadcastTimeout = null;
        if (!appRuntimeState.watchedMarkdownFilePath) {
          return;
        }

        if (
          shouldSuppressExternalChangeBroadcastForFilePath(
            appRuntimeState.watchedMarkdownFilePath,
          )
        ) {
          return;
        }

        broadcastExternalMarkdownFileChanged(
          appRuntimeState.watchedMarkdownFilePath,
        );
      },
      150,
    );
  };

  const watcher = watchWithChokidar(filePath, {
    ignoreInitial: true,
    persistent: true,
  });

  watcher.on('change', scheduleExternalChangeBroadcast);
  watcher.on('add', scheduleExternalChangeBroadcast);
  watcher.on('error', (error) => {
    console.error(`Markdown file watcher error for ${filePath}`, error);
  });

  appRuntimeState.activeMarkdownFileWatcher = watcher;
};

const ensureDefaultUserFile = async () => {
  const targetFilePath = path.join(
    app.getPath('userData'),
    DEFAULT_USER_FILE_NAME,
  );
  if (await canReadFile(targetFilePath)) {
    return targetFilePath;
  }

  await fs.mkdir(path.dirname(targetFilePath), { recursive: true });
  try {
    // Seed from the bundled sample so the first run opens useful content while
    // still writing to a user-writable location.
    const sampleContent = await fs.readFile(
      BUNDLED_SAMPLE_MARKDOWN_FILE,
      'utf8',
    );
    await fs.writeFile(targetFilePath, sampleContent, 'utf8');
  } catch {
    // If the bundled sample is unavailable, still create an empty writable file.
    await fs.writeFile(targetFilePath, '', 'utf8');
  }

  return targetFilePath;
};

const setCurrentMarkdownFilePath = async (filePath: string) => {
  appRuntimeState.currentMarkdownFilePath = filePath;
  const settings = await readSettings();
  settings.lastOpenedFilePath = filePath;
  await writeSettings(settings);
};

const ensureCurrentMarkdownFilePath = async () => {
  if (
    appRuntimeState.currentMarkdownFilePath &&
    (await canReadFile(appRuntimeState.currentMarkdownFilePath))
  ) {
    return appRuntimeState.currentMarkdownFilePath;
  }

  const settings = await readSettings();
  if (
    settings.lastOpenedFilePath &&
    (await canReadFile(settings.lastOpenedFilePath))
  ) {
    // Restore the last file the user worked on across app restarts.
    appRuntimeState.currentMarkdownFilePath = settings.lastOpenedFilePath;
    return appRuntimeState.currentMarkdownFilePath;
  }

  // Fall back to a guaranteed writable file if the remembered file is gone.
  const defaultFilePath = await ensureDefaultUserFile();
  await setCurrentMarkdownFilePath(defaultFilePath);
  return defaultFilePath;
};

// The isolated terminal view needs a stable, known markdown target during
// development even when the persisted "last opened" file points elsewhere.
const getBundledSampleMarkdownFilePath = () => BUNDLED_SAMPLE_MARKDOWN_FILE;

// Terminal sessions are keyed in main so the renderer never gets direct access
// to process objects and can only control them through narrow IPC methods.
const createTerminalSessionId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// The terminal prototype should prefer the bundled sample file for isolated
// testing while still allowing a fallback to the app's current file path.
const resolveTerminalBootstrapContext =
  async (): Promise<TerminalBootstrapResponse> => {
    const sampleFilePath = getBundledSampleMarkdownFilePath();
    if (await canReadFile(sampleFilePath)) {
      return {
        targetFilePath: sampleFilePath,
        cwd: path.dirname(sampleFilePath),
        source: 'sample',
      };
    }

    const currentFilePath = await ensureCurrentMarkdownFilePath();
    return {
      targetFilePath: currentFilePath,
      cwd: path.dirname(currentFilePath),
      source: 'current',
    };
  };

// The terminal pane launches Claude Code directly so Kale can provide writing
// guidance at session start without requiring users to boot a shell first.
const resolveTerminalLaunchCommand = async (
  request: StartTerminalSessionRequest,
) => {
  const activeFilePathForPrompt = request.targetFilePath.trim()
    ? request.targetFilePath.trim()
    : await ensureCurrentMarkdownFilePath();

  return {
    command: 'claude',
    args: [
      '--dangerously-skip-permissions',
      '--append-system-prompt',
      buildClaudeSystemPromptFromTemplate(activeFilePathForPrompt),
    ],
  };
};

// Main owns process spawning so the renderer can stream terminal I/O without
// gaining raw local process execution access.
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

    appRuntimeState.terminalSessionsById.set(sessionId, terminalProcess);

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
      appRuntimeState.terminalSessionsById.delete(sessionId);
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

// Centralized session lookup keeps renderer IPC failure modes predictable and
// avoids throwing uncaught errors when the user presses controls after exit.
const getTerminalSession = (sessionId: string) =>
  appRuntimeState.terminalSessionsById.get(sessionId);

const loadCurrentMarkdown = async (): Promise<LoadMarkdownResponse> => {
  const filePath = await ensureCurrentMarkdownFilePath();
  await ensureWatchingActiveMarkdownFile(filePath);
  const content = await fs.readFile(filePath, 'utf8');
  return { content, filePath };
};

// Git path-scoped restore needs a repository root so the command can target the
// current file deterministically and return actionable errors to the renderer.
const resolveGitRepositoryRoot = async (filePath: string) => {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', path.dirname(filePath), 'rev-parse', '--show-toplevel'],
    {
      windowsHide: true,
    },
  );
  return stdout.trim();
};

// Restoring to HEAD is intentionally destructive for the current file only, so
// this helper centralizes the safest non-shell command invocation and fallback.
const restoreFileFromGitHead = async (filePath: string) => {
  const repositoryRoot = await resolveGitRepositoryRoot(filePath);
  const repositoryRelativeFilePath = path.relative(repositoryRoot, filePath);

  try {
    await execFileAsync(
      'git',
      [
        '-C',
        repositoryRoot,
        'restore',
        '--source=HEAD',
        '--staged',
        '--worktree',
        '--',
        repositoryRelativeFilePath,
      ],
      {
        windowsHide: true,
      },
    );
    return;
  } catch (error) {
    const gitCommandError = error as NodeJS.ErrnoException & {
      stderr?: string;
    };
    const stderr = gitCommandError.stderr ?? '';
    const looksLikeUnsupportedRestoreCommand =
      stderr.includes('not a git command') ||
      stderr.includes("unknown switch `s'") ||
      stderr.includes('unknown subcommand');
    if (!looksLikeUnsupportedRestoreCommand) {
      throw error;
    }
  }

  await execFileAsync(
    'git',
    [
      '-C',
      repositoryRoot,
      'checkout',
      'HEAD',
      '--',
      repositoryRelativeFilePath,
    ],
    {
      windowsHide: true,
    },
  );
};

ipcMain.handle('editor:load-markdown', async () => {
  return loadCurrentMarkdown();
});

ipcMain.handle('editor:save-markdown', async (_event, content: string) => {
  const filePath = await ensureCurrentMarkdownFilePath();
  markMarkdownFilePathAsRecentlySavedByApp(filePath);
  await fs.writeFile(filePath, content, 'utf8');
  return { ok: true };
});

ipcMain.handle(
  'editor:restore-current-markdown-from-git',
  async (): Promise<RestoreMarkdownFromGitResponse> => {
    try {
      const filePath = await ensureCurrentMarkdownFilePath();
      await restoreFileFromGitHead(filePath);
      const content = await fs.readFile(filePath, 'utf8');
      return { ok: true, filePath, content };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown Git restore error';
      return { ok: false, errorMessage };
    }
  },
);

ipcMain.handle(
  'editor:open-markdown-file',
  async (): Promise<OpenMarkdownFileResponse> => {
    const browserWindow = BrowserWindow.getFocusedWindow();
    // The native dialog lives in the main process; the renderer only requests it
    // via IPC to keep filesystem access out of browser code.
    const { canceled, filePaths } = await dialog.showOpenDialog(
      browserWindow ?? undefined,
      {
        title: 'Open Markdown File',
        properties: ['openFile'],
        filters: [
          {
            name: 'Markdown',
            extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'],
          },
          { name: 'All Files', extensions: ['*'] },
        ],
      },
    );

    if (canceled || filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = filePaths[0];
    const content = await fs.readFile(filePath, 'utf8');
    // Persist immediately so restarting the app reopens the newly selected file.
    await setCurrentMarkdownFilePath(filePath);
    await ensureWatchingActiveMarkdownFile(filePath);
    return { canceled: false, content, filePath };
  },
);

ipcMain.handle('terminal:get-bootstrap-context', async () => {
  return resolveTerminalBootstrapContext();
});

ipcMain.handle(
  'terminal:start-session',
  async (
    _event,
    request: StartTerminalSessionRequest,
  ): Promise<StartTerminalSessionResponse> => {
    return startTerminalSession(request);
  },
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

ipcMain.handle('terminal:kill-session', async (_event, sessionId: string) => {
  const terminalSession = getTerminalSession(sessionId);
  if (!terminalSession) {
    return { ok: false, errorMessage: 'No active terminal session' };
  }

  terminalSession.kill();
  return { ok: true };
});

const createWindow = () => {
  const windowWidth = parseWindowDimension(
    process.env.KALE_WINDOW_WIDTH,
    DEFAULT_WINDOW_WIDTH,
  );
  const windowHeight = parseWindowDimension(
    process.env.KALE_WINDOW_HEIGHT,
    DEFAULT_WINDOW_HEIGHT,
  );

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// App startup must validate required runtime assets before opening the window so
// missing prompt configuration fails immediately and visibly for the user.
const startApplication = async () => {
  try {
    await ensureClaudeCliIsInstalledOrThrow();
    await loadBundledClaudeSystemPromptMarkdownOrThrow();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown startup prompt error';
    console.error(`Fatal startup error: ${errorMessage}`);
    app.exit(1);
    return;
  }

  createWindow();
};

// This method will be called when Electron has finished initialization and is
// ready to create browser windows. Some APIs can only be used after this event
// occurs.
app.on('ready', () => {
  void startApplication();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  const shutdownSessionsAndMaybeQuit = async () => {
    await stopWatchingActiveMarkdownFile();
    for (const terminalSession of appRuntimeState.terminalSessionsById.values()) {
      terminalSession.kill('SIGTERM');
    }
    appRuntimeState.terminalSessionsById.clear();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  };

  void shutdownSessionsAndMaybeQuit();
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
