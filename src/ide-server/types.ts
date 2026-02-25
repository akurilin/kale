//
// Type definitions for the MCP-over-WebSocket IDE server that lets Claude Code
// query Kale's editor state (open files, selections, diagnostics).
//
// Editor state types (SelectionRange, EditorSelection, OpenEditor) are defined
// once in shared-types.ts and re-exported here so the IDE server module and
// IPC boundary share one source of truth.
//

import type {
  EditorSelection,
  OpenEditor,
  SelectionRange,
} from '../shared-types';

export type { EditorSelection, OpenEditor, SelectionRange };

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
