import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { buildMarkdownFormattingToggleSelectionUpdate } from './codemirror-extensions';

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
