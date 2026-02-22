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
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';

import {
  livePreviewMarkersExtension,
  quoteLineDecorationExtension,
} from './codemirror-extensions';

type MarkdownEditorPaneProps = {
  loadedDocumentContent: string | null;
  onUserEditedDocument: (content: string) => void;
};

export type MarkdownEditorPaneHandle = {
  getCurrentContent: () => string | null;
};

// forwardRef lets the app shell ask for current editor content during blur,
// file switching, and close events without pushing every keystroke into React.
const MarkdownEditorPaneImpl = (
  { loadedDocumentContent, onUserEditedDocument }: MarkdownEditorPaneProps,
  ref: ForwardedRef<MarkdownEditorPaneHandle>,
) => {
  const editorContainerElementRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const isApplyingLoadedDocumentRef = useRef(false);
  const onUserEditedDocumentRef = useRef(onUserEditedDocument);

  // the update listener is attached once during editor creation, so a ref keeps
  // the latest React callback available without recreating the editor instance.
  useEffect(() => {
    onUserEditedDocumentRef.current = onUserEditedDocument;
  }, [onUserEditedDocument]);

  // exposing a tiny imperative handle keeps save/lifecycle integrations simple
  // while still letting CodeMirror own document and selection state internally.
  useImperativeHandle(
    ref,
    () => ({
      getCurrentContent: () =>
        editorViewRef.current?.state.doc.toString() ?? null,
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
        basicSetup,
        markdown(),
        quoteLineDecorationExtension(),
        livePreviewMarkersExtension(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          // Ignore programmatic file loads so they do not trigger autosave.
          if (!update.docChanged || isApplyingLoadedDocumentRef.current) {
            return;
          }

          onUserEditedDocumentRef.current(update.state.doc.toString());
        }),
      ],
      parent: editorContainerElement,
    });

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
  }, [loadedDocumentContent]);

  return <div id="editor" className="editor" ref={editorContainerElementRef} />;
};

export const MarkdownEditorPane = forwardRef(MarkdownEditorPaneImpl);
MarkdownEditorPane.displayName = 'MarkdownEditorPane';
