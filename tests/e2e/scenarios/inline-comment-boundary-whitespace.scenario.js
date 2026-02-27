/**
 * Boundary-whitespace regression scenario: ensure whitespace typed at exact
 * inline-comment edges is inserted outside comment ranges.
 */

const assert = require('node:assert');
const fs = require('node:fs');

const {
  AUTOSAVE_WAIT_MS,
  appendCommentedWordAtDocumentEnd,
  findCommentRangeWrappingExactText,
  focusEditorContentArea,
  runIsolatedE2ETest,
} = require('../harness');

const END_BOUNDARY_SPACE_COMMENT_WORD = 'edge_boundary_end_space_word';
const START_BOUNDARY_SPACE_COMMENT_WORD = 'edge_boundary_start_space_word';
const END_BOUNDARY_TAB_COMMENT_WORD = 'edge_boundary_end_tab_word';
const END_BOUNDARY_ENTER_COMMENT_WORD = 'edge_boundary_end_enter_word';

/**
 * Why: this regression protects edge semantics so whitespace typed at exact
 * comment boundaries does not silently expand the annotated text range.
 */
const runInlineCommentBoundaryWhitespaceScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E inline-comment boundary whitespace regression',
    seedDefaultMarkdownContent: '',
    testBody: async ({ page, activeFilePath }) => {
      const initialContent = fs.readFileSync(activeFilePath, 'utf8');
      assert.strictEqual(
        initialContent,
        '',
        `Blank-start scenario should begin with an empty file. Got:\n${initialContent}`,
      );

      let insertLineBreakBeforeWord = false;

      await appendCommentedWordAtDocumentEnd(page, {
        word: END_BOUNDARY_SPACE_COMMENT_WORD,
        insertLineBreakBeforeWord,
      });
      insertLineBreakBeforeWord = true;
      await focusEditorContentArea(page);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Space');

      await appendCommentedWordAtDocumentEnd(page, {
        word: START_BOUNDARY_SPACE_COMMENT_WORD,
        insertLineBreakBeforeWord,
      });
      await focusEditorContentArea(page);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Space');

      await appendCommentedWordAtDocumentEnd(page, {
        word: END_BOUNDARY_TAB_COMMENT_WORD,
        insertLineBreakBeforeWord,
      });
      await focusEditorContentArea(page);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Tab');

      await appendCommentedWordAtDocumentEnd(page, {
        word: END_BOUNDARY_ENTER_COMMENT_WORD,
        insertLineBreakBeforeWord,
      });
      await focusEditorContentArea(page);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');

      console.log(
        `Waiting ${AUTOSAVE_WAIT_MS / 1_000}s for autosave to flush...`,
      );
      await page.waitForTimeout(AUTOSAVE_WAIT_MS);

      const fileContent = fs.readFileSync(activeFilePath, 'utf8');
      console.log('\n--- FILE AFTER BOUNDARY REGRESSION FLOW ---');
      console.log(fileContent);
      console.log('--- END FILE AFTER BOUNDARY FLOW ---\n');

      const endBoundarySpaceCommentRange = findCommentRangeWrappingExactText(
        fileContent,
        END_BOUNDARY_SPACE_COMMENT_WORD,
      );
      assert.ok(
        endBoundarySpaceCommentRange,
        `End-boundary space comment should still wrap exactly ${END_BOUNDARY_SPACE_COMMENT_WORD}. Got:\n${fileContent}`,
      );

      const endBoundarySpaceCharacter = fileContent.slice(
        endBoundarySpaceCommentRange.endMarkerTo,
        endBoundarySpaceCommentRange.endMarkerTo + 1,
      );
      assert.strictEqual(
        endBoundarySpaceCharacter,
        ' ',
        `Space typed at comment end should be outside the comment. Got ${JSON.stringify(endBoundarySpaceCharacter)}.`,
      );

      const startBoundarySpaceCommentRange = findCommentRangeWrappingExactText(
        fileContent,
        START_BOUNDARY_SPACE_COMMENT_WORD,
      );
      assert.ok(
        startBoundarySpaceCommentRange,
        `Start-boundary space comment should still wrap exactly ${START_BOUNDARY_SPACE_COMMENT_WORD}. Got:\n${fileContent}`,
      );

      assert.ok(
        startBoundarySpaceCommentRange.startMarkerFrom >= 1,
        'Start-boundary space marker appears too early for prefix assertion.',
      );
      const startBoundarySpaceCharacter = fileContent.slice(
        startBoundarySpaceCommentRange.startMarkerFrom - 1,
        startBoundarySpaceCommentRange.startMarkerFrom,
      );
      assert.strictEqual(
        startBoundarySpaceCharacter,
        ' ',
        `Space typed at comment start should be outside the comment. Got ${JSON.stringify(startBoundarySpaceCharacter)}.`,
      );

      const endBoundaryTabCommentRange = findCommentRangeWrappingExactText(
        fileContent,
        END_BOUNDARY_TAB_COMMENT_WORD,
      );
      assert.ok(
        endBoundaryTabCommentRange,
        `End-boundary tab comment should still wrap exactly ${END_BOUNDARY_TAB_COMMENT_WORD}. Got:\n${fileContent}`,
      );
      const endBoundaryTabCharacter = fileContent.slice(
        endBoundaryTabCommentRange.endMarkerTo,
        endBoundaryTabCommentRange.endMarkerTo + 1,
      );
      assert.strictEqual(
        endBoundaryTabCharacter,
        '\t',
        `Tab typed at comment end should be outside the comment. Got ${JSON.stringify(endBoundaryTabCharacter)}.`,
      );

      const endBoundaryEnterCommentRange = findCommentRangeWrappingExactText(
        fileContent,
        END_BOUNDARY_ENTER_COMMENT_WORD,
      );
      assert.ok(
        endBoundaryEnterCommentRange,
        `End-boundary enter comment should still wrap exactly ${END_BOUNDARY_ENTER_COMMENT_WORD}. Got:\n${fileContent}`,
      );
      const endBoundaryEnterCharacter = fileContent.slice(
        endBoundaryEnterCommentRange.endMarkerTo,
        endBoundaryEnterCommentRange.endMarkerTo + 1,
      );
      assert.strictEqual(
        endBoundaryEnterCharacter,
        '\n',
        `Enter typed at comment end should be outside the comment. Got ${JSON.stringify(endBoundaryEnterCharacter)}.`,
      );
    },
  });
};

module.exports = { runInlineCommentBoundaryWhitespaceScenario };
