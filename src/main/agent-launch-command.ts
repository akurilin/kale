export type AgentTerminalLaunchProfileKind = 'claude' | 'claude-safe' | 'codex';

export type ResolvedAgentLaunchCommand = {
  command: string;
  args: string[];
  usesClaudeCodeShiftEnterRemap: boolean;
};

/**
 * Why: each supported agent needs different safety and prompt flags, so one
 * pure builder keeps the provider-specific process contract easy to test.
 */
export const buildAgentLaunchCommand = (
  agentProfileKind: AgentTerminalLaunchProfileKind,
  systemPromptText: string,
): ResolvedAgentLaunchCommand => {
  if (agentProfileKind === 'codex') {
    return {
      command: 'codex',
      args: [
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'on-request',
        '--no-alt-screen',
        '-c',
        `developer_instructions=${JSON.stringify(systemPromptText)}`,
      ],
      usesClaudeCodeShiftEnterRemap: false,
    };
  }

  const sharedClaudeArguments = ['--append-system-prompt', systemPromptText];
  if (agentProfileKind === 'claude-safe') {
    return {
      command: 'claude',
      args: [
        '--permission-mode',
        'default',
        '--tools',
        '',
        ...sharedClaudeArguments,
      ],
      usesClaudeCodeShiftEnterRemap: true,
    };
  }

  return {
    command: 'claude',
    args: ['--dangerously-skip-permissions', ...sharedClaudeArguments],
    usesClaudeCodeShiftEnterRemap: true,
  };
};
