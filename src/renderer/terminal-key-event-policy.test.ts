import { describe, expect, it } from 'vitest';

import {
  claudeShiftEnterEscapeSequence,
  getTerminalKeyboardRemapAction,
  type TerminalKeyboardLikeEvent,
} from './terminal-key-event-policy';

/**
 * Why: these tests only care about xterm's keyboard event shape, so a small
 * factory keeps each case focused on the remap decision instead of boilerplate.
 */
const createKeyboardEventShape = (
  overrides: Partial<TerminalKeyboardLikeEvent>,
): TerminalKeyboardLikeEvent => {
  return {
    type: 'keydown',
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
};

describe('getTerminalKeyboardRemapAction', () => {
  it('injects the Claude multiline escape sequence on Shift+Enter keydown', () => {
    expect(
      getTerminalKeyboardRemapAction(
        createKeyboardEventShape({
          type: 'keydown',
          shiftKey: true,
        }),
        true,
      ),
    ).toEqual({
      kind: 'intercept-and-send',
      data: claudeShiftEnterEscapeSequence,
    });
  });

  it('suppresses Shift+Enter keypress without sending an extra Enter', () => {
    expect(
      getTerminalKeyboardRemapAction(
        createKeyboardEventShape({
          type: 'keypress',
          shiftKey: true,
        }),
        true,
      ),
    ).toEqual({
      kind: 'intercept-only',
    });
  });

  it('suppresses Shift+Enter keyup without sending an extra Enter', () => {
    expect(
      getTerminalKeyboardRemapAction(
        createKeyboardEventShape({
          type: 'keyup',
          shiftKey: true,
        }),
        true,
      ),
    ).toEqual({
      kind: 'intercept-only',
    });
  });

  it('leaves Shift+Enter alone for terminal sessions that do not use Claude composer input', () => {
    expect(
      getTerminalKeyboardRemapAction(
        createKeyboardEventShape({
          type: 'keydown',
          shiftKey: true,
        }),
        false,
      ),
    ).toEqual({
      kind: 'pass-through',
    });
  });

  it('leaves a plain Enter alone so xterm keeps normal submit behavior', () => {
    expect(
      getTerminalKeyboardRemapAction(
        createKeyboardEventShape({
          type: 'keydown',
        }),
        true,
      ),
    ).toEqual({
      kind: 'pass-through',
    });
  });

  it('leaves modified Enter combinations with other modifiers alone', () => {
    expect(
      getTerminalKeyboardRemapAction(
        createKeyboardEventShape({
          type: 'keydown',
          shiftKey: true,
          ctrlKey: true,
        }),
        true,
      ),
    ).toEqual({
      kind: 'pass-through',
    });
  });
});
