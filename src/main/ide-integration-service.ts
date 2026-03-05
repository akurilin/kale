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

// Lock-file workspace folders should be stable and deduplicated so the IDE
// server only restarts when the effective workspace context truly changed.
const normalizeWorkspaceFolders = (workspaceFolders: string[]) => {
  const normalizedWorkspaceFolders: string[] = [];
  for (const workspaceFolder of workspaceFolders) {
    const normalizedWorkspaceFolder = workspaceFolder.trim();
    if (!normalizedWorkspaceFolder) {
      continue;
    }

    if (normalizedWorkspaceFolders.includes(normalizedWorkspaceFolder)) {
      continue;
    }

    normalizedWorkspaceFolders.push(normalizedWorkspaceFolder);
  }

  return normalizedWorkspaceFolders;
};

// Restarting the IDE server is expensive and can briefly drop connectivity, so
// this comparison prevents unnecessary lock-file churn.
const areWorkspaceFoldersEqual = (
  leftWorkspaceFolders: string[],
  rightWorkspaceFolders: string[],
) => {
  if (leftWorkspaceFolders.length !== rightWorkspaceFolders.length) {
    return false;
  }

  return leftWorkspaceFolders.every(
    (workspaceFolder, workspaceFolderIndex) =>
      workspaceFolder === rightWorkspaceFolders[workspaceFolderIndex],
  );
};

// IDE integration is isolated so Claude Code IPC/state caching does not bloat
// the Electron bootstrap file and can evolve independently from editor I/O.
export const createIdeIntegrationService = (
  dependencies: IdeIntegrationServiceDependencies,
) => {
  let ideServer: IdeServerHandle | null = null;
  let activeWorkspaceFolders: string[] = [];
  let pendingWorkspaceFolderUpdatePromise: Promise<void> = Promise.resolve();
  let cachedEditorSelection: EditorSelection = null;
  let pendingSelectionNotificationTimeout: ReturnType<
    typeof setTimeout
  > | null = null;

  // The MCP tool surface is stable across server restarts, so this provider is
  // defined once and reused whenever workspace-folder updates require a restart.
  const editorStateProvider = {
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
  };

  // Centralized shutdown keeps lock-file cleanup consistent whenever workspace
  // updates require replacing an existing IDE WebSocket server instance.
  const shutdownIdeServerIfRunning = async () => {
    if (!ideServer) {
      activeWorkspaceFolders = [];
      return;
    }

    await ideServer.shutdown();
    ideServer = null;
    activeWorkspaceFolders = [];
  };

  // Workspace-folder changes are reflected via lock-file rewrite, which means
  // restarting the IDE server when the advertised workspace set changes.
  const applyWorkspaceFolders = async (workspaceFolders: string[]) => {
    const normalizedWorkspaceFolders =
      normalizeWorkspaceFolders(workspaceFolders);
    if (normalizedWorkspaceFolders.length === 0) {
      return;
    }

    if (
      ideServer &&
      areWorkspaceFoldersEqual(
        activeWorkspaceFolders,
        normalizedWorkspaceFolders,
      )
    ) {
      return;
    }

    await shutdownIdeServerIfRunning();
    ideServer = await startIdeServer(
      normalizedWorkspaceFolders,
      editorStateProvider,
    );
    activeWorkspaceFolders = normalizedWorkspaceFolders;
  };

  // File-open and startup events can both request workspace updates, so this
  // queue serializes restart operations to avoid racey double-start/shutdown.
  const enqueueWorkspaceFolderUpdate = async (workspaceFolders: string[]) => {
    pendingWorkspaceFolderUpdatePromise = pendingWorkspaceFolderUpdatePromise
      .catch(() => {
        // Keep the queue alive after prior failures so later updates still run.
      })
      .then(async () => {
        await applyWorkspaceFolders(workspaceFolders);
      });

    try {
      await pendingWorkspaceFolderUpdatePromise;
    } catch (error) {
      console.error('Failed to refresh IDE MCP server workspace:', error);
    }
  };

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
    await enqueueWorkspaceFolderUpdate(workspaceFolders);
  };

  // Active-file changes may move terminal Claude sessions into a different cwd,
  // so this method keeps lock-file workspace folders aligned with that context.
  const updateWorkspaceFolders = async (workspaceFolders: string[]) => {
    await enqueueWorkspaceFolderUpdate(workspaceFolders);
  };

  // IDE server shutdown is centralized here so lock-file cleanup and websocket
  // teardown happen even if main.ts stays intentionally minimal.
  const shutdown = async () => {
    await pendingWorkspaceFolderUpdatePromise.catch(() => {
      // Best-effort wait: shutdown still proceeds even if an update failed.
    });

    if (pendingSelectionNotificationTimeout) {
      clearTimeout(pendingSelectionNotificationTimeout);
      pendingSelectionNotificationTimeout = null;
    }

    await shutdownIdeServerIfRunning();
  };

  return {
    registerIpcHandlers,
    startSafely,
    updateWorkspaceFolders,
    shutdown,
  };
};
