//
// This is the Electron main process entry that wires app lifecycle to the
// extracted markdown, terminal, IDE, and window modules.
//
import { app, BrowserWindow, ipcMain } from 'electron';
import started from 'electron-squirrel-startup';

// Running the Electron binary directly (e.g. for CDP/Playwright automation)
// defaults the app name to "Electron", which moves userData to a different
// directory and breaks settings/file-restore continuity. Force the canonical
// name so all launch methods share the same userData path.
app.setName('kale');

import { createIdeIntegrationService } from './main/ide-integration-service';
import { createMarkdownFileService } from './main/markdown-file-service';
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

markdownFileService.registerIpcHandlers(ipcMain);
terminalSessionService.registerIpcHandlers(ipcMain);
ideIntegrationService.registerIpcHandlers(ipcMain);

// App startup validates terminal/runtime prerequisites before opening a window
// so missing Claude dependencies fail early with a visible fatal error.
const startApplication = async () => {
  try {
    await terminalSessionService.prepareRuntimeOrThrow();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown startup prompt error';
    console.error(`Fatal startup error: ${errorMessage}`);
    app.exit(1);
    return;
  }

  createMainWindow();

  // Start the IDE MCP server after a window exists so the app remains usable
  // even if the optional integration fails to initialize.
  void ideIntegrationService.startSafely([process.cwd()]);
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
