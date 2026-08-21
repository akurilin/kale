/**
 * E2E scenario: agent-written suggestions must support accept, reject, and
 * undo while keeping the Markdown file as the source of truth.
 */

const assert = require('node:assert');
const fs = require('node:fs');

const { AUTOSAVE_WAIT_MS, runIsolatedE2ETest } = require('../harness');

/**
 * Why: the scenario must seed the exact public marker format that terminal
 * agents write, without depending on renderer-only TypeScript helpers.
 */
const createSuggestionMarkup = ({
  suggestionId,
  explanation,
  originalText,
  replacementText,
}) => {
  const markerPayload = JSON.stringify({
    version: 1,
    kind: 'suggestion',
    explanation,
    originalText,
    replacementText,
  }).replaceAll('--', '\\u002d\\u002d');

  return `<!-- @comment:${suggestionId} start | ${markerPayload} -->${originalText}<!-- @comment:${suggestionId} end -->`;
};

/**
 * Why: each resolution step targets a stable marker ID because card order can
 * change after replacements alter document offsets.
 */
const getSuggestionCard = (page, suggestionId) => {
  return page.locator(`[data-inline-comment-card-id="${suggestionId}"]`);
};

/**
 * Why: one scenario covers both resolution branches and their shared undo path
 * before it verifies that the final accepted state reaches disk.
 */
const runInlineSuggestionResolutionScenario = async () => {
  const acceptedSuggestionId = 'c_e2e_accept';
  const rejectedSuggestionId = 'c_e2e_reject';
  const acceptedOriginalText = 'This sentence has several extra words.';
  const acceptedReplacementText = 'This sentence is concise.';
  const rejectedOriginalText = 'Keep this original sentence.';
  const rejectedReplacementText = 'Replace the original sentence.';
  const seededMarkdownContent = [
    '# Suggestion review',
    '',
    createSuggestionMarkup({
      suggestionId: acceptedSuggestionId,
      explanation: 'Make this concise.',
      originalText: acceptedOriginalText,
      replacementText: acceptedReplacementText,
    }),
    '',
    createSuggestionMarkup({
      suggestionId: rejectedSuggestionId,
      explanation: 'Use different wording.',
      originalText: rejectedOriginalText,
      replacementText: rejectedReplacementText,
    }),
  ].join('\n');

  await runIsolatedE2ETest({
    testName: 'E2E inline suggestion accept, reject, and undo',
    seedDefaultMarkdownContent: '# Suggestion review\n',
    testBody: async ({ page, activeFilePath }) => {
      fs.writeFileSync(activeFilePath, seededMarkdownContent, 'utf8');
      await page.waitForSelector('.inline-suggestion-card');
      assert.strictEqual(
        await page.locator('.inline-suggestion-card').count(),
        2,
        'Both agent-written suggestions should render as diff cards.',
      );

      const acceptedSuggestionCard = getSuggestionCard(
        page,
        acceptedSuggestionId,
      );
      assert.match(
        await acceptedSuggestionCard.textContent(),
        /Before[\s\S]*This sentence has several extra words\.[\s\S]*After[\s\S]*This sentence is concise\./,
        'The suggestion card should show both versions.',
      );

      await acceptedSuggestionCard
        .getByRole('button', { name: 'Accept suggestion' })
        .click();
      await page.waitForFunction((suggestionId) => {
        return !document.querySelector(
          `[data-inline-comment-card-id="${suggestionId}"]`,
        );
      }, acceptedSuggestionId);
      assert.match(
        await page.locator('.cm-content').innerText(),
        /This sentence is concise\./,
        'Accept should place the replacement text in the editor.',
      );

      await page.keyboard.press(
        process.platform === 'darwin' ? 'Meta+z' : 'Control+z',
      );
      await getSuggestionCard(page, acceptedSuggestionId).waitFor();
      assert.match(
        await page.locator('.cm-content').innerText(),
        /This sentence has several extra words\./,
        'Undo should restore the original text and suggestion card.',
      );

      const rejectedSuggestionCard = getSuggestionCard(
        page,
        rejectedSuggestionId,
      );
      await rejectedSuggestionCard
        .getByRole('button', { name: 'Reject suggestion' })
        .click();
      await page.waitForFunction((suggestionId) => {
        return !document.querySelector(
          `[data-inline-comment-card-id="${suggestionId}"]`,
        );
      }, rejectedSuggestionId);
      assert.match(
        await page.locator('.cm-content').innerText(),
        /Keep this original sentence\./,
        'Reject should keep the original text.',
      );

      await page
        .locator('.inline-suggestion-resolution-notice')
        .getByRole('button', { name: 'Undo' })
        .click();
      await getSuggestionCard(page, rejectedSuggestionId).waitFor();

      await getSuggestionCard(page, acceptedSuggestionId)
        .getByRole('button', { name: 'Accept suggestion' })
        .click();
      await page.waitForTimeout(AUTOSAVE_WAIT_MS);

      const savedMarkdownContent = fs.readFileSync(activeFilePath, 'utf8');
      assert.ok(
        savedMarkdownContent.includes(acceptedReplacementText),
        'Autosave should persist the accepted replacement.',
      );
      assert.ok(
        !savedMarkdownContent.includes(acceptedSuggestionId),
        'Autosave should remove accepted suggestion markers.',
      );
      assert.ok(
        savedMarkdownContent.includes(rejectedSuggestionId),
        'The unresolved suggestion should remain in the file.',
      );
    },
  });
};

module.exports = { runInlineSuggestionResolutionScenario };
