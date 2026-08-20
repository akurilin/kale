import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SUPPORTED_AGENT_NAMES = new Set(['claude', 'codex']);
const SUPPORTED_AGENT_NAMES_TEXT = 'claude, codex';

/**
 * Why: npm must consume Kale's agent option before Electron Forge receives the
 * remaining options, because Electron Forge does not know Kale's custom flag.
 */
export const parseKaleStartArguments = (commandLineArguments) => {
  let selectedAgent = 'claude';
  let hasAgentOption = false;
  const forwardedArguments = [];

  for (
    let argumentIndex = 0;
    argumentIndex < commandLineArguments.length;
    argumentIndex += 1
  ) {
    const currentArgument = commandLineArguments[argumentIndex];
    const isSeparateAgentOption = currentArgument === '--agent';
    const isInlineAgentOption = currentArgument.startsWith('--agent=');

    if (!isSeparateAgentOption && !isInlineAgentOption) {
      forwardedArguments.push(currentArgument);
      continue;
    }

    if (hasAgentOption) {
      throw new Error('--agent can only be specified once.');
    }
    hasAgentOption = true;

    const requestedAgent = isSeparateAgentOption
      ? commandLineArguments[(argumentIndex += 1)]
      : currentArgument.slice('--agent='.length);
    if (!requestedAgent || requestedAgent.startsWith('--')) {
      throw new Error(
        `--agent requires a value. Supported values: ${SUPPORTED_AGENT_NAMES_TEXT}.`,
      );
    }

    const normalizedAgent = requestedAgent.trim().toLowerCase();
    if (!SUPPORTED_AGENT_NAMES.has(normalizedAgent)) {
      throw new Error(
        `Unsupported --agent value "${requestedAgent}". Supported values: ${SUPPORTED_AGENT_NAMES_TEXT}.`,
      );
    }

    selectedAgent = normalizedAgent;
  }

  return {
    agent: selectedAgent,
    forwardedArguments,
    wasAgentSpecified: hasAgentOption,
  };
};

/**
 * Why: legacy QA profiles must remain available when no user-facing agent is
 * selected, but an explicit command-line choice must take priority.
 */
export const resolveTerminalProfileNameForStart = (
  parsedArguments,
  environmentProfileName,
) => {
  if (parsedArguments.wasAgentSpecified) {
    return parsedArguments.agent;
  }

  return environmentProfileName?.trim() || parsedArguments.agent;
};

/**
 * Why: a small wrapper keeps Kale-specific options separate while preserving
 * Electron Forge's normal output, signal handling, and additional arguments.
 */
const startKale = () => {
  let parsedArguments;
  try {
    parsedArguments = parseKaleStartArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const scriptDirectoryPath = path.dirname(fileURLToPath(import.meta.url));
  const projectRootPath = path.resolve(scriptDirectoryPath, '..');
  const electronForgeCliPath = path.resolve(
    projectRootPath,
    'node_modules',
    '@electron-forge',
    'cli',
    'dist',
    'electron-forge.js',
  );
  const electronForgeProcess = spawn(
    process.execPath,
    [electronForgeCliPath, 'start', ...parsedArguments.forwardedArguments],
    {
      cwd: projectRootPath,
      env: {
        ...process.env,
        KALE_TERMINAL_PROFILE: resolveTerminalProfileNameForStart(
          parsedArguments,
          process.env.KALE_TERMINAL_PROFILE,
        ),
      },
      stdio: 'inherit',
    },
  );

  electronForgeProcess.once('error', (error) => {
    console.error(`Failed to start Electron Forge: ${error.message}`);
    process.exitCode = 1;
  });
  electronForgeProcess.once('exit', (exitCode, signal) => {
    if (signal) {
      console.error(`Electron Forge stopped because of signal ${signal}.`);
      process.exitCode = 1;
      return;
    }

    process.exitCode = exitCode ?? 1;
  });
};

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectExecution) {
  startKale();
}
