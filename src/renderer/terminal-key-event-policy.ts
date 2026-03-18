export type TerminalKeyboardLikeEvent = Pick<
  KeyboardEvent,
  'type' | 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'
>;

export type TerminalKeyboardRemapAction =
  | {
      kind: 'pass-through';
    }
  | {
      kind: 'intercept-only';
    }
  | {
      kind: 'intercept-and-send';
      data: string;
    };

export const claudeShiftEnterEscapeSequence = '\u001b[13;2u';

/**
 * Why: Claude expects modified Enter for multiline input, but xterm also emits
 * keypress/keyup phases for Enter. Matching the full modifier shape keeps the
 * remap narrowly scoped so other shortcuts still use xterm defaults.
 */
const isBareShiftEnterKeyboardEvent = (
  keyboardEvent: TerminalKeyboardLikeEvent,
) => {
  return (
    keyboardEvent.key === 'Enter' &&
    keyboardEvent.shiftKey &&
    !keyboardEvent.altKey &&
    !keyboardEvent.ctrlKey &&
    !keyboardEvent.metaKey
  );
};

/**
 * Why: only Claude-backed sessions need the custom modified-Enter escape
 * sequence. Raw terminal sessions should keep xterm's default Shift+Enter
 * behavior untouched.
 */
export const getTerminalKeyboardRemapAction = (
  keyboardEvent: TerminalKeyboardLikeEvent,
  shouldUseClaudeCodeShiftEnterRemap: boolean,
): TerminalKeyboardRemapAction => {
  if (
    !shouldUseClaudeCodeShiftEnterRemap ||
    !isBareShiftEnterKeyboardEvent(keyboardEvent)
  ) {
    return { kind: 'pass-through' };
  }

  if (keyboardEvent.type === 'keydown') {
    return {
      kind: 'intercept-and-send',
      data: claudeShiftEnterEscapeSequence,
    };
  }

  return { kind: 'intercept-only' };
};
