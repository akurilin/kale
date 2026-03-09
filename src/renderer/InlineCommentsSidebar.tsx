//
// This component owns the comments sidebar presentation so the app shell stays
// focused on document lifecycle orchestration instead of comment-list markup.
//

import type { InlineComment } from './inline-comments';
import { InlineCommentCard } from './InlineCommentCard';

type InlineCommentsSidebarProps = {
  comments: InlineComment[];
  commentTopOffsetsById: Record<string, number>;
  hiddenCommentIds: ReadonlySet<string>;
  onChangeCommentText: (commentId: string, nextCommentText: string) => void;
  onDeleteComment: (commentId: string) => void;
  activeCommentId: string | null;
  onActivateComment: (commentId: string) => void;
  onCompleteCommentEditing: (commentId: string) => void;
  autoFocusCommentId: string | null;
  onAutoFocusCommentHandled: (commentId: string) => void;
  onCommentCardHeightChanged: (commentId: string, nextHeight: number) => void;
};

// The sidebar is a presentational layer around comment cards so it can be
// replaced by floating bubbles later without changing editor integration code.
export const InlineCommentsSidebar = ({
  comments,
  commentTopOffsetsById,
  hiddenCommentIds,
  onChangeCommentText,
  onDeleteComment,
  activeCommentId,
  onActivateComment,
  onCompleteCommentEditing,
  autoFocusCommentId,
  onAutoFocusCommentHandled,
  onCommentCardHeightChanged,
}: InlineCommentsSidebarProps) => {
  const visibleComments = comments.filter(
    (comment) => !hiddenCommentIds.has(comment.id),
  );

  return (
    <aside
      className="inline-comments-sidebar inline-comments-sidebar--floating"
      aria-label="Floating comments"
    >
      {comments.length === 0 ? (
        <div className="inline-comments-empty-state">
          Select text and click the floating `Comment` button to create an
          inline comment.
        </div>
      ) : visibleComments.length === 0 ? (
        <div className="inline-comments-empty-state">
          Scroll the document to reveal comment cards next to their anchors.
        </div>
      ) : (
        <div className="inline-comments-floating-layer" aria-hidden="false">
          {visibleComments.map((comment) => {
            const commentTopOffset = commentTopOffsetsById[comment.id] ?? 0;

            return (
              <div
                key={comment.id}
                className="inline-comment-floating-slot"
                style={{ top: commentTopOffset }}
              >
                <InlineCommentCard
                  comment={comment}
                  onChangeCommentText={onChangeCommentText}
                  onDeleteComment={onDeleteComment}
                  isActive={activeCommentId === comment.id}
                  onActivateComment={onActivateComment}
                  onCompleteCommentEditing={onCompleteCommentEditing}
                  shouldAutoFocusInput={autoFocusCommentId === comment.id}
                  onAutoFocusHandled={onAutoFocusCommentHandled}
                  onCardHeightChanged={onCommentCardHeightChanged}
                />
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
};
