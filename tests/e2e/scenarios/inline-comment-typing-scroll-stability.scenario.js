/**
 * Regression scenario: typing in a floating inline-comment textarea should not
 * continuously move the editor viewport while the user is mid-document.
 */

const assert = require('node:assert');

const {
  createInlineCommentFromCurrentSelection,
  runIsolatedE2ETest,
} = require('../harness');

const MULTI_PAGE_PARAGRAPH_COUNT = 320;
const COMMENT_TEXT_FOR_SCROLL_STABILITY_TEST =
  'Typing one character at a time to verify viewport stability.';
const MAX_ALLOWED_PER_KEYSTROKE_SCROLL_DELTA_PIXELS = 8;
const MAX_ALLOWED_TOTAL_SCROLL_DRIFT_PIXELS = 12;

/**
 * Why: long wrapped paragraphs make this regression deterministic by creating
 * enough vertical space for accidental per-keystroke scroll chasing.
 */
const buildMultiPageRegressionDocumentContent = () => {
  return Array.from({ length: MULTI_PAGE_PARAGRAPH_COUNT }, (_, index) => {
    return `Paragraph ${index + 1}: Mid-document comment scroll regression repro content with enough lines to span multiple pages.`;
  }).join('\n\n');
};

/**
 * Why: key chords differ by platform, so this helper keeps select-all stable
 * across local macOS runs and Linux CI.
 */
const getSelectAllShortcut = () => {
  return process.platform === 'darwin' ? 'Meta+a' : 'Control+a';
};

/**
 * Why: this captures the mid-document regression where each sidebar keystroke
 * previously yanked the editor scroll toward document bottom.
 */
const runInlineCommentTypingScrollStabilityScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E inline-comment typing scroll stability regression',
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

      await page.mouse.click(
        scrollerBoundingBox.x + 220,
        scrollerBoundingBox.y + 36,
      );
      await page.keyboard.down('Shift');
      for (let moveIndex = 0; moveIndex < 14; moveIndex += 1) {
        await page.keyboard.press('ArrowRight');
      }
      await page.keyboard.up('Shift');

      await createInlineCommentFromCurrentSelection(page);

      await page.waitForFunction(() => {
        const activeElement = document.activeElement;
        return Boolean(
          activeElement &&
          activeElement.classList.contains('inline-comment-card-input'),
        );
      });

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

      for (const character of COMMENT_TEXT_FOR_SCROLL_STABILITY_TEST) {
        await page.keyboard.type(character, { delay: 10 });
        await page.waitForTimeout(15);
        const scrollTopAfterKeystroke = await page.evaluate(() => {
          return document.querySelector('.cm-scroller')?.scrollTop ?? null;
        });
        assert.strictEqual(
          typeof scrollTopAfterKeystroke,
          'number',
          'Expected numeric .cm-scroller scrollTop after comment keystroke.',
        );
        scrollTopReadings.push(scrollTopAfterKeystroke);
      }

      const perKeystrokeScrollDeltas = [];
      for (let index = 1; index < scrollTopReadings.length; index += 1) {
        perKeystrokeScrollDeltas.push(
          scrollTopReadings[index] - scrollTopReadings[index - 1],
        );
      }

      const maxAbsolutePerKeystrokeScrollDelta = Math.max(
        ...perKeystrokeScrollDeltas.map((delta) => Math.abs(delta)),
      );
      const totalScrollDrift =
        scrollTopReadings[scrollTopReadings.length - 1] - scrollTopReadings[0];

      assert.ok(
        maxAbsolutePerKeystrokeScrollDelta <=
          MAX_ALLOWED_PER_KEYSTROKE_SCROLL_DELTA_PIXELS,
        [
          `Per-keystroke editor scroll delta should stay <= ${MAX_ALLOWED_PER_KEYSTROKE_SCROLL_DELTA_PIXELS}px.`,
          `Observed max |delta|: ${maxAbsolutePerKeystrokeScrollDelta}px.`,
          `Initial midpoint scrollTop: ${midpointScrollTop}.`,
          `Deltas: ${JSON.stringify(perKeystrokeScrollDeltas)}.`,
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

module.exports = { runInlineCommentTypingScrollStabilityScenario };
