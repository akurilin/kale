import { randomUUID } from 'node:crypto';
import { promises as fs, realpathSync } from 'node:fs';
import net, { type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import type { CodexIdeContext } from './context';
import { CodexIpcFrameDecoder, encodeCodexIpcFrame } from './framing';

type CodexIpcMessage = Record<string, unknown> & {
  type: string;
  requestId?: string;
  method?: string;
};

type CodexIpcRequest = CodexIpcMessage & {
  type: 'request';
  requestId: string;
  method: string;
  params?: Record<string, unknown>;
};

type StartCodexIdeServerOptions = {
  socketPaths?: string[];
  getWorkspaceFolders: () => string[];
  getIdeContext: () => CodexIdeContext;
};

export type CodexIdeServerHandle = {
  shutdown: () => Promise<void>;
};

type RegisteredRouterClient = {
  id: string;
  socket: Socket;
};

type PendingDiscovery = {
  resolve: (canHandle: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const CODEX_IPC_INITIAL_CLIENT_ID = 'initializing-client';
const CODEX_IPC_DISCOVERY_TIMEOUT_MS = 1_000;
const CODEX_IPC_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Why: Codex uses one user-scoped IPC endpoint, with a secure temporary path
 * as a compatibility fallback when the primary Codex home is unavailable.
 */
const resolveDefaultCodexIpcSocketPaths = () => {
  if (process.platform === 'win32') {
    return ['\\\\.\\pipe\\codex-ipc'];
  }

  const codexHomeDirectory = process.env.CODEX_HOME?.trim()
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), '.codex');
  const currentUserId = process.getuid?.() ?? 0;
  return [
    path.join(codexHomeDirectory, 'ipc', 'ipc.sock'),
    path.join(os.tmpdir(), 'codex-ipc', `ipc-${currentUserId}.sock`),
  ];
};

/**
 * Why: workspace ownership must use path boundaries, not string prefixes, so
 * a workspace such as `/tmp/kale` does not claim `/tmp/kale-other`.
 */
const isPathInsideWorkspace = (
  candidatePath: string,
  workspaceFolder: string,
) => {
  /**
   * Why: macOS exposes `/tmp` as `/private/tmp`, and symlinked workspaces must
   * compare by their filesystem targets when both paths already exist.
   */
  const resolveComparablePath = (fileSystemPath: string) => {
    const absolutePath = path.resolve(fileSystemPath);
    try {
      return realpathSync.native(absolutePath);
    } catch {
      return absolutePath;
    }
  };
  const normalizedCandidatePath = resolveComparablePath(candidatePath);
  const normalizedWorkspaceFolder = resolveComparablePath(workspaceFolder);
  const relativePath = path.relative(
    normalizedWorkspaceFolder,
    normalizedCandidatePath,
  );
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
};

/**
 * Why: a short connection probe lets Kale join an existing Codex router and
 * avoids replacing a socket owned by ChatGPT, VS Code, or another application.
 */
const canConnectToSocketPath = (socketPath: string) =>
  new Promise<boolean>((resolve) => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    const settle = (canConnect: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(canConnect);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });

/**
 * Why: all router and provider writes must use one framing helper so partial
 * socket writes cannot produce protocol messages without a length prefix.
 */
const sendCodexIpcMessage = (socket: Socket, message: CodexIpcMessage) => {
  if (socket.writable) {
    socket.write(encodeCodexIpcFrame(message));
  }
};

/**
 * Why: Kale must supply a router when no other OpenAI application is running,
 * but the router remains generic so it does not reserve IDE IPC only for Kale.
 */
const startLocalCodexIpcRouter = async (socketPath: string) => {
  const server = net.createServer();
  const clientsBySocket = new Map<Socket, RegisteredRouterClient>();
  const clientsById = new Map<string, RegisteredRouterClient>();
  const pendingDiscoveriesById = new Map<string, PendingDiscovery>();
  const pendingRequestSourcesById = new Map<
    string,
    { sourceSocket: Socket; timeout: ReturnType<typeof setTimeout> }
  >();

  /**
   * Why: one failed or malicious frame must disconnect only its source client,
   * not terminate the Electron main process and every active terminal.
   */
  const attachMessageReader = (
    socket: Socket,
    onMessage: (message: CodexIpcMessage) => void,
  ) => {
    const decoder = new CodexIpcFrameDecoder((message) => {
      onMessage(message as CodexIpcMessage);
    });
    socket.on('data', (chunk) => {
      try {
        decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      } catch (error) {
        console.warn('Discarding invalid Codex IPC client frame:', error);
        socket.destroy();
      }
    });
  };

  /**
   * Why: discovery lets several IDE providers share the user-scoped router and
   * makes only the provider for the request workspace handle the request.
   */
  const askClientToHandleRequest = (
    client: RegisteredRouterClient,
    request: CodexIpcRequest,
  ) =>
    new Promise<boolean>((resolve) => {
      const discoveryRequestId = randomUUID();
      const timeout = setTimeout(() => {
        pendingDiscoveriesById.delete(discoveryRequestId);
        resolve(false);
      }, CODEX_IPC_DISCOVERY_TIMEOUT_MS);
      pendingDiscoveriesById.set(discoveryRequestId, { resolve, timeout });
      sendCodexIpcMessage(client.socket, {
        type: 'client-discovery-request',
        requestId: discoveryRequestId,
        request,
      });
    });

  /**
   * Why: the first provider that accepts the workspace receives the original
   * request, while the router keeps enough state to return its response.
   */
  const routeRequest = async (
    sourceSocket: Socket,
    request: CodexIpcRequest,
  ) => {
    const sourceClient = clientsBySocket.get(sourceSocket);
    const routedRequest = {
      ...request,
      sourceClientId: sourceClient?.id ?? request.sourceClientId,
    };
    const candidateClients = Array.from(clientsBySocket.values()).filter(
      (client) => client.socket !== sourceSocket && client.socket.writable,
    );
    const discoveryResults = await Promise.all(
      candidateClients.map(async (client) => ({
        client,
        canHandle: await askClientToHandleRequest(client, routedRequest),
      })),
    );
    const selectedClient = discoveryResults.find(
      ({ canHandle }) => canHandle,
    )?.client;
    if (!selectedClient) {
      sendCodexIpcMessage(sourceSocket, {
        type: 'response',
        requestId: request.requestId,
        resultType: 'error',
        error: 'no-client-found',
      });
      return;
    }

    const timeout = setTimeout(() => {
      pendingRequestSourcesById.delete(request.requestId);
      sendCodexIpcMessage(sourceSocket, {
        type: 'response',
        requestId: request.requestId,
        resultType: 'error',
        error: 'request-timeout',
      });
    }, CODEX_IPC_REQUEST_TIMEOUT_MS);
    pendingRequestSourcesById.set(request.requestId, {
      sourceSocket,
      timeout,
    });
    sendCodexIpcMessage(selectedClient.socket, routedRequest);
  };

  /**
   * Why: initialize assigns the stable client ID that later responses use to
   * show which connected IDE provider handled a request.
   */
  const registerClient = (socket: Socket, request: CodexIpcRequest) => {
    const existingClient = clientsBySocket.get(socket);
    const client = existingClient ?? { id: randomUUID(), socket };
    if (!existingClient) {
      clientsBySocket.set(socket, client);
      clientsById.set(client.id, client);
    }
    sendCodexIpcMessage(socket, {
      type: 'response',
      requestId: request.requestId,
      resultType: 'success',
      method: 'initialize',
      handledByClientId: client.id,
      result: { clientId: client.id },
    });
  };

  /**
   * Why: each protocol message has a distinct routing role, so the router keeps
   * those state transitions explicit and ignores unknown future message types.
   */
  const handleClientMessage = (socket: Socket, message: CodexIpcMessage) => {
    if (message.type === 'request' && message.requestId && message.method) {
      const request = message as CodexIpcRequest;
      if (request.method === 'initialize') {
        registerClient(socket, request);
      } else {
        void routeRequest(socket, request);
      }
      return;
    }

    if (message.type === 'client-discovery-response' && message.requestId) {
      const pendingDiscovery = pendingDiscoveriesById.get(message.requestId);
      if (!pendingDiscovery) {
        return;
      }
      pendingDiscoveriesById.delete(message.requestId);
      clearTimeout(pendingDiscovery.timeout);
      const response = message.response as { canHandle?: boolean } | undefined;
      pendingDiscovery.resolve(response?.canHandle === true);
      return;
    }

    if (message.type === 'response' && message.requestId) {
      const pendingRequest = pendingRequestSourcesById.get(message.requestId);
      if (!pendingRequest) {
        return;
      }
      pendingRequestSourcesById.delete(message.requestId);
      clearTimeout(pendingRequest.timeout);
      sendCodexIpcMessage(pendingRequest.sourceSocket, message);
      return;
    }

    if (message.type === 'broadcast') {
      for (const client of clientsBySocket.values()) {
        if (client.socket !== socket) {
          sendCodexIpcMessage(client.socket, message);
        }
      }
    }
  };

  server.on('connection', (socket) => {
    attachMessageReader(socket, (message) => {
      handleClientMessage(socket, message);
    });
    socket.on('close', () => {
      const client = clientsBySocket.get(socket);
      if (client) {
        clientsBySocket.delete(socket);
        clientsById.delete(client.id);
      }
    });
  });

  if (process.platform !== 'win32') {
    const socketDirectoryPath = path.dirname(socketPath);
    await fs.mkdir(socketDirectoryPath, { recursive: true, mode: 0o700 });
    await fs.chmod(socketDirectoryPath, 0o700);
    try {
      await fs.unlink(socketPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (process.platform !== 'win32') {
    await fs.chmod(socketPath, 0o600);
  }

  return {
    server,
    clientsBySocket,
    pendingDiscoveriesById,
    pendingRequestSourcesById,
    socketPath,
  };
};

type LocalCodexIpcRouter = Awaited<ReturnType<typeof startLocalCodexIpcRouter>>;

/**
 * Why: Kale acts as a normal IDE provider client whether another application
 * owns the router or Kale had to create the router itself.
 */
const connectKaleIdeProvider = async (
  socketPath: string,
  options: StartCodexIdeServerOptions,
) => {
  const socket = net.createConnection(socketPath);
  let clientId = CODEX_IPC_INITIAL_CLIENT_ID;
  const initializeRequestId = randomUUID();

  /**
   * Why: Codex asks every connected provider before routing, so Kale claims
   * only IDE-context requests whose workspace belongs to its active editor.
   */
  const canHandleRequest = (request: CodexIpcRequest) => {
    if (request.method !== 'ide-context') {
      return false;
    }
    const workspaceRoot = request.params?.workspaceRoot;
    if (typeof workspaceRoot !== 'string') {
      return false;
    }
    return options
      .getWorkspaceFolders()
      .some((workspaceFolder) =>
        isPathInsideWorkspace(workspaceRoot, workspaceFolder),
      );
  };

  /**
   * Why: IDE context is read only after prompt submission, so this response
   * always contains the most recent file and non-empty selection snapshot.
   */
  const handleProviderMessage = (message: CodexIpcMessage) => {
    if (
      message.type === 'response' &&
      message.requestId === initializeRequestId
    ) {
      const result = message.result as { clientId?: string } | undefined;
      if (result?.clientId) {
        clientId = result.clientId;
      }
      return;
    }

    if (message.type === 'client-discovery-request' && message.requestId) {
      const request = message.request as CodexIpcRequest;
      sendCodexIpcMessage(socket, {
        type: 'client-discovery-response',
        requestId: message.requestId,
        response: { canHandle: canHandleRequest(request) },
      });
      return;
    }

    if (message.type === 'request' && message.requestId && message.method) {
      const request = message as CodexIpcRequest;
      if (!canHandleRequest(request)) {
        sendCodexIpcMessage(socket, {
          type: 'response',
          requestId: request.requestId,
          resultType: 'error',
          error: 'client-cannot-handle-request',
        });
        return;
      }
      sendCodexIpcMessage(socket, {
        type: 'response',
        requestId: request.requestId,
        resultType: 'success',
        method: request.method,
        handledByClientId: clientId,
        result: { ideContext: options.getIdeContext() },
      });
    }
  };

  const decoder = new CodexIpcFrameDecoder((message) => {
    handleProviderMessage(message as CodexIpcMessage);
  });
  socket.on('data', (chunk) => {
    try {
      decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    } catch (error) {
      console.warn('Codex IDE provider received an invalid IPC frame:', error);
      socket.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  sendCodexIpcMessage(socket, {
    type: 'request',
    requestId: initializeRequestId,
    sourceClientId: CODEX_IPC_INITIAL_CLIENT_ID,
    version: 0,
    method: 'initialize',
    params: { clientType: 'kale' },
  });

  return socket;
};

/**
 * Why: startup first joins a live user-scoped router and creates a local router
 * only when no other Codex-capable application owns either supported endpoint.
 */
export const startCodexIdeServer = async (
  options: StartCodexIdeServerOptions,
): Promise<CodexIdeServerHandle> => {
  const socketPaths =
    options.socketPaths ?? resolveDefaultCodexIpcSocketPaths();
  let selectedSocketPath: string | null = null;
  for (const socketPath of socketPaths) {
    if (await canConnectToSocketPath(socketPath)) {
      selectedSocketPath = socketPath;
      break;
    }
  }

  let localRouter: LocalCodexIpcRouter | null = null;
  if (!selectedSocketPath) {
    const preferredSocketPath = socketPaths[0];
    if (!preferredSocketPath) {
      throw new Error('No Codex IPC socket path is configured');
    }
    localRouter = await startLocalCodexIpcRouter(preferredSocketPath);
    selectedSocketPath = preferredSocketPath;
  }

  const providerSocket = await connectKaleIdeProvider(
    selectedSocketPath,
    options,
  );

  return {
    shutdown: async () => {
      providerSocket.destroy();
      if (!localRouter) {
        return;
      }

      for (const pendingDiscovery of localRouter.pendingDiscoveriesById.values()) {
        clearTimeout(pendingDiscovery.timeout);
        pendingDiscovery.resolve(false);
      }
      localRouter.pendingDiscoveriesById.clear();
      for (const pendingRequest of localRouter.pendingRequestSourcesById.values()) {
        clearTimeout(pendingRequest.timeout);
      }
      localRouter.pendingRequestSourcesById.clear();
      for (const clientSocket of localRouter.clientsBySocket.keys()) {
        clientSocket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        (localRouter as LocalCodexIpcRouter).server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      if (process.platform !== 'win32') {
        await fs.unlink(localRouter.socketPath).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        });
      }
    },
  };
};
