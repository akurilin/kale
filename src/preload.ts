import { contextBridge, ipcRenderer } from 'electron';

import type {
  LoadMarkdownResponse,
  OpenMarkdownFileResponse,
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
});
