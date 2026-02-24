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
import { markdown } from '@codemirror/lang-markdown';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
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
  headingUnderlineResetHighlightExtension,
  inlineCommentDecorationExtension,
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

// CodeMirror recommends copying basicSetup when you need customization. This
// local setup preserves the useful editor defaults while omitting gutter
// features (line numbers, fold gutter, gutter active-line highlight) so the
// prose editor truly does not mount a line counter pane at all.
const proseEditorSetupWithoutGutters: Extension = [
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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

type MarkdownEditorPaneProps = {
  loadedDocumentContent: string | null;
  loadedDocumentRevision: number;
  onUserEditedDocument: (content: string) => void;
  onSelectionHasTextChanged?: (selectionHasText: boolean) => void;
};

export type MarkdownEditorPaneHandle = {
  getCurrentContent: () => string | null;
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
    onSelectionHasTextChanged,
  }: MarkdownEditorPaneProps,
  ref: ForwardedRef<MarkdownEditorPaneHandle>,
) => {
  const editorContainerElementRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const isApplyingLoadedDocumentRef = useRef(false);
  const onUserEditedDocumentRef = useRef(onUserEditedDocument);
  const onSelectionHasTextChangedRef = useRef(onSelectionHasTextChanged);

  // the update listener is attached once during editor creation, so a ref keeps
  // the latest React callback available without recreating the editor instance.
  useEffect(() => {
    onUserEditedDocumentRef.current = onUserEditedDocument;
  }, [onUserEditedDocument]);

  // Selection listeners are also attached once, so a ref keeps the latest
  // callback available without recreating the editor instance.
  useEffect(() => {
    onSelectionHasTextChangedRef.current = onSelectionHasTextChanged;
  }, [onSelectionHasTextChanged]);

  // exposing a tiny imperative handle keeps save/lifecycle integrations simple
  // while still letting CodeMirror own document and selection state internally.
  useImperativeHandle(
    ref,
    () => ({
      getCurrentContent: () =>
        editorViewRef.current?.state.doc.toString() ?? null,
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

        editorView.dispatch({
          changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: nextMarkdownContent,
          },
        });
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

        editorView.dispatch({
          changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: nextMarkdownContent,
          },
        });
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
        headingUnderlineResetHighlightExtension(),
        headingLineDecorationExtension(),
        quoteLineDecorationExtension(),
        inlineCommentDecorationExtension(),
        livePreviewMarkersExtension(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            onSelectionHasTextChangedRef.current?.(
              !update.state.selection.main.empty,
            );
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

    return () => {
      editorViewRef.current?.destroy();
      editorViewRef.current = null;
    };
  }, []);

  // external file loads replace the document contents in-place so CodeMirror
  // can preserve editor instance state instead of being torn down and rebuilt.
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
      return;
    }

    isApplyingLoadedDocumentRef.current = true;
    try {
      editorView.dispatch({
        changes: {
          from: 0,
          to: editorView.state.doc.length,
          insert: loadedDocumentContent,
        },
      });
    } finally {
      isApplyingLoadedDocumentRef.current = false;
    }
  }, [loadedDocumentContent, loadedDocumentRevision]);

  return <div id="editor" className="editor" ref={editorContainerElementRef} />;
};

export const MarkdownEditorPane = forwardRef(MarkdownEditorPaneImpl);
MarkdownEditorPane.displayName = 'MarkdownEditorPane';
