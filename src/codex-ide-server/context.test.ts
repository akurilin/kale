import { describe, expect, it } from 'vitest';

import { buildCodexIdeContext } from './context';

describe('buildCodexIdeContext', () => {
  it('includes the exact non-empty selection for the active file', () => {
    expect(
      buildCodexIdeContext({
        activeFilePath: '/tmp/kale-notes/draft.md',
        workspaceFolders: ['/tmp/kale-notes'],
        editorSelection: {
          filePath: '/tmp/kale-notes/draft.md',
          selectedText: 'Selected paragraph',
          range: {
            start: { line: 3, character: 2 },
            end: { line: 3, character: 20 },
          },
        },
      }),
    ).toEqual({
      activeFile: {
        label: 'draft.md',
        path: 'draft.md',
        fsPath: '/tmp/kale-notes/draft.md',
        selection: {
          start: { line: 3, character: 2 },
          end: { line: 3, character: 20 },
        },
        activeSelectionContent: 'Selected paragraph',
        selections: [
          {
            start: { line: 3, character: 2 },
            end: { line: 3, character: 20 },
          },
        ],
      },
      openTabs: [
        {
          label: 'draft.md',
          path: 'draft.md',
          fsPath: '/tmp/kale-notes/draft.md',
        },
      ],
    });
  });

  it('omits cursor and selection fields when no text is selected', () => {
    const ideContext = buildCodexIdeContext({
      activeFilePath: '/tmp/kale-notes/draft.md',
      workspaceFolders: ['/tmp/kale-notes'],
      editorSelection: {
        filePath: '/tmp/kale-notes/draft.md',
        selectedText: '',
        range: {
          start: { line: 9, character: 14 },
          end: { line: 9, character: 14 },
        },
      },
    });

    expect(ideContext).not.toHaveProperty('activeFile');
    expect(ideContext.openTabs).toEqual([
      {
        label: 'draft.md',
        path: 'draft.md',
        fsPath: '/tmp/kale-notes/draft.md',
      },
    ]);
  });

  it('does not attach a stale selection from a different file', () => {
    const ideContext = buildCodexIdeContext({
      activeFilePath: '/tmp/kale-notes/current.md',
      workspaceFolders: ['/tmp/kale-notes'],
      editorSelection: {
        filePath: '/tmp/kale-notes/previous.md',
        selectedText: 'Stale selection',
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 15 },
        },
      },
    });

    expect(ideContext).not.toHaveProperty('activeFile');
    expect(ideContext.openTabs).toEqual([
      {
        label: 'current.md',
        path: 'current.md',
        fsPath: '/tmp/kale-notes/current.md',
      },
    ]);
  });

  it('returns no active file or open tab before Kale opens a file', () => {
    expect(
      buildCodexIdeContext({
        activeFilePath: null,
        workspaceFolders: [],
        editorSelection: null,
      }),
    ).toEqual({ openTabs: [] });
  });
});
