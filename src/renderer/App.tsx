//
// This file hosts the React application shell so UI chrome, lifecycle events,
// and file actions become easier to evolve while CodeMirror remains imperative.
//

import { useEffect, useRef, useState } from 'react';

import type { LoadMarkdownResponse } from '../shared-types';
import { createSaveController } from './save-controller';
import {
  MarkdownEditorPane,
  type MarkdownEditorPaneHandle,
} from './MarkdownEditorPane';
import { getMarkdownApi } from './markdown-api';

// app-level status text starts neutral until the first async document load
// completes and the shell can report a concrete save state.
const INITIAL_SAVE_STATUS_TEXT = 'Ready';

// React owns shell composition and lifecycle wiring here because those flows
// benefit from explicit state transitions more than imperative DOM queries.
export const App = () => {
  const [loadedDocument, setLoadedDocument] =
    useState<LoadMarkdownResponse | null>(null);
  const [saveStatusText, setSaveStatusText] = useState(
    INITIAL_SAVE_STATUS_TEXT,
  );
  const [isOpeningFile, setIsOpeningFile] = useState(false);

  const markdownEditorPaneRef = useRef<MarkdownEditorPaneHandle | null>(null);
  const saveControllerRef = useRef<ReturnType<
    typeof createSaveController
  > | null>(null);

  if (!saveControllerRef.current) {
    saveControllerRef.current = createSaveController({
      // the controller owns debounced autosave behavior while the React shell
      // remains focused on file lifecycle and UI state composition.
      saveMarkdownContent: async (content) => {
        await getMarkdownApi().saveMarkdown(content);
      },
      setSaveStatusText: (text) => {
        setSaveStatusText(text);
      },
    });
  }

  const saveController = saveControllerRef.current;

  // loading a file updates both editor content and top-bar metadata, so this
  // helper keeps startup and "Open..." behavior aligned in one place.
  const applyLoadedDocument = (nextLoadedDocument: LoadMarkdownResponse) => {
    saveController.markContentAsSavedFromLoad(nextLoadedDocument.content);
    setLoadedDocument(nextLoadedDocument);
    setSaveStatusText('Saved');
  };

  // startup is async because the main process decides which file path/content
  // to restore and the renderer shell should reflect that loading state.
  useEffect(() => {
    let isDisposed = false;

    const bootstrap = async () => {
      setSaveStatusText('Loading...');
      const initialDocument = await getMarkdownApi().loadMarkdown();
      if (isDisposed) {
        return;
      }

      applyLoadedDocument(initialDocument);
    };

    void bootstrap();

    return () => {
      isDisposed = true;
    };
  }, []);

  // blur and close should flush editor content through the existing save
  // controller so users are less likely to lose changes during lifecycle edges.
  useEffect(() => {
    const saveCurrentEditorContent = () => {
      const currentContent = markdownEditorPaneRef.current?.getCurrentContent();
      if (currentContent === null || currentContent === undefined) {
        return;
      }

      void saveController.saveNow(currentContent);
    };

    window.addEventListener('blur', saveCurrentEditorContent);
    window.addEventListener('beforeunload', saveCurrentEditorContent);

    return () => {
      window.removeEventListener('blur', saveCurrentEditorContent);
      window.removeEventListener('beforeunload', saveCurrentEditorContent);
    };
  }, [saveController]);

  // opening another file should behave like switching documents in an editor
  // and not allow overlapping native dialogs or skipped debounce flushes.
  const openMarkdownFile = async () => {
    if (isOpeningFile) {
      return;
    }

    setIsOpeningFile(true);
    try {
      const currentContent = markdownEditorPaneRef.current?.getCurrentContent();
      if (currentContent !== null && currentContent !== undefined) {
        // Save first so "Open..." behaves like a document switch, not discard.
        await saveController.flushPendingSave(() => currentContent);
      }

      setSaveStatusText('Opening...');
      const response = await getMarkdownApi().openMarkdownFile();
      if (response.canceled) {
        setSaveStatusText(markdownEditorPaneRef.current ? 'Saved' : 'Ready');
        return;
      }

      applyLoadedDocument(response);
    } catch (error) {
      setSaveStatusText('Open failed');
      console.error(error);
    } finally {
      setIsOpeningFile(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-title">kale</div>
        <button
          className="topbar-button"
          type="button"
          onClick={() => {
            void openMarkdownFile();
          }}
          disabled={isOpeningFile}
        >
          Open...
        </button>
        <div className="file-path">{loadedDocument?.filePath ?? ''}</div>
        <div className="save-status">{saveStatusText}</div>
      </header>
      <main className="workspace">
        <section className="pane">
          <div className="pane-title">Document</div>
          <MarkdownEditorPane
            ref={markdownEditorPaneRef}
            loadedDocumentContent={loadedDocument?.content ?? null}
            onUserEditedDocument={(content) => {
              saveController.scheduleSave(content);
            }}
          />
        </section>
      </main>
    </>
  );
};
