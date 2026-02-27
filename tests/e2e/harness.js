/**
 * Shared E2E harness utilities for launching Electron, driving the editor, and
 * validating inline-comment persistence in deterministic isolated environments.
 */

const { _electron: electron } = require('playwright');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BUILD_DIR = path.join(PROJECT_ROOT, '.vite', 'build');
const DEFAULT_USER_MARKDOWN_FILE_NAME = 'simple.md';

// How long to wait after the last interaction for the 5-second autosave
// debounce to flush plus a safety buffer.
const AUTOSAVE_WAIT_MS = 7_000;

/**
 * Why: regex-based assertions need literal text escaping so generated patterns
 * stay deterministic regardless of punctuation in test strings.
 */
const escapeRegExp = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Why: direct Electron launches resolve runtime assets from .vite/build, so E2E
 * must mirror the CDP script and copy runtime folders into that location.
 */
const copyRuntimeAssetsToBuildDir = () => {
  for (const assetDir of ['prompts', 'data']) {
    const src = path.join(PROJECT_ROOT, assetDir);
    const dest = path.join(BUILD_DIR, assetDir);
    fs.cpSync(src, dest, { recursive: true });
  }
};

/**
 * Why: isolated userData keeps E2E deterministic and avoids mutating real app
 * settings; optional seed content allows blank-document startup scenarios.
 */
const createIsolatedUserDataDir = ({ seedDefaultMarkdownContent } = {}) => {
  const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kale-e2e-'));

  if (typeof seedDefaultMarkdownContent === 'string') {
    const seededMarkdownPath = path.join(
      testUserDataDir,
      DEFAULT_USER_MARKDOWN_FILE_NAME,
    );
    fs.mkdirSync(path.dirname(seededMarkdownPath), { recursive: true });
    fs.writeFileSync(seededMarkdownPath, seedDefaultMarkdownContent, 'utf8');
  }

  return testUserDataDir;
};

/**
 * Why: centralizing Electron launch options keeps test invocations consistent
 * across scenarios and preserves CI-specific Linux flags in one place.
 */
const launchElectronAppForE2E = async (testUserDataDir) => {
  const electronArgs = [path.join(BUILD_DIR, 'main.js')];
  if (process.platform === 'linux') {
    electronArgs.push('--no-sandbox', '--disable-gpu');
  }

  return electron.launch({
    args: electronArgs,
    env: {
      ...process.env,
      KALE_HEADLESS: '1',
      KALE_SKIP_TERMINAL_VALIDATION: '1',
      KALE_USER_DATA_DIR: testUserDataDir,
    },
  });
};

/**
 * Why: every editor interaction and on-disk assertion depends on the resolved
 * active file path, so startup wait + file-path extraction stay in one helper.
 */
const waitForAppToLoadAndGetActiveFilePath = async (page) => {
  await page.waitForFunction(
    () => {
      const filePathElement = document.querySelector('.file-path');
      return (
        filePathElement &&
        filePathElement.textContent &&
        filePathElement.textContent.trim().length > 0
      );
    },
    { timeout: 15_000 },
  );

  const activeFilePath = (await page.textContent('.file-path')).trim();
  assert.ok(activeFilePath, 'App should display a non-empty file path');
  return activeFilePath;
};

/**
 * Why: CodeMirror maps different end-of-document shortcuts by platform, so
 * tests must use the OS-appropriate key chord to remain portable.
 */
const getGoToEndOfDocumentShortcut = () => {
  return process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
};

/**
 * Why: after comment creation, focus can move to the sidebar textarea; editor
 * boundary tests need explicit focus on .cm-content before key presses.
 */
const focusEditorContentArea = async (page) => {
  await page.evaluate(() => {
    const editorContentElement = document.querySelector('.cm-content');
    if (!editorContentElement) {
      throw new Error('Missing .cm-content editor element');
    }
    editorContentElement.focus();
  });
};

/**
 * Why: comment creation UI is asynchronous (selection action + React mount), so
 * tests should funnel through one wait-and-click helper to reduce flakiness.
 */
const createInlineCommentFromCurrentSelection = async (page) => {
  await page.waitForSelector('.inline-comment-selection-action', {
    timeout: 5_000,
  });
  await page.click('.inline-comment-selection-action');

  await page.waitForSelector('.inline-comment-card-input', {
    timeout: 5_000,
  });
};

/**
 * Why: boundary tests need fresh, predictable comment anchors so each whitespace
 * key is exercised at a true comment edge without dependence on prior cursor
 * positions or selection state.
 */
const appendCommentedWordAtDocumentEnd = async (
  page,
  { word, insertLineBreakBeforeWord },
) => {
  const goToEndOfDocument = getGoToEndOfDocumentShortcut();
  await focusEditorContentArea(page);
  await page.keyboard.press(goToEndOfDocument);

  if (insertLineBreakBeforeWord) {
    await page.keyboard.press('Enter');
  }

  await page.keyboard.type(word, { delay: 10 });
  await page.keyboard.down('Shift');
  await page.keyboard.press('Home');
  await page.keyboard.up('Shift');
  await createInlineCommentFromCurrentSelection(page);
};

/**
 * Why: comment IDs are generated dynamically, so assertions that target a
 * specific comment must resolve marker boundaries by wrapped content text.
 */
const findCommentRangeWrappingExactText = (markdownContent, wrappedText) => {
  const startMarkerPattern =
    /<!-- @comment:([A-Za-z0-9_-]+) start \| [\s\S]*?-->/g;

  for (const startMatch of markdownContent.matchAll(startMarkerPattern)) {
    const commentId = startMatch[1];
    const startMarkerSource = startMatch[0];
    const startMarkerFrom = startMatch.index ?? 0;
    const startMarkerTo = startMarkerFrom + startMarkerSource.length;

    const endMarkerSource = `<!-- @comment:${commentId} end -->`;
    const endMarkerFrom = markdownContent.indexOf(
      endMarkerSource,
      startMarkerTo,
    );
    if (endMarkerFrom === -1) {
      continue;
    }

    const endMarkerTo = endMarkerFrom + endMarkerSource.length;
    const wrappedContent = markdownContent.slice(startMarkerTo, endMarkerFrom);

    if (wrappedContent === wrappedText) {
      return {
        commentId,
        startMarkerFrom,
        startMarkerTo,
        endMarkerFrom,
        endMarkerTo,
      };
    }
  }

  return null;
};

/**
 * Why: each scenario needs identical setup/teardown and logging while varying
 * only seed content and interaction logic, so this wrapper keeps tests concise.
 */
const runIsolatedE2ETest = async ({
  testName,
  seedDefaultMarkdownContent,
  testBody,
}) => {
  const testUserDataDir = createIsolatedUserDataDir({
    seedDefaultMarkdownContent,
  });

  console.log(`\n=== ${testName} ===`);
  console.log(`Build directory:   ${BUILD_DIR}`);
  console.log(`Test userData dir: ${testUserDataDir}`);

  copyRuntimeAssetsToBuildDir();

  const electronApp = await launchElectronAppForE2E(testUserDataDir);

  try {
    const page = await electronApp.firstWindow();
    const activeFilePath = await waitForAppToLoadAndGetActiveFilePath(page);
    console.log(`Active file: ${activeFilePath}`);

    await testBody({ page, activeFilePath });

    console.log(`${testName} passed.`);
  } finally {
    await electronApp.close();
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
  }
};

module.exports = {
  AUTOSAVE_WAIT_MS,
  appendCommentedWordAtDocumentEnd,
  createInlineCommentFromCurrentSelection,
  escapeRegExp,
  findCommentRangeWrappingExactText,
  focusEditorContentArea,
  getGoToEndOfDocumentShortcut,
  runIsolatedE2ETest,
};
