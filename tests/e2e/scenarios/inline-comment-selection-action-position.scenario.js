/**
 * Regression scenario: the inline-comment action must appear below the final
 * selected line so it never covers text inside a multi-line selection.
 */

const assert = require('node:assert');

const {
  getGoToEndOfDocumentShortcut,
  runIsolatedE2ETest,
  selectTrailingTextByCharacterLength,
} = require('../harness');

const FIRST_SELECTED_LINE = 'First selected line';
const LAST_SELECTED_LINE = 'Second and final selected line';

/**
 * Why: the reported bug only appears when a selection has more than one line,
 * so this scenario compares the button with the lowest selection rectangle.
 */
const runInlineCommentSelectionActionPositionScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E inline-comment selection action position regression',
    seedDefaultMarkdownContent: '',
    testBody: async ({ page }) => {
      const selectedText = `${FIRST_SELECTED_LINE}\n${LAST_SELECTED_LINE}`;

      await page.click('.cm-content');
      await page.keyboard.press(getGoToEndOfDocumentShortcut());
      await page.keyboard.type(FIRST_SELECTED_LINE, { delay: 10 });
      await page.keyboard.press('Enter');
      await page.keyboard.type(LAST_SELECTED_LINE, { delay: 10 });
      await selectTrailingTextByCharacterLength(page, selectedText.length);
      await page.waitForSelector('.inline-comment-selection-action');

      const selectionActionGeometry = await page.evaluate(() => {
        const selectionActionElement = document.querySelector(
          '.inline-comment-selection-action',
        );
        const selectionRectangles = Array.from(
          document.querySelectorAll('.cm-selectionBackground'),
        ).map((selectionRectangleElement) => {
          return selectionRectangleElement.getBoundingClientRect();
        });

        if (!(selectionActionElement instanceof HTMLButtonElement)) {
          throw new Error('Missing inline-comment selection action button.');
        }
        if (selectionRectangles.length < 2) {
          throw new Error(
            `Expected a multi-line selection, but found ${selectionRectangles.length} selection rectangle(s).`,
          );
        }

        return {
          buttonTop: selectionActionElement.getBoundingClientRect().top,
          lastSelectedLineBottom: Math.max(
            ...selectionRectangles.map((selectionRectangle) => {
              return selectionRectangle.bottom;
            }),
          ),
        };
      });

      assert.ok(
        selectionActionGeometry.buttonTop >
          selectionActionGeometry.lastSelectedLineBottom,
        [
          'Comment action button must be below the final selected line.',
          `Button top: ${selectionActionGeometry.buttonTop}.`,
          `Final selected line bottom: ${selectionActionGeometry.lastSelectedLineBottom}.`,
        ].join(' '),
      );
    },
  });
};

module.exports = { runInlineCommentSelectionActionPositionScenario };
