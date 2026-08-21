/**
 * Regression scenario: deleting a whole commented paragraph must remove its
 * unique inline comment instead of leaving hidden or raw marker text behind.
 */

const assert = require('node:assert');
const fs = require('node:fs');

const {
  AUTOSAVE_WAIT_MS,
  createInlineCommentFromCurrentSelection,
  runIsolatedE2ETest,
} = require('../harness');

const LEADING_PARAGRAPH = 'The leading paragraph must remain.';
const COMMENTED_PARAGRAPH =
  'Delete this whole paragraph after giving it one unique comment.';
const TRAILING_PARAGRAPH = 'The trailing paragraph must remain.';
const UNIQUE_COMMENT_TEXT =
  'This comment belongs only to the middle paragraph.';

/**
 * Why: selecting the plain paragraph through native line shortcuts creates the
 * same initial whole-paragraph selection that users annotate from the editor.
 */
const selectWholePlainParagraph = async (page) => {
  const targetLine = page
    .locator('.cm-line')
    .filter({ hasText: COMMENTED_PARAGRAPH });
  await targetLine.click();

  if (process.platform === 'darwin') {
    await page.keyboard.press('Meta+ArrowLeft');
    await page.keyboard.press('Shift+Meta+ArrowRight');
    return;
  }

  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
};

/**
 * Why: this exercises the reported visible-selection path. Starting at the
 * first visible character and extending to the source-line end includes the
 * hidden end marker but not the hidden start marker.
 */
const selectWholeCommentedParagraph = async (page) => {
  await page
    .locator('.cm-inline-comment-range')
    .click({ position: { x: 4, y: 4 } });
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Shift+Meta+ArrowRight' : 'Shift+End',
  );
  const selectedText = await page.evaluate(() => {
    return window.getSelection()?.toString() ?? '';
  });
  assert.ok(
    selectedText.includes(COMMENTED_PARAGRAPH),
    `Expected the full commented paragraph to be selected. Got ${JSON.stringify(selectedText)}.`,
  );
};

/**
 * Why: removing all text owned by one comment must also remove that comment's
 * marker pair, while unrelated paragraphs remain unchanged.
 */
const runInlineCommentSelectedParagraphDeleteScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E selected commented paragraph delete regression',
    seedDefaultMarkdownContent: `${LEADING_PARAGRAPH}\n\n${COMMENTED_PARAGRAPH}\n\n${TRAILING_PARAGRAPH}`,
    testBody: async ({ page, activeFilePath }) => {
      await selectWholePlainParagraph(page);
      await createInlineCommentFromCurrentSelection(page);
      await page.keyboard.type(UNIQUE_COMMENT_TEXT, { delay: 10 });
      await page.keyboard.press(
        process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter',
      );

      await selectWholeCommentedParagraph(page);
      const stateBeforeParagraphDelete = await page.evaluate(() => ({
        commentCardCount: document.querySelectorAll('.inline-comment-card')
          .length,
        commentRangeTexts: Array.from(
          document.querySelectorAll('.cm-inline-comment-range'),
        ).map((commentRangeElement) => commentRangeElement.textContent ?? ''),
      }));
      assert.deepStrictEqual(stateBeforeParagraphDelete, {
        commentCardCount: 1,
        commentRangeTexts: [COMMENTED_PARAGRAPH],
      });

      await page.keyboard.press('Delete');
      await page.waitForTimeout(AUTOSAVE_WAIT_MS);

      const fileContent = fs.readFileSync(activeFilePath, 'utf8');
      const renderedCommentState = await page.evaluate(() => ({
        commentCardCount: document.querySelectorAll('.inline-comment-card')
          .length,
        visibleMarkerText: Array.from(document.querySelectorAll('.cm-line'))
          .map((lineElement) => lineElement.textContent ?? '')
          .filter((lineText) => lineText.includes('@comment')),
      }));

      assert.ok(
        fileContent.includes(LEADING_PARAGRAPH),
        `The leading paragraph should remain. Got:\n${fileContent}`,
      );
      assert.ok(
        fileContent.includes(TRAILING_PARAGRAPH),
        `The trailing paragraph should remain. Got:\n${fileContent}`,
      );
      assert.ok(
        !fileContent.includes(COMMENTED_PARAGRAPH),
        `The selected paragraph should be deleted. Got:\n${fileContent}`,
      );
      assert.ok(
        !fileContent.includes('@comment:'),
        `Deleting the selected paragraph should remove its comment markers. Got:\n${fileContent}`,
      );
      assert.deepStrictEqual(renderedCommentState, {
        commentCardCount: 0,
        visibleMarkerText: [],
      });
    },
  });
};

module.exports = { runInlineCommentSelectedParagraphDeleteScenario };
