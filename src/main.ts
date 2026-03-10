//
// This is the Electron main process entry that wires app lifecycle to the
// extracted markdown, terminal, IDE, and window modules.
//
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import started from 'electron-squirrel-startup';

// Running the Electron binary directly (e.g. for CDP/Playwright automation)
// defaults the app name to "Electron", which moves userData to a different
// directory and breaks settings/file-restore continuity. Force the canonical
// name so all launch methods share the same userData path.
app.setName('kale');

// E2E tests pass a custom userData directory to isolate test state from the
// user's real app data. Must be set before any code calls app.getPath('userData').
if (process.env.KALE_USER_DATA_DIR) {
  app.setPath('userData', process.env.KALE_USER_DATA_DIR);
}

import { createIdeIntegrationService } from './main/ide-integration-service';
import { createMarkdownFileService } from './main/markdown-file-service';
import { registerSpellcheckIpcHandlers } from './main/spellcheck-service';
import { createTerminalSessionService } from './main/terminal-session-service';
import { createMainWindow } from './main/window';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const markdownFileService = createMarkdownFileService();
const terminalSessionService = createTerminalSessionService({
  ensureCurrentMarkdownFilePath:
    markdownFileService.ensureCurrentMarkdownFilePath,
});
const ideIntegrationService = createIdeIntegrationService({
  getCurrentMarkdownFilePath: markdownFileService.getCurrentMarkdownFilePath,
});
const removeCurrentMarkdownFilePathChangedListener =
  markdownFileService.onCurrentMarkdownFilePathChanged((nextFilePath) => {
    void ideIntegrationService.updateWorkspaceFolders([
      path.dirname(nextFilePath),
    ]);
  });

markdownFileService.registerIpcHandlers(ipcMain);
terminalSessionService.registerIpcHandlers(ipcMain);
ideIntegrationService.registerIpcHandlers(ipcMain);
registerSpellcheckIpcHandlers(ipcMain);

// Claude Code checks IDE workspace folders against the terminal cwd, so this
// helper aligns lock-file workspace metadata to the active markdown file path.
const syncIdeWorkspaceFoldersToCurrentMarkdownFileContext = async () => {
  try {
    const currentMarkdownWorkingDirectory =
      await markdownFileService.resolveCurrentMarkdownWorkingDirectory();
    await ideIntegrationService.startSafely([currentMarkdownWorkingDirectory]);
  } catch (error) {
    console.error(
      'Failed to resolve IDE workspace folder from active markdown file (non-fatal):',
      error,
    );
  }
};

// Startup dependency failures currently happen before a BrowserWindow exists,
// so this native dialog prevents "app opens then closes" silent exits.
const showFatalStartupErrorDialogIfVisible = (errorMessage: string) => {
  if (process.env.KALE_HEADLESS === '1') {
    return;
  }

  dialog.showErrorBox(
    'Kale failed to start',
    `${errorMessage}\n\nThe app will now close.`,
  );
};

// App startup validates terminal/runtime prerequisites before opening a window
// so missing Claude dependencies fail early with a visible fatal error.
// E2E tests skip terminal validation because the Claude CLI may not be
// available in CI environments and the terminal feature is not under test.
const startApplication = async () => {
  if (!process.env.KALE_SKIP_TERMINAL_VALIDATION) {
    try {
      await terminalSessionService.prepareRuntimeOrThrow();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown startup prompt error';
      console.error('');
      console.error('='.repeat(70));
      console.error('  KALE — FATAL STARTUP ERROR');
      console.error('='.repeat(70));
      console.error('');
      console.error(errorMessage);
      console.error('');
      console.error('='.repeat(70));
      console.error('');
      showFatalStartupErrorDialogIfVisible(errorMessage);
      app.exit(1);
      return;
    }
  }

  createMainWindow();

  // Start the IDE MCP server after a window exists so the app remains usable
  // even if the optional integration fails to initialize. Workspace folders are
  // sourced from the active markdown file context so they match Claude cwd.
  await syncIdeWorkspaceFoldersToCurrentMarkdownFileContext();
};

// Electron only allows certain APIs after the ready event, so all startup work
// is kicked off from here and delegated to the orchestrator function above.
app.on('ready', () => {
  void startApplication();
});

// When the last window closes we release watchers, IDE server resources, and
// PTYs before quitting (except on macOS where apps commonly stay active).
app.on('window-all-closed', () => {
  const shutdownServicesAndMaybeQuit = async () => {
    removeCurrentMarkdownFilePathChangedListener();
    await markdownFileService.shutdown();
    await ideIntegrationService.shutdown();
    await terminalSessionService.shutdown();

    if (process.platform !== 'darwin') {
      app.quit();
    }
  };

  void shutdownServicesAndMaybeQuit();
});

// macOS apps typically recreate a window when reactivated with none open, so
// window creation stays accessible from the lifecycle orchestrator.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
