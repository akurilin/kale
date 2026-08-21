import type { EditorSelectionDetails } from './MarkdownEditorPane';
import {
  findInlineCommentTextPayloadRangeInMarkdown,
  parseInlineCommentsFromMarkdown,
} from './inline-comments';

/**
 * Why: IDE selection ranges use line and character coordinates, while inline
 * comment parsing uses absolute source offsets that are easier to edit safely.
 */
const convertDocumentOffsetToLineAndCharacter = (
  markdownContent: string,
  documentOffset: number,
): { line: number; character: number } => {
  const contentBeforeOffset = markdownContent.slice(0, documentOffset);
  const lastLineBreakOffset = contentBeforeOffset.lastIndexOf('\n');
  const line = contentBeforeOffset.split('\n').length - 1;

  return {
    line,
    character:
      lastLineBreakOffset < 0
        ? documentOffset
        : documentOffset - lastLineBreakOffset - 1,
  };
};

/**
 * Why: focusing a comment must give agents the complete decoded comment text
 * through the same source-based selection contract used for selected prose.
 */
export const buildInlineCommentIdeSelectionDetails = (
  markdownContent: string,
  commentId: string,
): EditorSelectionDetails | null => {
  const targetComment = parseInlineCommentsFromMarkdown(markdownContent).find(
    (comment) => comment.id === commentId,
  );
  const payloadRange = findInlineCommentTextPayloadRangeInMarkdown(
    markdownContent,
    commentId,
  );
  if (!targetComment || !payloadRange) {
    return null;
  }

  return {
    selectedText: targetComment.text,
    range: {
      start: convertDocumentOffsetToLineAndCharacter(
        markdownContent,
        payloadRange.payloadFrom,
      ),
      end: convertDocumentOffsetToLineAndCharacter(
        markdownContent,
        payloadRange.payloadTo,
      ),
    },
  };
};
