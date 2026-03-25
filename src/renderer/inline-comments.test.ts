import { describe, expect, it } from 'vitest';

import {
  findInlineCommentIdForDocumentClick,
  findInlineCommentIdContainingDocumentPosition,
  parseInlineCommentsFromMarkdown,
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
