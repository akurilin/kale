import { describe, expect, it } from 'vitest';

import { buildPiEditorContextSnapshot } from './context';

describe('buildPiEditorContextSnapshot', () => {
  it('keeps a selection that belongs to the active file', () => {
    const selection = {
      filePath: '/drafts/current.md',
      selectedText: 'Current text',
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 12 },
      },
    };

    expect(
      buildPiEditorContextSnapshot('/drafts/current.md', selection),
    ).toEqual({
      activeFilePath: '/drafts/current.md',
      selection,
    });
  });

  it('removes a cached selection that belongs to a different file', () => {
    expect(
      buildPiEditorContextSnapshot('/drafts/current.md', {
        filePath: '/drafts/previous.md',
        selectedText: 'Old text',
        range: {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 8 },
        },
      }),
    ).toEqual({
      activeFilePath: '/drafts/current.md',
      selection: null,
    });
  });
});
