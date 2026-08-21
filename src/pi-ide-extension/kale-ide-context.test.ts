import { afterEach, describe, expect, it, vi } from 'vitest';

import registerKaleIdeContextExtension, {
  buildEditorContextMessage,
  buildEditorContextStatusText,
  countSelectedLines,
} from '../../integrations/pi/kale-ide-context';

/**
 * Why: extension tests replace process values and fetch, so cleanup prevents
 * the prompt-time transport setup from leaking into other unit tests.
 */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('countSelectedLines', () => {
  it('counts all lines that contain selected characters', () => {
    expect(
      countSelectedLines({
        filePath: '/drafts/essay.md',
        selectedText: 'alpha\nbeta\ngamma',
        range: {
          start: { line: 2, character: 3 },
          end: { line: 4, character: 5 },
        },
      }),
    ).toBe(3);
  });

  it('does not count the end line when the end-exclusive range stops at column zero', () => {
    expect(
      countSelectedLines({
        filePath: '/drafts/essay.md',
        selectedText: 'alpha\nbeta\n',
        range: {
          start: { line: 2, character: 0 },
          end: { line: 4, character: 0 },
        },
      }),
    ).toBe(2);
  });
});

describe('buildEditorContextMessage', () => {
  it('gives Pi the exact prompt-time text, range, and selected line count', () => {
    expect(
      buildEditorContextMessage({
        activeFilePath: '/drafts/essay.md',
        selection: {
          filePath: '/drafts/essay.md',
          selectedText: 'alpha\n```\nomega',
          range: {
            start: { line: 9, character: 2 },
            end: { line: 11, character: 5 },
          },
        },
      }),
    ).toBe(
      [
        'Kale editor context for this prompt:',
        'Active file: /drafts/essay.md',
        'Selected line count: 3',
        'Editor range (0-based, end-exclusive): 9:2 to 11:5',
        'Exact selected text as a JSON string:',
        '"alpha\\n```\\nomega"',
        'Use this snapshot as the selection that was active when the user submitted the prompt.',
      ].join('\n'),
    );
  });

  it('states that no text is selected while preserving the active file', () => {
    expect(
      buildEditorContextMessage({
        activeFilePath: '/drafts/essay.md',
        selection: null,
      }),
    ).toBe(
      [
        'Kale editor context for this prompt:',
        'Active file: /drafts/essay.md',
        'No text is selected.',
      ].join('\n'),
    );
  });
});

describe('buildEditorContextStatusText', () => {
  it('shows the live selected line count in the Pi footer', () => {
    expect(
      buildEditorContextStatusText({
        activeFilePath: '/drafts/essay.md',
        selection: {
          filePath: '/drafts/essay.md',
          selectedText: 'alpha\nbeta',
          range: {
            start: { line: 2, character: 0 },
            end: { line: 3, character: 4 },
          },
        },
      }),
    ).toBe('Kale: 2 lines selected');
  });
});

describe('registerKaleIdeContextExtension', () => {
  it('adds a fresh editor snapshot only to the next Pi system prompt', async () => {
    type PiExtensionApi = Parameters<typeof registerKaleIdeContextExtension>[0];
    type PiEventHandler = Parameters<PiExtensionApi['on']>[1];
    const registeredHandlers = new Map<string, PiEventHandler>();
    const piExtensionApi: PiExtensionApi = {
      on: (eventName, handler) => {
        registeredHandlers.set(eventName, handler);
      },
    };
    const setStatus = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          activeFilePath: '/drafts/essay.md',
          selection: {
            filePath: '/drafts/essay.md',
            selectedText: 'alpha\nbeta',
            range: {
              start: { line: 1, character: 0 },
              end: { line: 2, character: 4 },
            },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubEnv(
      'KALE_PI_EDITOR_CONTEXT_URL',
      'http://127.0.0.1:43210/editor-context',
    );
    vi.stubEnv('KALE_PI_IDE_AUTH_TOKEN', 'test-token');
    vi.stubGlobal('fetch', fetchMock);
    registerKaleIdeContextExtension(piExtensionApi);

    const beforeAgentStartHandler =
      registeredHandlers.get('before_agent_start');
    expect(beforeAgentStartHandler).toBeDefined();
    const result = await beforeAgentStartHandler?.(
      { systemPrompt: 'Base Pi system prompt' },
      { hasUI: true, ui: { setStatus } },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:43210/editor-context',
      {
        headers: { 'x-kale-ide-authorization': 'test-token' },
        cache: 'no-store',
      },
    );
    expect(result).toEqual({
      systemPrompt: [
        'Base Pi system prompt',
        [
          'Kale editor context for this prompt:',
          'Active file: /drafts/essay.md',
          'Selected line count: 2',
          'Editor range (0-based, end-exclusive): 1:0 to 2:4',
          'Exact selected text as a JSON string:',
          '"alpha\\nbeta"',
          'Use this snapshot as the selection that was active when the user submitted the prompt.',
        ].join('\n'),
      ].join('\n\n'),
    });
    expect(setStatus).toHaveBeenCalledWith(
      'kale-ide-context',
      'Kale: 2 lines selected',
    );
  });
});
