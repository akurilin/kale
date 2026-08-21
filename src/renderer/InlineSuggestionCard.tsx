//
// This component presents one proposed text replacement while the shared
// sidebar continues to own placement and active-annotation orchestration.
//

import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';

import type { InlineSuggestion } from './inline-comments';

type InlineSuggestionCardProps = {
  suggestion: InlineSuggestion;
  isActive?: boolean;
  onActivateSuggestion?: (suggestionId: string) => void;
  onFocusSuggestion?: (suggestionId: string) => void;
  onAcceptSuggestion: (suggestionId: string) => void;
  onRejectSuggestion: (suggestionId: string) => void;
  onCardHeightChanged?: (suggestionId: string, nextHeight: number) => void;
};

/**
 * Why: an empty side of a suggestion still needs a clear visible meaning for
 * insertion and deletion proposals.
 */
const formatSuggestionTextForDisplay = (
  suggestionText: string,
  emptyTextLabel: string,
): string => {
  return suggestionText.length === 0 ? emptyTextLabel : suggestionText;
};

/**
 * Why: suggestions are read-only proposals, so their card exposes only the two
 * resolution actions and sends all document mutations to the editor owner.
 */
export const InlineSuggestionCard = ({
  suggestion,
  isActive = false,
  onActivateSuggestion,
  onFocusSuggestion,
  onAcceptSuggestion,
  onRejectSuggestion,
  onCardHeightChanged,
}: InlineSuggestionCardProps) => {
  const suggestionCardElementRef = useRef<HTMLElement | null>(null);

  /**
   * Why: floating card packing must respond when a diff grows, shrinks, or
   * wraps after layout changes.
   */
  useEffect(() => {
    const suggestionCardElement = suggestionCardElementRef.current;
    if (!suggestionCardElement || !onCardHeightChanged) {
      return;
    }

    const emitCurrentCardHeight = () => {
      onCardHeightChanged(suggestion.id, suggestionCardElement.offsetHeight);
    };

    emitCurrentCardHeight();
    const resizeObserver = new ResizeObserver(emitCurrentCardHeight);
    resizeObserver.observe(suggestionCardElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [onCardHeightChanged, suggestion.id]);

  /**
   * Why: pointer activation must happen before a button click resolves and
   * removes the card, which keeps editor and sidebar focus state in sync.
   */
  const handleCardMouseDown = (event: ReactMouseEvent<HTMLElement>): void => {
    if (event.button !== 0) {
      return;
    }
    onActivateSuggestion?.(suggestion.id);
  };

  /**
   * Why: keyboard focus on any suggestion control should send the complete
   * before-and-after proposal to the active agent context.
   */
  const handleCardFocus = (): void => {
    onActivateSuggestion?.(suggestion.id);
    onFocusSuggestion?.(suggestion.id);
  };

  const suggestionCardClassName = isActive
    ? 'inline-comment-card inline-comment-card--active inline-suggestion-card'
    : 'inline-comment-card inline-suggestion-card';

  return (
    <article
      ref={suggestionCardElementRef}
      className={suggestionCardClassName}
      onMouseDown={handleCardMouseDown}
      onFocus={handleCardFocus}
      data-inline-comment-card-id={suggestion.id}
      aria-label="Suggested change"
    >
      <p className="inline-suggestion-explanation">
        {suggestion.explanation || 'Suggested change'}
      </p>
      <div className="inline-suggestion-diff" aria-label="Before and after">
        <div className="inline-suggestion-diff-section inline-suggestion-diff-section--before">
          <span className="inline-suggestion-diff-label">Before</span>
          <pre className="inline-suggestion-diff-text">
            {formatSuggestionTextForDisplay(suggestion.originalText, 'No text')}
          </pre>
        </div>
        <div className="inline-suggestion-diff-section inline-suggestion-diff-section--after">
          <span className="inline-suggestion-diff-label">After</span>
          <pre className="inline-suggestion-diff-text">
            {formatSuggestionTextForDisplay(
              suggestion.replacementText,
              'Delete text',
            )}
          </pre>
        </div>
      </div>
      {suggestion.isStale ? (
        <p className="inline-suggestion-stale-message">
          The original text changed. Reject this suggestion or ask the agent for
          a new one.
        </p>
      ) : null}
      <div className="inline-suggestion-actions">
        <button
          className="inline-suggestion-action inline-suggestion-action--reject"
          type="button"
          aria-label="Reject suggestion"
          title="Reject suggestion"
          onClick={() => onRejectSuggestion(suggestion.id)}
        >
          ×
        </button>
        <button
          className="inline-suggestion-action inline-suggestion-action--accept"
          type="button"
          aria-label="Accept suggestion"
          title={
            suggestion.isStale
              ? 'The original text changed'
              : 'Accept suggestion'
          }
          disabled={suggestion.isStale}
          onClick={() => onAcceptSuggestion(suggestion.id)}
        >
          ✓
        </button>
      </div>
    </article>
  );
};
