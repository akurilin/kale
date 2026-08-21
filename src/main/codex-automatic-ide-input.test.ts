import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCodexAutomaticIdeInputController } from './codex-automatic-ide-input';

describe('createCodexAutomaticIdeInputController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the IDE command after the Codex composer is ready', () => {
    const writeAutomaticInput = vi.fn();
    const controller = createCodexAutomaticIdeInputController({
      automaticInput: '/ide on',
      writeAutomaticInput,
      delayMs: 500,
    });

    controller.handleTerminalOutput('› Ask Codex to do anything');
    vi.advanceTimersByTime(499);
    expect(writeAutomaticInput).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(writeAutomaticInput).toHaveBeenCalledOnce();
    expect(writeAutomaticInput).toHaveBeenCalledWith('/ide on');
    vi.advanceTimersByTime(49);
    expect(writeAutomaticInput).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(writeAutomaticInput).toHaveBeenNthCalledWith(2, '\r');
  });

  it('waits for trust confirmation instead of typing into the trust prompt', () => {
    const writeAutomaticInput = vi.fn();
    const controller = createCodexAutomaticIdeInputController({
      automaticInput: '/ide on',
      writeAutomaticInput,
      delayMs: 500,
    });

    controller.handleTerminalOutput('› Ask Codex to do anything');
    vi.advanceTimersByTime(250);
    controller.handleTerminalOutput('› 1. Yes, continue');
    vi.advanceTimersByTime(1_000);
    expect(writeAutomaticInput).not.toHaveBeenCalled();

    controller.handleTerminalOutput('› Ask Codex to do anything');
    vi.advanceTimersByTime(500);
    expect(writeAutomaticInput).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(50);
    expect(writeAutomaticInput).toHaveBeenNthCalledWith(2, '\r');
  });

  it('does not type after the terminal session exits', () => {
    const writeAutomaticInput = vi.fn();
    const controller = createCodexAutomaticIdeInputController({
      automaticInput: '/ide on',
      writeAutomaticInput,
      delayMs: 500,
    });

    controller.handleTerminalOutput('› Ask Codex to do anything');
    controller.cancel();
    vi.advanceTimersByTime(500);

    expect(writeAutomaticInput).not.toHaveBeenCalled();
  });
});
