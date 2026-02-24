//
// This component owns the comments sidebar presentation so the app shell stays
// focused on document lifecycle orchestration instead of comment-list markup.
//

import type { InlineComment } from './inline-comments';
import { InlineCommentCard } from './InlineCommentCard';

type InlineCommentsSidebarProps = {
  comments: InlineComment[];
  onChangeCommentText: (commentId: string, nextCommentText: string) => void;
  onDeleteComment: (commentId: string) => void;
};

// The sidebar is a presentational layer around comment cards so it can be
// replaced by floating bubbles later without changing editor integration code.
export const InlineCommentsSidebar = ({
  comments,
  onChangeCommentText,
  onDeleteComment,
}: InlineCommentsSidebarProps) => {
  return (
    <aside className="inline-comments-sidebar" aria-label="Comments">
      <div className="inline-comments-sidebar-title">Comments</div>
      {comments.length === 0 ? (
        <div className="inline-comments-empty-state">
          Select text and click `Add Comment` to create an inline comment.
        </div>
      ) : (
        comments.map((comment) => {
          return (
            <InlineCommentCard
              key={comment.id}
              comment={comment}
              onChangeCommentText={onChangeCommentText}
              onDeleteComment={onDeleteComment}
            />
          );
        })
      )}
    </aside>
  );
};
