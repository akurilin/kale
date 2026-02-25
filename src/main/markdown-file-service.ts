import { app, BrowserWindow, dialog, type IpcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { watch as watchWithChokidar, type FSWatcher } from 'chokidar';

import type {
  ExternalMarkdownFileChangedEvent,
  LoadMarkdownResponse,
  OpenMarkdownFileResponse,
  RestoreMarkdownFromGitResponse,
} from '../shared-types';

const BUNDLED_SAMPLE_MARKDOWN_FILE = path.resolve(
  app.getAppPath(),
  'data',
  'what-the-best-looks-like.md',
);
// We store the active document in userData by default so packaged apps never try
// to write back into the app bundle / asar.
const DEFAULT_USER_FILE_NAME = 'what-the-best-looks-like.md';
const SETTINGS_FILE_NAME = 'settings.json';
const execFileAsync = promisify(execFile);

type AppSettings = {
  lastOpenedFilePath?: string;
};

// Markdown file operations share watcher state, settings persistence, and the
// active file pointer, so they live together behind one main-process API.
export const createMarkdownFileService = () => {
  let currentMarkdownFilePath: string | null = null;
  let activeMarkdownFileWatcher: FSWatcher | null = null;
  let watchedMarkdownFilePath: string | null = null;
  let pendingFileChangeBroadcastDebounceTimeout: ReturnType<
    typeof setTimeout
  > | null = null;

  // Settings are stored under Electron userData so the app remembers the last
  // opened file across restarts without writing into the app bundle.
  const getSettingsFilePath = () =>
    path.join(app.getPath('userData'), SETTINGS_FILE_NAME);

  // Corrupt or missing settings should not block startup because first-run and
  // recovery scenarios are expected and can be handled with defaults.
  const readSettings = async (): Promise<AppSettings> => {
    try {
      const raw = await fs.readFile(getSettingsFilePath(), 'utf8');
      const parsed = JSON.parse(raw) as AppSettings;
      return parsed ?? {};
    } catch {
      return {};
    }
  };

  // Settings writes are centralized so file-path persistence stays consistent
  // no matter which UI action changed the active markdown document.
  const writeSettings = async (settings: AppSettings) => {
    const settingsPath = getSettingsFilePath();
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  };

  // Files can disappear between reads and user interactions, so access checks
  // are wrapped to convert expected filesystem races into simple booleans.
  const canReadFile = async (filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  };

  // Watcher teardown clears debounce state first so stale notifications cannot
  // fire after the active file switches or the app shuts down.
  const stopWatchingActiveMarkdownFile = async () => {
    if (pendingFileChangeBroadcastDebounceTimeout) {
      clearTimeout(pendingFileChangeBroadcastDebounceTimeout);
      pendingFileChangeBroadcastDebounceTimeout = null;
    }

    watchedMarkdownFilePath = null;
    if (!activeMarkdownFileWatcher) {
      return;
    }

    const watcherToClose = activeMarkdownFileWatcher;
    activeMarkdownFileWatcher = null;
    await watcherToClose.close();
  };

  // File-change notifications originate in main so renderers do not need direct
  // filesystem watcher access and can remain focused on content reconciliation.
  const broadcastMarkdownFileChanged = (filePath: string) => {
    const eventPayload: ExternalMarkdownFileChangedEvent = { filePath };
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send(
        'editor:external-markdown-file-changed',
        eventPayload,
      );
    }
  };

  // Chokidar smooths over platform-specific save behavior, so this watcher
  // treats change/add events as notifications. The debounce only deduplicates
  // rapid chokidar events; correctness still comes from renderer content checks.
  const ensureWatchingActiveMarkdownFile = async (filePath: string) => {
    if (watchedMarkdownFilePath === filePath && activeMarkdownFileWatcher) {
      return;
    }

    await stopWatchingActiveMarkdownFile();
    watchedMarkdownFilePath = filePath;

    const scheduleFileChangeBroadcast = () => {
      if (pendingFileChangeBroadcastDebounceTimeout) {
        clearTimeout(pendingFileChangeBroadcastDebounceTimeout);
      }

      pendingFileChangeBroadcastDebounceTimeout = setTimeout(() => {
        pendingFileChangeBroadcastDebounceTimeout = null;
        if (!watchedMarkdownFilePath) {
          return;
        }

        broadcastMarkdownFileChanged(watchedMarkdownFilePath);
      }, 150);
    };

    const watcher = watchWithChokidar(filePath, {
      ignoreInitial: true,
      persistent: true,
    });

    watcher.on('change', scheduleFileChangeBroadcast);
    watcher.on('add', scheduleFileChangeBroadcast);
    watcher.on('error', (error) => {
      console.error(`Markdown file watcher error for ${filePath}`, error);
    });

    activeMarkdownFileWatcher = watcher;
  };

  // First run should open a writable document immediately, so we seed a userData
  // file from the bundled sample and fall back to an empty file if unavailable.
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
      const sampleContent = await fs.readFile(
        BUNDLED_SAMPLE_MARKDOWN_FILE,
        'utf8',
      );
      await fs.writeFile(targetFilePath, sampleContent, 'utf8');
    } catch {
      await fs.writeFile(targetFilePath, '', 'utf8');
    }

    return targetFilePath;
  };

  // Active-file updates always persist to settings so restart behavior matches
  // the most recent user choice regardless of which IPC path changed it.
  const setCurrentMarkdownFilePath = async (filePath: string) => {
    currentMarkdownFilePath = filePath;
    const settings = await readSettings();
    settings.lastOpenedFilePath = filePath;
    await writeSettings(settings);
  };

  // The active file pointer is validated lazily because files can be moved or
  // deleted outside Kale between operations and after restart.
  const ensureCurrentMarkdownFilePath = async () => {
    if (
      currentMarkdownFilePath &&
      (await canReadFile(currentMarkdownFilePath))
    ) {
      return currentMarkdownFilePath;
    }

    const settings = await readSettings();
    if (
      settings.lastOpenedFilePath &&
      (await canReadFile(settings.lastOpenedFilePath))
    ) {
      currentMarkdownFilePath = settings.lastOpenedFilePath;
      return currentMarkdownFilePath;
    }

    const defaultFilePath = await ensureDefaultUserFile();
    await setCurrentMarkdownFilePath(defaultFilePath);
    return defaultFilePath;
  };

  // Consumers that only need the current cached path (for IDE metadata, etc.)
  // should avoid forcing filesystem resolution or watcher side effects.
  const getCurrentMarkdownFilePath = () => currentMarkdownFilePath;

  // Editor load consolidates path resolution and watcher activation so the
  // renderer receives content from the same file that is being observed.
  const loadCurrentMarkdown = async (): Promise<LoadMarkdownResponse> => {
    const filePath = await ensureCurrentMarkdownFilePath();
    await ensureWatchingActiveMarkdownFile(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    return { content, filePath };
  };

  // Git restore for a specific file needs the repository root so both modern
  // and fallback commands target the exact document path deterministically.
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

  // Restore-to-HEAD is destructive, so this helper centralizes the safest
  // command invocation and compatibility fallback in one audited place.
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

  // Editor IPC lives with the markdown helpers so the public surface for file
  // operations is defined in one place and main.ts only wires dependencies.
  const registerIpcHandlers = (ipcMain: IpcMain) => {
    ipcMain.handle('editor:load-markdown', async () => loadCurrentMarkdown());

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
            error instanceof Error
              ? error.message
              : 'Unknown Git restore error';
          return { ok: false, errorMessage };
        }
      },
    );

    ipcMain.handle(
      'editor:open-markdown-file',
      async (): Promise<OpenMarkdownFileResponse> => {
        const browserWindow = BrowserWindow.getFocusedWindow();
        const openDialogOptions: Electron.OpenDialogOptions = {
          title: 'Open Markdown File',
          properties: ['openFile'],
          filters: [
            {
              name: 'Markdown',
              extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'],
            },
            { name: 'All Files', extensions: ['*'] },
          ],
        };
        const { canceled, filePaths } = browserWindow
          ? await dialog.showOpenDialog(browserWindow, openDialogOptions)
          : await dialog.showOpenDialog(openDialogOptions);

        if (canceled || filePaths.length === 0) {
          return { canceled: true };
        }

        const filePath = filePaths[0];
        const content = await fs.readFile(filePath, 'utf8');
        await setCurrentMarkdownFilePath(filePath);
        await ensureWatchingActiveMarkdownFile(filePath);
        return { canceled: false, content, filePath };
      },
    );
  };

  // App shutdown needs watcher cleanup so chokidar handles and pending debounce
  // timers do not survive after the last Electron window closes.
  const shutdown = async () => {
    await stopWatchingActiveMarkdownFile();
  };

  return {
    registerIpcHandlers,
    ensureCurrentMarkdownFilePath,
    getCurrentMarkdownFilePath,
    shutdown,
  };
};
