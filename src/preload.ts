//
// This preload file exposes a narrow, typed bridge from renderer to main
// so UI code can request file operations without direct Electron/Node access.
//

import { contextBridge, ipcRenderer } from 'electron';

import type {
  LoadMarkdownResponse,
  OpenMarkdownFileResponse,
  RestoreMarkdownFromGitResponse,
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
});
