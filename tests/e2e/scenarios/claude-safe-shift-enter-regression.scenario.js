/**
 * Claude safe-mode Shift+Enter regression scenario: reproduces the multiline
 * composer bug locally without granting Claude broad system-edit permissions.
 */

const assert = require('node:assert');

const { runIsolatedE2ETest } = require('../harness');

const CLAUDE_SAFE_SHIFT_ENTER_TIMEOUT_MS = 10_000;

/**
 * Why: Claude startup is asynchronous and local-only, so this wait produces a
 * deterministic prompt-ready boundary before sending keyboard input.
 */
const waitForClaudePromptToBeReady = async (page) => {
  await page.waitForFunction(
    () => {
      const terminalRows = Array.from(
        document.querySelectorAll('.terminal-pane .xterm-rows > div'),
      ).map((row) => row.textContent || '');
      return terminalRows.some((row) => row.includes('❯'));
    },
    { timeout: CLAUDE_SAFE_SHIFT_ENTER_TIMEOUT_MS },
  );
};

/**
 * Why: the terminal UI is rendered into xterm rows, so the regression needs a
 * stable snapshot format that exposes both visible text and cursor ownership.
 */
const readTerminalRowsSnapshot = async (page) => {
  return page.evaluate(() => {
    return Array.from(
      document.querySelectorAll('.terminal-pane .xterm-rows > div'),
    )
      .map((row, index) => ({
        index,
        text: row.textContent || '',
        hasCursor: Boolean(row.querySelector('.xterm-cursor')),
      }))
      .filter((row) => row.text.trim().length > 0);
  });
};

/**
 * Why: prompt-focused regressions need to drive the hidden xterm textarea
 * directly so keyboard input is routed into the active PTY session reliably.
 */
const focusTerminalInputTextarea = async (page) => {
  await page.locator('.xterm-helper-textarea').focus();
  await page.waitForFunction(() => {
    return document.activeElement?.classList.contains('xterm-helper-textarea');
  });
};

/**
 * Why: the empty-prompt Shift+Enter sequence is part of the reported repro, so
 * the scenario intentionally enters multiline mode the same way a user does.
 */
const enterClaudeMultilineModeFromAnEmptyPrompt = async (page) => {
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(250);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(250);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(250);
};

/**
 * Why: the intended behavior is "insert a newline without submitting", so the
 * red regression asserts both "no processing started" and "cursor moved below
 * the typed line" after Shift+Enter is pressed with prompt text present.
 */
const assertShiftEnterInsertedANewlineWithoutSubmitting = (rowsSnapshot) => {
  const helloRow = rowsSnapshot.find((row) => row.text.includes('hello'));
  assert.ok(
    helloRow,
    `Expected to keep a visible row containing "hello". Got ${JSON.stringify(rowsSnapshot)}.`,
  );

  const cursorRow = rowsSnapshot.find((row) => row.hasCursor);
  assert.ok(
    cursorRow,
    `Expected the prompt cursor to remain visible after Shift+Enter. Got ${JSON.stringify(rowsSnapshot)}.`,
  );
  assert.ok(
    cursorRow.index > helloRow.index,
    [
      'Shift+Enter should move the cursor onto a new line below the typed prompt text.',
      `hello row index: ${helloRow.index}.`,
      `cursor row index: ${cursorRow.index}.`,
      `Rows: ${JSON.stringify(rowsSnapshot)}.`,
    ].join(' '),
  );

  const processingRow = rowsSnapshot.find((row) =>
    /(Cultivating|Thinking|⏺ )/.test(row.text),
  );
  assert.ok(
    !processingRow,
    [
      'Shift+Enter should not submit the prompt and start a Claude response.',
      `Unexpected processing row: ${JSON.stringify(processingRow)}.`,
      `Rows: ${JSON.stringify(rowsSnapshot)}.`,
    ].join(' '),
  );
};

/**
 * Why: this scenario should stay out of CI because it requires a real local
 * Claude Code session, but it still needs to be a first-class red regression
 * developers can run before fixing the bug.
 */
const runClaudeSafeShiftEnterRegressionScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E local-only Claude safe Shift+Enter regression',
    launchEnv: {
      KALE_TERMINAL_PROFILE: 'claude-safe',
      KALE_SKIP_TERMINAL_VALIDATION: '',
    },
    testBody: async ({ page }) => {
      await waitForClaudePromptToBeReady(page);
      await focusTerminalInputTextarea(page);
      await enterClaudeMultilineModeFromAnEmptyPrompt(page);

      const multilineModeRowsSnapshot = await readTerminalRowsSnapshot(page);
      assert.ok(
        multilineModeRowsSnapshot.some((row) =>
          row.text.includes('ctrl+g to edit in VS Code'),
        ),
        [
          'Expected Shift+Enter on an empty prompt to enter the multiline composer state.',
          `Rows: ${JSON.stringify(multilineModeRowsSnapshot)}.`,
        ].join(' '),
      );

      await page.keyboard.type('hello', { delay: 50 });
      await page.waitForTimeout(500);
      await page.keyboard.press('Shift+Enter');
      await page.waitForTimeout(1_000);

      const afterTypedShiftEnterRowsSnapshot =
        await readTerminalRowsSnapshot(page);
      assertShiftEnterInsertedANewlineWithoutSubmitting(
        afterTypedShiftEnterRowsSnapshot,
      );
    },
  });
};

module.exports = {
  runClaudeSafeShiftEnterRegressionScenario,
};
