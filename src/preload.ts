import { contextBridge, ipcRenderer } from 'electron';

type LoadMarkdownResponse = {
  content: string;
  filePath: string;
};

contextBridge.exposeInMainWorld('markdownApi', {
  loadMarkdown: (): Promise<LoadMarkdownResponse> =>
    ipcRenderer.invoke('editor:load-markdown'),
  saveMarkdown: (content: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('editor:save-markdown', content),
});
