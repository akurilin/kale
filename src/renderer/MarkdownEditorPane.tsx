//
// This component embeds CodeMirror as an imperative editor subsystem while
// presenting a small React-friendly surface for the surrounding app shell.
//

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ForwardedRef,
} from 'react';

import type { SelectionRange } from '../shared-types';
import { useLatestRef } from './use-latest-ref';
import { markdown } from '@codemirror/lang-markdown';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { lintKeymap } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from '@codemirror/view';

import {
  headingLineDecorationExtension,
  inlineCommentAtomicRangesExtension,
  inlineCommentDecorationExtension,
  inlineCommentEditGuardExtension,
  livePreviewMarkersExtension,
  quoteLineDecorationExtension,
} from './codemirror-extensions';
import {
  createInlineCommentEndMarker,
  createInlineCommentId,
  createInlineCommentStartMarker,
  doesSelectionOverlapExistingInlineComment,
  removeInlineCommentMarkersFromMarkdown,
  updateInlineCommentTextInMarkdown,
} from './inline-comments';

/**
 * Why: several operations replace the entire document content (external reload,
 * comment text update, comment deletion). A full-document replacement dispatch
 * collapses the cursor to position 0 and can reset the viewport, so this helper
 * preserves and restores the cursor's line/column and the scroll position.
 */
const dispatchFullDocumentReplacementPreservingCursor = (
  editorView: EditorView,
  newContent: string,
) => {
  const prevCursorPos = editorView.state.selection.main.head;
  const prevCursorLine = editorView.state.doc.lineAt(prevCursorPos);
  const prevLineNumber = prevCursorLine.number;
  const prevColumn = prevCursorPos - prevCursorLine.from;
  const prevScrollTop = editorView.scrollDOM.scrollTop;

  editorView.dispatch({
    changes: {
      from: 0,
      to: editorView.state.doc.length,
      insert: newContent,
    },
  });

  // Restore cursor to the same line/column in the new document,
  // clamped to valid ranges if the document shrank.
  const newDoc = editorView.state.doc;
  const restoredLineNumber = Math.min(prevLineNumber, newDoc.lines);
  const restoredLine = newDoc.line(restoredLineNumber);
  const restoredColumn = Math.min(prevColumn, restoredLine.length);
  const restoredPos = restoredLine.from + restoredColumn;

  editorView.dispatch({
    selection: { anchor: restoredPos },
  });

  // Restore scroll position so the viewport doesn't jump.
  editorView.scrollDOM.scrollTop = prevScrollTop;
};

// CodeMirror recommends copying basicSetup when you need customization. This
// local setup preserves the useful editor defaults while omitting gutter
// features (line numbers, fold gutter, gutter active-line highlight) so the
// prose editor truly does not mount a line counter pane at all.

// Custom prose highlight style — a modified copy of CodeMirror's
// defaultHighlightStyle (@codemirror/language). We maintain our own copy
// instead of importing defaultHighlightStyle because:
//
//   1. defaultHighlightStyle sets `textDecoration: "underline"` on headings,
//      which looks like hyperlinks in a prose editor. We need headings
//      without underlines.
//
//   2. Trying to override a single property via a second HighlightStyle is
//      unreliable — CodeMirror generates one CSS class per HighlightStyle
//      rule, and when two classes set the same property at equal specificity,
//      the winner depends on stylesheet injection order, which CodeMirror
//      does not guarantee.
//
//   3. CodeMirror's highlight facet has a binary fallback gate: if ANY
//      non-fallback HighlightStyle exists, ALL fallback styles are silently
//      discarded. Using defaultHighlightStyle as a fallback alongside a
//      non-fallback override causes the default (bold, italic, etc.) to
//      vanish entirely. A single style avoids this trap.
//
// If @codemirror/language updates defaultHighlightStyle, review the upstream
// diff and port relevant changes here.
const proseHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: '#404740' },
  { tag: tags.link, textDecoration: 'underline' },
  // Upstream defaultHighlightStyle uses `textDecoration: "underline"` here.
  // Omitted so headings don't look like links in the prose editor.
  { tag: tags.heading, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.keyword, color: '#708' },
  {
    tag: [
      tags.atom,
      tags.bool,
      tags.url,
      tags.contentSeparator,
      tags.labelName,
    ],
    color: '#219',
  },
  { tag: [tags.literal, tags.inserted], color: '#164' },
  { tag: [tags.string, tags.deleted], color: '#a11' },
  {
    tag: [tags.regexp, tags.escape, tags.special(tags.string)],
    color: '#e40',
  },
  { tag: tags.definition(tags.variableName), color: '#00f' },
  { tag: tags.local(tags.variableName), color: '#30a' },
  { tag: [tags.typeName, tags.namespace], color: '#085' },
  { tag: tags.className, color: '#167' },
  { tag: [tags.special(tags.variableName), tags.macroName], color: '#256' },
  { tag: tags.definition(tags.propertyName), color: '#00c' },
  { tag: tags.comment, color: '#940' },
  { tag: tags.invalid, color: '#f00' },
]);

const proseEditorSetupWithoutGutters: Extension = [
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(proseHighlightStyle),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...completionKeymap,
    ...lintKeymap,
  ]),
];

/** Selection details emitted on every selection/cursor change for IDE integration. */
export type EditorSelectionDetails = {
  selectedText: string;
  range: SelectionRange;
};

type MarkdownEditorPaneProps = {
  loadedDocumentContent: string | null;
  loadedDocumentRevision: number;
  onUserEditedDocument: (content: string) => void;
  onDocumentContentReplacedFromDisk?: (replacedWithContent: string) => void;
  onSelectionHasTextChanged?: (selectionHasText: boolean) => void;
  onSelectionDetailsChanged?: (details: EditorSelectionDetails | null) => void;
  onInlineCommentAnchorGeometryChanged?: () => void;
  onInlineCommentCreationAnchorChanged?: (
    anchorPosition: { top: number; left: number } | null,
  ) => void;
};

export type MarkdownEditorPaneHandle = {
  getCurrentContent: () => string | null;
  getAnchorPositionForDocumentRange: (
    rangeFrom: number,
    rangeTo: number,
  ) => { top: number; left: number } | null;
  createInlineCommentFromCurrentSelection: () => {
    ok: boolean;
    errorMessage?: string;
    createdCommentId?: string;
  };
  updateInlineCommentTextById: (
    commentId: string,
    nextCommentText: string,
  ) => boolean;
  deleteInlineCommentById: (commentId: string) => boolean;
};

// forwardRef lets the app shell ask for current editor content during blur,
// file switching, and close events without pushing every keystroke into React.
const MarkdownEditorPaneImpl = (
  {
    loadedDocumentContent,
    loadedDocumentRevision,
    onUserEditedDocument,
    onDocumentContentReplacedFromDisk,
    onSelectionHasTextChanged,
    onSelectionDetailsChanged,
    onInlineCommentAnchorGeometryChanged,
    onInlineCommentCreationAnchorChanged,
  }: MarkdownEditorPaneProps,
  ref: ForwardedRef<MarkdownEditorPaneHandle>,
) => {
  const editorContainerElementRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const isApplyingLoadedDocumentRef = useRef(false);
  // useLatestRef keeps each callback ref current on every render so the
  // one-shot CodeMirror update listener always sees the latest handler
  // without forcing editor instance recreation.
  const onUserEditedDocumentRef = useLatestRef(onUserEditedDocument);
  const onDocumentContentReplacedFromDiskRef = useLatestRef(
    onDocumentContentReplacedFromDisk,
  );
  const onSelectionHasTextChangedRef = useLatestRef(onSelectionHasTextChanged);
  const onSelectionDetailsChangedRef = useLatestRef(onSelectionDetailsChanged);
  const onInlineCommentAnchorGeometryChangedRef = useLatestRef(
    onInlineCommentAnchorGeometryChanged,
  );
  const onInlineCommentCreationAnchorChangedRef = useLatestRef(
    onInlineCommentCreationAnchorChanged,
  );

  /**
   * Why: floating comment cards and the selection action both need the same
   * coordinate translation from CodeMirror viewport space into editor-local UI.
   */
  const getEditorLocalAnchorPositionForDocumentRange = (
    editorView: EditorView,
    rangeFrom: number,
    rangeTo: number,
  ): { top: number; left: number } | null => {
    const clampedRangeFrom = Math.max(0, Math.min(rangeFrom, rangeTo));
    const clampedRangeTo = Math.min(
      editorView.state.doc.length,
      Math.max(rangeFrom, rangeTo),
    );
    const rangeAnchorCoordinates =
      editorView.coordsAtPos(clampedRangeTo) ??
      editorView.coordsAtPos(clampedRangeFrom);
    const editorContainerElement = editorContainerElementRef.current;
    if (!rangeAnchorCoordinates || !editorContainerElement) {
      return null;
    }

    const editorContainerBounds =
      editorContainerElement.getBoundingClientRect();
    return {
      top: rangeAnchorCoordinates.top - editorContainerBounds.top,
      left: rangeAnchorCoordinates.right - editorContainerBounds.left,
    };
  };

  /**
   * Why: the floating comment action belongs next to the current text
   * selection, so we translate CodeMirror's viewport coordinates into
   * editor-local coordinates that React can position against.
   */
  const emitInlineCommentCreationAnchorPosition = (editorView: EditorView) => {
    const anchorCallback = onInlineCommentCreationAnchorChangedRef.current;
    if (!anchorCallback) {
      return;
    }

    const primarySelectionRange = editorView.state.selection.main;
    if (primarySelectionRange.empty || !editorView.hasFocus) {
      anchorCallback(null);
      return;
    }

    const selectionTo = Math.max(
      primarySelectionRange.from,
      primarySelectionRange.to,
    );
    const selectionFrom = Math.min(
      primarySelectionRange.from,
      primarySelectionRange.to,
    );
    anchorCallback(
      getEditorLocalAnchorPositionForDocumentRange(
        editorView,
        selectionFrom,
        selectionTo,
      ),
    );
  };

  /**
   * Why: comment cards must re-pack when editor scroll or geometry changes, and
   * a shared emitter keeps those invalidation points consistent.
   */
  const emitInlineCommentAnchorGeometryChanged = () => {
    onInlineCommentAnchorGeometryChangedRef.current?.();
  };

  // exposing a tiny imperative handle keeps save/lifecycle integrations simple
  // while still letting CodeMirror own document and selection state internally.
  useImperativeHandle(
    ref,
    () => ({
      getCurrentContent: () =>
        editorViewRef.current?.state.doc.toString() ?? null,
      getAnchorPositionForDocumentRange: (rangeFrom, rangeTo) => {
        const editorView = editorViewRef.current;
        if (!editorView) {
          return null;
        }

        return getEditorLocalAnchorPositionForDocumentRange(
          editorView,
          rangeFrom,
          rangeTo,
        );
      },
      createInlineCommentFromCurrentSelection: () => {
        const editorView = editorViewRef.current;
        if (!editorView) {
          return { ok: false, errorMessage: 'Editor is not ready.' };
        }

        const primarySelectionRange = editorView.state.selection.main;
        if (primarySelectionRange.empty) {
          return {
            ok: false,
            errorMessage: 'Select some text before creating a comment.',
          };
        }

        const selectionFrom = Math.min(
          primarySelectionRange.from,
          primarySelectionRange.to,
        );
        const selectionTo = Math.max(
          primarySelectionRange.from,
          primarySelectionRange.to,
        );
        const currentMarkdownContent = editorView.state.doc.toString();

        if (
          doesSelectionOverlapExistingInlineComment(
            currentMarkdownContent,
            selectionFrom,
            selectionTo,
          )
        ) {
          return {
            ok: false,
            errorMessage:
              'Overlapping or nested comments are not supported in this MVP.',
          };
        }

        const createdCommentId = createInlineCommentId();
        const startMarker = createInlineCommentStartMarker(
          createdCommentId,
          '',
        );
        const endMarker = createInlineCommentEndMarker(createdCommentId);

        // Insert end marker first so the original selection offsets remain valid.
        editorView.dispatch({
          changes: [
            { from: selectionTo, insert: endMarker },
            { from: selectionFrom, insert: startMarker },
          ],
          selection: {
            anchor: selectionFrom + startMarker.length,
            head: selectionTo + startMarker.length,
          },
          scrollIntoView: true,
        });

        return { ok: true, createdCommentId };
      },
      updateInlineCommentTextById: (
        commentId: string,
        nextCommentText: string,
      ) => {
        const editorView = editorViewRef.current;
        if (!editorView) {
          return false;
        }

        const nextMarkdownContent = updateInlineCommentTextInMarkdown(
          editorView.state.doc.toString(),
          commentId,
          nextCommentText,
        );
        if (nextMarkdownContent === null) {
          return false;
        }

        dispatchFullDocumentReplacementPreservingCursor(
          editorView,
          nextMarkdownContent,
        );
        return true;
      },
      deleteInlineCommentById: (commentId: string) => {
        const editorView = editorViewRef.current;
        if (!editorView) {
          return false;
        }

        const nextMarkdownContent = removeInlineCommentMarkersFromMarkdown(
          editorView.state.doc.toString(),
          commentId,
        );
        if (nextMarkdownContent === null) {
          return false;
        }

        dispatchFullDocumentReplacementPreservingCursor(
          editorView,
          nextMarkdownContent,
        );
        return true;
      },
    }),
    [],
  );

  // CodeMirror should be instantiated exactly once per mounted editor host so
  // undo history, selection, and extensions stay stable across React renders.
  useEffect(() => {
    const editorContainerElement = editorContainerElementRef.current;
    if (!editorContainerElement || editorViewRef.current) {
      return;
    }

    editorViewRef.current = new EditorView({
      doc: loadedDocumentContent ?? '',
      extensions: [
        proseEditorSetupWithoutGutters,
        markdown(),
        headingLineDecorationExtension(),
        quoteLineDecorationExtension(),
        inlineCommentDecorationExtension(),
        inlineCommentAtomicRangesExtension(),
        inlineCommentEditGuardExtension(),
        livePreviewMarkersExtension(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            onSelectionHasTextChangedRef.current?.(
              !update.state.selection.main.empty,
            );
          }

          // Emit selection details for IDE integration on selection changes
          // only (not focus changes). The reference protocol (claudecode.nvim)
          // emits on cursor movement and selection changes, not on blur/focus.
          // Re-emitting on focusChanged causes extra selection_changed
          // notifications during prompt submission that reset Claude Code's
          // selection tracking. The main process cache persists the last
          // selection independently, so focus events are unnecessary.
          if (update.selectionSet) {
            const selectionDetailsCallback =
              onSelectionDetailsChangedRef.current;
            if (selectionDetailsCallback) {
              const mainSelection = update.state.selection.main;
              const fromPos = Math.min(mainSelection.from, mainSelection.to);
              const toPos = Math.max(mainSelection.from, mainSelection.to);
              const fromLine = update.state.doc.lineAt(fromPos);
              const toLine = update.state.doc.lineAt(toPos);
              selectionDetailsCallback({
                selectedText: update.state.sliceDoc(fromPos, toPos),
                range: {
                  start: {
                    line: fromLine.number - 1,
                    character: fromPos - fromLine.from,
                  },
                  end: {
                    line: toLine.number - 1,
                    character: toPos - toLine.from,
                  },
                },
              });
            }
          }

          if (
            update.selectionSet ||
            update.viewportChanged ||
            update.geometryChanged ||
            update.focusChanged
          ) {
            emitInlineCommentCreationAnchorPosition(update.view);
            emitInlineCommentAnchorGeometryChanged();
          }

          // Ignore programmatic file loads so they do not trigger autosave.
          if (!update.docChanged || isApplyingLoadedDocumentRef.current) {
            return;
          }

          onUserEditedDocumentRef.current(update.state.doc.toString());
        }),
      ],
      parent: editorContainerElement,
    });

    onSelectionHasTextChangedRef.current?.(
      !editorViewRef.current.state.selection.main.empty,
    );
    emitInlineCommentCreationAnchorPosition(editorViewRef.current);
    emitInlineCommentAnchorGeometryChanged();

    /* Show the scrollbar while actively scrolling, then fade it out after
       a short idle period. This keeps the gutter between editor and comments
       visually clean when the user isn't scrolling. */
    let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
    const handleEditorScroll = () => {
      emitInlineCommentCreationAnchorPosition(editorViewRef.current!);
      emitInlineCommentAnchorGeometryChanged();

      editorContainerElement.classList.add('is-scrolling');
      if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(() => {
        editorContainerElement.classList.remove('is-scrolling');
      }, 1000);
    };
    editorViewRef.current.scrollDOM.addEventListener(
      'scroll',
      handleEditorScroll,
    );

    return () => {
      editorViewRef.current?.scrollDOM.removeEventListener(
        'scroll',
        handleEditorScroll,
      );
      if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
      editorViewRef.current?.destroy();
      editorViewRef.current = null;
    };
  }, []);

  // External file loads replace the document contents in-place so CodeMirror
  // can preserve editor instance state instead of being torn down and rebuilt.
  // After the dispatch, onDocumentContentReplacedFromDisk is called so the
  // save controller can sync its state (clear stale save timers, update
  // lastSavedContent) at the exact moment the editor content is replaced —
  // not earlier when stale timers could still be created in the async gap.
  useEffect(() => {
    if (loadedDocumentContent === null) {
      return;
    }

    const editorView = editorViewRef.current;
    if (!editorView) {
      return;
    }

    const currentContent = editorView.state.doc.toString();
    if (currentContent === loadedDocumentContent) {
      // Content already matches (e.g. initial mount or no-op reload). Still
      // sync save state so the controller knows the editor is up to date.
      onDocumentContentReplacedFromDiskRef.current?.(loadedDocumentContent);
      return;
    }

    isApplyingLoadedDocumentRef.current = true;
    try {
      dispatchFullDocumentReplacementPreservingCursor(
        editorView,
        loadedDocumentContent,
      );
      emitInlineCommentCreationAnchorPosition(editorView);
      emitInlineCommentAnchorGeometryChanged();
    } finally {
      isApplyingLoadedDocumentRef.current = false;
    }

    // Sync save state after the editor dispatch so any save timers created
    // by user keystrokes during the async reload gap are cleared here.
    onDocumentContentReplacedFromDiskRef.current?.(loadedDocumentContent);
  }, [loadedDocumentContent, loadedDocumentRevision]);

  return <div id="editor" className="editor" ref={editorContainerElementRef} />;
};

export const MarkdownEditorPane = forwardRef(MarkdownEditorPaneImpl);
MarkdownEditorPane.displayName = 'MarkdownEditorPane';
