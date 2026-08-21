import { randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';

import type { PiEditorContextSnapshot } from './context';

export const KALE_PI_EDITOR_CONTEXT_URL_ENVIRONMENT_VARIABLE =
  'KALE_PI_EDITOR_CONTEXT_URL';
export const KALE_PI_IDE_AUTH_TOKEN_ENVIRONMENT_VARIABLE =
  'KALE_PI_IDE_AUTH_TOKEN';
export const KALE_PI_IDE_AUTHORIZATION_HEADER = 'x-kale-ide-authorization';

type PiIdeServerDependencies = {
  getCurrentEditorContext: () => Promise<PiEditorContextSnapshot>;
};

export type PiIdeServerHandle = {
  editorContextUrl: string;
  authToken: string;
  shutdown: () => Promise<void>;
};

/**
 * Why: all endpoint responses need consistent JSON and cache controls so Pi
 * receives prompt-time state instead of a reused selection snapshot.
 */
const sendJsonResponse = (
  response: ServerResponse,
  statusCode: number,
  body: unknown,
) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
};

/**
 * Why: Pi uses a separate process, so this narrow authenticated HTTP handler
 * gives its extension current editor state without exposing Electron IPC.
 */
const handleEditorContextRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  authToken: string,
  dependencies: PiIdeServerDependencies,
) => {
  if (request.method !== 'GET' || request.url !== '/editor-context') {
    sendJsonResponse(response, 404, { error: 'Not found' });
    return;
  }

  if (request.headers[KALE_PI_IDE_AUTHORIZATION_HEADER] !== authToken) {
    sendJsonResponse(response, 401, { error: 'Unauthorized' });
    return;
  }

  try {
    sendJsonResponse(
      response,
      200,
      await dependencies.getCurrentEditorContext(),
    );
  } catch {
    sendJsonResponse(response, 500, { error: 'Editor context unavailable' });
  }
};

/**
 * Why: a dedicated loopback server gives Pi a stable prompt-time context API
 * while keeping its per-process token and lifecycle under Kale main control.
 */
export const startPiIdeServer = async (
  dependencies: PiIdeServerDependencies,
): Promise<PiIdeServerHandle> => {
  const authToken = randomUUID();
  const httpServer = http.createServer((request, response) => {
    void handleEditorContextRequest(request, response, authToken, dependencies);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  const serverAddress = httpServer.address();
  if (!serverAddress || typeof serverAddress === 'string') {
    httpServer.close();
    throw new Error('Pi IDE context server did not receive a TCP port.');
  }

  const editorContextUrl = `http://127.0.0.1:${serverAddress.port}/editor-context`;
  console.log(`Pi IDE context server listening on ${editorContextUrl}`);

  /**
   * Why: awaiting the close callback ensures the port is released before a
   * later Kale process or test attempts to create another context server.
   */
  const shutdown = async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
    console.log('Pi IDE context server shut down.');
  };

  return { editorContextUrl, authToken, shutdown };
};
