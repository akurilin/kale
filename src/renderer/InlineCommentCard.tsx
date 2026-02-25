//
// This component isolates a single comment card UI so comment-level controls
// can evolve without bloating the app shell with repeated markup and handlers.
//

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type MouseEvent,
  type RefObject,
} from 'react';

import type { InlineComment } from './inline-comments';

type InlineCommentCardProps = {
  comment: InlineComment;
  onChangeCommentText: (commentId: string, nextCommentText: string) => void;
  onDeleteComment: (commentId: string) => void;
  shouldAutoFocusInput?: boolean;
  onAutoFocusHandled?: (commentId: string) => void;
  onCardHeightChanged?: (commentId: string, nextHeight: number) => void;
};

/**
 * Why: textarea elements do not shrink back down automatically as controlled
 * values change, so we explicitly reset and grow to the content height to keep
 * each comment card only as tall as its current text.
 */
const resizeCommentTextareaToContentHeight = (
  textareaElementRef: RefObject<HTMLTextAreaElement>,
) => {
  const textareaElement = textareaElementRef.current;
  if (!textareaElement) {
    return;
  }

  textareaElement.style.height = 'auto';
  textareaElement.style.height = `${textareaElement.scrollHeight}px`;
};

// The card stays stateless so all edits flow through the existing editor-backed
// markdown source of truth rather than creating duplicate React-only comment state.
export const InlineCommentCard = ({
  comment,
  onChangeCommentText,
  onDeleteComment,
  shouldAutoFocusInput = false,
  onAutoFocusHandled,
  onCardHeightChanged,
}: InlineCommentCardProps) => {
  const commentCardElementRef = useRef<HTMLLabelElement | null>(null);
  const commentTextareaElementRef = useRef<HTMLTextAreaElement | null>(null);

  // Resizing after each rendered value change keeps externally-driven updates
  // and local edits visually compact without requiring manual drag-resize.
  useLayoutEffect(() => {
    resizeCommentTextareaToContentHeight(commentTextareaElementRef);
  }, [comment.text]);

  /**
   * Why: floating comment layout depends on actual rendered card heights, so a
   * ResizeObserver reports size changes back to the positioning layer.
   */
  useEffect(() => {
    const commentCardElement = commentCardElementRef.current;
    if (!commentCardElement || !onCardHeightChanged) {
      return;
    }

    const emitCurrentCardHeight = () => {
      onCardHeightChanged(comment.id, commentCardElement.offsetHeight);
    };

    emitCurrentCardHeight();
    const resizeObserver = new ResizeObserver(() => {
      emitCurrentCardHeight();
    });
    resizeObserver.observe(commentCardElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [comment.id, onCardHeightChanged]);

  // Focusing immediately after comment creation keeps the workflow keyboard-
  // first so users can keep typing without a pointer round-trip.
  useEffect(() => {
    if (!shouldAutoFocusInput) {
      return;
    }

    const textareaElement = commentTextareaElementRef.current;
    if (!textareaElement) {
      return;
    }

    textareaElement.focus();
    const textLength = textareaElement.value.length;
    textareaElement.setSelectionRange(textLength, textLength);
    onAutoFocusHandled?.(comment.id);
  }, [comment.id, onAutoFocusHandled, shouldAutoFocusInput]);

  // Keeping this handler local avoids repeating event-plumbing details in the JSX.
  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChangeCommentText(comment.id, event.target.value);
  };

  // Delete is delegated upward so the caller can decide marker-removal policy.
  const handleDeleteClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onDeleteComment(comment.id);
  };

  return (
    <label className="inline-comment-card" ref={commentCardElementRef}>
      <button
        className="inline-comment-card-delete-button"
        type="button"
        aria-label="Delete comment"
        title="Delete comment"
        onClick={handleDeleteClick}
      >
        🗑
      </button>
      <textarea
        ref={commentTextareaElementRef}
        className="inline-comment-card-input"
        value={comment.text}
        onChange={handleTextChange}
        rows={1}
        placeholder="Type a comment..."
      />
    </label>
  );
};
