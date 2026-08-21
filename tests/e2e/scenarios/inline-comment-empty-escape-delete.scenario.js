/**
 * Regression scenario: Escape should discard only the focused semantically
 * empty inline comment and must preserve a focused non-empty comment.
 */

const assert = require('node:assert');

const {
  createInlineCommentFromCurrentSelection,
  getGoToEndOfDocumentShortcut,
  runIsolatedE2ETest,
  selectTrailingTextByCharacterLength,
} = require('../harness');

const NON_EMPTY_COMMENT_TARGET_TEXT = 'NonEmptyEscapeTarget';
const EMPTY_COMMENT_TARGET_TEXT = 'EmptyEscapeTarget';
const NON_EMPTY_COMMENT_TEXT = 'Keep this comment';
const SEMANTICALLY_EMPTY_COMMENT_TEXT = '   ';

/**
 * Why: a whitespace-only focused comment is an unfinished annotation, so
 * Escape should remove only that card and its Markdown markers. A non-empty
 * comment must remain even when it has focus and receives the same key.
 */
const runInlineCommentEmptyEscapeDeleteScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E empty inline-comment Escape delete regression',
    seedDefaultMarkdownContent: '',
    testBody: async ({ page }) => {
      await page.click('.cm-content');
      await page.keyboard.press(getGoToEndOfDocumentShortcut());
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type(NON_EMPTY_COMMENT_TARGET_TEXT, { delay: 10 });
      await selectTrailingTextByCharacterLength(
        page,
        NON_EMPTY_COMMENT_TARGET_TEXT.length,
      );
      await createInlineCommentFromCurrentSelection(page);
      await page.keyboard.type(NON_EMPTY_COMMENT_TEXT, { delay: 10 });

      await page.click('.cm-content');
      await page.keyboard.press(getGoToEndOfDocumentShortcut());
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type(EMPTY_COMMENT_TARGET_TEXT, { delay: 10 });
      await selectTrailingTextByCharacterLength(
        page,
        EMPTY_COMMENT_TARGET_TEXT.length,
      );
      await createInlineCommentFromCurrentSelection(page);
      await page.keyboard.type(SEMANTICALLY_EMPTY_COMMENT_TEXT, { delay: 10 });

      const focusedCommentState = await page.evaluate(() => {
        const activeElement = document.activeElement;
        return {
          commentCardCount: document.querySelectorAll('.inline-comment-card')
            .length,
          commentInputs: Array.from(
            document.querySelectorAll('.inline-comment-card-input'),
          ).map((commentInputElement) => ({
            isFocused: activeElement === commentInputElement,
            text:
              commentInputElement instanceof HTMLTextAreaElement
                ? commentInputElement.value
                : null,
          })),
        };
      });
      assert.deepStrictEqual(focusedCommentState, {
        commentCardCount: 2,
        commentInputs: [
          { isFocused: false, text: NON_EMPTY_COMMENT_TEXT },
          { isFocused: true, text: SEMANTICALLY_EMPTY_COMMENT_TEXT },
        ],
      });

      await page.keyboard.press('Escape');

      await page.waitForFunction(
        () => {
          return document.querySelectorAll('.inline-comment-card').length === 1;
        },
        null,
        { timeout: 5_000 },
      );

      const stateAfterEmptyCommentEscape = await page.evaluate(() => {
        const remainingCommentInput = document.querySelector(
          '.inline-comment-card-input',
        );
        return {
          commentCardCount: document.querySelectorAll('.inline-comment-card')
            .length,
          commentRangeTexts: Array.from(
            document.querySelectorAll('.cm-inline-comment-range'),
          ).map((commentRangeElement) => commentRangeElement.textContent ?? ''),
          remainingCommentText:
            remainingCommentInput instanceof HTMLTextAreaElement
              ? remainingCommentInput.value
              : null,
        };
      });
      assert.deepStrictEqual(stateAfterEmptyCommentEscape, {
        commentCardCount: 1,
        commentRangeTexts: [NON_EMPTY_COMMENT_TARGET_TEXT],
        remainingCommentText: NON_EMPTY_COMMENT_TEXT,
      });

      await page.click('.inline-comment-card-input');
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        return new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });

      const stateAfterNonEmptyCommentEscape = await page.evaluate(() => {
        const remainingCommentInput = document.querySelector(
          '.inline-comment-card-input',
        );
        return {
          commentCardCount: document.querySelectorAll('.inline-comment-card')
            .length,
          commentRangeTexts: Array.from(
            document.querySelectorAll('.cm-inline-comment-range'),
          ).map((commentRangeElement) => commentRangeElement.textContent ?? ''),
          isRemainingCommentFocused:
            document.activeElement === remainingCommentInput,
          remainingCommentText:
            remainingCommentInput instanceof HTMLTextAreaElement
              ? remainingCommentInput.value
              : null,
        };
      });
      assert.deepStrictEqual(stateAfterNonEmptyCommentEscape, {
        commentCardCount: 1,
        commentRangeTexts: [NON_EMPTY_COMMENT_TARGET_TEXT],
        isRemainingCommentFocused: true,
        remainingCommentText: NON_EMPTY_COMMENT_TEXT,
      });
    },
  });
};

module.exports = { runInlineCommentEmptyEscapeDeleteScenario };
