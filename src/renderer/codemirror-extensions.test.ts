import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';

import {
  buildInlineCommentAwareSelectionDeletionUpdateForState,
  buildMarkdownHeadingShortcutChangesForState,
  buildLivePreviewDecorationInstructionsForState,
  buildMarkdownFormattingToggleSelectionUpdate,
} from './codemirror-extensions';
import {
  createInlineCommentEndMarker,
  createInlineCommentStartMarker,
  parseInlineCommentsFromMarkdown,
} from './inline-comments';

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

// Heading shortcut tests should assert final text after line-level rewrites, so
// this helper applies the exported heading-change spec to an immutable state.
const applyMarkdownHeadingShortcutToState = (
  initialState: EditorState,
  headingLevel: number,
): EditorState =>
  initialState.update({
    changes: buildMarkdownHeadingShortcutChangesForState(
      initialState,
      headingLevel,
    ),
  }).state;

/**
 * Why: comment-selection tests should exercise the same transaction update
 * that the Backspace and Delete key handlers dispatch in the editor.
 */
const applyInlineCommentAwareSelectionDeletionToState = (
  initialState: EditorState,
): EditorState => {
  const deletionUpdate =
    buildInlineCommentAwareSelectionDeletionUpdateForState(initialState);
  expect(deletionUpdate).not.toBeNull();
  return initialState.update(deletionUpdate ?? {}).state;
};

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

describe('buildInlineCommentAwareSelectionDeletionUpdateForState', () => {
  const commentId = 'c_selection_delete';
  const commentText = 'The comment must follow its anchor.';
  const anchoredText = 'Delete this paragraph';
  const startMarker = createInlineCommentStartMarker(commentId, commentText);
  const endMarker = createInlineCommentEndMarker(commentId);
  const markdownContent = `Before\n\n${startMarker}${anchoredText}${endMarker}\n\nAfter`;

  /**
   * Why: each case needs source coordinates from the production parser so the
   * tests remain correct if the marker format changes.
   */
  const buildSelectionState = (
    selectionFrom: number,
    selectionTo: number,
  ): EditorState =>
    EditorState.create({
      doc: markdownContent,
      selection: EditorSelection.range(selectionFrom, selectionTo),
    });

  it('removes both markers when the selection covers all anchored text', () => {
    const [inlineComment] = parseInlineCommentsFromMarkdown(markdownContent);
    const nextState = applyInlineCommentAwareSelectionDeletionToState(
      buildSelectionState(inlineComment.contentFrom, inlineComment.contentTo),
    );

    expect(nextState.doc.toString()).toBe('Before\n\n\n\nAfter');
    expect(parseInlineCommentsFromMarkdown(nextState.doc.toString())).toEqual(
      [],
    );
  });

  it.each([
    {
      selectedMarker: 'start',
      getSelection: (
        inlineComment: ReturnType<
          typeof parseInlineCommentsFromMarkdown
        >[number],
      ) => ({
        from: inlineComment.startMarkerFrom,
        to: inlineComment.contentTo,
      }),
    },
    {
      selectedMarker: 'end',
      getSelection: (
        inlineComment: ReturnType<
          typeof parseInlineCommentsFromMarkdown
        >[number],
      ) => ({
        from: inlineComment.contentFrom,
        to: inlineComment.endMarkerTo,
      }),
    },
  ])(
    'removes the complete pair when the full anchor and $selectedMarker marker are selected',
    ({ getSelection }) => {
      const [inlineComment] = parseInlineCommentsFromMarkdown(markdownContent);
      const selection = getSelection(inlineComment);
      const nextState = applyInlineCommentAwareSelectionDeletionToState(
        buildSelectionState(selection.from, selection.to),
      );

      expect(nextState.doc.toString()).toBe('Before\n\n\n\nAfter');
      expect(parseInlineCommentsFromMarkdown(nextState.doc.toString())).toEqual(
        [],
      );
    },
  );

  it.each([
    {
      selectedMarker: 'start',
      getSelection: (
        inlineComment: ReturnType<
          typeof parseInlineCommentsFromMarkdown
        >[number],
      ) => ({
        from: inlineComment.startMarkerFrom + 1,
        to: inlineComment.startMarkerTo - 1,
        expectedCursor: inlineComment.startMarkerFrom,
      }),
    },
    {
      selectedMarker: 'end',
      getSelection: (
        inlineComment: ReturnType<
          typeof parseInlineCommentsFromMarkdown
        >[number],
      ) => ({
        from: inlineComment.endMarkerFrom + 1,
        to: inlineComment.endMarkerTo - 1,
        expectedCursor: inlineComment.endMarkerFrom,
      }),
    },
  ])(
    'consumes a $selectedMarker marker-only selection without changing the document',
    ({ getSelection }) => {
      const [inlineComment] = parseInlineCommentsFromMarkdown(markdownContent);
      const selection = getSelection(inlineComment);
      const nextState = applyInlineCommentAwareSelectionDeletionToState(
        buildSelectionState(selection.from, selection.to),
      );

      expect(nextState.doc.toString()).toBe(markdownContent);
      expect(nextState.selection.main.empty).toBe(true);
      expect(nextState.selection.main.from).toBe(selection.expectedCursor);
      expect(parseInlineCommentsFromMarkdown(nextState.doc.toString())).toEqual(
        [inlineComment],
      );
    },
  );

  it('protects a marker-only selection when the comment anchor is empty', () => {
    const emptyAnchorMarkdownContent = `${startMarker}${endMarker}`;
    const [emptyInlineComment] = parseInlineCommentsFromMarkdown(
      emptyAnchorMarkdownContent,
    );
    const initialState = EditorState.create({
      doc: emptyAnchorMarkdownContent,
      selection: EditorSelection.range(
        emptyInlineComment.startMarkerFrom + 1,
        emptyInlineComment.startMarkerTo - 1,
      ),
    });
    const nextState =
      applyInlineCommentAwareSelectionDeletionToState(initialState);

    expect(nextState.doc.toString()).toBe(emptyAnchorMarkdownContent);
    expect(nextState.selection.main.from).toBe(
      emptyInlineComment.startMarkerFrom,
    );
    expect(parseInlineCommentsFromMarkdown(nextState.doc.toString())).toEqual([
      emptyInlineComment,
    ]);
  });

  it('preserves both markers when only part of the anchor is selected', () => {
    const [inlineComment] = parseInlineCommentsFromMarkdown(markdownContent);
    const nextState = applyInlineCommentAwareSelectionDeletionToState(
      buildSelectionState(
        inlineComment.contentFrom,
        inlineComment.contentFrom + 'Delete '.length,
      ),
    );

    const [remainingComment] = parseInlineCommentsFromMarkdown(
      nextState.doc.toString(),
    );
    expect(nextState.doc.toString()).toContain(startMarker);
    expect(nextState.doc.toString()).toContain(endMarker);
    expect(
      nextState.sliceDoc(
        remainingComment.contentFrom,
        remainingComment.contentTo,
      ),
    ).toBe('this paragraph');
    expect(nextState.selection.main.from).toBe(inlineComment.contentFrom);
    expect(nextState.selection.main.empty).toBe(true);
  });

  it.each([
    {
      selectedMarker: 'start',
      getSelection: (
        inlineComment: ReturnType<
          typeof parseInlineCommentsFromMarkdown
        >[number],
      ) => ({
        from: inlineComment.startMarkerFrom,
        to: inlineComment.contentFrom + 'Delete '.length,
      }),
      expectedAnchor: 'this paragraph',
    },
    {
      selectedMarker: 'end',
      getSelection: (
        inlineComment: ReturnType<
          typeof parseInlineCommentsFromMarkdown
        >[number],
      ) => ({
        from: inlineComment.contentFrom + 'Delete '.length,
        to: inlineComment.endMarkerTo,
      }),
      expectedAnchor: 'Delete ',
    },
  ])(
    'preserves the $selectedMarker marker when only part of the anchor is selected',
    ({ getSelection, expectedAnchor }) => {
      const [inlineComment] = parseInlineCommentsFromMarkdown(markdownContent);
      const selection = getSelection(inlineComment);
      const nextState = applyInlineCommentAwareSelectionDeletionToState(
        buildSelectionState(selection.from, selection.to),
      );

      const [remainingComment] = parseInlineCommentsFromMarkdown(
        nextState.doc.toString(),
      );
      expect(nextState.doc.toString()).toContain(startMarker);
      expect(nextState.doc.toString()).toContain(endMarker);
      expect(
        nextState.sliceDoc(
          remainingComment.contentFrom,
          remainingComment.contentTo,
        ),
      ).toBe(expectedAnchor);
    },
  );
});

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

describe('buildMarkdownHeadingShortcutChangesForState', () => {
  it('converts the cursor line into the requested heading level', () => {
    const initialState = EditorState.create({
      doc: 'hello world',
      selection: EditorSelection.cursor(4),
    });

    const nextState = applyMarkdownHeadingShortcutToState(initialState, 2);

    expect(nextState.doc.toString()).toBe('## hello world');
  });

  it('replaces an existing heading level while preserving indentation', () => {
    const initialState = EditorState.create({
      doc: '  #### Nested title',
      selection: EditorSelection.cursor(10),
    });

    const nextState = applyMarkdownHeadingShortcutToState(initialState, 3);

    expect(nextState.doc.toString()).toBe('  ### Nested title');
  });

  it('applies heading conversion across all lines touched by selection', () => {
    const initialState = EditorState.create({
      doc: 'alpha\nbeta\ngamma',
      selection: EditorSelection.range(1, 12),
    });

    const nextState = applyMarkdownHeadingShortcutToState(initialState, 4);

    expect(nextState.doc.toString()).toBe('#### alpha\n#### beta\n#### gamma');
  });

  it('does not include the next line when selection ends at line start', () => {
    const initialState = EditorState.create({
      doc: 'first\nsecond\nthird',
      selection: EditorSelection.range(0, 6),
    });

    const nextState = applyMarkdownHeadingShortcutToState(initialState, 1);

    expect(nextState.doc.toString()).toBe('# first\nsecond\nthird');
  });
});

describe('buildLivePreviewDecorationInstructionsForState', () => {
  it.each(['-', '*', '+'])(
    'renders the %s unordered list source marker as a bullet on an inactive line',
    (unorderedListMarker) => {
      const markdownEditorState = buildMarkdownEditorStateWithCursor(
        `${unorderedListMarker} tldr\nSecond line`,
        8,
      );

      expect(
        buildLivePreviewDecorationInstructionsForState(markdownEditorState),
      ).toContainEqual({
        type: 'replaceWithText',
        from: 0,
        to: 1,
        text: '•',
        className: 'cm-live-list-bullet',
        accessibleLabel: 'bullet',
      });
    },
  );

  it('keeps an unordered list source marker editable on the active line', () => {
    const markdownEditorState = buildMarkdownEditorStateWithCursor(
      '- tldr\nSecond line',
      3,
    );

    expect(
      buildLivePreviewDecorationInstructionsForState(markdownEditorState),
    ).not.toContainEqual(
      expect.objectContaining({ type: 'replaceWithText', from: 0, to: 1 }),
    );
  });

  it('does not replace ordered list markers with unordered bullets', () => {
    const markdownEditorState = buildMarkdownEditorStateWithCursor(
      '1. first\nSecond line',
      10,
    );

    expect(
      buildLivePreviewDecorationInstructionsForState(markdownEditorState),
    ).not.toContainEqual(
      expect.objectContaining({ type: 'replaceWithText', from: 0, to: 2 }),
    );
  });

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
