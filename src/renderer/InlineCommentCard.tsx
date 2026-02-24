//
// This component isolates a single comment card UI so comment-level controls
// can evolve without bloating the app shell with repeated markup and handlers.
//

import type { ChangeEvent, MouseEvent } from 'react';

import type { InlineComment } from './inline-comments';

type InlineCommentCardProps = {
  comment: InlineComment;
  onChangeCommentText: (commentId: string, nextCommentText: string) => void;
  onDeleteComment: (commentId: string) => void;
};

// The card stays stateless so all edits flow through the existing editor-backed
// markdown source of truth rather than creating duplicate React-only comment state.
export const InlineCommentCard = ({
  comment,
  onChangeCommentText,
  onDeleteComment,
}: InlineCommentCardProps) => {
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
    <label className="inline-comment-card">
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
        className="inline-comment-card-input"
        value={comment.text}
        onChange={handleTextChange}
        rows={3}
        placeholder="Type a comment..."
      />
    </label>
  );
};
