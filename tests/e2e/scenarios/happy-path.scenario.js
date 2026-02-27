/**
 * Happy-path scenario: type a paragraph, annotate it with an inline comment,
 * wait for autosave, and verify persisted markers in the markdown file.
 */

const assert = require('node:assert');
const fs = require('node:fs');

const {
  AUTOSAVE_WAIT_MS,
  createInlineCommentFromCurrentSelection,
  escapeRegExp,
  getGoToEndOfDocumentShortcut,
  runIsolatedE2ETest,
} = require('../harness');

const TEST_PARAGRAPH = 'This paragraph was created by the E2E happy-path test.';
const TEST_COMMENT = 'This is an E2E test comment.';

/**
 * Why: this baseline flow verifies that full-stack editing/comment persistence
 * still works before and alongside narrower regression assertions.
 */
const runHappyPathScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E happy-path',
    testBody: async ({ page, activeFilePath }) => {
      const fileContentBefore = fs.readFileSync(activeFilePath, 'utf8');
      console.log('\n--- FILE BEFORE EDITS ---');
      console.log(fileContentBefore);
      console.log('--- END FILE BEFORE ---\n');

      const goToEndOfDocument = getGoToEndOfDocumentShortcut();
      await page.click('.cm-content');
      await page.keyboard.press(goToEndOfDocument);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type(TEST_PARAGRAPH, { delay: 10 });

      await page.keyboard.press('Home');
      await page.keyboard.down('Shift');
      await page.keyboard.press('End');
      await page.keyboard.up('Shift');

      await createInlineCommentFromCurrentSelection(page);

      await page.waitForTimeout(300);
      await page.keyboard.type(TEST_COMMENT, { delay: 10 });

      console.log(
        `Waiting ${AUTOSAVE_WAIT_MS / 1_000}s for autosave to flush...`,
      );
      await page.waitForTimeout(AUTOSAVE_WAIT_MS);

      const fileContent = fs.readFileSync(activeFilePath, 'utf8');
      console.log('\n--- FILE AFTER EDITS ---');
      console.log(fileContent);
      console.log('--- END FILE AFTER ---\n');

      assert.ok(
        fileContent.includes(TEST_PARAGRAPH),
        `File should contain the test paragraph. Got:\n${fileContent}`,
      );

      const encodedCommentText = JSON.stringify(TEST_COMMENT);
      assert.ok(
        fileContent.includes(encodedCommentText),
        `File should contain encoded comment text ${encodedCommentText}. Got:\n${fileContent}`,
      );

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

      const wrappedPattern = new RegExp(
        `<!-- @comment:\\w+ start \\|.*?-->.*?${escapeRegExp(TEST_PARAGRAPH)}.*?<!-- @comment:\\w+ end -->`,
        's',
      );
      assert.ok(
        wrappedPattern.test(fileContent),
        `Test paragraph should be wrapped in comment markers. Got:\n${fileContent}`,
      );
    },
  });
};

module.exports = { runHappyPathScenario };
