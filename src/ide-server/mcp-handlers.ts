//
// JSON-RPC 2.0 request dispatcher for the MCP tools that Claude Code calls.
// Each tool handler queries the renderer's live editor state through the
// EditorStateProvider callback interface so the WebSocket layer stays decoupled
// from Electron IPC details.
//
// The protocol version and capability shape must match what Claude Code CLI
// expects. Reference: claudecode.nvim PROTOCOL.md (MCP spec 2024-11-05).
//

import type {
  EditorStateProvider,
  JsonRpcErrorResponse,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
} from './types';

// Must match the MCP protocol version that Claude Code CLI speaks. Using a
// wrong version causes the CLI to ignore or partially discover tools.
const MCP_PROTOCOL_VERSION = '2024-11-05';

// JSON-RPC 2.0 standard error codes.
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/** Builds a successful JSON-RPC 2.0 response. */
const successResponse = (
  id: number | string,
  result: unknown,
): JsonRpcSuccessResponse => ({
  jsonrpc: '2.0',
  id,
  result,
});

/** Builds a JSON-RPC 2.0 error response. */
const errorResponse = (
  id: number | string,
  code: number,
  message: string,
): JsonRpcErrorResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

// ---------------------------------------------------------------------------
// MCP tool-call wrapper
//
// Claude Code sends `tools/call` with { name, arguments } inside params.
// We unwrap that layer here and dispatch to the right handler.
// ---------------------------------------------------------------------------

type ToolCallParams = {
  name: string;
  arguments?: Record<string, unknown>;
};

/** Returns true when the params object looks like a valid tools/call request. */
const isToolCallParams = (
  params: Record<string, unknown> | undefined,
): params is ToolCallParams =>
  params !== undefined && typeof params.name === 'string';

// ---------------------------------------------------------------------------
// Tool definitions advertised via tools/list
//
// The inputSchema uses JSON Schema draft-07 with additionalProperties: false
// to match the format Claude Code expects from IDE MCP servers.
// ---------------------------------------------------------------------------

const MCP_TOOL_DEFINITIONS = [
  {
    name: 'getCurrentSelection',
    description:
      'Returns the currently selected text, file path, and line/column range in the active editor.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
      $schema: 'http://json-schema.org/draft-07/schema#',
    },
  },
  {
    name: 'getLatestSelection',
    description:
      'Returns the most recent text selection across any editor tab.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
      $schema: 'http://json-schema.org/draft-07/schema#',
    },
  },
  {
    name: 'getOpenEditors',
    description:
      'Returns all open editor tabs with file paths and active status.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
      $schema: 'http://json-schema.org/draft-07/schema#',
    },
  },
  {
    name: 'getDiagnostics',
    description:
      'Returns LSP-style diagnostics (errors, warnings) for files in the workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        uri: {
          type: 'string',
          description: 'Optional file URI to filter diagnostics.',
        },
      },
      additionalProperties: false,
      $schema: 'http://json-schema.org/draft-07/schema#',
    },
  },
];

/**
 * Dispatches a single JSON-RPC 2.0 request and returns the response object.
 *
 * The dispatcher handles the MCP lifecycle methods (initialize, tools/list,
 * prompts/list, resources/list) directly and routes tools/call requests to the
 * appropriate editor state provider callback. Claude Code queries all four
 * list endpoints during the handshake — returning errors for any of them
 * causes the CLI to silently drop tools from its available set.
 */
export const dispatchJsonRpcRequest = async (
  request: JsonRpcRequest,
  editorStateProvider: EditorStateProvider,
): Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse> => {
  try {
    switch (request.method) {
      // MCP session handshake — return server capabilities. The capabilities
      // object must include all four capability keys with their sub-fields so
      // Claude Code proceeds to query each list endpoint.
      case 'initialize': {
        return successResponse(request.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            logging: {},
            prompts: { listChanged: true },
            resources: { subscribe: true, listChanged: true },
            tools: { listChanged: true },
          },
          serverInfo: { name: 'kale', version: '1.0.0' },
        });
      }

      // MCP tool discovery — return the list of available tools.
      case 'tools/list': {
        return successResponse(request.id, { tools: MCP_TOOL_DEFINITIONS });
      }

      // Claude Code also queries prompts and resources during the handshake.
      // We don't have custom prompts or resources, but returning empty lists
      // (instead of method-not-found errors) keeps the handshake healthy.
      case 'prompts/list': {
        return successResponse(request.id, { prompts: [] });
      }

      case 'resources/list': {
        return successResponse(request.id, { resources: [] });
      }

      // MCP tool execution — route to the matching handler.
      case 'tools/call': {
        const params = request.params as Record<string, unknown> | undefined;
        if (!isToolCallParams(params)) {
          return errorResponse(
            request.id,
            METHOD_NOT_FOUND,
            'Missing or invalid tool name in tools/call params.',
          );
        }

        return await dispatchToolCall(request.id, params, editorStateProvider);
      }

      default: {
        return errorResponse(
          request.id,
          METHOD_NOT_FOUND,
          `Method not found: ${request.method}`,
        );
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown handler error';
    return errorResponse(request.id, INTERNAL_ERROR, errorMessage);
  }
};

/** Routes a tools/call request to the right editor state provider method. */
const dispatchToolCall = async (
  id: number | string,
  params: ToolCallParams,
  editorStateProvider: EditorStateProvider,
): Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse> => {
  switch (params.name) {
    case 'getCurrentSelection':
    case 'getLatestSelection': {
      // Both selection tools return the same data in this single-document
      // editor because there is only one active tab at a time.
      const selection = await editorStateProvider.getCurrentSelection();
      return successResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(selection),
          },
        ],
      });
    }

    case 'getOpenEditors': {
      const editors = await editorStateProvider.getOpenEditors();
      return successResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(editors),
          },
        ],
      });
    }

    case 'getDiagnostics': {
      const diagnostics = await editorStateProvider.getDiagnostics();
      return successResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(diagnostics),
          },
        ],
      });
    }

    default: {
      return errorResponse(
        id,
        METHOD_NOT_FOUND,
        `Unknown tool: ${params.name}`,
      );
    }
  }
};
