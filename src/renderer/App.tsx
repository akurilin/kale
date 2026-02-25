//
// This file hosts the React application shell so UI chrome, lifecycle events,
// and file actions become easier to evolve while CodeMirror remains imperative.
//

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type { LoadMarkdownResponse } from '../shared-types';
import { createSaveController } from './save-controller';
import {
  DocumentCommentsPane,
  type DocumentCommentsPaneHandle,
} from './DocumentCommentsPane';
import { mergeDocumentLines } from './line-merge';
import { getMarkdownApi } from './markdown-api';
import { TerminalPane } from './TerminalPane';

// app-level status text starts neutral until the first async document load
// completes and the shell can report a concrete save state.
const INITIAL_SAVE_STATUS_TEXT = 'Ready';
const DEFAULT_EDITOR_PANE_WIDTH_RATIO = 3 / 5;
const MIN_EDITOR_PANE_WIDTH_RATIO = 0.25;
const MAX_EDITOR_PANE_WIDTH_RATIO = 0.8;

// The renderer needs a folder path for terminal startup, so this helper keeps
// path parsing local and avoids coupling the pane to full document responses.
const getParentDirectoryPathFromFilePath = (filePath: string | null) => {
  if (!filePath) {
    return null;
  }

  const normalizedFilePath = filePath.replace(/\\/g, '/');
  const lastSlashIndex = normalizedFilePath.lastIndexOf('/');
  if (lastSlashIndex < 0) {
    return null;
  }

  if (lastSlashIndex === 0) {
    return '/';
  }

  return normalizedFilePath.slice(0, lastSlashIndex);
};

// This helper constrains drag updates so both panes remain usable while still
// allowing the user to strongly prefer one side over the other.
const clampEditorPaneWidthRatio = (editorPaneWidthRatio: number) => {
  return Math.min(
    MAX_EDITOR_PANE_WIDTH_RATIO,
    Math.max(MIN_EDITOR_PANE_WIDTH_RATIO, editorPaneWidthRatio),
  );
};

// React owns shell composition and lifecycle wiring here because those flows
// benefit from explicit state transitions more than imperative DOM queries.
export const App = () => {
  const [loadedDocument, setLoadedDocument] =
    useState<LoadMarkdownResponse | null>(null);
  const [loadedDocumentRevision, setLoadedDocumentRevision] = useState(0);
  const [saveStatusText, setSaveStatusText] = useState(
    INITIAL_SAVE_STATUS_TEXT,
  );
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [isRestoringFromGit, setIsRestoringFromGit] = useState(false);
  const [editorPaneWidthRatio, setEditorPaneWidthRatio] = useState(
    DEFAULT_EDITOR_PANE_WIDTH_RATIO,
  );
  const documentCommentsPaneRef = useRef<DocumentCommentsPaneHandle | null>(
    null,
  );
  const workspaceElementRef = useRef<HTMLElement | null>(null);
  const activeWorkspaceDividerDragCleanupRef = useRef<(() => void) | null>(
    null,
  );
  const isSuppressingLifecycleSaveRef = useRef(false);
  // When a three-way merge produces content that differs from disk, this ref
  // holds the actual disk content so the post-replacement callback can set
  // lastSavedContent to what's truly persisted (not the merged result). This
  // lets the save controller correctly detect the merged content as dirty and
  // persist it on the next save cycle. The ref is consumed once and cleared.
  const pendingDiskContentForSaveSyncRef = useRef<string | null>(null);
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
  const activeDocumentFilePath = loadedDocument?.filePath ?? null;
  const activeDocumentWorkingDirectory = getParentDirectoryPathFromFilePath(
    activeDocumentFilePath,
  );

  // Loading a file updates both editor content and top-bar metadata. Save
  // state synchronization is intentionally deferred to after the editor
  // dispatch (via onDocumentContentReplacedFromDisk) so that any save timers
  // created by user keystrokes during the async reload gap are correctly
  // cleared at the moment the editor content is actually replaced, not before.
  const applyLoadedDocument = useCallback(
    (nextLoadedDocument: LoadMarkdownResponse) => {
      setLoadedDocument(nextLoadedDocument);
      setLoadedDocumentRevision((previousRevision) => previousRevision + 1);
      setSaveStatusText('Saved');
    },
    [],
  );

  // This callback fires after MarkdownEditorPane's useEffect has dispatched
  // the content replacement into CodeMirror. Syncing save state here (instead
  // of in applyLoadedDocument) guarantees that stale save timers from
  // keystrokes typed during the async reload gap are cleared at the right
  // moment — after the editor content is actually replaced.
  //
  // When a three-way merge produced content that differs from disk, the
  // pending ref overrides lastSavedContent to the actual disk content so the
  // save controller sees the merged editor content as dirty and will persist
  // it. A save is scheduled immediately so the merge result reaches disk
  // without waiting for the user to type again.
  const handleDocumentContentReplacedFromDisk = useCallback(
    (replacedWithContent: string) => {
      const actualDiskContent = pendingDiskContentForSaveSyncRef.current;
      pendingDiskContentForSaveSyncRef.current = null;

      if (actualDiskContent !== null) {
        // Merge case: the editor now shows merged content that differs from
        // disk. Set lastSavedContent to what's actually on disk so the save
        // controller detects dirty state, then schedule a save to persist.
        saveController.markContentAsSavedFromLoad(actualDiskContent);
        saveController.scheduleSave(replacedWithContent);
      } else {
        // Normal case: editor content matches what was loaded from disk.
        saveController.markContentAsSavedFromLoad(replacedWithContent);
      }
    },
    [saveController],
  );

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
  }, [applyLoadedDocument]);

  // File-change notifications arrive for every disk write — including the
  // app's own saves. Content comparison against the save controller's last
  // known saved content distinguishes self-save echo-backs (ignore) from
  // genuine external changes (reload). This replaces the old timestamp-based
  // suppression heuristic with a deterministic check that is immune to
  // filesystem event timing variations.
  useEffect(() => {
    const removeFileChangeListener =
      getMarkdownApi().onExternalMarkdownFileChanged((event) => {
        if (
          !activeDocumentFilePath ||
          event.filePath !== activeDocumentFilePath
        ) {
          return;
        }

        void (async () => {
          try {
            const reloadedDocument = await getMarkdownApi().loadMarkdown();
            if (reloadedDocument.filePath !== activeDocumentFilePath) {
              return;
            }

            // Content comparison: if the disk content matches what we last
            // saved, this notification is the echo-back from our own save.
            // Skip the reload so user keystrokes are never interrupted.
            const lastSavedContent = saveController.getLastSavedContent();
            if (reloadedDocument.content === lastSavedContent) {
              return;
            }

            // Genuine external change. Check if the user has unsaved edits
            // that should be preserved via three-way merge.
            const currentEditorContent =
              documentCommentsPaneRef.current?.getCurrentContent();
            const editorHasUnsavedEdits =
              currentEditorContent != null &&
              currentEditorContent !== lastSavedContent;

            if (editorHasUnsavedEdits) {
              // Three-way merge: base (last save) × ours (editor) × theirs
              // (disk). Non-conflicting edits from both sides are preserved;
              // conflicts resolve in favor of the disk version.
              const mergeResult = mergeDocumentLines(
                lastSavedContent,
                currentEditorContent,
                reloadedDocument.content,
              );

              if (mergeResult.content !== reloadedDocument.content) {
                // Merge preserved user edits — tell the post-replacement
                // callback to use the actual disk content as lastSavedContent
                // so the save controller will persist the merged result.
                pendingDiskContentForSaveSyncRef.current =
                  reloadedDocument.content;
              }

              const mergedDocument = {
                ...reloadedDocument,
                content: mergeResult.content,
              };
              applyLoadedDocument(mergedDocument);

              if (mergeResult.content === reloadedDocument.content) {
                setSaveStatusText('Reloaded from disk');
              } else if (mergeResult.hadConflicts) {
                setSaveStatusText('Merged (some edits overwritten)');
              } else {
                setSaveStatusText('Merged with external changes');
              }
            } else {
              // Editor is clean — apply the disk content directly.
              applyLoadedDocument(reloadedDocument);
              setSaveStatusText('Reloaded from disk');
            }
          } catch (error) {
            setSaveStatusText('Reload failed');
            console.error(error);
          }
        })();
      });

    return () => {
      removeFileChangeListener();
    };
  }, [activeDocumentFilePath, applyLoadedDocument, saveController]);

  // blur and close should flush editor content through the existing save
  // controller so users are less likely to lose changes during lifecycle edges.
  useEffect(() => {
    const saveCurrentEditorContent = () => {
      if (isSuppressingLifecycleSaveRef.current) {
        return;
      }

      const currentContent =
        documentCommentsPaneRef.current?.getCurrentContent();
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

  // Window-scoped drag listeners are attached outside React's event system, so
  // unmount cleanup must release any active drag handlers to avoid leaks.
  useEffect(() => {
    return () => {
      activeWorkspaceDividerDragCleanupRef.current?.();
      activeWorkspaceDividerDragCleanupRef.current = null;
    };
  }, []);

  // opening another file should behave like switching documents in an editor
  // and not allow overlapping native dialogs or skipped debounce flushes.
  const openMarkdownFile = async () => {
    if (isOpeningFile) {
      return;
    }

    setIsOpeningFile(true);
    try {
      const currentContent =
        documentCommentsPaneRef.current?.getCurrentContent();
      if (currentContent !== null && currentContent !== undefined) {
        // Save first so "Open..." behaves like a document switch, not discard.
        await saveController.flushPendingSave(() => currentContent);
      }

      setSaveStatusText('Opening...');
      const response = await getMarkdownApi().openMarkdownFile();
      if (response.canceled) {
        setSaveStatusText(documentCommentsPaneRef.current ? 'Saved' : 'Ready');
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

  // This action intentionally discards local edits, so the flow confirms first
  // and then reloads the editor from the Git-restored file on disk.
  const restoreCurrentFileFromGit = async () => {
    if (!loadedDocument || isRestoringFromGit) {
      return;
    }

    isSuppressingLifecycleSaveRef.current = true;
    const confirmed = window.confirm(
      `Restore this file from Git HEAD and discard local changes?\n\n${loadedDocument.filePath}`,
    );
    if (!confirmed) {
      isSuppressingLifecycleSaveRef.current = false;
      return;
    }

    setIsRestoringFromGit(true);
    saveController.clearPendingSaveTimer();
    setSaveStatusText('Restoring from Git...');
    try {
      const response = await getMarkdownApi().restoreCurrentMarkdownFromGit();
      if (!response.ok) {
        setSaveStatusText('Git restore failed');
        window.alert(
          `Could not restore file from Git.\n\n${response.errorMessage}`,
        );
        return;
      }

      applyLoadedDocument(response);
    } catch (error) {
      setSaveStatusText('Git restore failed');
      console.error(error);
    } finally {
      isSuppressingLifecycleSaveRef.current = false;
      setIsRestoringFromGit(false);
    }
  };

  // The split ratio lives in React state so the default ratio is only a
  // starting point and user drags can redefine the layout for the session.
  const resizeWorkspacePanesFromClientX = (clientX: number) => {
    const workspaceElement = workspaceElementRef.current;
    if (!workspaceElement) {
      return;
    }

    const workspaceBounds = workspaceElement.getBoundingClientRect();
    if (workspaceBounds.width <= 0) {
      return;
    }

    const nextEditorPaneWidthRatio =
      (clientX - workspaceBounds.left) / workspaceBounds.width;
    setEditorPaneWidthRatio(
      clampEditorPaneWidthRatio(nextEditorPaneWidthRatio),
    );
  };

  // Mouse drag listeners are attached to the window during the drag so resizing
  // continues smoothly even when the pointer leaves the narrow splitter target.
  const startWorkspaceDividerDrag = (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    activeWorkspaceDividerDragCleanupRef.current?.();

    const handleWindowMouseMove = (mouseMoveEvent: MouseEvent) => {
      resizeWorkspacePanesFromClientX(mouseMoveEvent.clientX);
    };

    const finishWorkspaceDividerDrag = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', finishWorkspaceDividerDrag);
      document.body.classList.remove('is-resizing-panes');
      if (
        activeWorkspaceDividerDragCleanupRef.current ===
        finishWorkspaceDividerDrag
      ) {
        activeWorkspaceDividerDragCleanupRef.current = null;
      }
    };

    activeWorkspaceDividerDragCleanupRef.current = finishWorkspaceDividerDrag;
    document.body.classList.add('is-resizing-panes');
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', finishWorkspaceDividerDrag);
    resizeWorkspacePanesFromClientX(event.clientX);
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
        <button
          className="topbar-button"
          type="button"
          onClick={() => {
            void restoreCurrentFileFromGit();
          }}
          disabled={!loadedDocument || isRestoringFromGit}
        >
          {isRestoringFromGit ? 'Restoring...' : 'Restore Git'}
        </button>
        <div className="file-path">{loadedDocument?.filePath ?? ''}</div>
        <div className="save-status">{saveStatusText}</div>
      </header>
      <main
        className="workspace workspace--split"
        ref={workspaceElementRef}
        style={
          {
            '--workspace-split-columns': `${editorPaneWidthRatio}fr 8px ${1 - editorPaneWidthRatio}fr`,
          } as CSSProperties
        }
      >
        <section className="pane workspace-pane workspace-pane--editor">
          <div className="pane-title">Document</div>
          <DocumentCommentsPane
            ref={documentCommentsPaneRef}
            loadedDocumentContent={loadedDocument?.content ?? null}
            loadedDocumentRevision={loadedDocumentRevision}
            onUserEditedDocument={(content) => {
              saveController.scheduleSave(content);
            }}
            onDocumentContentReplacedFromDisk={
              handleDocumentContentReplacedFromDisk
            }
          />
        </section>
        <div
          className="workspace-divider"
          aria-hidden="true"
          onMouseDown={startWorkspaceDividerDrag}
        />
        <TerminalPane
          title="Terminal"
          targetFilePath={activeDocumentFilePath}
          targetWorkingDirectory={activeDocumentWorkingDirectory}
          showMetadataPanel={false}
        />
      </main>
    </>
  );
};
