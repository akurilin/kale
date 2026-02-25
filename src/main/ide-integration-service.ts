import type { IpcMain } from 'electron';

import { startIdeServer } from '../ide-server';
import type { IdeServerHandle } from '../ide-server';
import type {
  EditorSelection,
  IdeSelectionChangedEvent,
} from '../shared-types';

type IdeIntegrationServiceDependencies = {
  getCurrentMarkdownFilePath: () => string | null;
};

const SELECTION_NOTIFICATION_DEBOUNCE_MS = 50;

// IDE integration is isolated so Claude Code IPC/state caching does not bloat
// the Electron bootstrap file and can evolve independently from editor I/O.
export const createIdeIntegrationService = (
  dependencies: IdeIntegrationServiceDependencies,
) => {
  let ideServer: IdeServerHandle | null = null;
  let cachedEditorSelection: EditorSelection = null;
  let pendingSelectionNotificationTimeout: ReturnType<
    typeof setTimeout
  > | null = null;

  // Renderer selection updates are registered here so the cached editor state
  // and Claude notification debounce live next to IDE server broadcast logic.
  const registerIpcHandlers = (ipcMain: IpcMain) => {
    ipcMain.on(
      'ide:selection-changed',
      (_event, payload: IdeSelectionChangedEvent) => {
        // Update the cache that getCurrentSelection reads. When the selection is
        // empty (cursor-only), we still cache the cursor position so Claude Code
        // can always see where the user is in the document.
        cachedEditorSelection = {
          filePath: payload.filePath,
          selectedText: payload.selectedText,
          range: payload.range,
        };

        // Debounced broadcast to connected Claude Code clients. Sends both text
        // selections and cursor-only positions so Claude Code's status display
        // always reflects reality (matching VS Code extension behavior).
        if (pendingSelectionNotificationTimeout) {
          clearTimeout(pendingSelectionNotificationTimeout);
        }
        pendingSelectionNotificationTimeout = setTimeout(() => {
          pendingSelectionNotificationTimeout = null;
          ideServer?.broadcastNotification({
            jsonrpc: '2.0',
            method: 'selection_changed',
            params: {
              text: payload.selectedText,
              filePath: payload.filePath,
              fileUrl: `file://${payload.filePath}`,
              selection: {
                start: payload.range.start,
                end: payload.range.end,
                isEmpty: !payload.selectedText,
              },
            },
          });
        }, SELECTION_NOTIFICATION_DEBOUNCE_MS);
      },
    );
  };

  // MCP server startup is non-fatal so Kale remains usable when Claude Code IDE
  // integration cannot bind a port or initialize its lock file state.
  const startSafely = async (workspaceFolders: string[]) => {
    try {
      ideServer = await startIdeServer(workspaceFolders, {
        getCurrentSelection: async () => cachedEditorSelection,
        getOpenEditors: async () => {
          const filePath = dependencies.getCurrentMarkdownFilePath();
          if (!filePath) {
            return [];
          }
          return [{ filePath, isActive: true, languageId: 'markdown' }];
        },
        getDiagnostics: async () => {
          // Diagnostics are not yet implemented — return empty for now.
          return [];
        },
      });
    } catch (error) {
      console.error('Failed to start IDE MCP server (non-fatal):', error);
    }
  };

  // IDE server shutdown is centralized here so lock-file cleanup and websocket
  // teardown happen even if main.ts stays intentionally minimal.
  const shutdown = async () => {
    if (pendingSelectionNotificationTimeout) {
      clearTimeout(pendingSelectionNotificationTimeout);
      pendingSelectionNotificationTimeout = null;
    }

    if (!ideServer) {
      return;
    }

    await ideServer.shutdown();
    ideServer = null;
  };

  return {
    registerIpcHandlers,
    startSafely,
    shutdown,
  };
};
