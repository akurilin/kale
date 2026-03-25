/**
 * Regression scenario: inline comment boundary clicks should activate from the
 * start edge but stay in prose at the end edge.
 */

const assert = require('node:assert');
const fs = require('node:fs');

const {
  createInlineCommentFromCurrentSelection,
  getGoToEndOfDocumentShortcut,
  runIsolatedE2ETest,
  selectTrailingTextByCharacterLength,
} = require('../harness');

const COMMENT_CONTEXT_TEXT = 'Cursor boundary click context before';
const COMMENT_TARGET_TEXT = 'BoundaryClickTarget';
const COMMENT_NOTE_TEXT = 'Boundary click regression note.';
const COMMENT_END_CLICK_PADDING_PX = 40;
const COMMENT_START_CLICK_OFFSET_PX = 1;

/**
 * Why: this regression needs a single authoritative snapshot of whether focus
 * and active-comment state stayed in the editor after the boundary click.
 */
const readInlineCommentInteractionState = async (page) => {
  return page.evaluate(() => {
    const activeElement = document.activeElement;
    const editorRootElement = document.querySelector('.cm-editor');
    const isCommentInputFocused = Boolean(
      activeElement instanceof HTMLTextAreaElement &&
      activeElement.classList.contains('inline-comment-card-input'),
    );

    return {
      isCommentInputFocused,
      editorFocused: Boolean(
        editorRootElement instanceof HTMLElement &&
        editorRootElement.classList.contains('cm-focused'),
      ),
      editorOwnsActiveElement: Boolean(
        activeElement instanceof HTMLElement &&
        editorRootElement instanceof HTMLElement &&
        editorRootElement.contains(activeElement),
      ),
      activeCommentCardCount: document.querySelectorAll(
        '.inline-comment-card--active',
      ).length,
      activeCommentRangeCount: document.querySelectorAll(
        '.cm-inline-comment-range--active',
      ).length,
    };
  });
};

/**
 * Why: boundary clicks must target the same rendered line so the regression
 * exercises the editor's real click hit-testing instead of synthetic ranges.
 */
const readCommentBoundaryProbePositions = async (page) => {
  return page.evaluate(
    ({ commentEndClickPaddingPx, commentStartClickOffsetPx }) => {
      const inlineCommentRangeElement = document.querySelector(
        '.cm-inline-comment-range',
      );
      const scrollerElement = document.querySelector('.cm-scroller');
      if (!(inlineCommentRangeElement instanceof HTMLElement)) {
        throw new Error('Missing .cm-inline-comment-range element.');
      }
      if (!(scrollerElement instanceof HTMLElement)) {
        throw new Error('Missing .cm-scroller element.');
      }

      const clientRects = Array.from(
        inlineCommentRangeElement.getClientRects(),
      );
      const targetRect = clientRects[clientRects.length - 1];
      if (!targetRect) {
        throw new Error('Inline comment range has no client rects.');
      }

      const scrollerBounds = scrollerElement.getBoundingClientRect();
      const endClickX = Math.min(
        targetRect.right + commentEndClickPaddingPx,
        scrollerBounds.right - 24,
      );
      const startClickX = Math.min(
        targetRect.left + commentStartClickOffsetPx,
        targetRect.right - 1,
      );
      const boundaryClickY = targetRect.top + targetRect.height / 2;

      return {
        startClickX,
        endClickX,
        boundaryClickY,
        targetRectLeft: targetRect.left,
        targetRectRight: targetRect.right,
      };
    },
    {
      commentEndClickPaddingPx: COMMENT_END_CLICK_PADDING_PX,
      commentStartClickOffsetPx: COMMENT_START_CLICK_OFFSET_PX,
    },
  );
};

/**
 * Why: users reproduce this by clicking back into prose after comment editing,
 * so the regression first returns to a neutral editor state before the probe.
 */
const clearInlineCommentFocusByClickingNeutralEditorSpace = async (page) => {
  const scrollerBoundingBox = await page.locator('.cm-scroller').boundingBox();
  assert.ok(
    scrollerBoundingBox,
    'Expected .cm-scroller bounds while clearing comment focus.',
  );

  await page.mouse.click(
    scrollerBoundingBox.x + 16,
    scrollerBoundingBox.y + 22,
  );

  await page.waitForFunction(() => {
    const activeElement = document.activeElement;
    const editorRootElement = document.querySelector('.cm-editor');
    const isCommentInputFocused = Boolean(
      activeElement instanceof HTMLTextAreaElement &&
      activeElement.classList.contains('inline-comment-card-input'),
    );

    return Boolean(
      editorRootElement instanceof HTMLElement &&
      editorRootElement.classList.contains('cm-focused') &&
      activeElement instanceof HTMLElement &&
      editorRootElement.contains(activeElement) &&
      !isCommentInputFocused &&
      document.querySelectorAll('.inline-comment-card--active').length === 0 &&
      document.querySelectorAll('.cm-inline-comment-range--active').length ===
        0,
    );
  });
};

/**
 * Why: this protects the boundary between prose editing and comment editing so
 * clicks at the start edge open the comment while clicks at the end edge keep
 * the caret in prose.
 */
const runInlineCommentEndBoundaryClickFocusScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E inline-comment boundary click focus regression',
    seedDefaultMarkdownContent: '',
    testBody: async ({ page, activeFilePath }) => {
      const initialContent = fs.readFileSync(activeFilePath, 'utf8');
      assert.strictEqual(
        initialContent,
        '',
        `Blank-start scenario should begin with an empty file. Got:\n${initialContent}`,
      );

      const goToEndOfDocumentShortcut = getGoToEndOfDocumentShortcut();

      await page.click('.cm-content');
      await page.keyboard.press(goToEndOfDocumentShortcut);
      await page.keyboard.type(
        `${COMMENT_CONTEXT_TEXT} ${COMMENT_TARGET_TEXT}`,
        { delay: 10 },
      );
      await selectTrailingTextByCharacterLength(
        page,
        COMMENT_TARGET_TEXT.length,
      );
      await createInlineCommentFromCurrentSelection(page);
      await page.keyboard.type(COMMENT_NOTE_TEXT, { delay: 10 });

      await clearInlineCommentFocusByClickingNeutralEditorSpace(page);

      const probePosition = await readCommentBoundaryProbePositions(page);
      assert.ok(
        probePosition.startClickX > probePosition.targetRectLeft,
        `Start-boundary probe should land inside the highlighted text. Got ${JSON.stringify(probePosition)}.`,
      );
      assert.ok(
        probePosition.endClickX > probePosition.targetRectRight,
        `End-boundary probe should land beyond the highlighted text. Got ${JSON.stringify(probePosition)}.`,
      );

      await page.mouse.click(
        probePosition.startClickX,
        probePosition.boundaryClickY,
      );
      await page.waitForTimeout(200);

      const startBoundaryInteractionState =
        await readInlineCommentInteractionState(page);
      assert.ok(
        startBoundaryInteractionState.editorFocused &&
          startBoundaryInteractionState.editorOwnsActiveElement,
        `Start-boundary click should keep focus in the editor. Got ${JSON.stringify(startBoundaryInteractionState)}.`,
      );
      assert.ok(
        !startBoundaryInteractionState.isCommentInputFocused,
        `Start-boundary click should not focus the comment textarea. Got ${JSON.stringify(startBoundaryInteractionState)}.`,
      );
      assert.strictEqual(
        startBoundaryInteractionState.activeCommentCardCount,
        1,
        `Start-boundary click should activate a comment card. Got ${JSON.stringify(startBoundaryInteractionState)}.`,
      );
      assert.strictEqual(
        startBoundaryInteractionState.activeCommentRangeCount,
        1,
        `Start-boundary click should reactivate the inline comment range. Got ${JSON.stringify(startBoundaryInteractionState)}.`,
      );

      await clearInlineCommentFocusByClickingNeutralEditorSpace(page);

      await page.mouse.click(
        probePosition.endClickX,
        probePosition.boundaryClickY,
      );
      await page.waitForTimeout(200);

      const endBoundaryInteractionState =
        await readInlineCommentInteractionState(page);
      assert.ok(
        endBoundaryInteractionState.editorFocused &&
          endBoundaryInteractionState.editorOwnsActiveElement,
        `End-boundary click should leave focus in the editor. Got ${JSON.stringify(endBoundaryInteractionState)}.`,
      );
      assert.ok(
        !endBoundaryInteractionState.isCommentInputFocused,
        `End-boundary click should not focus the comment textarea. Got ${JSON.stringify(endBoundaryInteractionState)}.`,
      );
      assert.strictEqual(
        endBoundaryInteractionState.activeCommentCardCount,
        0,
        `End-boundary click should not activate a comment card. Got ${JSON.stringify(endBoundaryInteractionState)}.`,
      );
      assert.strictEqual(
        endBoundaryInteractionState.activeCommentRangeCount,
        0,
        `End-boundary click should not reactivate the inline comment range. Got ${JSON.stringify(endBoundaryInteractionState)}.`,
      );
    },
  });
};

module.exports = { runInlineCommentEndBoundaryClickFocusScenario };
