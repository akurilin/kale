//
// This file centralizes the typed preload bridge contract so React renderer
// modules can share one source of truth for IPC-facing browser globals.
//

import type {
  LoadMarkdownResponse,
  OpenMarkdownFileResponse,
  SaveMarkdownResponse,
} from '../shared-types';

type MarkdownApi = {
  loadMarkdown: () => Promise<LoadMarkdownResponse>;
  openMarkdownFile: () => Promise<OpenMarkdownFileResponse>;
  saveMarkdown: (content: string) => Promise<SaveMarkdownResponse>;
};

declare global {
  interface Window {
    markdownApi: MarkdownApi;
  }
}

// reading the bridge through one helper keeps React modules focused on app
// behavior and gives us a single place to evolve renderer-side typing later.
export const getMarkdownApi = (): MarkdownApi => window.markdownApi;
