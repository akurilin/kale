import { describe, expect, it } from 'vitest';

import {
  acceptInlineSuggestionInMarkdown,
  createInlineCommentEndMarker,
  createInlineSuggestionStartMarker,
  findInlineCommentIdForDocumentClick,
  findInlineCommentIdContainingDocumentPosition,
  parseInlineCommentsFromMarkdown,
  removeInlineCommentMarkersFromMarkdown,
} from './inline-comments';

const markdownWithSingleInlineComment =
  'Leading prose <!-- @comment:c_boundary start | "" -->BoundaryTarget<!-- @comment:c_boundary end --> trailing prose';

describe('findInlineCommentIdContainingDocumentPosition', () => {
  it('returns the comment id for positions inside the commented prose', () => {
    const [inlineComment] = parseInlineCommentsFromMarkdown(
      markdownWithSingleInlineComment,
    );

    expect(
      findInlineCommentIdContainingDocumentPosition(
        markdownWithSingleInlineComment,
        inlineComment.contentFrom,
      ),
    ).toBe(inlineComment.id);
    expect(
      findInlineCommentIdContainingDocumentPosition(
        markdownWithSingleInlineComment,
        inlineComment.contentTo - 1,
      ),
    ).toBe(inlineComment.id);
  });

  it('treats the comment end boundary as outside the comment', () => {
    const [inlineComment] = parseInlineCommentsFromMarkdown(
      markdownWithSingleInlineComment,
    );

    expect(
      findInlineCommentIdContainingDocumentPosition(
        markdownWithSingleInlineComment,
        inlineComment.contentTo,
      ),
    ).toBeNull();
  });
});

describe('findInlineCommentIdForDocumentClick', () => {
  it('treats the comment start boundary as inside when clicked from the right', () => {
    const [inlineComment] = parseInlineCommentsFromMarkdown(
      markdownWithSingleInlineComment,
    );

    expect(
      findInlineCommentIdForDocumentClick(
        markdownWithSingleInlineComment,
        inlineComment.contentFrom,
        1,
      ),
    ).toBe(inlineComment.id);
  });

  it('treats the comment start boundary as outside when clicked from the left', () => {
    const [inlineComment] = parseInlineCommentsFromMarkdown(
      markdownWithSingleInlineComment,
    );

    expect(
      findInlineCommentIdForDocumentClick(
        markdownWithSingleInlineComment,
        inlineComment.contentFrom,
        -1,
      ),
    ).toBeNull();
  });

  it('treats the comment end boundary as outside the comment', () => {
    const [inlineComment] = parseInlineCommentsFromMarkdown(
      markdownWithSingleInlineComment,
    );

    expect(
      findInlineCommentIdForDocumentClick(
        markdownWithSingleInlineComment,
        inlineComment.contentTo,
        -1,
      ),
    ).toBeNull();
  });
});

describe('inline suggestion payloads', () => {
  it('parses a valid replacement suggestion without changing its anchored text', () => {
    const suggestionId = 'c_replace';
    const originalText = 'The draft repeats the same point twice.';
    const replacementText = 'The draft repeats the point.';
    const startMarker = createInlineSuggestionStartMarker(suggestionId, {
      explanation: 'Remove repeated wording.',
      originalText,
      replacementText,
    });
    const markdownContent = `${startMarker}${originalText}${createInlineCommentEndMarker(suggestionId)}`;

    expect(parseInlineCommentsFromMarkdown(markdownContent)).toEqual([
      expect.objectContaining({
        id: suggestionId,
        kind: 'suggestion',
        explanation: 'Remove repeated wording.',
        originalText,
        replacementText,
        isStale: false,
      }),
    ]);
  });

  it('round-trips multiline suggestion text and HTML-comment delimiters safely', () => {
    const suggestionId = 'c_multiline_suggestion';
    const originalText = 'First line\nSecond -- line';
    const replacementText = 'First "clear" line\nSecond --> line';
    const startMarker = createInlineSuggestionStartMarker(suggestionId, {
      explanation: 'Clarify -- both lines.',
      originalText,
      replacementText,
    });
    const markdownContent = `${startMarker}${originalText}${createInlineCommentEndMarker(suggestionId)}`;
    const [suggestion] = parseInlineCommentsFromMarkdown(markdownContent);

    expect(startMarker).not.toContain('Clarify -- both lines.');
    expect(suggestion).toEqual(
      expect.objectContaining({
        kind: 'suggestion',
        explanation: 'Clarify -- both lines.',
        originalText,
        replacementText,
        isStale: false,
      }),
    );
  });

  it('marks a suggestion as stale when its anchored text changed', () => {
    const suggestionId = 'c_stale';
    const originalText = 'Original sentence.';
    const startMarker = createInlineSuggestionStartMarker(suggestionId, {
      explanation: 'Use a shorter sentence.',
      originalText,
      replacementText: 'Short sentence.',
    });
    const markdownContent = `${startMarker}User-edited sentence.${createInlineCommentEndMarker(suggestionId)}`;

    expect(parseInlineCommentsFromMarkdown(markdownContent)).toEqual([
      expect.objectContaining({
        kind: 'suggestion',
        isStale: true,
      }),
    ]);
  });
});

describe('inline suggestion resolution', () => {
  it('accepts a suggestion by replacing its complete marker range with the proposed text', () => {
    const suggestionId = 'c_accept';
    const originalText = 'A sentence with extra words.';
    const replacementText = 'A concise sentence.';
    const startMarker = createInlineSuggestionStartMarker(suggestionId, {
      explanation: 'Make the sentence concise.',
      originalText,
      replacementText,
    });
    const markdownContent = `Before ${startMarker}${originalText}${createInlineCommentEndMarker(suggestionId)} After`;

    expect(
      acceptInlineSuggestionInMarkdown(markdownContent, suggestionId),
    ).toBe(`Before ${replacementText} After`);
  });

  it('does not accept a stale suggestion', () => {
    const suggestionId = 'c_stale_accept';
    const startMarker = createInlineSuggestionStartMarker(suggestionId, {
      explanation: 'Replace the sentence.',
      originalText: 'Expected sentence.',
      replacementText: 'Replacement sentence.',
    });
    const markdownContent = `${startMarker}Changed sentence.${createInlineCommentEndMarker(suggestionId)}`;

    expect(
      acceptInlineSuggestionInMarkdown(markdownContent, suggestionId),
    ).toBeNull();
  });

  it('accepts insertion and deletion suggestions', () => {
    const insertionId = 'c_insert';
    const insertionStartMarker = createInlineSuggestionStartMarker(
      insertionId,
      {
        explanation: 'Add a transition.',
        originalText: '',
        replacementText: 'However, ',
      },
    );
    const insertionMarkdown = `${insertionStartMarker}${createInlineCommentEndMarker(insertionId)}the result changed.`;

    const deletionId = 'c_delete';
    const deletionStartMarker = createInlineSuggestionStartMarker(deletionId, {
      explanation: 'Remove filler.',
      originalText: 'very ',
      replacementText: '',
    });
    const deletionMarkdown = `This is ${deletionStartMarker}very ${createInlineCommentEndMarker(deletionId)}clear.`;

    expect(
      acceptInlineSuggestionInMarkdown(insertionMarkdown, insertionId),
    ).toBe('However, the result changed.');
    expect(acceptInlineSuggestionInMarkdown(deletionMarkdown, deletionId)).toBe(
      'This is clear.',
    );
  });

  it('rejects a suggestion by removing its markers and preserving the original text', () => {
    const suggestionId = 'c_reject';
    const originalText = 'Keep this sentence.';
    const startMarker = createInlineSuggestionStartMarker(suggestionId, {
      explanation: 'Propose different text.',
      originalText,
      replacementText: 'Use different text.',
    });
    const markdownContent = `Before ${startMarker}${originalText}${createInlineCommentEndMarker(suggestionId)} After`;

    expect(
      removeInlineCommentMarkersFromMarkdown(markdownContent, suggestionId),
    ).toBe(`Before ${originalText} After`);
  });
});
