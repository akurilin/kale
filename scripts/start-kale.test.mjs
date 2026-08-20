import { describe, expect, it } from 'vitest';

import {
  parseKaleStartArguments,
  resolveTerminalProfileNameForStart,
} from './start-kale.mjs';

describe('parseKaleStartArguments', () => {
  it('uses Claude when no agent is specified', () => {
    expect(parseKaleStartArguments([])).toEqual({
      agent: 'claude',
      forwardedArguments: [],
      wasAgentSpecified: false,
    });
  });

  it('selects Codex and forwards Electron Forge arguments', () => {
    expect(
      parseKaleStartArguments(['--agent', 'codex', '--inspect-electron']),
    ).toEqual({
      agent: 'codex',
      forwardedArguments: ['--inspect-electron'],
      wasAgentSpecified: true,
    });
  });

  it('accepts an inline Claude value', () => {
    expect(parseKaleStartArguments(['--agent=claude'])).toEqual({
      agent: 'claude',
      forwardedArguments: [],
      wasAgentSpecified: true,
    });
  });

  it('rejects a missing agent value', () => {
    expect(() => parseKaleStartArguments(['--agent'])).toThrowError(
      '--agent requires a value. Supported values: claude, codex.',
    );
  });

  it('rejects an unsupported agent value', () => {
    expect(() =>
      parseKaleStartArguments(['--agent', 'unknown-agent']),
    ).toThrowError(
      'Unsupported --agent value "unknown-agent". Supported values: claude, codex.',
    );
  });

  it('rejects more than one agent option', () => {
    expect(() =>
      parseKaleStartArguments(['--agent', 'claude', '--agent=codex']),
    ).toThrowError('--agent can only be specified once.');
  });
});

describe('resolveTerminalProfileNameForStart', () => {
  it('preserves a QA profile when no agent option is specified', () => {
    expect(
      resolveTerminalProfileNameForStart(
        {
          agent: 'claude',
          forwardedArguments: [],
          wasAgentSpecified: false,
        },
        'claude-safe',
      ),
    ).toBe('claude-safe');
  });

  it('uses an explicit agent instead of an environment profile', () => {
    expect(
      resolveTerminalProfileNameForStart(
        {
          agent: 'codex',
          forwardedArguments: [],
          wasAgentSpecified: true,
        },
        'shell',
      ),
    ).toBe('codex');
  });

  it('defaults to Claude when neither source specifies a profile', () => {
    expect(
      resolveTerminalProfileNameForStart(
        {
          agent: 'claude',
          forwardedArguments: [],
          wasAgentSpecified: false,
        },
        undefined,
      ),
    ).toBe('claude');
  });
});
