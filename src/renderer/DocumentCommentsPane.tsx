//
// This component groups the markdown editor and inline comments UI so comment
// interactions can evolve independently from the app shell's file lifecycle.
//

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ForwardedRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import {
  MarkdownEditorPane,
  type EditorSelectionDetails,
  type MarkdownEditorPaneHandle,
} from './MarkdownEditorPane';
import { InlineCommentsSidebar } from './InlineCommentsSidebar';
import {
  parseInlineCommentsFromMarkdown,
  type InlineComment,
} from './inline-comments';

const INLINE_COMMENT_SELECTION_BUTTON_WIDTH = 92;
const INLINE_COMMENT_SELECTION_BUTTON_HEIGHT = 34;
const INLINE_COMMENT_SELECTION_BUTTON_MARGIN = 8;
const FLOATING_COMMENT_CARD_GAP = 10;
const DEFAULT_FLOATING_COMMENT_CARD_HEIGHT = 64;
const INLINE_COMMENT_CARD_ID_ATTRIBUTE = 'data-inline-comment-card-id';
const INLINE_COMMENT_RANGE_ID_ATTRIBUTE = 'data-inline-comment-range-id';

type DocumentCommentsPaneProps = {
  loadedDocumentContent: string | null;
  loadedDocumentRevision: number;
  onUserEditedDocument: (content: string) => void;
  onDocumentContentReplacedFromDisk?: (replacedWithContent: string) => void;
  onSelectionDetailsChanged?: (details: EditorSelectionDetails | null) => void;
};

export type DocumentCommentsPaneHandle = {
  getCurrentContent: () => string | null;
};

type FloatingCommentAnchor = {
  commentId: string;
  desiredTop: number;
  cardHeight: number;
};

/**
 * Why: floating comments should follow anchor order without overlapping, so we
 * do a simple Google Docs-style packing pass while preserving anchor-relative
 * overflow so cards can drift out of view instead of sticking to the edges.
 */
const computePackedFloatingCommentTopOffsets = (
  anchors: FloatingCommentAnchor[],
): Record<string, number> => {
  const sortedAnchors = [...anchors].sort((leftAnchor, rightAnchor) => {
    return leftAnchor.desiredTop - rightAnchor.desiredTop;
  });
  if (sortedAnchors.length === 0) {
    return {};
  }

  const positionedAnchors = sortedAnchors.map((anchor) => ({
    ...anchor,
    top: anchor.desiredTop,
  }));

  for (let index = 1; index < positionedAnchors.length; index += 1) {
    const previousAnchor = positionedAnchors[index - 1];
    const currentAnchor = positionedAnchors[index];
    const minimumTopAfterPrevious =
      previousAnchor.top +
      previousAnchor.cardHeight +
      FLOATING_COMMENT_CARD_GAP;

    currentAnchor.top = Math.max(currentAnchor.top, minimumTopAfterPrevious);
  }

  return Object.fromEntries(
    positionedAnchors.map((anchor) => [anchor.commentId, anchor.top]),
  );
};

// forwardRef keeps the editor imperative API available for save/open flows
// while moving comment-specific orchestration out of the main app shell.
const DocumentCommentsPaneImpl = (
  {
    loadedDocumentContent,
    loadedDocumentRevision,
    onUserEditedDocument,
    onDocumentContentReplacedFromDisk,
    onSelectionDetailsChanged,
  }: DocumentCommentsPaneProps,
  ref: ForwardedRef<DocumentCommentsPaneHandle>,
) => {
  const [inlineComments, setInlineComments] = useState<InlineComment[]>([]);
  const [inlineCommentSelectionAnchor, setInlineCommentSelectionAnchor] =
    useState<{ top: number; left: number } | null>(null);
  const [activeInlineCommentId, setActiveInlineCommentId] = useState<
    string | null
  >(null);
  const [autoFocusInlineCommentId, setAutoFocusInlineCommentId] = useState<
    string | null
  >(null);
  const [
    inlineCommentAnchorLayoutRevision,
    setInlineCommentAnchorLayoutRevision,
  ] = useState(0);
  const [inlineCommentTopOffsetsById, setInlineCommentTopOffsetsById] =
    useState<Record<string, number>>({});
  const [hiddenInlineCommentIds, setHiddenInlineCommentIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [inlineCommentCardHeightsById, setInlineCommentCardHeightsById] =
    useState<Record<string, number>>({});

  const markdownEditorPaneRef = useRef<MarkdownEditorPaneHandle | null>(null);
  const documentCommentsLayoutElementRef = useRef<HTMLDivElement | null>(null);

  /**
   * Why: App only needs the current document text for save/lifecycle behavior,
   * so this narrower handle hides comment implementation details from the shell.
   */
  useImperativeHandle(
    ref,
    () => ({
      getCurrentContent: () =>
        markdownEditorPaneRef.current?.getCurrentContent() ?? null,
    }),
    [],
  );

  /**
   * Why: programmatic document loads do not emit editor "user edit" callbacks,
   * so the comment list must resync from loaded markdown props here.
   */
  useEffect(() => {
    if (loadedDocumentContent === null) {
      setInlineComments([]);
      setInlineCommentSelectionAnchor(null);
      setActiveInlineCommentId(null);
      setAutoFocusInlineCommentId(null);
      setInlineCommentTopOffsetsById({});
      setHiddenInlineCommentIds(new Set());
      return;
    }

    setInlineComments(parseInlineCommentsFromMarkdown(loadedDocumentContent));
  }, [loadedDocumentContent, loadedDocumentRevision]);

  /**
   * Why: editor decorations and sidebar selection should never target stale
   * IDs, so active state clears automatically when a comment no longer exists.
   */
  useEffect(() => {
    if (activeInlineCommentId === null) {
      return;
    }

    const activeCommentStillExists = inlineComments.some(
      (inlineComment) => inlineComment.id === activeInlineCommentId,
    );
    if (!activeCommentStillExists) {
      setActiveInlineCommentId(null);
    }
  }, [activeInlineCommentId, inlineComments]);

  /**
   * Why: range highlight styling lives inside CodeMirror while activation
   * orchestration lives in React, so this sync keeps both layers consistent.
   */
  useEffect(() => {
    markdownEditorPaneRef.current?.setActiveInlineCommentById(
      activeInlineCommentId,
    );
  }, [activeInlineCommentId]);

  /**
   * Why: active comment context should clear immediately when users click
   * anywhere outside the current card/highlight, so this capture listener
   * enforces one active comment only while interaction stays in that context.
   */
  useEffect(() => {
    if (activeInlineCommentId === null) {
      return;
    }

    const handleWindowPointerDownCapture = (pointerEvent: PointerEvent) => {
      const pointerTarget = pointerEvent.target;
      if (!(pointerTarget instanceof Node)) {
        setActiveInlineCommentId(null);
        setAutoFocusInlineCommentId(null);
        return;
      }

      const pointerTargetElement =
        pointerTarget instanceof Element
          ? pointerTarget
          : pointerTarget.parentElement;
      if (!pointerTargetElement) {
        setActiveInlineCommentId(null);
        setAutoFocusInlineCommentId(null);
        return;
      }

      const targetCommentCardElement = pointerTargetElement.closest(
        `[${INLINE_COMMENT_CARD_ID_ATTRIBUTE}]`,
      );
      if (
        targetCommentCardElement?.getAttribute(
          INLINE_COMMENT_CARD_ID_ATTRIBUTE,
        ) === activeInlineCommentId
      ) {
        return;
      }

      const targetCommentRangeElement = pointerTargetElement.closest(
        `[${INLINE_COMMENT_RANGE_ID_ATTRIBUTE}]`,
      );
      if (
        targetCommentRangeElement?.getAttribute(
          INLINE_COMMENT_RANGE_ID_ATTRIBUTE,
        ) === activeInlineCommentId
      ) {
        return;
      }

      setActiveInlineCommentId(null);
      setAutoFocusInlineCommentId(null);
    };

    window.addEventListener(
      'pointerdown',
      handleWindowPointerDownCapture,
      true,
    );
    return () => {
      window.removeEventListener(
        'pointerdown',
        handleWindowPointerDownCapture,
        true,
      );
    };
  }, [activeInlineCommentId]);

  /**
   * Why: floating comment packing depends on the layout container height, so a
   * ResizeObserver invalidates placement when the editor/comment pane resizes.
   */
  useEffect(() => {
    const layoutElement = documentCommentsLayoutElementRef.current;
    if (!layoutElement) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      setInlineCommentAnchorLayoutRevision((previousRevision) => {
        return previousRevision + 1;
      });
    });
    resizeObserver.observe(layoutElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  /**
   * Why: floating comments should track anchor text as the editor scrolls or
   * reflows, so placements are recomputed whenever anchor geometry invalidates.
   */
  useLayoutEffect(() => {
    const editorHandle = markdownEditorPaneRef.current;
    if (!editorHandle || inlineComments.length === 0) {
      setInlineCommentTopOffsetsById({});
      setHiddenInlineCommentIds(new Set());
      return;
    }

    const visibleAnchors: FloatingCommentAnchor[] = [];
    const hiddenCommentIds = new Set<string>();

    for (const comment of inlineComments) {
      const anchorPosition = editorHandle.getAnchorPositionForDocumentRange(
        comment.contentFrom,
        comment.contentFrom,
      );
      if (!anchorPosition) {
        hiddenCommentIds.add(comment.id);
        continue;
      }

      const measuredCardHeight =
        inlineCommentCardHeightsById[comment.id] ??
        DEFAULT_FLOATING_COMMENT_CARD_HEIGHT;
      visibleAnchors.push({
        commentId: comment.id,
        desiredTop: anchorPosition.top,
        cardHeight: measuredCardHeight,
      });
    }

    setHiddenInlineCommentIds(hiddenCommentIds);
    setInlineCommentTopOffsetsById(
      computePackedFloatingCommentTopOffsets(visibleAnchors),
    );
  }, [
    inlineCommentAnchorLayoutRevision,
    inlineCommentCardHeightsById,
    inlineComments,
  ]);

  /**
   * Why: comment creation must go through the editor so markdown marker ranges
   * remain the source of truth and selection anchoring stays accurate.
   */
  const createInlineCommentFromSelection = () => {
    const createResult =
      markdownEditorPaneRef.current?.createInlineCommentFromCurrentSelection();
    if (!createResult) {
      window.alert('Editor is not ready yet.');
      return;
    }

    if (!createResult.ok) {
      window.alert(createResult.errorMessage ?? 'Could not create comment.');
      return;
    }

    if (createResult.createdCommentId) {
      setActiveInlineCommentId(createResult.createdCommentId);
      setAutoFocusInlineCommentId(createResult.createdCommentId);
    }
  };

  /**
   * Why: updates stay editor-backed so the markdown markers remain canonical and
   * the sidebar continues to act as a pure UI surface over parsed comments.
   */
  const updateInlineCommentText = (
    commentId: string,
    nextCommentText: string,
  ) => {
    const didUpdate =
      markdownEditorPaneRef.current?.updateInlineCommentTextById(
        commentId,
        nextCommentText,
      ) ?? false;
    if (!didUpdate) {
      window.alert(
        'Could not update comment text. The comment markers may be malformed.',
      );
    }
  };

  /**
   * Why: deletion follows the same editor-backed path as creation/updates so
   * future comment policy changes remain centralized in one integration layer.
   */
  const deleteInlineComment = (commentId: string) => {
    const didDelete =
      markdownEditorPaneRef.current?.deleteInlineCommentById(commentId) ??
      false;
    if (!didDelete) {
      window.alert(
        'Could not delete comment. The comment markers may be malformed.',
      );
      return;
    }

    setActiveInlineCommentId((currentActiveInlineCommentId) => {
      return currentActiveInlineCommentId === commentId
        ? null
        : currentActiveInlineCommentId;
    });
  };

  /**
   * Why: comment cards and highlighted text both represent the same comment
   * entity, so interaction from either surface must drive one active-comment ID.
   */
  const activateInlineComment = (
    commentId: string | null,
    {
      shouldMoveFocusToCommentInput,
    }: { shouldMoveFocusToCommentInput: boolean },
  ) => {
    setActiveInlineCommentId(commentId);
    if (!shouldMoveFocusToCommentInput || commentId === null) {
      return;
    }

    setAutoFocusInlineCommentId(commentId);
  };

  /**
   * Why: clicking or tab-focusing inside a card should visually elevate that
   * comment and its referenced text range without forcing extra editor focus.
   */
  const handleCommentCardActivated = (commentId: string) => {
    activateInlineComment(commentId, {
      shouldMoveFocusToCommentInput: false,
    });
  };

  /**
   * Why: keyboard completion shortcuts should close the current comment editing
   * session, returning the UI to a neutral no-active-comment state.
   */
  const handleCommentEditingCompleted = (commentId: string) => {
    setActiveInlineCommentId((currentActiveInlineCommentId) => {
      return currentActiveInlineCommentId === commentId
        ? null
        : currentActiveInlineCommentId;
    });
    setAutoFocusInlineCommentId((currentCommentId) => {
      return currentCommentId === commentId ? null : currentCommentId;
    });
  };

  /**
   * Why: clicking highlighted editor text should activate the corresponding
   * sidebar card while keeping the prose caret in the editor pane.
   */
  const handleInlineCommentRangeInteraction = (commentId: string | null) => {
    activateInlineComment(commentId, {
      shouldMoveFocusToCommentInput: false,
    });
  };

  /**
   * Why: this local wrapper keeps comment parsing co-located with comment UI
   * state so App only handles save scheduling and document lifecycle concerns.
   */
  const handleUserEditedDocument = (content: string) => {
    setInlineComments(parseInlineCommentsFromMarkdown(content));
    onUserEditedDocument(content);
  };

  /**
   * Why: mousedown default prevention preserves the editor selection so the
   * floating action can create a comment from the highlighted text.
   */
  const handleSelectionActionMouseDown = (
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
  };

  /**
   * Why: the auto-focus flag is a one-shot signal and must be cleared once the
   * target card handles focus to avoid stealing focus on later re-renders.
   */
  const handleAutoFocusCommentHandled = (commentId: string) => {
    setAutoFocusInlineCommentId((currentCommentId) => {
      return currentCommentId === commentId ? null : currentCommentId;
    });
  };

  /**
   * Why: card height changes alter collision packing, so they must trigger a
   * re-layout when a textarea grows or shrinks.
   */
  const handleInlineCommentCardHeightChanged = (
    commentId: string,
    nextHeight: number,
  ) => {
    setInlineCommentCardHeightsById((currentHeightsById) => {
      if (currentHeightsById[commentId] === nextHeight) {
        return currentHeightsById;
      }

      return {
        ...currentHeightsById,
        [commentId]: nextHeight,
      };
    });
  };

  /**
   * Why: editor scroll/viewport changes should not directly encode positions in
   * state, so this signal simply invalidates and the layout effect re-derives.
   */
  const handleInlineCommentAnchorGeometryChanged = () => {
    setInlineCommentAnchorLayoutRevision((previousRevision) => {
      return previousRevision + 1;
    });
  };

  return (
    <div
      className="document-comments-layout"
      ref={documentCommentsLayoutElementRef}
    >
      <div className="document-comments-content">
        <MarkdownEditorPane
          ref={markdownEditorPaneRef}
          loadedDocumentContent={loadedDocumentContent}
          loadedDocumentRevision={loadedDocumentRevision}
          onUserEditedDocument={handleUserEditedDocument}
          onDocumentContentReplacedFromDisk={onDocumentContentReplacedFromDisk}
          onSelectionDetailsChanged={onSelectionDetailsChanged}
          onInlineCommentAnchorGeometryChanged={
            handleInlineCommentAnchorGeometryChanged
          }
          onInlineCommentCreationAnchorChanged={setInlineCommentSelectionAnchor}
          onInlineCommentRangeInteraction={handleInlineCommentRangeInteraction}
        />
        {loadedDocumentContent !== null && inlineCommentSelectionAnchor ? (
          <button
            className="inline-comment-selection-action"
            type="button"
            onMouseDown={handleSelectionActionMouseDown}
            onClick={createInlineCommentFromSelection}
            style={
              {
                left: Math.max(
                  INLINE_COMMENT_SELECTION_BUTTON_MARGIN,
                  inlineCommentSelectionAnchor.left -
                    INLINE_COMMENT_SELECTION_BUTTON_WIDTH,
                ),
                top: Math.max(
                  INLINE_COMMENT_SELECTION_BUTTON_MARGIN,
                  inlineCommentSelectionAnchor.top -
                    INLINE_COMMENT_SELECTION_BUTTON_HEIGHT -
                    INLINE_COMMENT_SELECTION_BUTTON_MARGIN,
                ),
              } as CSSProperties
            }
          >
            Comment
          </button>
        ) : null}
        <InlineCommentsSidebar
          comments={inlineComments}
          commentTopOffsetsById={inlineCommentTopOffsetsById}
          hiddenCommentIds={hiddenInlineCommentIds}
          onChangeCommentText={updateInlineCommentText}
          onDeleteComment={deleteInlineComment}
          activeCommentId={activeInlineCommentId}
          onActivateComment={handleCommentCardActivated}
          onCompleteCommentEditing={handleCommentEditingCompleted}
          autoFocusCommentId={autoFocusInlineCommentId}
          onAutoFocusCommentHandled={handleAutoFocusCommentHandled}
          onCommentCardHeightChanged={handleInlineCommentCardHeightChanged}
        />
      </div>
    </div>
  );
};

export const DocumentCommentsPane = forwardRef(DocumentCommentsPaneImpl);
DocumentCommentsPane.displayName = 'DocumentCommentsPane';
