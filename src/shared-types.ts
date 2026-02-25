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

export type ExternalMarkdownFileChangedEvent = {
  filePath: string;
};

export type OpenMarkdownFileResponse =
  | { canceled: true }
  | ({ canceled: false } & LoadMarkdownResponse);

export type RestoreMarkdownFromGitResponse =
  | ({ ok: true } & LoadMarkdownResponse)
  | { ok: false; errorMessage: string };

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

export type TerminalSessionActionResponse = {
  ok: boolean;
  errorMessage?: string;
};

export type ResizeTerminalSessionRequest = {
  sessionId: string;
  cols: number;
  rows: number;
};

// ---------------------------------------------------------------------------
// IDE integration: editor state shared across main, renderer, and IDE server.
// These are the canonical definitions — ide-server/types.ts re-exports them
// so the two modules never drift out of sync.
// ---------------------------------------------------------------------------

/** A text selection range using 0-based line/column coordinates. */
export type SelectionRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

/** The result of getCurrentSelection / getLatestSelection. */
export type EditorSelection = {
  filePath: string;
  selectedText: string;
  range: SelectionRange;
} | null;

/** A single open editor tab. */
export type OpenEditor = {
  filePath: string;
  isActive: boolean;
  /** Language identifier (e.g. "markdown"). */
  languageId: string;
};

/** Push event: renderer tells main about selection/cursor changes. */
export type IdeSelectionChangedEvent = {
  filePath: string;
  selectedText: string;
  range: SelectionRange;
};
