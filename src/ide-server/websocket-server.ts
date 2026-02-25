//
// WebSocket server that speaks MCP (JSON-RPC 2.0) so Claude Code CLI can
// query Kale's editor state. This is the core transport layer — it validates
// auth tokens on the upgrade handshake and routes incoming messages through
// the MCP dispatcher.
//

import { randomUUID } from 'node:crypto';
import http from 'node:http';

import { WebSocketServer, WebSocket } from 'ws';

import { writeIdeLockFile, removeIdeLockFile } from './lock-file';
import { dispatchJsonRpcRequest } from './mcp-handlers';
import type {
  EditorStateProvider,
  JsonRpcNotification,
  JsonRpcRequest,
} from './types';

// Claude Code lock file discovery expects ports in this range.
const MIN_PORT = 10000;
const MAX_PORT = 65535;

/** Picks a random port in the allowed range for the IDE WebSocket server. */
const pickRandomPort = () =>
  Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;

/** Runtime handle returned by startIdeServer for lifecycle management. */
export type IdeServerHandle = {
  port: number;
  authToken: string;
  /** Send a JSON-RPC notification to all connected Claude Code clients. */
  broadcastNotification: (notification: JsonRpcNotification) => void;
  /** Gracefully shuts down the server and removes the lock file. */
  shutdown: () => Promise<void>;
};

/**
 * Starts the MCP WebSocket server, writes the lock file, and returns a handle
 * the caller uses to broadcast notifications and shut down later.
 *
 * The server tries up to `maxPortRetries` random ports before giving up, since
 * port collisions are possible on a busy machine.
 */
export const startIdeServer = async (
  workspaceFolders: string[],
  editorStateProvider: EditorStateProvider,
  maxPortRetries = 10,
): Promise<IdeServerHandle> => {
  const authToken = randomUUID();

  // Try binding to a random port, retrying on EADDRINUSE.
  let httpServer: http.Server | null = null;
  let boundPort = 0;

  for (let attempt = 0; attempt < maxPortRetries; attempt++) {
    const candidatePort = pickRandomPort();
    httpServer = http.createServer();

    try {
      await new Promise<void>((resolve, reject) => {
        httpServer!.once('error', reject);
        httpServer!.listen(candidatePort, '127.0.0.1', () => {
          httpServer!.removeAllListeners('error');
          resolve();
        });
      });
      boundPort = candidatePort;
      break;
    } catch (error) {
      const errnoError = error as NodeJS.ErrnoException;
      if (errnoError.code !== 'EADDRINUSE') {
        throw error;
      }
      httpServer = null;
    }
  }

  if (!httpServer || boundPort === 0) {
    throw new Error(
      `Could not bind IDE WebSocket server after ${maxPortRetries} attempts.`,
    );
  }

  const wss = new WebSocketServer({ noServer: true });

  // Validate the auth token on the HTTP upgrade so unauthenticated clients
  // never reach the WebSocket layer.
  httpServer.on('upgrade', (request, socket, head) => {
    const headerToken = request.headers['x-claude-code-ide-authorization'];
    if (headerToken !== authToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    ws.on('message', (rawData) => {
      void handleIncomingMessage(ws, rawData, editorStateProvider);
    });
  });

  // Write the lock file so Claude Code CLI can discover this server.
  const lockFilePath = await writeIdeLockFile(boundPort, {
    pid: process.pid,
    workspaceFolders,
    ideName: 'Kale',
    transport: 'ws',
    authToken,
  });

  console.log(
    `IDE MCP server listening on ws://127.0.0.1:${boundPort} (lock: ${lockFilePath})`,
  );

  // Broadcast a JSON-RPC notification to every connected client.
  const broadcastNotification = (notification: JsonRpcNotification) => {
    const serialized = JSON.stringify(notification);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  };

  // Graceful shutdown: close all connections, stop the HTTP server, remove
  // the lock file.
  const shutdown = async () => {
    for (const client of wss.clients) {
      client.close();
    }
    wss.close();
    await new Promise<void>((resolve, reject) => {
      httpServer!.close((err) => (err ? reject(err) : resolve()));
    });
    await removeIdeLockFile(boundPort);
    console.log('IDE MCP server shut down.');
  };

  return { port: boundPort, authToken, broadcastNotification, shutdown };
};

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

/** Parses an incoming WebSocket frame and dispatches it as a JSON-RPC request. */
const handleIncomingMessage = async (
  ws: WebSocket,
  rawData: unknown,
  editorStateProvider: EditorStateProvider,
) => {
  try {
    const text =
      rawData instanceof Buffer ? rawData.toString('utf8') : String(rawData);
    const parsed = JSON.parse(text) as JsonRpcRequest;

    // Notifications (no `id`) are silently acknowledged — we don't need to
    // respond. Currently Claude Code only sends requests, not notifications.
    if (parsed.id === undefined || parsed.id === null) {
      return;
    }

    const response = await dispatchJsonRpcRequest(parsed, editorStateProvider);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  } catch {
    // Malformed messages are dropped. JSON-RPC 2.0 requires a valid `id` to
    // send an error response, and we can't extract one from garbage input.
  }
};
