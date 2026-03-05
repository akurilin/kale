import { app, BrowserWindow, dialog, type IpcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { watch as watchWithChokidar, type FSWatcher } from 'chokidar';

import type {
  CommitCurrentMarkdownFileResponse,
  CurrentMarkdownGitBranchState,
  ExternalMarkdownFileChangedEvent,
  GetCurrentMarkdownGitBranchStateResponse,
  LoadMarkdownResponse,
  OpenMarkdownFileResponse,
  RestoreMarkdownFromGitResponse,
  SwitchCurrentMarkdownGitBranchRequest,
  SwitchCurrentMarkdownGitBranchResponse,
} from '../shared-types';

const BUNDLED_SAMPLE_MARKDOWN_FILE = path.resolve(
  app.getAppPath(),
  'data',
  'simple.md',
);
// We store the active document in userData by default so packaged apps never try
// to write back into the app bundle / asar.
const DEFAULT_USER_FILE_NAME = 'simple.md';
const SETTINGS_FILE_NAME = 'settings.json';
const FORCED_STARTUP_MARKDOWN_FILE_PATH_ENV_VAR =
  'KALE_STARTUP_MARKDOWN_FILE_PATH';
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
  const currentMarkdownFilePathChangedListeners = new Set<
    (filePath: string) => void
  >();
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

  // IDE workspace synchronization depends on file-path transitions, so this
  // helper fan-outs active-file updates to subscribers in main.
  const emitCurrentMarkdownFilePathChanged = (filePath: string) => {
    for (const listener of currentMarkdownFilePathChangedListeners) {
      try {
        listener(filePath);
      } catch (error) {
        console.error(
          'Current markdown file-path listener threw (ignored):',
          error,
        );
      }
    }
  };

  // All file-path transitions should flow through one helper so watchers, IDE
  // integration, and settings persistence observe the same canonical updates.
  const updateCurrentMarkdownFilePath = (filePath: string) => {
    if (currentMarkdownFilePath === filePath) {
      return;
    }

    currentMarkdownFilePath = filePath;
    emitCurrentMarkdownFilePathChanged(filePath);
  };

  // Active-file updates always persist to settings so restart behavior matches
  // the most recent user choice regardless of which IPC path changed it.
  const setCurrentMarkdownFilePath = async (filePath: string) => {
    updateCurrentMarkdownFilePath(filePath);
    const settings = await readSettings();
    settings.lastOpenedFilePath = filePath;
    await writeSettings(settings);
  };

  // Test and automation workflows need a deterministic startup file path that
  // bypasses persisted settings, so this reads and normalizes that override.
  const getForcedStartupMarkdownFilePathFromEnvironment = () => {
    const configuredPath =
      process.env[FORCED_STARTUP_MARKDOWN_FILE_PATH_ENV_VAR];
    if (!configuredPath) {
      return null;
    }

    const trimmedPath = configuredPath.trim();
    if (trimmedPath.length === 0) {
      return null;
    }

    return path.resolve(trimmedPath);
  };

  // For QA flows we allow the forced startup file path to point at a
  // not-yet-created markdown file, and eagerly create it as an empty document.
  const ensureForcedStartupMarkdownFilePath = async () => {
    const forcedStartupMarkdownFilePath =
      getForcedStartupMarkdownFilePathFromEnvironment();
    if (!forcedStartupMarkdownFilePath) {
      return null;
    }

    if (await canReadFile(forcedStartupMarkdownFilePath)) {
      return forcedStartupMarkdownFilePath;
    }

    try {
      await fs.mkdir(path.dirname(forcedStartupMarkdownFilePath), {
        recursive: true,
      });
      await fs.writeFile(forcedStartupMarkdownFilePath, '', 'utf8');
      return forcedStartupMarkdownFilePath;
    } catch (error) {
      console.error(
        `Could not create forced startup markdown file at ${forcedStartupMarkdownFilePath}`,
        error,
      );
      return null;
    }
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

    const forcedStartupMarkdownFilePath =
      await ensureForcedStartupMarkdownFilePath();
    if (forcedStartupMarkdownFilePath) {
      updateCurrentMarkdownFilePath(forcedStartupMarkdownFilePath);
      return forcedStartupMarkdownFilePath;
    }

    const settings = await readSettings();
    if (
      settings.lastOpenedFilePath &&
      (await canReadFile(settings.lastOpenedFilePath))
    ) {
      updateCurrentMarkdownFilePath(settings.lastOpenedFilePath);
      return settings.lastOpenedFilePath;
    }

    const defaultFilePath = await ensureDefaultUserFile();
    await setCurrentMarkdownFilePath(defaultFilePath);
    return defaultFilePath;
  };

  // Consumers that only need the current cached path (for IDE metadata, etc.)
  // should avoid forcing filesystem resolution or watcher side effects.
  const getCurrentMarkdownFilePath = () => currentMarkdownFilePath;

  // Claude IDE lock-file workspace matching should follow the active document
  // context, so this resolves the current file's containing directory.
  const resolveCurrentMarkdownWorkingDirectory = async () => {
    const filePath = await ensureCurrentMarkdownFilePath();
    return path.dirname(filePath);
  };

  // Main-process services can subscribe to active-file path transitions so
  // cross-cutting integrations (like Claude IDE workspace folders) stay aligned.
  const onCurrentMarkdownFilePathChanged = (
    listener: (filePath: string) => void,
  ) => {
    currentMarkdownFilePathChangedListeners.add(listener);
    return () => {
      currentMarkdownFilePathChangedListeners.delete(listener);
    };
  };

  // Editor load consolidates path resolution and watcher activation so the
  // renderer receives content from the same file that is being observed.
  const loadCurrentMarkdown = async (): Promise<LoadMarkdownResponse> => {
    const filePath = await ensureCurrentMarkdownFilePath();
    await ensureWatchingActiveMarkdownFile(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    return { content, filePath };
  };

  // Git command errors vary by version/platform, so this helper keeps stderr
  // extraction in one place for capability fallbacks and user-facing messages.
  const getGitCommandErrorStderr = (error: unknown) => {
    const gitCommandError = error as NodeJS.ErrnoException & {
      stderr?: string;
    };
    return gitCommandError.stderr ?? '';
  };

  // Git pathspecs are slash-delimited across platforms, so repository-relative
  // file paths are normalized before being passed to git commands.
  const normalizeRepositoryRelativePathForGit = (
    repositoryRelativePath: string,
  ) => repositoryRelativePath.replace(/\\/g, '/');

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

  // Local branch switching and status checks all target the same file path, so
  // this helper centralizes repository-relative conversion for consistency.
  const resolveRepositoryRelativeFilePath = (
    repositoryRoot: string,
    filePath: string,
  ) =>
    normalizeRepositoryRelativePathForGit(
      path.relative(repositoryRoot, filePath),
    );

  // Save-to-git should operate on one active file only, so this helper scopes
  // status checks to a single repository-relative path.
  const readRepositoryFilePorcelainStatus = async (
    repositoryRoot: string,
    repositoryRelativeFilePath: string,
  ) => {
    const normalizedRepositoryRelativeFilePath =
      normalizeRepositoryRelativePathForGit(repositoryRelativeFilePath);
    const { stdout } = await execFileAsync(
      'git',
      [
        '-C',
        repositoryRoot,
        'status',
        '--porcelain',
        '--',
        normalizedRepositoryRelativeFilePath,
      ],
      {
        windowsHide: true,
      },
    );
    return stdout.trim();
  };

  // The Save action uses a deterministic commit message so users can persist
  // quickly without waiting for an LLM-generated summary.
  const buildStockCommitMessageForFilePath = (filePath: string) =>
    `Edits to ${path.basename(filePath)}`;

  // Branch dropdown UX requires current branch, available branch names, and
  // whether the active file currently has local git modifications.
  const readCurrentMarkdownGitBranchState = async (
    filePath: string,
  ): Promise<CurrentMarkdownGitBranchState> => {
    const repositoryRoot = await resolveGitRepositoryRoot(filePath);
    const repositoryRelativeFilePath = resolveRepositoryRelativeFilePath(
      repositoryRoot,
      filePath,
    );

    const [{ stdout: currentBranchOutput }, { stdout: currentCommitOutput }] =
      await Promise.all([
        execFileAsync(
          'git',
          ['-C', repositoryRoot, 'branch', '--show-current'],
          {
            windowsHide: true,
          },
        ),
        execFileAsync(
          'git',
          ['-C', repositoryRoot, 'rev-parse', '--short', 'HEAD'],
          {
            windowsHide: true,
          },
        ),
      ]);

    const currentBranchName = currentBranchOutput.trim();
    const detachedHeadCommitShortSha =
      currentBranchName.length === 0 ? currentCommitOutput.trim() : null;

    const [{ stdout: branchListOutput }, { stdout: porcelainStatusOutput }] =
      await Promise.all([
        execFileAsync(
          'git',
          [
            '-C',
            repositoryRoot,
            'branch',
            '--list',
            '--format=%(refname:short)',
          ],
          {
            windowsHide: true,
          },
        ),
        execFileAsync(
          'git',
          [
            '-C',
            repositoryRoot,
            'status',
            '--porcelain',
            '--',
            repositoryRelativeFilePath,
          ],
          {
            windowsHide: true,
          },
        ),
      ]);

    const parsedBranchNames = branchListOutput
      .split('\n')
      .map((branchName) => branchName.trim())
      .filter((branchName) => branchName.length > 0);
    const normalizedCurrentBranchName =
      currentBranchName.length > 0 ? currentBranchName : 'HEAD';
    const branchNames = parsedBranchNames.includes(normalizedCurrentBranchName)
      ? parsedBranchNames
      : [normalizedCurrentBranchName, ...parsedBranchNames];

    return {
      currentBranchName: normalizedCurrentBranchName,
      detachedHeadCommitShortSha,
      branchNames,
      isCurrentFileModified: porcelainStatusOutput.trim().length > 0,
    };
  };

  // Branch switching can only keep the current file open if that file exists
  // on the target branch, so this guard blocks confusing post-switch failures.
  const ensureBranchContainsCurrentFileOrThrow = async (
    repositoryRoot: string,
    branchName: string,
    repositoryRelativeFilePath: string,
  ) => {
    try {
      await execFileAsync(
        'git',
        [
          '-C',
          repositoryRoot,
          'cat-file',
          '-e',
          `${branchName}:${repositoryRelativeFilePath}`,
        ],
        {
          windowsHide: true,
        },
      );
    } catch {
      throw new Error(
        `Cannot switch to branch "${branchName}" because this file does not exist there.`,
      );
    }
  };

  // Git feature support varies by version, so switch/checkout compatibility is
  // centralized here and reused by every branch-switching IPC path.
  const switchRepositoryToGitBranch = async (
    repositoryRoot: string,
    branchName: string,
  ) => {
    try {
      await execFileAsync('git', ['-C', repositoryRoot, 'switch', branchName], {
        windowsHide: true,
      });
      return;
    } catch (error) {
      const stderr = getGitCommandErrorStderr(error);
      const looksLikeUnsupportedSwitchCommand =
        stderr.includes('not a git command') ||
        stderr.includes('unknown subcommand') ||
        stderr.includes('did you mean `checkout`');
      if (!looksLikeUnsupportedSwitchCommand) {
        throw error;
      }
    }

    await execFileAsync('git', ['-C', repositoryRoot, 'checkout', branchName], {
      windowsHide: true,
    });
  };

  // Restore-to-HEAD is destructive, so this helper centralizes the safest
  // command invocation and compatibility fallback in one audited place.
  const restoreRepositoryFileFromGitHead = async (
    repositoryRoot: string,
    repositoryRelativeFilePath: string,
  ) => {
    const normalizedRepositoryRelativeFilePath =
      normalizeRepositoryRelativePathForGit(repositoryRelativeFilePath);

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
          normalizedRepositoryRelativeFilePath,
        ],
        {
          windowsHide: true,
        },
      );
      return;
    } catch (error) {
      const stderr = getGitCommandErrorStderr(error);
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
        normalizedRepositoryRelativeFilePath,
      ],
      {
        windowsHide: true,
      },
    );
  };

  // Existing UI actions restore the currently open file only, so this wrapper
  // resolves repository coordinates once and delegates to the shared helper.
  const restoreFileFromGitHead = async (filePath: string) => {
    const repositoryRoot = await resolveGitRepositoryRoot(filePath);
    const repositoryRelativeFilePath = resolveRepositoryRelativeFilePath(
      repositoryRoot,
      filePath,
    );
    await restoreRepositoryFileFromGitHead(
      repositoryRoot,
      repositoryRelativeFilePath,
    );
  };

  // Top-bar save should stage and commit only the active markdown file in the
  // same repository that file belongs to, regardless of Kale's own repo path.
  const commitCurrentMarkdownFileWithStockMessage = async (
    filePath: string,
  ) => {
    const repositoryRoot = await resolveGitRepositoryRoot(filePath);
    const repositoryRelativeFilePath = resolveRepositoryRelativeFilePath(
      repositoryRoot,
      filePath,
    );
    const normalizedRepositoryRelativeFilePath =
      normalizeRepositoryRelativePathForGit(repositoryRelativeFilePath);
    const commitMessage = buildStockCommitMessageForFilePath(filePath);

    const fileStatusBeforeAdd = await readRepositoryFilePorcelainStatus(
      repositoryRoot,
      repositoryRelativeFilePath,
    );
    if (fileStatusBeforeAdd.length === 0) {
      return {
        didCreateCommit: false,
        commitMessage,
      };
    }

    await execFileAsync(
      'git',
      ['-C', repositoryRoot, 'add', '--', normalizedRepositoryRelativeFilePath],
      {
        windowsHide: true,
      },
    );

    const fileStatusAfterAdd = await readRepositoryFilePorcelainStatus(
      repositoryRoot,
      repositoryRelativeFilePath,
    );
    if (fileStatusAfterAdd.length === 0) {
      return {
        didCreateCommit: false,
        commitMessage,
      };
    }

    await execFileAsync(
      'git',
      [
        '-C',
        repositoryRoot,
        'commit',
        '-m',
        commitMessage,
        '--',
        normalizedRepositoryRelativeFilePath,
      ],
      {
        windowsHide: true,
      },
    );

    return {
      didCreateCommit: true,
      commitMessage,
    };
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
      'editor:commit-current-markdown-file',
      async (): Promise<CommitCurrentMarkdownFileResponse> => {
        try {
          const filePath = await ensureCurrentMarkdownFilePath();
          const commitResult =
            await commitCurrentMarkdownFileWithStockMessage(filePath);
          return {
            ok: true,
            didCreateCommit: commitResult.didCreateCommit,
            committedFilePath: filePath,
            commitMessage: commitResult.commitMessage,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown Git commit error';
          return { ok: false, errorMessage };
        }
      },
    );

    ipcMain.handle(
      'editor:get-current-markdown-git-branch-state',
      async (): Promise<GetCurrentMarkdownGitBranchStateResponse> => {
        try {
          const filePath = await ensureCurrentMarkdownFilePath();
          const gitBranchState =
            await readCurrentMarkdownGitBranchState(filePath);
          return { ok: true, gitBranchState };
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : 'Unknown Git branch state error';
          return { ok: false, errorMessage };
        }
      },
    );

    ipcMain.handle(
      'editor:switch-current-markdown-git-branch',
      async (
        _event,
        request: SwitchCurrentMarkdownGitBranchRequest,
      ): Promise<SwitchCurrentMarkdownGitBranchResponse> => {
        try {
          const normalizedBranchName = request.branchName.trim();
          if (normalizedBranchName.length === 0) {
            throw new Error('A target branch name is required.');
          }

          const filePath = await ensureCurrentMarkdownFilePath();
          const repositoryRoot = await resolveGitRepositoryRoot(filePath);
          const repositoryRelativeFilePath = resolveRepositoryRelativeFilePath(
            repositoryRoot,
            filePath,
          );

          await ensureBranchContainsCurrentFileOrThrow(
            repositoryRoot,
            normalizedBranchName,
            repositoryRelativeFilePath,
          );

          if (request.discardCurrentFileChanges) {
            await restoreRepositoryFileFromGitHead(
              repositoryRoot,
              repositoryRelativeFilePath,
            );
          }

          await switchRepositoryToGitBranch(
            repositoryRoot,
            normalizedBranchName,
          );
          const content = await fs.readFile(filePath, 'utf8');
          const gitBranchState =
            await readCurrentMarkdownGitBranchState(filePath);
          return {
            ok: true,
            filePath,
            content,
            gitBranchState,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : 'Unknown Git branch switch error';
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
    resolveCurrentMarkdownWorkingDirectory,
    onCurrentMarkdownFilePathChanged,
    shutdown,
  };
};
