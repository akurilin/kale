type Position = {
  line: number;
  character: number;
};

type EditorSelection = {
  filePath: string;
  selectedText: string;
  range: {
    start: Position;
    end: Position;
  };
};

type EditorContextSnapshot = {
  activeFilePath: string | null;
  selection: EditorSelection | null;
};

type PiExtensionContext = {
  hasUI: boolean;
  ui: {
    setStatus: (key: string, text: string | undefined) => void;
  };
};

type BeforeAgentStartResult = {
  systemPrompt: string;
};

type PiEventHandler = (
  event: unknown,
  context: PiExtensionContext,
) => void | BeforeAgentStartResult | Promise<void | BeforeAgentStartResult>;

type PiExtensionApi = {
  on: (eventName: string, handler: PiEventHandler) => void;
};

type ContextTransportConfiguration = {
  editorContextUrl: string;
  authToken: string;
};

const EDITOR_CONTEXT_URL_ENVIRONMENT_VARIABLE = 'KALE_PI_EDITOR_CONTEXT_URL';
const AUTH_TOKEN_ENVIRONMENT_VARIABLE = 'KALE_PI_IDE_AUTH_TOKEN';
const AUTHORIZATION_HEADER = 'x-kale-ide-authorization';
const STATUS_KEY = 'kale-ide-context';
const STATUS_POLL_INTERVAL_MILLISECONDS = 300;

/**
 * Why: CodeMirror ranges are end-exclusive, so a range ending at column zero
 * does not select characters from its final line.
 */
export const countSelectedLines = (selection: EditorSelection) => {
  if (!selection.selectedText) {
    return 0;
  }

  const lineDifference = selection.range.end.line - selection.range.start.line;
  if (lineDifference === 0) {
    return 1;
  }

  return lineDifference + (selection.range.end.character === 0 ? 0 : 1);
};

/**
 * Why: JSON encoding preserves the exact selected text even when it contains
 * markdown fences, quotes, control characters, or trailing newlines.
 */
export const buildEditorContextMessage = (
  editorContext: EditorContextSnapshot,
) => {
  const messageLines = [
    'Kale editor context for this prompt:',
    `Active file: ${editorContext.activeFilePath ?? '(none)'}`,
  ];
  const selection = editorContext.selection;
  if (!selection?.selectedText) {
    messageLines.push('No text is selected.');
    return messageLines.join('\n');
  }

  messageLines.push(
    `Selected line count: ${countSelectedLines(selection)}`,
    `Editor range (0-based, end-exclusive): ${selection.range.start.line}:${selection.range.start.character} to ${selection.range.end.line}:${selection.range.end.character}`,
    'Exact selected text as a JSON string:',
    JSON.stringify(selection.selectedText),
    'Use this snapshot as the selection that was active when the user submitted the prompt.',
  );
  return messageLines.join('\n');
};

/**
 * Why: the footer gives the user immediate confirmation that Pi can see the
 * active Kale selection before the user submits a prompt.
 */
export const buildEditorContextStatusText = (
  editorContext: EditorContextSnapshot,
) => {
  const selectedLineCount = editorContext.selection
    ? countSelectedLines(editorContext.selection)
    : 0;
  if (selectedLineCount === 1) {
    return 'Kale: 1 line selected';
  }

  if (selectedLineCount > 1) {
    return `Kale: ${selectedLineCount} lines selected`;
  }

  return editorContext.activeFilePath
    ? 'Kale: no text selected'
    : 'Kale: no editor context';
};

/**
 * Why: validating the local response prevents malformed or unrelated HTTP
 * content from becoming a hidden message in the agent conversation.
 */
const isEditorContextSnapshot = (
  candidateValue: unknown,
): candidateValue is EditorContextSnapshot => {
  if (typeof candidateValue !== 'object' || candidateValue === null) {
    return false;
  }

  const candidateContext = candidateValue as Partial<EditorContextSnapshot>;
  if (
    candidateContext.activeFilePath !== null &&
    typeof candidateContext.activeFilePath !== 'string'
  ) {
    return false;
  }

  if (candidateContext.selection === null) {
    return true;
  }

  const selection = candidateContext.selection;
  return Boolean(
    selection &&
    typeof selection.filePath === 'string' &&
    typeof selection.selectedText === 'string' &&
    Number.isInteger(selection.range?.start?.line) &&
    Number.isInteger(selection.range?.start?.character) &&
    Number.isInteger(selection.range?.end?.line) &&
    Number.isInteger(selection.range?.end?.character),
  );
};

/**
 * Why: Kale supplies transport details only to its Pi child process, so the
 * extension fails clearly if it is loaded outside that managed session.
 */
const readContextTransportConfiguration = (): ContextTransportConfiguration => {
  const editorContextUrl =
    process.env[EDITOR_CONTEXT_URL_ENVIRONMENT_VARIABLE]?.trim() ?? '';
  const authToken = process.env[AUTH_TOKEN_ENVIRONMENT_VARIABLE]?.trim() ?? '';
  if (!editorContextUrl || !authToken) {
    throw new Error('Kale IDE context transport is not configured.');
  }

  return { editorContextUrl, authToken };
};

/**
 * Why: each prompt and status refresh must read a new no-cache snapshot so Pi
 * never relies on the selection that was active when the terminal started.
 */
const fetchCurrentEditorContext = async () => {
  const transportConfiguration = readContextTransportConfiguration();
  const response = await fetch(transportConfiguration.editorContextUrl, {
    headers: {
      [AUTHORIZATION_HEADER]: transportConfiguration.authToken,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Kale IDE context request failed with ${response.status}.`);
  }

  const responseBody: unknown = await response.json();
  if (!isEditorContextSnapshot(responseBody)) {
    throw new Error('Kale IDE context response is invalid.');
  }

  return responseBody;
};

/**
 * Why: Pi has no native Kale integration, so this extension adds live footer
 * status and fresh editor context to the system prompt for each agent turn.
 */
export default function registerKaleIdeContextExtension(pi: PiExtensionApi) {
  let isSessionActive = false;
  let isStatusRefreshInProgress = false;
  let statusPollingTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Why: status polling is best-effort and must never stop normal Pi prompts if
   * Kale is closing or its local context service is briefly unavailable.
   */
  const refreshFooterStatus = async (context: PiExtensionContext) => {
    if (!isSessionActive || !context.hasUI || isStatusRefreshInProgress) {
      return;
    }

    isStatusRefreshInProgress = true;
    try {
      const editorContext = await fetchCurrentEditorContext();
      if (isSessionActive) {
        context.ui.setStatus(
          STATUS_KEY,
          buildEditorContextStatusText(editorContext),
        );
      }
    } catch {
      if (isSessionActive) {
        context.ui.setStatus(STATUS_KEY, 'Kale: context unavailable');
      }
    } finally {
      isStatusRefreshInProgress = false;
    }
  };

  /**
   * Why: footer polling starts with each Pi session so the visible count tracks
   * later Kale selections without adding messages to the conversation.
   */
  pi.on('session_start', async (_event, context) => {
    isSessionActive = true;
    await refreshFooterStatus(context);
    statusPollingTimer = setInterval(() => {
      void refreshFooterStatus(context);
    }, STATUS_POLL_INTERVAL_MILLISECONDS);
    statusPollingTimer.unref?.();
  });

  /**
   * Why: session-scoped cleanup prevents stale extension contexts and timers
   * from surviving Pi reload, resume, and exit flows.
   */
  pi.on('session_shutdown', (_event, context) => {
    isSessionActive = false;
    if (statusPollingTimer) {
      clearInterval(statusPollingTimer);
      statusPollingTimer = null;
    }
    if (context.hasUI) {
      context.ui.setStatus(STATUS_KEY, undefined);
    }
  });

  /**
   * Why: prompt-time fetching makes the hidden context match the selection the
   * user saw when they pressed Enter, independent of the footer poll timing.
   */
  pi.on('before_agent_start', async (event, context) => {
    try {
      if (
        typeof event !== 'object' ||
        event === null ||
        !('systemPrompt' in event) ||
        typeof event.systemPrompt !== 'string'
      ) {
        throw new Error('Pi did not provide its current system prompt.');
      }

      const editorContext = await fetchCurrentEditorContext();
      if (context.hasUI) {
        context.ui.setStatus(
          STATUS_KEY,
          buildEditorContextStatusText(editorContext),
        );
      }
      return {
        systemPrompt: `${event.systemPrompt}\n\n${buildEditorContextMessage(editorContext)}`,
      };
    } catch {
      if (context.hasUI) {
        context.ui.setStatus(STATUS_KEY, 'Kale: context unavailable');
      }
    }
  });
}
