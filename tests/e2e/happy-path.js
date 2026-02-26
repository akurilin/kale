/**
 * E2E happy-path test: launch the app, type a paragraph, add a comment to it,
 * wait for autosave, and verify both the paragraph and comment markers exist on
 * disk. This exercises the core editing → commenting → persistence loop.
 *
 * Prerequisites:
 *   - `electron-forge package` must have been run (npm run test:e2e handles this)
 *   - Playwright must be installed as a devDependency
 *
 * The test launches Electron in headless mode with an isolated userData
 * directory so it never touches the user's real app state.
 */

const { _electron: electron } = require('playwright');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BUILD_DIR = path.join(PROJECT_ROOT, '.vite', 'build');

const TEST_PARAGRAPH = 'This paragraph was created by the E2E happy-path test.';
const TEST_COMMENT = 'This is an E2E test comment.';

// How long to wait after the last interaction for the 5-second autosave
// debounce to flush plus a safety buffer.
const AUTOSAVE_WAIT_MS = 7_000;

/**
 * Copy prompts/ and data/ into the Vite build output so the direct Electron
 * launch can resolve runtime assets the same way start-with-cdp.sh does.
 */
const copyRuntimeAssetsToBuildDir = () => {
  for (const assetDir of ['prompts', 'data']) {
    const src = path.join(PROJECT_ROOT, assetDir);
    const dest = path.join(BUILD_DIR, assetDir);
    fs.cpSync(src, dest, { recursive: true });
  }
};

/**
 * Create a temporary directory for this test run's Electron userData so we
 * never pollute or depend on the user's real app settings or documents.
 */
const createIsolatedUserDataDir = () => {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kale-e2e-'));
};

const runHappyPathTest = async () => {
  const testUserDataDir = createIsolatedUserDataDir();

  console.log(`Build directory:   ${BUILD_DIR}`);
  console.log(`Test userData dir: ${testUserDataDir}`);

  copyRuntimeAssetsToBuildDir();

  const electronApp = await electron.launch({
    args: [path.join(BUILD_DIR, 'main.js')],
    env: {
      ...process.env,
      KALE_HEADLESS: '1',
      KALE_SKIP_TERMINAL_VALIDATION: '1',
      KALE_USER_DATA_DIR: testUserDataDir,
    },
  });

  try {
    const page = await electronApp.firstWindow();

    // --- Wait for the app to load and display the active file path ---
    console.log('Waiting for app to load...');
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.file-path');
        return el && el.textContent && el.textContent.trim().length > 0;
      },
      { timeout: 15_000 },
    );

    const activeFilePath = (await page.textContent('.file-path')).trim();
    console.log(`Active file: ${activeFilePath}`);
    assert.ok(activeFilePath, 'App should display a non-empty file path');

    // --- Snapshot the file before any edits ---
    const fileContentBefore = fs.readFileSync(activeFilePath, 'utf8');
    console.log('\n--- FILE BEFORE EDITS ---');
    console.log(fileContentBefore);
    console.log('--- END FILE BEFORE ---\n');

    // --- Type a new paragraph at the end of the document ---
    // CodeMirror maps Cmd+ArrowDown on macOS and Ctrl+End on Linux to
    // "go to end of document", so pick the right shortcut for the platform.
    const goToEndOfDocument =
      process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
    console.log('Typing test paragraph...');
    await page.click('.cm-content');
    await page.keyboard.press(goToEndOfDocument);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type(TEST_PARAGRAPH, { delay: 10 });

    // --- Select the paragraph text we just typed ---
    // Home goes to start of line, Shift+End selects to end — works in
    // CodeMirror on all platforms because its keymap binds Home/End explicitly.
    console.log('Selecting text...');
    await page.keyboard.press('Home');
    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');

    // --- Click the floating "Comment" button that appears on selection ---
    console.log('Adding comment...');
    await page.waitForSelector('.inline-comment-selection-action', {
      timeout: 5_000,
    });
    await page.click('.inline-comment-selection-action');

    // --- Type the comment text into the newly created comment card ---
    // The card's textarea gets autofocused after creation, so we wait for it
    // to appear and then type directly via the keyboard.
    await page.waitForSelector('.inline-comment-card-input', {
      timeout: 5_000,
    });
    // Small delay for React autofocus effect to settle.
    await page.waitForTimeout(300);
    await page.keyboard.type(TEST_COMMENT, { delay: 10 });

    // --- Wait for autosave to flush to disk ---
    console.log(
      `Waiting ${AUTOSAVE_WAIT_MS / 1_000}s for autosave to flush...`,
    );
    await page.waitForTimeout(AUTOSAVE_WAIT_MS);

    // --- Read the file from disk and verify ---
    const fileContent = fs.readFileSync(activeFilePath, 'utf8');
    console.log('\n--- FILE AFTER EDITS ---');
    console.log(fileContent);
    console.log('--- END FILE AFTER ---\n');

    console.log('Verifying file on disk...');

    // The paragraph text should be present in the file.
    assert.ok(
      fileContent.includes(TEST_PARAGRAPH),
      `File should contain the test paragraph. Got:\n${fileContent}`,
    );

    // Inline comment markers use the format:
    //   <!-- @comment:<id> start | "<encoded text>" -->...<!-- @comment:<id> end -->
    // The comment text is JSON-encoded inside the start marker.
    const encodedCommentText = JSON.stringify(TEST_COMMENT);
    assert.ok(
      fileContent.includes(encodedCommentText),
      `File should contain the encoded comment text ${encodedCommentText}. Got:\n${fileContent}`,
    );

    // Verify both start and end markers are present (paired).
    const startMarkerPattern = /<!-- @comment:\w+ start \|/;
    const endMarkerPattern = /<!-- @comment:\w+ end -->/;
    assert.ok(
      startMarkerPattern.test(fileContent),
      `File should contain a comment start marker. Got:\n${fileContent}`,
    );
    assert.ok(
      endMarkerPattern.test(fileContent),
      `File should contain a comment end marker. Got:\n${fileContent}`,
    );

    // Verify the paragraph is wrapped between comment markers — the start
    // marker should appear right before the paragraph text, and the end marker
    // right after.
    const wrappedPattern = new RegExp(
      `<!-- @comment:\\w+ start \\|.*?-->.*?${TEST_PARAGRAPH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?<!-- @comment:\\w+ end -->`,
      's',
    );
    assert.ok(
      wrappedPattern.test(fileContent),
      `Test paragraph should be wrapped in comment markers. Got:\n${fileContent}`,
    );

    console.log('\nE2E happy-path test passed!');
  } finally {
    await electronApp.close();

    // Clean up the isolated userData directory.
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
  }
};

runHappyPathTest().catch((error) => {
  console.error('\nE2E happy-path test FAILED:', error.message || error);
  process.exit(1);
});
