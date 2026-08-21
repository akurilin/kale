/**
 * Regression scenario: focusing a comment input should expose the complete
 * comment text through the same IDE context channel as a prose selection.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const {
  createInlineCommentFromCurrentSelection,
  getGoToEndOfDocumentShortcut,
  runIsolatedE2ETest,
  selectTrailingTextByCharacterLength,
} = require('../harness');

const COMMENT_TARGET_TEXT = 'CommentIdeContextTarget';
const COMMENT_TEXT = 'Check this claim and add a primary source.';
const IDE_LOCK_DIRECTORY = path.join(os.homedir(), '.claude', 'ide');

/**
 * Why: other Kale instances can have live IDE lock files, so the scenario must
 * select only the lock that belongs to its Electron process and workspace.
 */
const findIdeLockForTestApplication = (electronProcessId, activeFilePath) => {
  const activeWorkspaceFolder = path.dirname(activeFilePath);
  const lockFileNames = fs.existsSync(IDE_LOCK_DIRECTORY)
    ? fs.readdirSync(IDE_LOCK_DIRECTORY)
    : [];

  for (const lockFileName of lockFileNames) {
    if (!lockFileName.endsWith('.lock')) {
      continue;
    }

    try {
      const lockFilePath = path.join(IDE_LOCK_DIRECTORY, lockFileName);
      const lockFile = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
      if (
        lockFile.pid === electronProcessId &&
        lockFile.ideName === 'Kale' &&
        lockFile.workspaceFolders?.includes(activeWorkspaceFolder)
      ) {
        return {
          authToken: lockFile.authToken,
          port: Number.parseInt(path.basename(lockFileName, '.lock'), 10),
        };
      }
    } catch {
      // A different live process can replace a lock while this test scans it.
    }
  }

  return null;
};

/**
 * Why: the IDE server is the public integration boundary, so reading selection
 * context from its MCP tool verifies the full renderer-to-agent data path.
 */
const readCurrentIdeSelection = async (ideLock) => {
  const websocket = new WebSocket(`ws://127.0.0.1:${ideLock.port}`, {
    headers: {
      'x-claude-code-ide-authorization': ideLock.authToken,
    },
  });

  try {
    await new Promise((resolve, reject) => {
      websocket.once('open', resolve);
      websocket.once('error', reject);
    });

    const responsePromise = new Promise((resolve, reject) => {
      websocket.once('message', (rawMessage) => {
        try {
          resolve(JSON.parse(rawMessage.toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
      websocket.once('error', reject);
    });

    websocket.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'getCurrentSelection',
          arguments: {},
        },
      }),
    );

    const response = await responsePromise;
    const serializedSelection = response.result?.content?.[0]?.text;
    assert.strictEqual(
      typeof serializedSelection,
      'string',
      `Expected IDE selection tool text. Got ${JSON.stringify(response)}.`,
    );
    return JSON.parse(serializedSelection);
  } finally {
    websocket.close();
  }
};

/**
 * Why: a user prompt can follow any cursor position inside a comment, so focus
 * must make the complete comment the active agent selection.
 */
const runInlineCommentIdeSelectionContextScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E inline-comment IDE selection context regression',
    testBody: async ({ page, activeFilePath, electronApp }) => {
      const electronProcessId = electronApp.process().pid;
      const ideLock = findIdeLockForTestApplication(
        electronProcessId,
        activeFilePath,
      );
      assert.ok(ideLock, 'Expected an IDE lock for the isolated Kale process.');

      await page.click('.cm-content');
      await page.keyboard.press(getGoToEndOfDocumentShortcut());
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type(COMMENT_TARGET_TEXT, { delay: 10 });
      await selectTrailingTextByCharacterLength(
        page,
        COMMENT_TARGET_TEXT.length,
      );
      await createInlineCommentFromCurrentSelection(page);
      await page.keyboard.type(COMMENT_TEXT, { delay: 10 });
      const commentInputs = page.locator('.inline-comment-card-input');
      const createdCommentInputIndex = await commentInputs.evaluateAll(
        (commentInputElements, expectedCommentText) => {
          return commentInputElements.findIndex((commentInputElement) => {
            return commentInputElement.value === expectedCommentText;
          });
        },
        COMMENT_TEXT,
      );
      assert.notStrictEqual(
        createdCommentInputIndex,
        -1,
        'Expected to find the newly written comment input.',
      );

      // Move context back to a prose cursor before refocusing the existing
      // comment. This makes the assertion depend on focus, not comment typing.
      await page.click('.cm-content');
      await commentInputs.nth(createdCommentInputIndex).click();

      const commentSelection = await readCurrentIdeSelection(ideLock);
      assert.strictEqual(
        commentSelection.filePath,
        activeFilePath,
        'Focused comment context should belong to the active Markdown file.',
      );
      assert.strictEqual(
        commentSelection.selectedText,
        COMMENT_TEXT,
        'Focused comment context should contain the complete comment text.',
      );
      assert.ok(
        commentSelection.range &&
          commentSelection.range.start &&
          commentSelection.range.end,
        `Focused comment context should include a source range. Got ${JSON.stringify(commentSelection)}.`,
      );
    },
  });
};

module.exports = { runInlineCommentIdeSelectionContextScenario };
