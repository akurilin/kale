import { describe, expect, it } from 'vitest';

import { buildAgentLaunchCommand } from './agent-launch-command';

describe('buildAgentLaunchCommand', () => {
  it('starts Claude with the current unrestricted settings', () => {
    expect(buildAgentLaunchCommand('claude', 'System prompt')).toEqual({
      command: 'claude',
      args: [
        '--dangerously-skip-permissions',
        '--append-system-prompt',
        'System prompt',
      ],
      usesClaudeCodeShiftEnterRemap: true,
    });
  });

  it('starts the constrained Claude profile without tools', () => {
    expect(buildAgentLaunchCommand('claude-safe', 'System prompt')).toEqual({
      command: 'claude',
      args: [
        '--permission-mode',
        'default',
        '--tools',
        '',
        '--append-system-prompt',
        'System prompt',
      ],
      usesClaudeCodeShiftEnterRemap: true,
    });
  });

  it('starts Codex with workspace writes and the Kale system prompt', () => {
    expect(buildAgentLaunchCommand('codex', 'System\nprompt')).toEqual({
      command: 'codex',
      args: [
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'on-request',
        '--no-alt-screen',
        '-c',
        'developer_instructions="System\\nprompt"',
      ],
      usesClaudeCodeShiftEnterRemap: false,
    });
  });

  it('starts Pi with Kale instructions and the bundled IDE context extension', () => {
    expect(
      buildAgentLaunchCommand('pi', 'System prompt', {
        piIdeContextExtensionFilePath:
          '/Applications/kale/integrations/pi/kale-ide-context.ts',
      }),
    ).toEqual({
      command: 'pi',
      args: [
        '--append-system-prompt',
        'System prompt',
        '--extension',
        '/Applications/kale/integrations/pi/kale-ide-context.ts',
      ],
      usesClaudeCodeShiftEnterRemap: false,
    });
  });
});
