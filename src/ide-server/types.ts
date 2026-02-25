//
// Type definitions for the MCP-over-WebSocket IDE server that lets Claude Code
// query Kale's editor state (open files, selections, diagnostics).
//

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 wire types
// ---------------------------------------------------------------------------

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcSuccessResponse = {
  jsonrpc: '2.0';
  id: number | string;
  result: unknown;
};

export type JsonRpcErrorResponse = {
  jsonrpc: '2.0';
  id: number | string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Lock file written to ~/.claude/ide/<port>.lock
// ---------------------------------------------------------------------------

export type IdeLockFileContents = {
  pid: number;
  workspaceFolders: string[];
  ideName: string;
  transport: 'ws';
  authToken: string;
};

// ---------------------------------------------------------------------------
// Editor state types exposed to MCP tool handlers
// ---------------------------------------------------------------------------

/** A text selection range using line/column coordinates (0-based). */
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

/** A single diagnostic entry from the editor. */
export type DiagnosticEntry = {
  filePath: string;
  range: SelectionRange;
  message: string;
  severity: 'error' | 'warning' | 'information' | 'hint';
  source?: string;
};

// ---------------------------------------------------------------------------
// Callback interface: main process provides these to the MCP server so it
// can query the renderer's live editor state on demand.
// ---------------------------------------------------------------------------

export type EditorStateProvider = {
  getCurrentSelection: () => Promise<EditorSelection>;
  getOpenEditors: () => Promise<OpenEditor[]>;
  getDiagnostics: () => Promise<DiagnosticEntry[]>;
};
