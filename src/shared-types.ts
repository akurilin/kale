// Shared IPC type definitions used by main, preload, and renderer processes.
// Kept in a single place so the contract between processes can't drift.

export type LoadMarkdownResponse = {
  content: string;
  filePath: string;
};

export type SaveMarkdownResponse = {
  ok: boolean;
};

export type OpenMarkdownFileResponse =
  | { canceled: true }
  | ({ canceled: false } & LoadMarkdownResponse);
