const CODEX_COMPOSER_READY_TEXT = 'Ask Codex to do anything';
const CODEX_WORKSPACE_TRUST_PROMPT_TEXT = 'Yes, continue';
const DEFAULT_AUTOMATIC_IDE_INPUT_DELAY_MS = 1_500;
const AUTOMATIC_INPUT_SUBMIT_DELAY_MS = 50;
const MAXIMUM_RECENT_TERMINAL_OUTPUT_CHARACTERS = 8_192;

type CodexAutomaticIdeInputControllerOptions = {
  automaticInput: string;
  writeAutomaticInput: (automaticInput: string) => void;
  delayMs?: number;
};

export type CodexAutomaticIdeInputController = {
  handleTerminalOutput: (chunkText: string) => void;
  cancel: () => void;
};

/**
 * Why: Codex can show a workspace-trust prompt after its first composer frame,
 * so Kale must never type `/ide on` until the real composer remains active.
 */
export const createCodexAutomaticIdeInputController = ({
  automaticInput,
  writeAutomaticInput,
  delayMs = DEFAULT_AUTOMATIC_IDE_INPUT_DELAY_MS,
}: CodexAutomaticIdeInputControllerOptions): CodexAutomaticIdeInputController => {
  let recentTerminalOutput = '';
  let pendingInputTimeout: ReturnType<typeof setTimeout> | null = null;
  let didSendAutomaticInput = false;

  /**
   * Why: a later trust frame must cancel input that an earlier loading frame
   * scheduled, or the slash command can select "No, quit" and close Codex.
   */
  const cancelPendingInput = () => {
    if (pendingInputTimeout) {
      clearTimeout(pendingInputTimeout);
      pendingInputTimeout = null;
    }
  };

  /**
   * Why: the delay gives Codex time to replace its loading frame with a trust
   * prompt before Kale commits any automatic text to the active terminal UI.
   */
  const scheduleAutomaticInput = () => {
    if (didSendAutomaticInput || pendingInputTimeout) {
      return;
    }
    pendingInputTimeout = setTimeout(() => {
      writeAutomaticInput(automaticInput);
      // Codex treats command text and Enter from one PTY write as pasted input.
      // A separate write makes the slash command run instead of staying open.
      pendingInputTimeout = setTimeout(() => {
        pendingInputTimeout = null;
        didSendAutomaticInput = true;
        writeAutomaticInput('\r');
      }, AUTOMATIC_INPUT_SUBMIT_DELAY_MS);
    }, delayMs);
  };

  /**
   * Why: readiness text can span PTY chunks, so a small rolling buffer detects
   * both composer and trust frames without retaining all terminal output.
   */
  const handleTerminalOutput = (chunkText: string) => {
    if (didSendAutomaticInput) {
      return;
    }
    recentTerminalOutput = `${recentTerminalOutput}${chunkText}`.slice(
      -MAXIMUM_RECENT_TERMINAL_OUTPUT_CHARACTERS,
    );

    if (recentTerminalOutput.includes(CODEX_WORKSPACE_TRUST_PROMPT_TEXT)) {
      cancelPendingInput();
      recentTerminalOutput = '';
      return;
    }
    if (recentTerminalOutput.includes(CODEX_COMPOSER_READY_TEXT)) {
      scheduleAutomaticInput();
    }
  };

  /**
   * Why: session exit must make a delayed write impossible because PTY IDs can
   * be removed or replaced while the timeout is still pending.
   */
  const cancel = () => {
    cancelPendingInput();
    didSendAutomaticInput = true;
  };

  return { handleTerminalOutput, cancel };
};
