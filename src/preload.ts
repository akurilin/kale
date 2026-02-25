//
// This preload file exposes a narrow, typed bridge from renderer to main
// so UI code can request file operations without direct Electron/Node access.
//

import { contextBridge, ipcRenderer } from 'electron';

import type {
  ExternalMarkdownFileChangedEvent,
  LoadMarkdownResponse,
  OpenMarkdownFileResponse,
  ResizeTerminalSessionRequest,
  RestoreMarkdownFromGitResponse,
  StartTerminalSessionRequest,
  StartTerminalSessionResponse,
  TerminalSessionActionResponse,
  TerminalProcessDataEvent,
  TerminalProcessExitEvent,
} from './shared-types';

// Expose a narrow, explicit bridge instead of raw ipcRenderer so the renderer
// stays constrained to just the file operations this app supports.
contextBridge.exposeInMainWorld('markdownApi', {
  loadMarkdown: (): Promise<LoadMarkdownResponse> =>
    ipcRenderer.invoke('editor:load-markdown'),
  openMarkdownFile: (): Promise<OpenMarkdownFileResponse> =>
    ipcRenderer.invoke('editor:open-markdown-file'),
  saveMarkdown: (content: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('editor:save-markdown', content),
  restoreCurrentMarkdownFromGit: (): Promise<RestoreMarkdownFromGitResponse> =>
    ipcRenderer.invoke('editor:restore-current-markdown-from-git'),
  onExternalMarkdownFileChanged: (
    handler: (event: ExternalMarkdownFileChangedEvent) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: ExternalMarkdownFileChangedEvent,
    ) => {
      handler(payload);
    };
    ipcRenderer.on('editor:external-markdown-file-changed', listener);
    return () => {
      ipcRenderer.removeListener(
        'editor:external-markdown-file-changed',
        listener,
      );
    };
  },
});

// The terminal pane uses a separate bridge so process control stays explicit
// and we can evolve it independently from the editor file-API contract.
contextBridge.exposeInMainWorld('terminalApi', {
  startSession: (
    request: StartTerminalSessionRequest,
  ): Promise<StartTerminalSessionResponse> =>
    ipcRenderer.invoke('terminal:start-session', request),
  sendInput: (
    sessionId: string,
    data: string,
  ): Promise<TerminalSessionActionResponse> =>
    ipcRenderer.invoke('terminal:send-input', sessionId, data),
  resizeSession: (
    request: ResizeTerminalSessionRequest,
  ): Promise<TerminalSessionActionResponse> =>
    ipcRenderer.invoke('terminal:resize-session', request),
  killSession: (sessionId: string): Promise<TerminalSessionActionResponse> =>
    ipcRenderer.invoke('terminal:kill-session', sessionId),
  onProcessData: (
    handler: (event: TerminalProcessDataEvent) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: TerminalProcessDataEvent,
    ) => {
      handler(payload);
    };
    ipcRenderer.on('terminal:process-data', listener);
    return () => {
      ipcRenderer.removeListener('terminal:process-data', listener);
    };
  },
  onProcessExit: (
    handler: (event: TerminalProcessExitEvent) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: TerminalProcessExitEvent,
    ) => {
      handler(payload);
    };
    ipcRenderer.on('terminal:process-exit', listener);
    return () => {
      ipcRenderer.removeListener('terminal:process-exit', listener);
    };
  },
});
