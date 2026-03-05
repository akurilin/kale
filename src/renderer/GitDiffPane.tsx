//
// This component renders a read-only, side-by-side document comparison so
// writers can review Git HEAD vs current content at a glance before committing.
//

import { useMemo } from 'react';

import {
  buildSideBySideDiffRows,
  countChangedDiffRows,
  type SideBySideDiffRow,
} from './git-diff';

type GitDiffPaneProps = {
  committedHeadContent: string;
  currentContent: string;
  isLoadingCommittedHeadContent: boolean;
  committedHeadLoadErrorText: string | null;
  isCurrentFileTrackedInHead: boolean;
};

// Empty lines are valid diff rows, so this helper preserves row height while
// still rendering a visible line box in both columns.
const formatDiffLineText = (lineText: string) => {
  return lineText.length > 0 ? lineText : ' ';
};

// Summary text gives quick orientation before scanning the full line-by-line
// table, especially for long essays with only a few localized edits.
const buildDiffSummaryText = (
  changedRowCount: number,
  isCurrentFileTrackedInHead: boolean,
) => {
  if (!isCurrentFileTrackedInHead) {
    return 'No committed HEAD version exists for this file yet.';
  }

  if (changedRowCount === 0) {
    return 'No differences from HEAD.';
  }

  if (changedRowCount === 1) {
    return '1 changed line compared to HEAD.';
  }

  return `${changedRowCount} changed lines compared to HEAD.`;
};

// Stable row keys prevent unnecessary DOM churn while users toggle diff mode
// and while upstream file reloads update content snapshots.
const buildDiffRowKey = (row: SideBySideDiffRow, rowIndex: number) => {
  return [
    rowIndex,
    row.leftLineNumber ?? 'x',
    row.rightLineNumber ?? 'x',
    row.hasLeftChange ? 'l' : '_',
    row.hasRightChange ? 'r' : '_',
  ].join(':');
};

// The view is intentionally read-only to keep review mode separate from author
// mode, reducing accidental edits while users inspect change details.
export const GitDiffPane = ({
  committedHeadContent,
  currentContent,
  isLoadingCommittedHeadContent,
  committedHeadLoadErrorText,
  isCurrentFileTrackedInHead,
}: GitDiffPaneProps) => {
  const diffRows = useMemo(() => {
    return buildSideBySideDiffRows(committedHeadContent, currentContent);
  }, [committedHeadContent, currentContent]);

  const changedRowCount = useMemo(() => {
    return countChangedDiffRows(diffRows);
  }, [diffRows]);

  const summaryText = useMemo(() => {
    return buildDiffSummaryText(changedRowCount, isCurrentFileTrackedInHead);
  }, [changedRowCount, isCurrentFileTrackedInHead]);

  return (
    <section className="pane diff-pane">
      <div className="pane-title">Diff</div>
      {isLoadingCommittedHeadContent ? (
        <div className="diff-status-message">Loading Git HEAD content...</div>
      ) : committedHeadLoadErrorText ? (
        <div className="diff-status-message diff-status-message--error">
          {`Could not load HEAD content: ${committedHeadLoadErrorText}`}
        </div>
      ) : (
        <>
          <div className="diff-summary">{summaryText}</div>
          <div className="diff-grid-header" role="presentation">
            <div className="diff-column-header diff-column-header--left">
              <span className="diff-column-label">HEAD</span>
            </div>
            <div className="diff-column-header diff-column-header--right">
              <span className="diff-column-label">Current</span>
            </div>
          </div>
          <div className="diff-grid" role="table" aria-label="Git diff view">
            {diffRows.length === 0 ? (
              <div className="diff-empty-state">This document is empty.</div>
            ) : (
              diffRows.map((row, rowIndex) => (
                <div
                  className="diff-row"
                  role="row"
                  key={buildDiffRowKey(row, rowIndex)}
                >
                  <div
                    className={`diff-cell diff-cell--left ${
                      row.hasLeftChange ? 'diff-cell--left-changed' : ''
                    }`.trim()}
                    role="cell"
                  >
                    <span className="diff-line-number">
                      {row.leftLineNumber ?? ''}
                    </span>
                    <pre className="diff-line-text">
                      {formatDiffLineText(row.leftLineText)}
                    </pre>
                  </div>
                  <div
                    className={`diff-cell diff-cell--right ${
                      row.hasRightChange ? 'diff-cell--right-changed' : ''
                    }`.trim()}
                    role="cell"
                  >
                    <span className="diff-line-number">
                      {row.rightLineNumber ?? ''}
                    </span>
                    <pre className="diff-line-text">
                      {formatDiffLineText(row.rightLineText)}
                    </pre>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
};
