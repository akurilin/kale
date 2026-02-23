//
// This file centralizes the IPC payload types shared across main, preload,
// and renderer so process boundaries stay type-safe and synchronized.
//
// Shared IPC type definitions used by main, preload, and renderer processes.
// Kept in a single place so the contract between processes can't drift.
//

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

export type RestoreMarkdownFromGitResponse =
  | ({ ok: true } & LoadMarkdownResponse)
  | { ok: false; errorMessage: string };

export type TerminalBootstrapResponse = {
  targetFilePath: string;
  cwd: string;
  source: 'current' | 'sample';
};

export type StartTerminalSessionRequest = {
  cwd: string;
  targetFilePath: string;
};

export type StartTerminalSessionResponse =
  | {
      ok: true;
      sessionId: string;
      pid: number;
      cwd: string;
      targetFilePath: string;
      command: string;
      args: string[];
    }
  | {
      ok: false;
      errorMessage: string;
      command: string;
      args: string[];
    };

export type TerminalProcessDataEvent = {
  sessionId: string;
  chunk: string;
};

export type TerminalProcessExitEvent = {
  sessionId: string;
  exitCode: number | null;
  signal: number | null;
};

export type ResizeTerminalSessionRequest = {
  sessionId: string;
  cols: number;
  rows: number;
};
