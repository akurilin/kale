//
// This component isolates a single comment card UI so comment-level controls
// can evolve without bloating the app shell with repeated markup and handlers.
//

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';

import type { InlineComment } from './inline-comments';

type InlineCommentCardProps = {
  comment: InlineComment;
  onChangeCommentText: (commentId: string, nextCommentText: string) => void;
  onDeleteComment: (commentId: string) => void;
  isActive?: boolean;
  onActivateComment?: (commentId: string) => void;
  onCompleteCommentEditing?: (commentId: string) => void;
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

/**
 * Why: comment editing flows commonly use Cmd/Ctrl+Enter as a completion
 * shortcut, so this helper keeps platform-modifier detection centralized.
 */
const isCommentEditingCompleteShortcut = (
  keyboardEvent: ReactKeyboardEvent<HTMLTextAreaElement>,
): boolean => {
  return (
    keyboardEvent.key === 'Enter' &&
    (keyboardEvent.metaKey || keyboardEvent.ctrlKey)
  );
};

// The card stays stateless so all edits flow through the existing editor-backed
// markdown source of truth rather than creating duplicate React-only comment state.
export const InlineCommentCard = ({
  comment,
  onChangeCommentText,
  onDeleteComment,
  isActive = false,
  onActivateComment,
  onCompleteCommentEditing,
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

  /**
   * Why: pointer interactions should mark a card as active before text input
   * focus settles so highlight animation begins immediately on click.
   */
  const handleCardMouseDown = (
    event: ReactMouseEvent<HTMLLabelElement>,
  ): void => {
    const pointerTarget = event.target;
    if (
      pointerTarget instanceof HTMLElement &&
      pointerTarget.closest('.inline-comment-card-delete-button')
    ) {
      return;
    }

    onActivateComment?.(comment.id);
  };

  /**
   * Why: keyboard and programmatic focus should activate comment context too,
   * not only pointer interactions, so this covers non-mouse navigation paths.
   */
  const handleCommentInputFocus = (): void => {
    onActivateComment?.(comment.id);
  };

  /**
   * Why: completing comment editing should blur the textarea and clear active
   * state without inserting newlines when users press Cmd/Ctrl+Enter.
   */
  const handleCommentInputKeyDown = (
    keyboardEvent: ReactKeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (!isCommentEditingCompleteShortcut(keyboardEvent)) {
      return;
    }

    keyboardEvent.preventDefault();
    keyboardEvent.currentTarget.blur();
    onCompleteCommentEditing?.(comment.id);
  };

  const inlineCommentCardClassName = isActive
    ? 'inline-comment-card inline-comment-card--active'
    : 'inline-comment-card';

  return (
    <label
      className={inlineCommentCardClassName}
      ref={commentCardElementRef}
      onMouseDown={handleCardMouseDown}
      data-inline-comment-card-id={comment.id}
    >
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
        onFocus={handleCommentInputFocus}
        onKeyDown={handleCommentInputKeyDown}
        rows={1}
        placeholder="Type a comment..."
      />
    </label>
  );
};
