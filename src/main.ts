//
// This is the Electron main process entry that owns window lifecycle and
// filesystem-backed markdown load/open/save IPC handlers for the renderer.
//
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import started from 'electron-squirrel-startup';
import * as nodePty from 'node-pty';

import type {
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
// In-memory cache for the active file path. We still re-validate on use because
// the file can be moved/deleted outside the app between operations.
let currentMarkdownFilePath: string | null = null;
const execFileAsync = promisify(execFile);
const terminalSessionsById = new Map<string, nodePty.IPty>();

type AppSettings = {
  lastOpenedFilePath?: string;
};

const parseWindowDimension = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getSettingsFilePath = () =>
  path.join(app.getPath('userData'), SETTINGS_FILE_NAME);

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
  currentMarkdownFilePath = filePath;
  const settings = await readSettings();
  settings.lastOpenedFilePath = filePath;
  await writeSettings(settings);
};

const ensureCurrentMarkdownFilePath = async () => {
  if (currentMarkdownFilePath && (await canReadFile(currentMarkdownFilePath))) {
    return currentMarkdownFilePath;
  }

  const settings = await readSettings();
  if (
    settings.lastOpenedFilePath &&
    (await canReadFile(settings.lastOpenedFilePath))
  ) {
    // Restore the last file the user worked on across app restarts.
    currentMarkdownFilePath = settings.lastOpenedFilePath;
    return currentMarkdownFilePath;
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

// The terminal prototype should default to the user's shell so we can validate
// PTY terminal behavior before layering in app-specific terminal workflows.
const resolveTerminalLaunchCommand = () => {
  const override = process.env.KALE_TERMINAL_COMMAND?.trim();
  if (override) {
    return {
      command: override,
      args: process.env.KALE_TERMINAL_ARGS
        ? process.env.KALE_TERMINAL_ARGS.split(' ').filter(Boolean)
        : [],
    };
  }

  return {
    command: process.env.SHELL?.trim() || '/bin/zsh',
    args: [] as string[],
  };
};

// Main owns process spawning so the renderer can stream terminal I/O without
// gaining raw local process execution access.
const startTerminalSession = async (
  request: StartTerminalSessionRequest,
): Promise<StartTerminalSessionResponse> => {
  const { command, args } = resolveTerminalLaunchCommand();
  const sessionId = createTerminalSessionId();

  try {
    const terminalProcess = nodePty.spawn(command, args, {
      cwd: request.cwd,
      env: process.env,
      name: 'xterm-color',
      cols: 120,
      rows: 40,
    });

    terminalSessionsById.set(sessionId, terminalProcess);

    const sendChunkToRenderers = (chunkText: string) => {
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
  terminalSessionsById.get(sessionId);

const loadCurrentMarkdown = async (): Promise<LoadMarkdownResponse> => {
  const filePath = await ensureCurrentMarkdownFilePath();
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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  for (const terminalSession of terminalSessionsById.values()) {
    terminalSession.kill('SIGTERM');
  }
  terminalSessionsById.clear();
  if (process.platform !== 'darwin') {
    app.quit();
  }
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
