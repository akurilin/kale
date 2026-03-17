import { describe, expect, it } from 'vitest';

import { resolveTerminalLaunchProfileFromEnvironment } from './terminal-launch-profile';

describe('resolveTerminalLaunchProfileFromEnvironment', () => {
  it('defaults to the Claude launch profile when no override is configured', () => {
    expect(resolveTerminalLaunchProfileFromEnvironment({}, 'darwin')).toEqual({
      kind: 'claude',
    });
  });

  it('uses a constrained Claude profile when the safe Claude mode is requested', () => {
    expect(
      resolveTerminalLaunchProfileFromEnvironment(
        {
          KALE_TERMINAL_PROFILE: 'claude-safe',
        },
        'darwin',
      ),
    ).toEqual({
      kind: 'claude-safe',
    });
  });

  it('uses the current interactive shell when the shell profile is requested', () => {
    expect(
      resolveTerminalLaunchProfileFromEnvironment(
        {
          KALE_TERMINAL_PROFILE: 'shell',
          SHELL: '/bin/zsh',
        },
        'darwin',
      ),
    ).toEqual({
      kind: 'shell',
      command: '/bin/zsh',
      args: ['-i'],
    });
  });

  it('uses an explicit custom command override with optional JSON arguments', () => {
    expect(
      resolveTerminalLaunchProfileFromEnvironment(
        {
          KALE_TERMINAL_COMMAND: '/usr/bin/env',
          KALE_TERMINAL_ARGS_JSON: '["cat","-v"]',
        },
        'darwin',
      ),
    ).toEqual({
      kind: 'custom',
      command: '/usr/bin/env',
      args: ['cat', '-v'],
    });
  });

  it('prefers the explicit custom command override over the named profile', () => {
    expect(
      resolveTerminalLaunchProfileFromEnvironment(
        {
          KALE_TERMINAL_PROFILE: 'shell',
          KALE_TERMINAL_COMMAND: '/bin/cat',
          KALE_TERMINAL_ARGS_JSON: '["-v"]',
          SHELL: '/bin/zsh',
        },
        'darwin',
      ),
    ).toEqual({
      kind: 'custom',
      command: '/bin/cat',
      args: ['-v'],
    });
  });

  it('throws a clear error when custom arguments are not valid JSON', () => {
    expect(() =>
      resolveTerminalLaunchProfileFromEnvironment(
        {
          KALE_TERMINAL_COMMAND: '/bin/cat',
          KALE_TERMINAL_ARGS_JSON: '-v',
        },
        'darwin',
      ),
    ).toThrowError(
      'KALE_TERMINAL_ARGS_JSON must be a JSON array of string arguments.',
    );
  });

  it('throws a clear error when the terminal profile is unknown', () => {
    expect(() =>
      resolveTerminalLaunchProfileFromEnvironment(
        {
          KALE_TERMINAL_PROFILE: 'unknown-profile',
        },
        'darwin',
      ),
    ).toThrowError(
      'Unsupported KALE_TERMINAL_PROFILE value "unknown-profile". Supported values: claude, claude-safe, shell.',
    );
  });

  it('throws when custom arguments are provided without a custom command override', () => {
    expect(() =>
      resolveTerminalLaunchProfileFromEnvironment(
        {
          KALE_TERMINAL_ARGS_JSON: '["-v"]',
        },
        'darwin',
      ),
    ).toThrowError(
      'KALE_TERMINAL_ARGS_JSON requires KALE_TERMINAL_COMMAND to also be set.',
    );
  });
});
