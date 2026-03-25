/**
 * Regression scenario: active inline comment focus should stay synchronized
 * between editor highlights and floating comment cards, including keyboard
 * completion shortcuts that exit comment-editing mode.
 */

const assert = require('node:assert');

const {
  createInlineCommentFromCurrentSelection,
  getGoToEndOfDocumentShortcut,
  runIsolatedE2ETest,
  selectTrailingTextByCharacterLength,
} = require('../harness');

const COMMENT_TARGET_TEXT = 'FocusSyncTarget';
const COMMENT_CONTEXT_TEXT = 'Outside prose before comment target.';

/**
 * Why: comment-edit completion should honor platform-native modifier keys so
 * keyboard behavior is consistent across local macOS and Linux CI runs.
 */
const getCommentEditingCompleteShortcut = () => {
  return process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
};

/**
 * Why: each assertion checks multiple synchronized CSS states, so this helper
 * keeps active/inactive state snapshots concise and deterministic.
 */
const readInlineCommentFocusState = async (page) => {
  return page.evaluate(() => {
    const activeCommentCardCount = document.querySelectorAll(
      '.inline-comment-card--active',
    ).length;
    const activeCommentRangeCount = document.querySelectorAll(
      '.cm-inline-comment-range--active',
    ).length;
    const activeElement = document.activeElement;
    const isCommentInputFocused = Boolean(
      activeElement instanceof HTMLTextAreaElement &&
      activeElement.classList.contains('inline-comment-card-input'),
    );
    const firstCommentValue =
      document.querySelector('.inline-comment-card-input')?.value ?? '';
    const editorRootElement = document.querySelector('.cm-editor');
    const editorFocused = Boolean(
      editorRootElement instanceof HTMLElement &&
      editorRootElement.classList.contains('cm-focused'),
    );
    const editorOwnsActiveElement = Boolean(
      activeElement instanceof HTMLElement &&
      editorRootElement instanceof HTMLElement &&
      editorRootElement.contains(activeElement),
    );

    return {
      activeCommentCardCount,
      activeCommentRangeCount,
      isCommentInputFocused,
      editorFocused,
      editorOwnsActiveElement,
      firstCommentValue,
    };
  });
};

/**
 * Why: this verifies the bidirectional active-comment contract users rely on:
 * editor-highlight clicks activate the matching card without stealing editor
 * focus, and card focus still re-highlights the referenced text.
 */
const runInlineCommentActiveFocusSyncScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E inline-comment active focus sync regression',
    testBody: async ({ page }) => {
      const goToEndOfDocumentShortcut = getGoToEndOfDocumentShortcut();
      const commentEditingCompleteShortcut =
        getCommentEditingCompleteShortcut();

      await page.click('.cm-content');
      await page.keyboard.press(goToEndOfDocumentShortcut);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type(
        `${COMMENT_CONTEXT_TEXT} ${COMMENT_TARGET_TEXT}`,
        { delay: 10 },
      );
      await selectTrailingTextByCharacterLength(
        page,
        COMMENT_TARGET_TEXT.length,
      );
      await createInlineCommentFromCurrentSelection(page);

      await page.waitForFunction(() => {
        const activeCommentCards = document.querySelectorAll(
          '.inline-comment-card--active',
        );
        const activeCommentRanges = document.querySelectorAll(
          '.cm-inline-comment-range--active',
        );
        const activeElement = document.activeElement;
        const isCommentInputFocused = Boolean(
          activeElement instanceof HTMLTextAreaElement &&
          activeElement.classList.contains('inline-comment-card-input'),
        );
        return (
          activeCommentCards.length === 1 &&
          activeCommentRanges.length === 1 &&
          isCommentInputFocused
        );
      });

      const scrollerBoundingBox = await page
        .locator('.cm-scroller')
        .boundingBox();
      assert.ok(
        scrollerBoundingBox,
        'Expected .cm-scroller bounds while clearing active comment focus.',
      );
      await page.mouse.click(
        scrollerBoundingBox.x + 16,
        scrollerBoundingBox.y + 22,
      );

      await page.waitForFunction(() => {
        const activeCommentCards = document.querySelectorAll(
          '.inline-comment-card--active',
        );
        const activeCommentRanges = document.querySelectorAll(
          '.cm-inline-comment-range--active',
        );
        const activeElement = document.activeElement;
        const isCommentInputFocused = Boolean(
          activeElement instanceof HTMLTextAreaElement &&
          activeElement.classList.contains('inline-comment-card-input'),
        );
        return (
          activeCommentCards.length === 0 &&
          activeCommentRanges.length === 0 &&
          !isCommentInputFocused
        );
      });

      await page.click('.cm-inline-comment-range');
      await page.waitForFunction(() => {
        const activeCommentCards = document.querySelectorAll(
          '.inline-comment-card--active',
        );
        const activeCommentRanges = document.querySelectorAll(
          '.cm-inline-comment-range--active',
        );
        const activeElement = document.activeElement;
        const editorRootElement = document.querySelector('.cm-editor');
        return (
          activeCommentCards.length === 1 &&
          activeCommentRanges.length === 1 &&
          editorRootElement instanceof HTMLElement &&
          editorRootElement.classList.contains('cm-focused') &&
          activeElement instanceof HTMLElement &&
          editorRootElement.contains(activeElement) &&
          !(
            activeElement instanceof HTMLTextAreaElement &&
            activeElement.classList.contains('inline-comment-card-input')
          )
        );
      });

      const postEditorRangeClickState = await readInlineCommentFocusState(page);
      assert.strictEqual(
        postEditorRangeClickState.activeCommentCardCount,
        1,
        'Clicking highlighted prose should activate the matching comment card.',
      );
      assert.strictEqual(
        postEditorRangeClickState.activeCommentRangeCount,
        1,
        'Clicking highlighted prose should reactivate the referenced text highlight.',
      );
      assert.ok(
        postEditorRangeClickState.editorFocused &&
          postEditorRangeClickState.editorOwnsActiveElement,
        'Clicking highlighted prose should keep keyboard focus in the editor.',
      );
      assert.ok(
        !postEditorRangeClickState.isCommentInputFocused,
        'Clicking highlighted prose should not focus the comment textarea.',
      );

      await page.click('.inline-comment-card-input');
      await page.waitForFunction(() => {
        const activeElement = document.activeElement;
        return Boolean(
          activeElement instanceof HTMLTextAreaElement &&
          activeElement.classList.contains('inline-comment-card-input'),
        );
      });

      await page.keyboard.type(' edited', { delay: 10 });
      await page.keyboard.press(commentEditingCompleteShortcut);

      await page.waitForFunction(() => {
        const activeCommentCards = document.querySelectorAll(
          '.inline-comment-card--active',
        );
        const activeCommentRanges = document.querySelectorAll(
          '.cm-inline-comment-range--active',
        );
        const activeElement = document.activeElement;
        const isCommentInputFocused = Boolean(
          activeElement instanceof HTMLTextAreaElement &&
          activeElement.classList.contains('inline-comment-card-input'),
        );
        return (
          activeCommentCards.length === 0 &&
          activeCommentRanges.length === 0 &&
          !isCommentInputFocused
        );
      });

      const postShortcutState = await readInlineCommentFocusState(page);
      assert.ok(
        !postShortcutState.firstCommentValue.includes('\n'),
        'Cmd/Ctrl+Enter should complete editing without inserting a newline.',
      );

      await page.click('.inline-comment-card-input');
      await page.waitForFunction(() => {
        const activeCommentCards = document.querySelectorAll(
          '.inline-comment-card--active',
        );
        const activeCommentRanges = document.querySelectorAll(
          '.cm-inline-comment-range--active',
        );
        return (
          activeCommentCards.length === 1 && activeCommentRanges.length === 1
        );
      });

      const reactivatedState = await readInlineCommentFocusState(page);
      assert.strictEqual(
        reactivatedState.activeCommentCardCount,
        1,
        'Clicking a comment card input should reactivate that comment card.',
      );
      assert.strictEqual(
        reactivatedState.activeCommentRangeCount,
        1,
        'Clicking a comment card input should reactivate the referenced text highlight.',
      );

      await page.click('.save-status');
      await page.waitForFunction(() => {
        const activeCommentCards = document.querySelectorAll(
          '.inline-comment-card--active',
        );
        const activeCommentRanges = document.querySelectorAll(
          '.cm-inline-comment-range--active',
        );
        return (
          activeCommentCards.length === 0 && activeCommentRanges.length === 0
        );
      });

      await page.click('.inline-comment-card-input');
      await page.waitForFunction(() => {
        const activeCommentCards = document.querySelectorAll(
          '.inline-comment-card--active',
        );
        const activeCommentRanges = document.querySelectorAll(
          '.cm-inline-comment-range--active',
        );
        return (
          activeCommentCards.length === 1 && activeCommentRanges.length === 1
        );
      });

      await page.keyboard.press(commentEditingCompleteShortcut);
      await page.waitForFunction(() => {
        const activeCommentCards = document.querySelectorAll(
          '.inline-comment-card--active',
        );
        const activeCommentRanges = document.querySelectorAll(
          '.cm-inline-comment-range--active',
        );
        return (
          activeCommentCards.length === 0 && activeCommentRanges.length === 0
        );
      });
    },
  });
};

module.exports = { runInlineCommentActiveFocusSyncScenario };
