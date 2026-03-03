/**
 * Regression scenario: deleting inline comments should not nudge the editor
 * viewport when users resolve comments mid-document.
 */

const assert = require('node:assert');

const {
  createInlineCommentFromCurrentSelection,
  runIsolatedE2ETest,
} = require('../harness');

const MULTI_PAGE_PARAGRAPH_COUNT = 320;
const MAX_ALLOWED_PER_DELETE_SCROLL_DELTA_PIXELS = 4;
const MAX_ALLOWED_TOTAL_SCROLL_DRIFT_PIXELS = 8;

/**
 * Why: wrapped multi-page content creates enough vertical space to reproduce
 * subtle scroll drift that only appears away from the document start.
 */
const buildMultiPageRegressionDocumentContent = () => {
  return Array.from({ length: MULTI_PAGE_PARAGRAPH_COUNT }, (_, index) => {
    return `Paragraph ${index + 1}: Mid-document inline-comment delete regression content for scroll stability verification.`;
  }).join('\n\n');
};

/**
 * Why: keyboard shortcuts differ by OS, so this keeps editor reset behavior
 * deterministic across local macOS and Linux CI environments.
 */
const getSelectAllShortcut = () => {
  return process.platform === 'darwin' ? 'Meta+a' : 'Control+a';
};

/**
 * Why: this helper keeps anchor creation deterministic so we can delete one
 * comment near the top, middle, and bottom of the current viewport.
 */
const createInlineCommentAtViewportOffset = async (
  page,
  scrollerBoundingBox,
  viewportClickY,
) => {
  await page.mouse.click(scrollerBoundingBox.x + 220, viewportClickY);
  await page.keyboard.down('Shift');
  for (let moveIndex = 0; moveIndex < 14; moveIndex += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.up('Shift');
  await createInlineCommentFromCurrentSelection(page);
};

/**
 * Why: deleting comments uses a different editor-update path than typing in a
 * comment card, so it needs its own viewport-stability regression coverage.
 */
const runInlineCommentDeleteScrollStabilityScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E inline-comment delete scroll stability regression',
    seedDefaultMarkdownContent: '',
    testBody: async ({ page }) => {
      await page.click('.cm-content');
      await page.keyboard.press(getSelectAllShortcut());
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText(buildMultiPageRegressionDocumentContent());
      await page.waitForTimeout(300);

      const midpointScrollTop = await page.evaluate(() => {
        const scroller = document.querySelector('.cm-scroller');
        if (!scroller) {
          throw new Error('Missing .cm-scroller element for regression setup.');
        }

        const maxScrollTop = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight,
        );
        const midpoint = Math.round(maxScrollTop / 2);
        scroller.scrollTop = midpoint;
        return midpoint;
      });

      const scrollerBoundingBox = await page
        .locator('.cm-scroller')
        .boundingBox();
      assert.ok(
        scrollerBoundingBox,
        'Expected a measurable .cm-scroller bounding box.',
      );

      await createInlineCommentAtViewportOffset(
        page,
        scrollerBoundingBox,
        scrollerBoundingBox.y + 36,
      );
      await createInlineCommentAtViewportOffset(
        page,
        scrollerBoundingBox,
        scrollerBoundingBox.y + scrollerBoundingBox.height / 2,
      );
      await createInlineCommentAtViewportOffset(
        page,
        scrollerBoundingBox,
        scrollerBoundingBox.y + scrollerBoundingBox.height - 36,
      );

      const scrollTopReadings = [];
      const initialScrollTop = await page.evaluate(() => {
        return document.querySelector('.cm-scroller')?.scrollTop ?? null;
      });
      assert.strictEqual(
        typeof initialScrollTop,
        'number',
        'Expected numeric initial .cm-scroller scrollTop.',
      );
      scrollTopReadings.push(initialScrollTop);

      for (let deleteIndex = 0; deleteIndex < 3; deleteIndex += 1) {
        const commentCountBeforeDelete = await page
          .locator('.inline-comment-card')
          .count();
        assert.ok(
          commentCountBeforeDelete > 0,
          'Expected at least one comment card before delete action.',
        );

        await page.evaluate(() => {
          const deleteButton = document.querySelector(
            '.inline-comment-card-delete-button',
          );
          if (!(deleteButton instanceof HTMLButtonElement)) {
            throw new Error('Missing inline-comment delete button.');
          }
          deleteButton.click();
        });

        await page.waitForFunction(
          (expectedCount) => {
            return (
              document.querySelectorAll('.inline-comment-card').length ===
              expectedCount
            );
          },
          commentCountBeforeDelete - 1,
          { timeout: 5_000 },
        );
        await page.waitForTimeout(120);

        const scrollTopAfterDelete = await page.evaluate(() => {
          return document.querySelector('.cm-scroller')?.scrollTop ?? null;
        });
        assert.strictEqual(
          typeof scrollTopAfterDelete,
          'number',
          'Expected numeric .cm-scroller scrollTop after comment delete.',
        );
        scrollTopReadings.push(scrollTopAfterDelete);
      }

      const perDeleteScrollDeltas = [];
      for (let index = 1; index < scrollTopReadings.length; index += 1) {
        perDeleteScrollDeltas.push(
          scrollTopReadings[index] - scrollTopReadings[index - 1],
        );
      }

      const maxAbsolutePerDeleteScrollDelta = Math.max(
        ...perDeleteScrollDeltas.map((delta) => Math.abs(delta)),
      );
      const totalScrollDrift =
        scrollTopReadings[scrollTopReadings.length - 1] - scrollTopReadings[0];

      assert.ok(
        maxAbsolutePerDeleteScrollDelta <=
          MAX_ALLOWED_PER_DELETE_SCROLL_DELTA_PIXELS,
        [
          `Per-delete editor scroll delta should stay <= ${MAX_ALLOWED_PER_DELETE_SCROLL_DELTA_PIXELS}px.`,
          `Observed max |delta|: ${maxAbsolutePerDeleteScrollDelta}px.`,
          `Initial midpoint scrollTop: ${midpointScrollTop}.`,
          `Deltas: ${JSON.stringify(perDeleteScrollDeltas)}.`,
        ].join(' '),
      );
      assert.ok(
        Math.abs(totalScrollDrift) <= MAX_ALLOWED_TOTAL_SCROLL_DRIFT_PIXELS,
        [
          `Total editor scroll drift should stay <= ${MAX_ALLOWED_TOTAL_SCROLL_DRIFT_PIXELS}px.`,
          `Observed drift: ${totalScrollDrift}px.`,
          `Readings: ${JSON.stringify(scrollTopReadings)}.`,
        ].join(' '),
      );
    },
  });
};

module.exports = { runInlineCommentDeleteScrollStabilityScenario };
