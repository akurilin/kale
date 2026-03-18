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

export type RepositoryMarkdownExplorerFileNode = {
  type: 'file';
  name: string;
  path: string;
};

export type RepositoryMarkdownExplorerDirectoryNode = {
  type: 'directory';
  name: string;
  path: string;
  children: RepositoryMarkdownExplorerNode[];
};

export type RepositoryMarkdownExplorerNode =
  | RepositoryMarkdownExplorerFileNode
  | RepositoryMarkdownExplorerDirectoryNode;

export type SaveMarkdownResponse = {
  ok: boolean;
};

export type ExternalMarkdownFileChangedEvent = {
  filePath: string;
};

export type CurrentMarkdownFilePathChangedEvent = {
  filePath: string;
};

export type OpenMarkdownFileResponse =
  | { canceled: true }
  | ({ canceled: false } & LoadMarkdownResponse);

export type OpenMarkdownFileAtPathResponse =
  | ({ ok: true } & LoadMarkdownResponse)
  | { ok: false; errorMessage: string };

export type CreateMarkdownFileResponse =
  | { canceled: true }
  | ({ canceled: false } & LoadMarkdownResponse);

export type GetCurrentFileRepositoryMarkdownTreeResponse =
  | {
      ok: true;
      repositoryRoot: string;
      activeFilePath: string;
      tree: RepositoryMarkdownExplorerNode[];
    }
  | {
      ok: false;
      reason: 'not-in-git-repo' | 'load-failed';
      errorMessage?: string;
    };

export type RestoreMarkdownFromGitResponse =
  | ({ ok: true } & LoadMarkdownResponse)
  | { ok: false; errorMessage: string };

export type CommitCurrentMarkdownFileResponse =
  | {
      ok: true;
      didCreateCommit: boolean;
      committedFilePath: string;
      commitMessage: string;
    }
  | {
      ok: false;
      errorMessage: string;
    };

export type CurrentMarkdownGitBranchState = {
  currentBranchName: string;
  detachedHeadCommitShortSha: string | null;
  branchNames: string[];
  isCurrentFileModified: boolean;
};

export type GetCurrentMarkdownGitBranchStateResponse =
  | {
      ok: true;
      gitBranchState: CurrentMarkdownGitBranchState;
    }
  | {
      ok: false;
      errorMessage: string;
    };

export type SwitchCurrentMarkdownGitBranchRequest = {
  branchName: string;
  discardCurrentFileChanges: boolean;
};

export type SwitchCurrentMarkdownGitBranchResponse =
  | ({
      ok: true;
      gitBranchState: CurrentMarkdownGitBranchState;
    } & LoadMarkdownResponse)
  | {
      ok: false;
      errorMessage: string;
    };

export type StartTerminalSessionRequest = {
  cwd: string;
  targetFilePath: string;
  initialCols?: number;
  initialRows?: number;
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
      usesClaudeCodeShiftEnterRemap: boolean;
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
