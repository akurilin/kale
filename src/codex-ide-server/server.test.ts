import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { CodexIdeContext } from './context';
import { CodexIpcFrameDecoder, encodeCodexIpcFrame } from './framing';
import { startCodexIdeServer, type CodexIdeServerHandle } from './server';

type TestCodexIpcMessage = Record<string, unknown> & {
  type: string;
  requestId?: string;
};

const activeServerHandles: CodexIdeServerHandle[] = [];
const temporaryDirectoryPaths: string[] = [];

/**
 * Why: the test requester uses the real framed socket contract, which catches
 * routing mistakes that a direct provider unit test cannot expose.
 */
const connectTestRequester = async (socketPath: string) => {
  const socket = net.createConnection(socketPath);
  const pendingMessages: TestCodexIpcMessage[] = [];
  const messageWaiters: Array<{
    predicate: (message: TestCodexIpcMessage) => boolean;
    resolve: (message: TestCodexIpcMessage) => void;
  }> = [];
  const decoder = new CodexIpcFrameDecoder((message) => {
    const typedMessage = message as TestCodexIpcMessage;
    const matchingWaiterIndex = messageWaiters.findIndex(({ predicate }) =>
      predicate(typedMessage),
    );
    if (matchingWaiterIndex === -1) {
      pendingMessages.push(typedMessage);
      return;
    }

    const [matchingWaiter] = messageWaiters.splice(matchingWaiterIndex, 1);
    matchingWaiter.resolve(typedMessage);
  });
  socket.on('data', (chunk) =>
    decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  const waitForMessage = (
    predicate: (message: TestCodexIpcMessage) => boolean,
  ) => {
    const pendingMessageIndex = pendingMessages.findIndex(predicate);
    if (pendingMessageIndex !== -1) {
      const [pendingMessage] = pendingMessages.splice(pendingMessageIndex, 1);
      return Promise.resolve(pendingMessage);
    }

    return new Promise<TestCodexIpcMessage>((resolve) => {
      messageWaiters.push({ predicate, resolve });
    });
  };

  return {
    socket,
    send: (message: TestCodexIpcMessage) => {
      socket.write(encodeCodexIpcFrame(message));
    },
    waitForMessage,
  };
};

afterEach(async () => {
  await Promise.all(
    activeServerHandles.splice(0).map((handle) => handle.shutdown()),
  );
  await Promise.all(
    temporaryDirectoryPaths
      .splice(0)
      .map((directoryPath) =>
        fs.rm(directoryPath, { recursive: true, force: true }),
      ),
  );
});

describe('startCodexIdeServer', () => {
  it('routes an IDE-context request to Kale and reads the latest snapshot', async () => {
    const temporaryDirectoryPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'kale-codex-ide-test-'),
    );
    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    const socketPath = path.join(temporaryDirectoryPath, 'ipc.sock');
    let currentIdeContext: CodexIdeContext = {
      openTabs: [
        {
          label: 'first.md',
          path: 'first.md',
          fsPath: '/tmp/kale/first.md',
        },
      ],
    };
    const serverHandle = await startCodexIdeServer({
      socketPaths: [socketPath],
      getWorkspaceFolders: () => ['/tmp/kale'],
      getIdeContext: () => currentIdeContext,
    });
    activeServerHandles.push(serverHandle);
    const requester = await connectTestRequester(socketPath);

    const initializeRequestId = randomUUID();
    requester.send({
      type: 'request',
      requestId: initializeRequestId,
      sourceClientId: 'initializing-client',
      version: 0,
      method: 'initialize',
      params: { clientType: 'codex-test' },
    });
    await requester.waitForMessage(
      (message) =>
        message.type === 'response' &&
        message.requestId === initializeRequestId,
    );

    currentIdeContext = {
      activeFile: {
        label: 'latest.md',
        path: 'latest.md',
        fsPath: '/tmp/kale/latest.md',
        selection: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 6 },
        },
        activeSelectionContent: 'latest',
        selections: [
          {
            start: { line: 2, character: 0 },
            end: { line: 2, character: 6 },
          },
        ],
      },
      openTabs: [],
    };
    const ideContextRequestId = randomUUID();
    requester.send({
      type: 'request',
      requestId: ideContextRequestId,
      sourceClientId: 'initializing-client',
      version: 0,
      method: 'ide-context',
      params: { workspaceRoot: '/tmp/kale' },
    });

    await expect(
      requester.waitForMessage(
        (message) =>
          message.type === 'response' &&
          message.requestId === ideContextRequestId,
      ),
    ).resolves.toMatchObject({
      resultType: 'success',
      method: 'ide-context',
      result: { ideContext: currentIdeContext },
    });

    requester.socket.end();
  });

  it('does not claim IDE-context requests outside the Kale workspace', async () => {
    const temporaryDirectoryPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'kale-codex-ide-test-'),
    );
    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    const socketPath = path.join(temporaryDirectoryPath, 'ipc.sock');
    const serverHandle = await startCodexIdeServer({
      socketPaths: [socketPath],
      getWorkspaceFolders: () => ['/tmp/kale'],
      getIdeContext: () => ({ openTabs: [] }),
    });
    activeServerHandles.push(serverHandle);
    const requester = await connectTestRequester(socketPath);
    const initializeRequestId = randomUUID();
    requester.send({
      type: 'request',
      requestId: initializeRequestId,
      sourceClientId: 'initializing-client',
      version: 0,
      method: 'initialize',
      params: { clientType: 'codex-test' },
    });
    await requester.waitForMessage(
      (message) => message.requestId === initializeRequestId,
    );

    const ideContextRequestId = randomUUID();
    requester.send({
      type: 'request',
      requestId: ideContextRequestId,
      sourceClientId: 'initializing-client',
      version: 0,
      method: 'ide-context',
      params: { workspaceRoot: '/tmp/another-app' },
    });

    await expect(
      requester.waitForMessage(
        (message) => message.requestId === ideContextRequestId,
      ),
    ).resolves.toMatchObject({
      resultType: 'error',
      error: 'no-client-found',
    });

    requester.socket.end();
  });

  it('claims a workspace reached through a filesystem path alias', async () => {
    const temporaryDirectoryPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'kale-codex-ide-test-'),
    );
    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    const realWorkspacePath = path.join(
      temporaryDirectoryPath,
      'real-workspace',
    );
    const aliasedWorkspacePath = path.join(
      temporaryDirectoryPath,
      'aliased-workspace',
    );
    await fs.mkdir(realWorkspacePath);
    await fs.symlink(realWorkspacePath, aliasedWorkspacePath);
    const socketPath = path.join(temporaryDirectoryPath, 'ipc.sock');
    const serverHandle = await startCodexIdeServer({
      socketPaths: [socketPath],
      getWorkspaceFolders: () => [aliasedWorkspacePath],
      getIdeContext: () => ({ openTabs: [] }),
    });
    activeServerHandles.push(serverHandle);
    const requester = await connectTestRequester(socketPath);
    const initializeRequestId = randomUUID();
    requester.send({
      type: 'request',
      requestId: initializeRequestId,
      sourceClientId: 'initializing-client',
      version: 0,
      method: 'initialize',
      params: { clientType: 'codex-test' },
    });
    await requester.waitForMessage(
      (message) => message.requestId === initializeRequestId,
    );

    const ideContextRequestId = randomUUID();
    requester.send({
      type: 'request',
      requestId: ideContextRequestId,
      sourceClientId: 'initializing-client',
      version: 0,
      method: 'ide-context',
      params: { workspaceRoot: realWorkspacePath },
    });

    await expect(
      requester.waitForMessage(
        (message) => message.requestId === ideContextRequestId,
      ),
    ).resolves.toMatchObject({ resultType: 'success' });

    requester.socket.end();
  });
});
