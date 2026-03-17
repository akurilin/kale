export type TerminalLaunchProfile =
  | {
      kind: 'claude';
    }
  | {
      kind: 'claude-safe';
    }
  | {
      kind: 'shell';
      command: string;
      args: string[];
    }
  | {
      kind: 'custom';
      command: string;
      args: string[];
    };

/**
 * Why: custom QA commands need unambiguous argument parsing, so overrides use a
 * JSON array instead of shell-style splitting that would differ by platform.
 */
const parseTerminalArgumentListJsonOrThrow = (
  serializedArgumentsJson: string | undefined,
): string[] => {
  const trimmedSerializedArgumentsJson = serializedArgumentsJson?.trim() ?? '';
  if (!trimmedSerializedArgumentsJson) {
    return [];
  }

  let parsedArguments: unknown;
  try {
    parsedArguments = JSON.parse(trimmedSerializedArgumentsJson);
  } catch {
    throw new Error(
      'KALE_TERMINAL_ARGS_JSON must be a JSON array of string arguments.',
    );
  }

  if (
    !Array.isArray(parsedArguments) ||
    parsedArguments.some((argument) => typeof argument !== 'string')
  ) {
    throw new Error(
      'KALE_TERMINAL_ARGS_JSON must be a JSON array of string arguments.',
    );
  }

  return parsedArguments;
};

/**
 * Why: the shell QA profile should feel like a normal terminal session on the
 * current platform without forcing every caller to know platform-specific
 * fallback shell conventions.
 */
const resolveDefaultInteractiveShellCommandForPlatform = (
  environmentVariables: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) => {
  if (platform === 'win32') {
    return environmentVariables.ComSpec?.trim() || 'cmd.exe';
  }

  return environmentVariables.SHELL?.trim() || '/bin/sh';
};

/**
 * Why: terminal launch behavior now needs a safe QA escape hatch, but the app
 * must still default to Claude unless an explicit override is configured.
 */
export const resolveTerminalLaunchProfileFromEnvironment = (
  environmentVariables: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): TerminalLaunchProfile => {
  const configuredCustomCommand =
    environmentVariables.KALE_TERMINAL_COMMAND?.trim() ?? '';
  const configuredArgumentsJson =
    environmentVariables.KALE_TERMINAL_ARGS_JSON?.trim() ?? '';

  if (configuredArgumentsJson && !configuredCustomCommand) {
    throw new Error(
      'KALE_TERMINAL_ARGS_JSON requires KALE_TERMINAL_COMMAND to also be set.',
    );
  }

  if (configuredCustomCommand) {
    return {
      kind: 'custom',
      command: configuredCustomCommand,
      args: parseTerminalArgumentListJsonOrThrow(configuredArgumentsJson),
    };
  }

  const configuredProfileName =
    environmentVariables.KALE_TERMINAL_PROFILE?.trim().toLowerCase() ??
    'claude';
  if (configuredProfileName === 'claude') {
    return { kind: 'claude' };
  }

  if (configuredProfileName === 'claude-safe') {
    return { kind: 'claude-safe' };
  }

  if (configuredProfileName === 'shell') {
    return {
      kind: 'shell',
      command: resolveDefaultInteractiveShellCommandForPlatform(
        environmentVariables,
        platform,
      ),
      args: platform === 'win32' ? [] : ['-i'],
    };
  }

  throw new Error(
    `Unsupported KALE_TERMINAL_PROFILE value "${configuredProfileName}". Supported values: claude, claude-safe, shell.`,
  );
};
