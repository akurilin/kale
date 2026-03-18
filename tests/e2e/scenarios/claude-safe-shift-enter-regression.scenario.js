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
const isClaudeMainComposerPromptVisible = () => {
  const terminalRows = Array.from(
    document.querySelectorAll('.terminal-pane .xterm-rows > div'),
  ).map((row) => row.textContent || '');
  return (
    terminalRows.some((row) => row.includes('current:')) &&
    terminalRows.some(
      (row) => row.includes('❯') && !row.includes('Yes, I trust this folder'),
    )
  );
};

/**
 * Why: the workspace-trust chooser also renders a `❯` marker, so prompt-ready
 * detection must distinguish the real Claude composer from that gate screen.
 */
const waitForClaudePromptToBeReady = async (page) => {
  await page.waitForFunction(isClaudeMainComposerPromptVisible, {
    timeout: CLAUDE_SAFE_SHIFT_ENTER_TIMEOUT_MS,
  });
};

/**
 * Why: safe-mode Claude can show a one-time workspace-trust confirmation for
 * the isolated temporary test directory. The regression should accept that
 * prompt explicitly so the actual Shift+Enter assertion reaches the composer.
 */
const acceptClaudeWorkspaceTrustPromptIfPresent = async (page) => {
  await page.waitForFunction(
    () => {
      const terminalRows = Array.from(
        document.querySelectorAll('.terminal-pane .xterm-rows > div'),
      ).map((row) => row.textContent || '');
      return (
        terminalRows.some((row) => row.includes('Yes, I trust this folder')) ||
        (terminalRows.some((row) => row.includes('current:')) &&
          terminalRows.some(
            (row) =>
              row.includes('❯') && !row.includes('Yes, I trust this folder'),
          ))
      );
    },
    { timeout: CLAUDE_SAFE_SHIFT_ENTER_TIMEOUT_MS },
  );

  const trustPromptIsVisible = await page.evaluate(() => {
    const terminalRows = Array.from(
      document.querySelectorAll('.terminal-pane .xterm-rows > div'),
    ).map((row) => row.textContent || '');
    return terminalRows.some((row) => row.includes('Yes, I trust this folder'));
  });
  if (!trustPromptIsVisible) {
    return;
  }

  await focusTerminalInputTextarea(page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_000);
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
      .filter((row) => row.text.trim().length > 0 || row.hasCursor);
  });
};

/**
 * Why: Claude labels the external editor affordance with the locally configured
 * editor name, so the multiline check must anchor on the stable shortcut text
 * instead of assuming one editor such as VS Code.
 */
const hasClaudeMultilineComposerFooter = (rowsSnapshot) => {
  return rowsSnapshot.some((row) => /ctrl\+g to edit in /i.test(row.text));
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
 * red regression asserts both "no processing started" and "the multiline
 * footer shifted downward by one row" after Shift+Enter is pressed with prompt
 * text present.
 */
const assertShiftEnterInsertedANewlineWithoutSubmitting = (
  beforeShiftRowsSnapshot,
  afterShiftRowsSnapshot,
) => {
  const helloRow = afterShiftRowsSnapshot.find((row) =>
    row.text.includes('hello'),
  );
  assert.ok(
    helloRow,
    `Expected to keep a visible row containing "hello". Got ${JSON.stringify(afterShiftRowsSnapshot)}.`,
  );

  const beforeFooterSeparatorRow = beforeShiftRowsSnapshot.find(
    (row) => row.index > helloRow.index && row.text.includes('────────────'),
  );
  const afterFooterSeparatorRow = afterShiftRowsSnapshot.find(
    (row) => row.index > helloRow.index && row.text.includes('────────────'),
  );
  assert.ok(
    beforeFooterSeparatorRow,
    [
      'Expected the multiline composer footer separator before Shift+Enter.',
      `Rows: ${JSON.stringify(beforeShiftRowsSnapshot)}.`,
    ].join(' '),
  );
  assert.ok(
    afterFooterSeparatorRow,
    [
      'Expected the multiline composer footer separator after Shift+Enter.',
      `Rows: ${JSON.stringify(afterShiftRowsSnapshot)}.`,
    ].join(' '),
  );
  assert.ok(
    afterFooterSeparatorRow.index > beforeFooterSeparatorRow.index,
    [
      'Shift+Enter should insert a newline and push the multiline composer footer downward.',
      `before footer separator row index: ${beforeFooterSeparatorRow.index}.`,
      `after footer separator row index: ${afterFooterSeparatorRow.index}.`,
      `Rows before: ${JSON.stringify(beforeShiftRowsSnapshot)}.`,
      `Rows after: ${JSON.stringify(afterShiftRowsSnapshot)}.`,
    ].join(' '),
  );

  const processingRow = afterShiftRowsSnapshot.find((row) =>
    /(Cultivating|Thinking|⏺ )/.test(row.text),
  );
  assert.ok(
    !processingRow,
    [
      'Shift+Enter should not submit the prompt and start a Claude response.',
      `Unexpected processing row: ${JSON.stringify(processingRow)}.`,
      `Rows: ${JSON.stringify(afterShiftRowsSnapshot)}.`,
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
      await acceptClaudeWorkspaceTrustPromptIfPresent(page);
      await waitForClaudePromptToBeReady(page);
      await focusTerminalInputTextarea(page);
      await enterClaudeMultilineModeFromAnEmptyPrompt(page);

      const multilineModeRowsSnapshot = await readTerminalRowsSnapshot(page);
      assert.ok(
        hasClaudeMultilineComposerFooter(multilineModeRowsSnapshot),
        [
          'Expected Shift+Enter on an empty prompt to enter the multiline composer state.',
          `Rows: ${JSON.stringify(multilineModeRowsSnapshot)}.`,
        ].join(' '),
      );

      await page.keyboard.type('hello', { delay: 50 });
      await page.waitForTimeout(500);
      const beforeTypedShiftEnterRowsSnapshot =
        await readTerminalRowsSnapshot(page);
      await page.keyboard.press('Shift+Enter');
      await page.waitForTimeout(1_000);

      const afterTypedShiftEnterRowsSnapshot =
        await readTerminalRowsSnapshot(page);
      assertShiftEnterInsertedANewlineWithoutSubmitting(
        beforeTypedShiftEnterRowsSnapshot,
        afterTypedShiftEnterRowsSnapshot,
      );
    },
  });
};

module.exports = {
  runClaudeSafeShiftEnterRegressionScenario,
};
