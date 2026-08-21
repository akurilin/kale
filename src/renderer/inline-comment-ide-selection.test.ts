import { describe, expect, it } from 'vitest';

import {
  createInlineCommentEndMarker,
  createInlineCommentStartMarker,
  encodeInlineCommentTextForMarker,
} from './inline-comments';
import { buildInlineCommentIdeSelectionDetails } from './inline-comment-ide-selection';

describe('buildInlineCommentIdeSelectionDetails', () => {
  it('maps ordinary comment text to its encoded marker payload range', () => {
    const commentId = 'c_claim';
    const commentText = 'Check this claim.';
    const encodedCommentText = encodeInlineCommentTextForMarker(commentText);
    const linePrefix = `Before <!-- @comment:${commentId} start | `;
    const markdownContent = [
      '# Heading',
      `${linePrefix}${encodedCommentText} -->claim${createInlineCommentEndMarker(commentId)} after`,
    ].join('\n');

    expect(
      buildInlineCommentIdeSelectionDetails(markdownContent, commentId),
    ).toEqual({
      selectedText: commentText,
      range: {
        start: { line: 1, character: linePrefix.length },
        end: {
          line: 1,
          character: linePrefix.length + encodedCommentText.length,
        },
      },
    });
  });

  it('decodes JSON-escaped multiline comment text while spanning its encoded payload', () => {
    const commentId = 'c_multiline';
    const commentText = 'First line\nSecond "quoted" line -- verify.';
    const encodedCommentText = encodeInlineCommentTextForMarker(commentText);
    const firstLine = 'Paragraph before the comment.';
    const secondLinePrefix = '  ';
    const startMarker = createInlineCommentStartMarker(commentId, commentText);
    const markdownContent = [
      firstLine,
      `${secondLinePrefix}${startMarker}target${createInlineCommentEndMarker(commentId)}`,
    ].join('\n');
    const payloadCharacter =
      secondLinePrefix.length + startMarker.indexOf(encodedCommentText);

    expect(
      buildInlineCommentIdeSelectionDetails(markdownContent, commentId),
    ).toEqual({
      selectedText: commentText,
      range: {
        start: { line: 1, character: payloadCharacter },
        end: {
          line: 1,
          character: payloadCharacter + encodedCommentText.length,
        },
      },
    });
  });

  it('returns null when the requested comment id is missing', () => {
    const markdownContent =
      'Text <!-- @comment:c_present start | "Present" -->target<!-- @comment:c_present end -->';

    expect(
      buildInlineCommentIdeSelectionDetails(markdownContent, 'c_missing'),
    ).toBeNull();
  });
});
