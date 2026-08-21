import { afterEach, describe, expect, it } from 'vitest';

import { startPiIdeServer, type PiIdeServerHandle } from './server';
import type { PiEditorContextSnapshot } from './context';

const runningServerHandles: PiIdeServerHandle[] = [];

/**
 * Why: each test owns a real localhost server, so cleanup prevents open handles
 * and makes later authentication tests independent.
 */
afterEach(async () => {
  await Promise.all(
    runningServerHandles
      .splice(0)
      .map((serverHandle) => serverHandle.shutdown()),
  );
});

describe('startPiIdeServer', () => {
  it('returns the latest editor context to an authenticated local client', async () => {
    let currentContext: PiEditorContextSnapshot = {
      activeFilePath: '/drafts/essay.md',
      selection: {
        filePath: '/drafts/essay.md',
        selectedText: 'First line\nSecond line',
        range: {
          start: { line: 4, character: 2 },
          end: { line: 5, character: 11 },
        },
      },
    };
    const serverHandle = await startPiIdeServer({
      getCurrentEditorContext: async () => currentContext,
    });
    runningServerHandles.push(serverHandle);

    const firstResponse = await fetch(serverHandle.editorContextUrl, {
      headers: {
        'x-kale-ide-authorization': serverHandle.authToken,
      },
    });
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual(currentContext);

    currentContext = {
      activeFilePath: '/drafts/essay.md',
      selection: null,
    };
    const secondResponse = await fetch(serverHandle.editorContextUrl, {
      headers: {
        'x-kale-ide-authorization': serverHandle.authToken,
      },
    });
    expect(await secondResponse.json()).toEqual(currentContext);
  });

  it('rejects requests without its per-process authentication token', async () => {
    const serverHandle = await startPiIdeServer({
      getCurrentEditorContext: async () => ({
        activeFilePath: '/drafts/essay.md',
        selection: null,
      }),
    });
    runningServerHandles.push(serverHandle);

    const response = await fetch(serverHandle.editorContextUrl);

    expect(response.status).toBe(401);
  });
});
