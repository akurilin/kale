//
// This module centralizes the inline HTML comment marker format so the editor
// command logic, comment list UI, and decoration rendering stay in sync.
//

export type InlineComment = {
  id: string;
  text: string;
  contentFrom: number;
  contentTo: number;
  startMarkerFrom: number;
  startMarkerTo: number;
  endMarkerFrom: number;
  endMarkerTo: number;
};

type ParsedStartMarker = {
  id: string;
  fullFrom: number;
  fullTo: number;
  payloadFrom: number;
  payloadTo: number;
  text: string;
};

type ParsedEndMarker = {
  id: string;
  fullFrom: number;
  fullTo: number;
};

type MarkerToken = ParsedStartMarker | ParsedEndMarker;
type InlineCommentTextPayloadRange = {
  payloadFrom: number;
  payloadTo: number;
};

const INLINE_COMMENT_MARKER_PATTERN =
  /<!--\s*@comment:([A-Za-z0-9_-]+)\s+(start|end)(?:\s*\|\s*([\s\S]*?))?\s*-->/g;

/**
 * Why: random opaque IDs avoid user-managed numbering while still making start
 * and end markers pairable and recoverable after imperfect file edits.
 */
export const createInlineCommentId = (): string => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `c_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

/**
 * Why: comment text lives inside an HTML comment marker, so we encode it as a
 * JSON string literal and neutralize "--" to reduce accidental marker breakage.
 */
export const encodeInlineCommentTextForMarker = (text: string): string => {
  return JSON.stringify(text).replaceAll('--', '\\u002d\\u002d');
};

/**
 * Why: the parser needs one canonical decode path so marker payload handling
 * remains consistent between editor commands, decorations, and the sidebar UI.
 */
const decodeInlineCommentTextFromMarkerPayload = (payload: string): string => {
  try {
    return JSON.parse(payload) as string;
  } catch {
    return payload.trim().replace(/^"|"$/g, '');
  }
};

/**
 * Why: marker parsing is easier to validate when start/end markers are first
 * tokenized in source order before pairing them into comment ranges.
 */
const parseInlineCommentMarkerTokens = (
  markdownContent: string,
): MarkerToken[] => {
  const tokens: MarkerToken[] = [];

  for (const match of markdownContent.matchAll(INLINE_COMMENT_MARKER_PATTERN)) {
    const fullMatch = match[0];
    const markerId = match[1];
    const markerKind = match[2];
    const markerPayload = match[3] ?? '';
    const markerFrom = match.index ?? 0;
    const markerTo = markerFrom + fullMatch.length;

    if (markerKind === 'start') {
      const payloadIndexWithinMarker = fullMatch.indexOf(markerPayload);
      const payloadFrom =
        payloadIndexWithinMarker >= 0
          ? markerFrom + payloadIndexWithinMarker
          : markerTo;
      const payloadTo = payloadFrom + markerPayload.length;

      tokens.push({
        id: markerId,
        fullFrom: markerFrom,
        fullTo: markerTo,
        payloadFrom,
        payloadTo,
        text: decodeInlineCommentTextFromMarkerPayload(markerPayload),
      });
      continue;
    }

    tokens.push({
      id: markerId,
      fullFrom: markerFrom,
      fullTo: markerTo,
    });
  }

  return tokens;
};

/**
 * Why: the editor and UI only need well-formed comment ranges; malformed
 * markers are ignored here so the MVP can fail safe without crashing.
 */
export const parseInlineCommentsFromMarkdown = (
  markdownContent: string,
): InlineComment[] => {
  const parsedComments: InlineComment[] = [];
  const openStartsById = new Map<string, ParsedStartMarker>();

  for (const token of parseInlineCommentMarkerTokens(markdownContent)) {
    if ('payloadFrom' in token) {
      if (!openStartsById.has(token.id)) {
        openStartsById.set(token.id, token);
      }
      continue;
    }

    const matchingStartMarker = openStartsById.get(token.id);
    if (!matchingStartMarker) {
      continue;
    }

    openStartsById.delete(token.id);
    if (matchingStartMarker.fullTo > token.fullFrom) {
      continue;
    }

    parsedComments.push({
      id: token.id,
      text: matchingStartMarker.text,
      contentFrom: matchingStartMarker.fullTo,
      contentTo: token.fullFrom,
      startMarkerFrom: matchingStartMarker.fullFrom,
      startMarkerTo: matchingStartMarker.fullTo,
      endMarkerFrom: token.fullFrom,
      endMarkerTo: token.fullTo,
    });
  }

  return parsedComments.sort((leftComment, rightComment) => {
    return leftComment.contentFrom - rightComment.contentFrom;
  });
};

/**
 * Why: editor hit-testing should treat inline comment ranges as half-open so
 * clicks at the visual end boundary stay in prose instead of jumping to cards.
 */
export const findInlineCommentIdContainingDocumentPosition = (
  markdownContent: string,
  documentPosition: number,
): string | null => {
  const parsedComments = parseInlineCommentsFromMarkdown(markdownContent);
  const inlineCommentAtPosition = parsedComments.find((comment) => {
    return (
      documentPosition >= comment.contentFrom &&
      documentPosition < comment.contentTo
    );
  });
  return inlineCommentAtPosition?.id ?? null;
};

/**
 * Why: mouse clicks on inline comment boundaries should behave like prose
 * editors: the start edge activates the comment, but the end edge leaves the
 * caret outside so users can resume typing after the annotated text.
 */
export const findInlineCommentIdForDocumentClick = (
  markdownContent: string,
  documentPosition: number,
  documentPositionSide: -1 | 1,
): string | null => {
  const parsedComments = parseInlineCommentsFromMarkdown(markdownContent);
  const inlineCommentAtClick = parsedComments.find((comment) => {
    if (
      documentPosition > comment.contentFrom &&
      documentPosition < comment.contentTo
    ) {
      return true;
    }

    return (
      documentPosition === comment.contentFrom && documentPositionSide === 1
    );
  });
  return inlineCommentAtClick?.id ?? null;
};

/**
 * Why: comment creation should use one marker syntax generator so future format
 * tweaks do not require coordinated edits across multiple call sites.
 */
export const createInlineCommentStartMarker = (
  commentId: string,
  commentText: string,
): string => {
  return `<!-- @comment:${commentId} start | ${encodeInlineCommentTextForMarker(commentText)} -->`;
};

/**
 * Why: end-marker formatting must remain exact for parser compatibility and
 * string replacement operations that depend on stable marker shapes.
 */
export const createInlineCommentEndMarker = (commentId: string): string => {
  return `<!-- @comment:${commentId} end -->`;
};

/**
 * Why: sidebar edits need direct marker payload coordinates so callers can
 * apply minimal in-place document changes without replacing the full file.
 */
export const findInlineCommentTextPayloadRangeInMarkdown = (
  markdownContent: string,
  commentId: string,
): InlineCommentTextPayloadRange | null => {
  const targetComment = parseInlineCommentsFromMarkdown(markdownContent).find(
    (comment) => comment.id === commentId,
  );
  if (!targetComment) {
    return null;
  }

  const targetStartMarkerSource = markdownContent.slice(
    targetComment.startMarkerFrom,
    targetComment.startMarkerTo,
  );
  const targetStartMarkerMatch = targetStartMarkerSource.match(
    /^<!--\s*@comment:[A-Za-z0-9_-]+\s+start\s*\|\s*([\s\S]*?)\s*-->$/,
  );
  if (!targetStartMarkerMatch || targetStartMarkerMatch.index === undefined) {
    return null;
  }

  const existingPayload = targetStartMarkerMatch[1] ?? '';
  const payloadIndexWithinStartMarker =
    targetStartMarkerSource.indexOf(existingPayload);
  if (payloadIndexWithinStartMarker < 0) {
    return null;
  }

  const payloadFrom =
    targetComment.startMarkerFrom + payloadIndexWithinStartMarker;
  const payloadTo = payloadFrom + existingPayload.length;
  return { payloadFrom, payloadTo };
};

/**
 * Why: the sidebar editor needs a targeted string replacement path that only
 * mutates one comment payload while preserving the anchored document range.
 */
export const updateInlineCommentTextInMarkdown = (
  markdownContent: string,
  commentId: string,
  nextCommentText: string,
): string | null => {
  const targetPayloadRange = findInlineCommentTextPayloadRangeInMarkdown(
    markdownContent,
    commentId,
  );
  if (!targetPayloadRange) {
    return null;
  }

  const encodedCommentText = encodeInlineCommentTextForMarker(nextCommentText);

  return (
    markdownContent.slice(0, targetPayloadRange.payloadFrom) +
    encodedCommentText +
    markdownContent.slice(targetPayloadRange.payloadTo)
  );
};

/**
 * Why: comment deletion should remove only the marker pair so resolving a
 * comment preserves the user-authored document text inside the anchored range.
 */
export const removeInlineCommentMarkersFromMarkdown = (
  markdownContent: string,
  commentId: string,
): string | null => {
  const targetComment = parseInlineCommentsFromMarkdown(markdownContent).find(
    (comment) => comment.id === commentId,
  );
  if (!targetComment) {
    return null;
  }

  return (
    markdownContent.slice(0, targetComment.startMarkerFrom) +
    markdownContent.slice(
      targetComment.startMarkerTo,
      targetComment.endMarkerFrom,
    ) +
    markdownContent.slice(targetComment.endMarkerTo)
  );
};

/**
 * Why: overlap checks are enforced during MVP comment creation to prevent
 * nested/crossing ranges before they enter the markdown format at all.
 */
export const doesSelectionOverlapExistingInlineComment = (
  markdownContent: string,
  selectionFrom: number,
  selectionTo: number,
): boolean => {
  if (selectionFrom >= selectionTo) {
    return false;
  }

  return parseInlineCommentsFromMarkdown(markdownContent).some((comment) => {
    return (
      selectionFrom < comment.contentTo && selectionTo > comment.contentFrom
    );
  });
};
