import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';

import {
  buildLivePreviewDecorationInstructionsForState,
  buildMarkdownFormattingToggleSelectionUpdate,
} from './codemirror-extensions';

const markdownStrongFormattingMarker = '**';
const markdownEmphasisFormattingMarker = '*';

// Tests should assert final doc/selection behavior, so this helper applies one
// formatting-toggle update and returns the resulting immutable state snapshot.
const applyMarkdownFormattingToggleToState = (
  initialState: EditorState,
  markdownMarker: string,
): EditorState =>
  initialState.update(
    buildMarkdownFormattingToggleSelectionUpdate(initialState, markdownMarker),
  ).state;

// Selection assertions are easier to read when each test can ask for the
// selected text directly from the final state.
const readMainSelectionText = (editorState: EditorState): string => {
  const { main } = editorState.selection;
  const selectionFrom = Math.min(main.from, main.to);
  const selectionTo = Math.max(main.from, main.to);
  return editorState.sliceDoc(selectionFrom, selectionTo);
};

// Live-preview tests need deterministic parse trees, so this helper builds a
// markdown-backed editor state with a cursor at the specified character index.
const buildMarkdownEditorStateWithCursor = (
  markdownContent: string,
  cursorPos: number,
): EditorState =>
  EditorState.create({
    doc: markdownContent,
    selection: EditorSelection.cursor(cursorPos),
    extensions: [markdown()],
  });

// Replace decorations hide markdown control syntax, so this helper applies the
// replacement ranges and returns the text that remains visibly rendered.
const renderVisibleLivePreviewTextFromState = (
  markdownEditorState: EditorState,
): string => {
  const replaceInstructions = buildLivePreviewDecorationInstructionsForState(
    markdownEditorState,
  )
    .filter(
      (
        instruction,
      ): instruction is { type: 'replace'; from: number; to: number } =>
        instruction.type === 'replace',
    )
    .sort(
      (instructionA, instructionB) => instructionA.from - instructionB.from,
    );
  const sourceText = markdownEditorState.doc.toString();
  let nextVisibleSliceFrom = 0;
  let visibleText = '';

  for (const replaceInstruction of replaceInstructions) {
    visibleText += sourceText.slice(
      nextVisibleSliceFrom,
      replaceInstruction.from,
    );
    nextVisibleSliceFrom = Math.max(
      nextVisibleSliceFrom,
      replaceInstruction.to,
    );
  }

  visibleText += sourceText.slice(nextVisibleSliceFrom);
  return visibleText;
};

// Link visual-cue assertions should read plain ranges, so this helper extracts
// only link-label mark decorations from the instruction list.
const listLivePreviewLinkLabelMarkRanges = (
  markdownEditorState: EditorState,
): Array<{ from: number; to: number }> =>
  buildLivePreviewDecorationInstructionsForState(markdownEditorState)
    .filter(
      (
        instruction,
      ): instruction is {
        type: 'mark';
        from: number;
        to: number;
        className: string;
      } =>
        instruction.type === 'mark' &&
        instruction.className === 'cm-live-link-label',
    )
    .map((instruction) => ({ from: instruction.from, to: instruction.to }));

describe('buildMarkdownFormattingToggleSelectionUpdate', () => {
  it('wraps a non-empty selection with strong markdown markers', () => {
    const initialState = EditorState.create({
      doc: 'hello world',
      selection: EditorSelection.range(6, 11),
    });

    const nextState = applyMarkdownFormattingToggleToState(
      initialState,
      markdownStrongFormattingMarker,
    );

    expect(nextState.doc.toString()).toBe('hello **world**');
    expect(readMainSelectionText(nextState)).toBe('world');
    expect(nextState.selection.main.from).toBe(8);
    expect(nextState.selection.main.to).toBe(13);
  });

  it('unwraps strong markers when the selection is already wrapped', () => {
    const initialState = EditorState.create({
      doc: 'hello **world**',
      selection: EditorSelection.range(8, 13),
    });

    const nextState = applyMarkdownFormattingToggleToState(
      initialState,
      markdownStrongFormattingMarker,
    );

    expect(nextState.doc.toString()).toBe('hello world');
    expect(readMainSelectionText(nextState)).toBe('world');
    expect(nextState.selection.main.from).toBe(6);
    expect(nextState.selection.main.to).toBe(11);
  });

  it('inserts paired emphasis markers for an empty selection', () => {
    const initialState = EditorState.create({
      doc: 'hello',
      selection: EditorSelection.cursor(5),
    });

    const nextState = applyMarkdownFormattingToggleToState(
      initialState,
      markdownEmphasisFormattingMarker,
    );

    expect(nextState.doc.toString()).toBe('hello**');
    expect(nextState.selection.main.from).toBe(6);
    expect(nextState.selection.main.to).toBe(6);
  });

  it('preserves reverse selection direction after wrapping', () => {
    const initialState = EditorState.create({
      doc: 'alpha beta',
      selection: EditorSelection.range(10, 6),
    });

    const nextState = applyMarkdownFormattingToggleToState(
      initialState,
      markdownStrongFormattingMarker,
    );

    expect(nextState.doc.toString()).toBe('alpha **beta**');
    expect(readMainSelectionText(nextState)).toBe('beta');
    expect(nextState.selection.main.anchor).toBe(12);
    expect(nextState.selection.main.head).toBe(8);
  });

  it('maps multiple selection ranges in a single toggle transaction', () => {
    const initialState = EditorState.create({
      doc: 'alpha beta',
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create(
        [EditorSelection.range(0, 5), EditorSelection.range(6, 10)],
        1,
      ),
    });

    const nextState = applyMarkdownFormattingToggleToState(
      initialState,
      markdownStrongFormattingMarker,
    );

    expect(nextState.doc.toString()).toBe('**alpha** **beta**');
    expect(nextState.selection.ranges[0].from).toBe(2);
    expect(nextState.selection.ranges[0].to).toBe(7);
    expect(nextState.selection.ranges[1].from).toBe(12);
    expect(nextState.selection.ranges[1].to).toBe(16);
  });
});

describe('buildLivePreviewDecorationInstructionsForState', () => {
  it('conceals standard inline link syntax on inactive lines', () => {
    const markdownEditorState = buildMarkdownEditorStateWithCursor(
      '[Google](https://google.com)\nSecond line',
      31,
    );

    expect(renderVisibleLivePreviewTextFromState(markdownEditorState)).toBe(
      'Google\nSecond line',
    );
    expect(listLivePreviewLinkLabelMarkRanges(markdownEditorState)).toEqual([
      { from: 1, to: 7 },
    ]);
  });

  it('restores raw inline link markdown when the cursor is on that line', () => {
    const markdownEditorState = buildMarkdownEditorStateWithCursor(
      '[Google](https://google.com)\nSecond line',
      3,
    );

    expect(renderVisibleLivePreviewTextFromState(markdownEditorState)).toBe(
      '[Google](https://google.com)\nSecond line',
    );
    expect(listLivePreviewLinkLabelMarkRanges(markdownEditorState)).toEqual([]);
  });

  it('conceals Hugo shortcode destinations and keeps the link label visible', () => {
    const markdownEditorState = buildMarkdownEditorStateWithCursor(
      '[Post]({{< ref "post.md" >}})\nSecond line',
      33,
    );

    expect(renderVisibleLivePreviewTextFromState(markdownEditorState)).toBe(
      'Post\nSecond line',
    );
    expect(listLivePreviewLinkLabelMarkRanges(markdownEditorState)).toEqual([
      { from: 1, to: 5 },
    ]);
  });

  it('conceals autolink angle brackets while preserving URL text', () => {
    const markdownEditorState = buildMarkdownEditorStateWithCursor(
      '<https://example.com>\nSecond line',
      22,
    );

    expect(renderVisibleLivePreviewTextFromState(markdownEditorState)).toBe(
      'https://example.com\nSecond line',
    );
    expect(listLivePreviewLinkLabelMarkRanges(markdownEditorState)).toEqual([
      { from: 1, to: 20 },
    ]);
  });

  it('leaves bracketed prose without destinations unchanged', () => {
    const markdownEditorState = buildMarkdownEditorStateWithCursor(
      'Array index [0] should stay visible',
      0,
    );

    expect(renderVisibleLivePreviewTextFromState(markdownEditorState)).toBe(
      'Array index [0] should stay visible',
    );
    expect(listLivePreviewLinkLabelMarkRanges(markdownEditorState)).toEqual([]);
  });
});
