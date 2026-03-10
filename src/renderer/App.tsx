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

import type {
  IdeSelectionChangedEvent,
  LoadMarkdownResponse,
} from '../shared-types';
import { createSaveController } from './save-controller';
import {
  DocumentCommentsPane,
  type DocumentCommentsPaneHandle,
} from './DocumentCommentsPane';
import { getIdeServerApi } from './ide-server-api';
import { mergeDocumentLines } from './line-merge';
import { getMarkdownApi } from './markdown-api';
import { RepositoryFileExplorerPane } from './RepositoryFileExplorerPane';
import { TerminalPane } from './TerminalPane';
import { countWordsInMarkdownContent } from './word-count';

// app-level status text starts neutral until the first async document load
// completes and the shell can report a concrete save state.
const INITIAL_SAVE_STATUS_TEXT = '';
const SAVE_SUCCESS_STATUS_TEXT = 'Saved';
const SAVE_SUCCESS_STATUS_VISIBLE_DURATION_MS = 3000;
const WORKSPACE_DIVIDER_WIDTH_PIXELS = 8;
const DEFAULT_EXPLORER_PANE_WIDTH_PIXELS = 280;
const MIN_EXPLORER_PANE_WIDTH_PIXELS = 220;
const MAX_EXPLORER_PANE_WIDTH_PIXELS = 420;
const DEFAULT_TERMINAL_PANE_COLLAPSED = false;
const DEFAULT_TERMINAL_PANE_WIDTH_PIXELS = 420;
const MIN_TERMINAL_PANE_WIDTH_PIXELS = 280;
const MAX_TERMINAL_PANE_WIDTH_PIXELS = 720;
const MIN_EDITOR_PANE_WIDTH_PIXELS = 360;

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

// Sidebar widths should stay within explicit pixel bounds so both side panes
// remain ergonomic while the center editor retains a useful minimum size.
const clampWorkspacePaneWidthPixels = (
  requestedPaneWidthPixels: number,
  minimumPaneWidthPixels: number,
  maximumPaneWidthPixels: number,
) => {
  return Math.min(
    maximumPaneWidthPixels,
    Math.max(minimumPaneWidthPixels, requestedPaneWidthPixels),
  );
};

// The split grid is driven from one helper so expand/collapse can swap tracks
// without duplicating column math across JSX, drag handlers, and resize logic.
const buildWorkspaceSplitColumnsValue = ({
  explorerPaneWidthPixels,
  isExplorerPaneVisible,
  isTerminalPaneVisible,
  terminalPaneWidthPixels,
}: {
  explorerPaneWidthPixels: number;
  isExplorerPaneVisible: boolean;
  isTerminalPaneVisible: boolean;
  terminalPaneWidthPixels: number;
}) => {
  const resolvedExplorerPaneWidthPixels = isExplorerPaneVisible
    ? explorerPaneWidthPixels
    : 0;
  const resolvedExplorerDividerWidthPixels = isExplorerPaneVisible
    ? WORKSPACE_DIVIDER_WIDTH_PIXELS
    : 0;
  const resolvedTerminalDividerWidthPixels = isTerminalPaneVisible
    ? WORKSPACE_DIVIDER_WIDTH_PIXELS
    : 0;
  const resolvedTerminalPaneWidthPixels = isTerminalPaneVisible
    ? terminalPaneWidthPixels
    : 0;

  return `${resolvedExplorerPaneWidthPixels}px ${resolvedExplorerDividerWidthPixels}px minmax(0, 1fr) ${resolvedTerminalDividerWidthPixels}px ${resolvedTerminalPaneWidthPixels}px`;
};

// Keeping the toggle icon as a tiny component avoids repeating SVG markup in
// the top bar and makes expanded/collapsed semantics explicit at the call site.
const ExplorerPaneToggleIcon = ({
  isExplorerPaneVisible,
}: {
  isExplorerPaneVisible: boolean;
}) => (
  <svg
    className={`topbar-explorer-toggle-icon ${
      isExplorerPaneVisible ? 'topbar-explorer-toggle-icon--active' : ''
    }`.trim()}
    viewBox="0 0 20 20"
    width="16"
    height="16"
    aria-hidden="true"
  >
    <rect
      className="topbar-explorer-toggle-icon-outline"
      x="1.5"
      y="2.5"
      width="17"
      height="15"
      rx="3"
    />
    <rect
      className="topbar-explorer-toggle-icon-explorer-pane"
      x="3"
      y="4"
      width="3.5"
      height="12"
      rx="1.2"
    />
    <rect
      className="topbar-explorer-toggle-icon-main-pane"
      x="7"
      y="4"
      width="10"
      height="12"
      rx="1.8"
    />
  </svg>
);

const TerminalPaneToggleIcon = ({
  isTerminalPaneVisible,
}: {
  isTerminalPaneVisible: boolean;
}) => (
  <svg
    className={`topbar-terminal-toggle-icon ${
      isTerminalPaneVisible ? 'topbar-terminal-toggle-icon--active' : ''
    }`.trim()}
    viewBox="0 0 20 20"
    width="16"
    height="16"
    aria-hidden="true"
  >
    <rect
      className="topbar-terminal-toggle-icon-outline"
      x="1.5"
      y="2.5"
      width="17"
      height="15"
      rx="3"
    />
    <rect
      className="topbar-terminal-toggle-icon-main-pane"
      x="3"
      y="4"
      width="10"
      height="12"
      rx="1.8"
    />
    <rect
      className="topbar-terminal-toggle-icon-terminal-pane"
      x="13.5"
      y="4"
      width="3.5"
      height="12"
      rx="1.2"
    />
  </svg>
);

// The title-row badge stays concise and readable by handling singular/plural
// label formatting in one place.
const formatWordCountLabel = (wordCount: number): string =>
  `${wordCount.toLocaleString()} ${wordCount === 1 ? 'word' : 'words'}`;

type ApplyLoadedDocumentOptions = {
  saveStatusTextAfterLoad?: string;
};

// React owns shell composition and lifecycle wiring here because those flows
// benefit from explicit state transitions more than imperative DOM queries.
export const App = () => {
  const [loadedDocument, setLoadedDocument] =
    useState<LoadMarkdownResponse | null>(null);
  const [loadedDocumentRevision, setLoadedDocumentRevision] = useState(0);
  const [editorContentForWordCount, setEditorContentForWordCount] = useState<
    string | null
  >(null);
  const [saveStatusText, setSaveStatusText] = useState(
    INITIAL_SAVE_STATUS_TEXT,
  );
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isRestoringFromGit, setIsRestoringFromGit] = useState(false);
  const [isSavingCurrentFileToGit, setIsSavingCurrentFileToGit] =
    useState(false);
  const [explorerPaneWidthPixels, setExplorerPaneWidthPixels] = useState(
    DEFAULT_EXPLORER_PANE_WIDTH_PIXELS,
  );
  const [terminalPaneWidthPixels, setTerminalPaneWidthPixels] = useState(
    DEFAULT_TERMINAL_PANE_WIDTH_PIXELS,
  );
  const [isExplorerPaneManuallyCollapsed, setIsExplorerPaneManuallyCollapsed] =
    useState(false);
  const [explorerRepositoryAvailability, setExplorerRepositoryAvailability] =
    useState<boolean | null>(null);
  const [isTerminalPaneCollapsed, setIsTerminalPaneCollapsed] = useState(
    DEFAULT_TERMINAL_PANE_COLLAPSED,
  );
  const documentCommentsPaneRef = useRef<DocumentCommentsPaneHandle | null>(
    null,
  );
  const workspaceElementRef = useRef<HTMLElement | null>(null);
  const activeExplorerDividerDragCleanupRef = useRef<(() => void) | null>(null);
  const activeTerminalDividerDragCleanupRef = useRef<(() => void) | null>(null);
  const isSuppressingLifecycleSaveRef = useRef(false);
  const isSuppressingExternalMarkdownReloadRef = useRef(false);
  // When a three-way merge produces content that differs from disk, this ref
  // holds the actual disk content so the post-replacement callback can set
  // lastSavedContent to what's truly persisted (not the merged result). This
  // lets the save controller correctly detect the merged content as dirty and
  // persist it on the next save cycle. The ref is consumed once and cleared.
  const pendingDiskContentForSaveSyncRef = useRef<string | null>(null);
  const saveControllerRef = useRef<ReturnType<
    typeof createSaveController
  > | null>(null);
  const clearSaveSuccessStatusTimeoutRef = useRef<number | null>(null);

  // Save success should read as a transient confirmation, so this helper keeps
  // timeout cleanup centralized whenever status transitions or effects unmount.
  const clearPendingSaveSuccessStatusTimeout = useCallback(() => {
    if (clearSaveSuccessStatusTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(clearSaveSuccessStatusTimeoutRef.current);
    clearSaveSuccessStatusTimeoutRef.current = null;
  }, []);

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
  const isExplorerRepositoryAvailable = explorerRepositoryAvailability === true;
  const isExplorerPaneVisible =
    isExplorerRepositoryAvailable && !isExplorerPaneManuallyCollapsed;
  const isTerminalPaneVisible = !isTerminalPaneCollapsed;
  const activeDocumentWordCount = countWordsInMarkdownContent(
    editorContentForWordCount ?? loadedDocument?.content ?? null,
  );
  const activeDocumentWordCountLabel = formatWordCountLabel(
    activeDocumentWordCount,
  );
  const isSaveCurrentFileToGitActionDisabled =
    !loadedDocument || isSavingCurrentFileToGit || isRestoringFromGit;

  // "Saved" should pulse briefly and then clear so the next successful save
  // provides a fresh visual acknowledgment instead of persistent idle text.
  useEffect(() => {
    clearPendingSaveSuccessStatusTimeout();
    if (saveStatusText !== SAVE_SUCCESS_STATUS_TEXT) {
      return;
    }

    clearSaveSuccessStatusTimeoutRef.current = window.setTimeout(() => {
      clearSaveSuccessStatusTimeoutRef.current = null;
      setSaveStatusText((currentSaveStatusText) =>
        currentSaveStatusText === SAVE_SUCCESS_STATUS_TEXT
          ? ''
          : currentSaveStatusText,
      );
    }, SAVE_SUCCESS_STATUS_VISIBLE_DURATION_MS);

    return () => {
      clearPendingSaveSuccessStatusTimeout();
    };
  }, [clearPendingSaveSuccessStatusTimeout, saveStatusText]);

  // Loading a file updates both editor content and top-bar metadata. Save
  // state synchronization is intentionally deferred to after the editor
  // dispatch (via onDocumentContentReplacedFromDisk) so that any save timers
  // created by user keystrokes during the async reload gap are correctly
  // cleared at the moment the editor content is actually replaced, not before.
  // Status text is caller-controlled so startup can stay neutral instead of
  // showing a misleading "Saved" pulse before any write happened.
  const applyLoadedDocument = useCallback(
    (
      nextLoadedDocument: LoadMarkdownResponse,
      {
        saveStatusTextAfterLoad = INITIAL_SAVE_STATUS_TEXT,
      }: ApplyLoadedDocumentOptions = {},
    ) => {
      setLoadedDocument(nextLoadedDocument);
      setLoadedDocumentRevision((previousRevision) => previousRevision + 1);
      setEditorContentForWordCount(nextLoadedDocument.content);
      setSaveStatusText(saveStatusTextAfterLoad);
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
      setEditorContentForWordCount(replacedWithContent);
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

  // Save should be fast and deterministic, so this flow flushes editor content
  // to disk first, then stages/commits only the active file with a stock
  // message in that file's own git repository.
  const saveCurrentFileToGitWithStockMessage = useCallback(async () => {
    if (isSaveCurrentFileToGitActionDisabled) {
      return;
    }

    setIsSavingCurrentFileToGit(true);
    try {
      const currentEditorContent =
        documentCommentsPaneRef.current?.getCurrentContent();
      if (currentEditorContent !== null && currentEditorContent !== undefined) {
        await saveController.flushPendingSave(() => currentEditorContent);
      }

      setSaveStatusText('Committing...');
      const response = await getMarkdownApi().commitCurrentMarkdownFile();
      if (!response.ok) {
        setSaveStatusText('Save failed');
        window.alert(`Could not commit this file.\n\n${response.errorMessage}`);
        return;
      }

      setSaveStatusText(
        response.didCreateCommit ? 'Committed' : 'No changes to commit',
      );
    } catch (error) {
      setSaveStatusText('Save failed');
      console.error(error);
    } finally {
      setIsSavingCurrentFileToGit(false);
    }
  }, [isSaveCurrentFileToGitActionDisabled, saveController]);

  // Startup is async because main decides which file path/content to restore.
  // Status intentionally stays blank here until there's actionable feedback.
  useEffect(() => {
    let isDisposed = false;

    const bootstrap = async () => {
      const initialDocument = await getMarkdownApi().loadMarkdown();
      if (isDisposed) {
        return;
      }

      applyLoadedDocument(initialDocument, {
        saveStatusTextAfterLoad: INITIAL_SAVE_STATUS_TEXT,
      });
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
        if (isSuppressingExternalMarkdownReloadRef.current) {
          return;
        }

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

  // Called by the editor pane on every selection or focus change. Always pushes
  // to main (including cursor-only positions) so the MCP server has fresh state
  // and can broadcast accurate selection_changed notifications to Claude Code.
  const handleIdeSelectionChanged = useCallback(
    (event: IdeSelectionChangedEvent | null) => {
      if (event) {
        getIdeServerApi().reportSelectionChanged(event);
      }
    },
    [],
  );

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
      activeExplorerDividerDragCleanupRef.current?.();
      activeExplorerDividerDragCleanupRef.current = null;
      activeTerminalDividerDragCleanupRef.current?.();
      activeTerminalDividerDragCleanupRef.current = null;
    };
  }, []);

  // Repository availability can hide the explorer while a drag is active, so
  // that transition must tear down any global mouse listeners immediately.
  useEffect(() => {
    if (isExplorerRepositoryAvailable) {
      return;
    }

    activeExplorerDividerDragCleanupRef.current?.();
  }, [isExplorerRepositoryAvailable]);

  // File dialogs should return the top bar to a stable idle label when users
  // cancel, so this helper keeps the fallback text consistent across actions.
  const getIdleSaveStatusTextAfterFileDialog = () => {
    return INITIAL_SAVE_STATUS_TEXT;
  };

  // Document switches should preserve the current draft first, so Open and New
  // both flush the debounced save queue through one shared helper.
  const flushCurrentEditorContentBeforeFileSwitch = async () => {
    const currentContent = documentCommentsPaneRef.current?.getCurrentContent();
    if (currentContent === null || currentContent === undefined) {
      return;
    }

    await saveController.flushPendingSave(() => currentContent);
  };

  // opening another file should behave like switching documents in an editor
  // and not allow overlapping native dialogs or skipped debounce flushes.
  const openMarkdownFile = async () => {
    if (isOpeningFile || isCreatingFile) {
      return;
    }

    setIsOpeningFile(true);
    try {
      // Save first so "Open..." behaves like a document switch, not discard.
      await flushCurrentEditorContentBeforeFileSwitch();

      setSaveStatusText('Opening...');
      const response = await getMarkdownApi().openMarkdownFile();
      if (response.canceled) {
        setSaveStatusText(getIdleSaveStatusTextAfterFileDialog());
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

  // Explorer-initiated file opens should preserve the same save-before-switch
  // lifecycle as the top-bar Open/New flows without coupling explorer logic to
  // editor internals.
  const openMarkdownFileAtPath = useCallback(
    async (filePath: string) => {
      if (isOpeningFile || isCreatingFile) {
        return;
      }

      setIsOpeningFile(true);
      try {
        await flushCurrentEditorContentBeforeFileSwitch();

        setSaveStatusText('Opening...');
        const response =
          await getMarkdownApi().openMarkdownFileAtPath(filePath);
        if (!response.ok) {
          setSaveStatusText('Open failed');
          window.alert(`Could not open this file.\n\n${response.errorMessage}`);
          return;
        }

        applyLoadedDocument(response);
      } catch (error) {
        setSaveStatusText('Open failed');
        console.error(error);
      } finally {
        setIsOpeningFile(false);
      }
    },
    [applyLoadedDocument, isCreatingFile, isOpeningFile],
  );

  // New document creation should mirror Open's switch behavior while using a
  // native save panel to choose destination folder and file name in one step.
  const createMarkdownFile = async () => {
    if (isCreatingFile || isOpeningFile) {
      return;
    }

    setIsCreatingFile(true);
    try {
      // Save first so "New..." also behaves like a document switch.
      await flushCurrentEditorContentBeforeFileSwitch();

      setSaveStatusText('Creating...');
      const response = await getMarkdownApi().createMarkdownFile();
      if (response.canceled) {
        setSaveStatusText(getIdleSaveStatusTextAfterFileDialog());
        return;
      }

      applyLoadedDocument(response);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown file create error';
      setSaveStatusText('Create failed');
      window.alert(`Could not create a new markdown file.\n\n${errorMessage}`);
      console.error(error);
    } finally {
      setIsCreatingFile(false);
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

    isSuppressingExternalMarkdownReloadRef.current = true;
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
      isSuppressingExternalMarkdownReloadRef.current = false;
      setIsRestoringFromGit(false);
    }
  };

  // Sidebar drag sizing should only run in desktop split mode so responsive
  // stacked layouts do not receive meaningless horizontal resize gestures.
  const isCompactWorkspaceLayoutActive = () => {
    return window.innerWidth <= 900;
  };

  // Left-sidebar drag math clamps against the visible right sidebar and a
  // minimum editor width so the center document pane never becomes unusable.
  const resizeExplorerPaneFromClientX = (clientX: number) => {
    const workspaceElement = workspaceElementRef.current;
    if (!workspaceElement) {
      return;
    }

    const workspaceBounds = workspaceElement.getBoundingClientRect();
    if (workspaceBounds.width <= 0) {
      return;
    }

    const visibleTerminalAreaWidthPixels = isTerminalPaneVisible
      ? terminalPaneWidthPixels + WORKSPACE_DIVIDER_WIDTH_PIXELS
      : 0;
    const maximumExplorerPaneWidthPixels = Math.min(
      MAX_EXPLORER_PANE_WIDTH_PIXELS,
      Math.max(
        MIN_EXPLORER_PANE_WIDTH_PIXELS,
        Math.floor(
          workspaceBounds.width -
            visibleTerminalAreaWidthPixels -
            MIN_EDITOR_PANE_WIDTH_PIXELS -
            WORKSPACE_DIVIDER_WIDTH_PIXELS,
        ),
      ),
    );
    const requestedExplorerPaneWidthPixels =
      clientX - workspaceBounds.left - WORKSPACE_DIVIDER_WIDTH_PIXELS / 2;
    setExplorerPaneWidthPixels(
      clampWorkspacePaneWidthPixels(
        requestedExplorerPaneWidthPixels,
        MIN_EXPLORER_PANE_WIDTH_PIXELS,
        maximumExplorerPaneWidthPixels,
      ),
    );
  };

  // Right-sidebar drag math mirrors the explorer logic while measuring width
  // from the workspace's right edge for a natural terminal resize gesture.
  const resizeTerminalPaneFromClientX = (clientX: number) => {
    const workspaceElement = workspaceElementRef.current;
    if (!workspaceElement) {
      return;
    }

    const workspaceBounds = workspaceElement.getBoundingClientRect();
    if (workspaceBounds.width <= 0) {
      return;
    }

    const visibleExplorerAreaWidthPixels = isExplorerPaneVisible
      ? explorerPaneWidthPixels + WORKSPACE_DIVIDER_WIDTH_PIXELS
      : 0;
    const maximumTerminalPaneWidthPixels = Math.min(
      MAX_TERMINAL_PANE_WIDTH_PIXELS,
      Math.max(
        MIN_TERMINAL_PANE_WIDTH_PIXELS,
        Math.floor(
          workspaceBounds.width -
            visibleExplorerAreaWidthPixels -
            MIN_EDITOR_PANE_WIDTH_PIXELS -
            WORKSPACE_DIVIDER_WIDTH_PIXELS,
        ),
      ),
    );
    const requestedTerminalPaneWidthPixels =
      workspaceBounds.right - clientX - WORKSPACE_DIVIDER_WIDTH_PIXELS / 2;
    setTerminalPaneWidthPixels(
      clampWorkspacePaneWidthPixels(
        requestedTerminalPaneWidthPixels,
        MIN_TERMINAL_PANE_WIDTH_PIXELS,
        maximumTerminalPaneWidthPixels,
      ),
    );
  };

  // Drag listeners live on the window so resizing stays smooth after the
  // pointer leaves the narrow divider target.
  const startExplorerDividerDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isExplorerPaneVisible || isCompactWorkspaceLayoutActive()) {
      return;
    }

    event.preventDefault();
    activeExplorerDividerDragCleanupRef.current?.();
    activeTerminalDividerDragCleanupRef.current?.();

    const handleWindowMouseMove = (mouseMoveEvent: MouseEvent) => {
      resizeExplorerPaneFromClientX(mouseMoveEvent.clientX);
    };

    const finishExplorerDividerDrag = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', finishExplorerDividerDrag);
      document.body.classList.remove('is-resizing-panes');
      if (
        activeExplorerDividerDragCleanupRef.current ===
        finishExplorerDividerDrag
      ) {
        activeExplorerDividerDragCleanupRef.current = null;
      }
    };

    activeExplorerDividerDragCleanupRef.current = finishExplorerDividerDrag;
    document.body.classList.add('is-resizing-panes');
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', finishExplorerDividerDrag);
    resizeExplorerPaneFromClientX(event.clientX);
  };

  const startTerminalDividerDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isTerminalPaneVisible || isCompactWorkspaceLayoutActive()) {
      return;
    }

    event.preventDefault();
    activeTerminalDividerDragCleanupRef.current?.();
    activeExplorerDividerDragCleanupRef.current?.();

    const handleWindowMouseMove = (mouseMoveEvent: MouseEvent) => {
      resizeTerminalPaneFromClientX(mouseMoveEvent.clientX);
    };

    const finishTerminalDividerDrag = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', finishTerminalDividerDrag);
      document.body.classList.remove('is-resizing-panes');
      if (
        activeTerminalDividerDragCleanupRef.current ===
        finishTerminalDividerDrag
      ) {
        activeTerminalDividerDragCleanupRef.current = null;
      }
    };

    activeTerminalDividerDragCleanupRef.current = finishTerminalDividerDrag;
    document.body.classList.add('is-resizing-panes');
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', finishTerminalDividerDrag);
    resizeTerminalPaneFromClientX(event.clientX);
  };

  // The explorer should behave like the terminal pane: manual collapse only
  // changes the workspace split and keeps the remembered sidebar width intact.
  const toggleExplorerPaneCollapsedState = useCallback(() => {
    if (!isExplorerRepositoryAvailable) {
      return;
    }

    if (isExplorerPaneManuallyCollapsed) {
      setIsExplorerPaneManuallyCollapsed(false);
      return;
    }

    activeExplorerDividerDragCleanupRef.current?.();
    setIsExplorerPaneManuallyCollapsed(true);
  }, [isExplorerPaneManuallyCollapsed, isExplorerRepositoryAvailable]);

  // Expanding/collapsing should feel like one intentional layout action, so
  // this callback updates only split state and lets the editor reclaim space.
  const toggleTerminalPaneCollapsedState = useCallback(() => {
    if (isTerminalPaneCollapsed) {
      setIsTerminalPaneCollapsed(false);
      return;
    }

    activeTerminalDividerDragCleanupRef.current?.();
    setIsTerminalPaneCollapsed(true);
  }, [isTerminalPaneCollapsed]);

  // The labels and titles stay in sync so screen readers and pointer users both
  // get clear affordance for the same toggle actions.
  const explorerPaneToggleLabel = isExplorerPaneVisible
    ? 'Collapse file explorer pane'
    : 'Expand file explorer pane';
  const terminalPaneToggleLabel = isTerminalPaneVisible
    ? 'Collapse terminal pane'
    : 'Expand terminal pane';

  // Desktop save expectations favor a window-level Mod+S action, so this
  // shortcut mirrors the top-bar Save button regardless of focused sub-pane.
  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const isSaveShortcutKey = event.key.toLowerCase() === 's';
      if (
        !isSaveShortcutKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }

      event.preventDefault();
      if (isSaveCurrentFileToGitActionDisabled) {
        return;
      }

      void saveCurrentFileToGitWithStockMessage();
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [
    isSaveCurrentFileToGitActionDisabled,
    saveCurrentFileToGitWithStockMessage,
  ]);

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
          disabled={isOpeningFile || isCreatingFile}
        >
          Open...
        </button>
        <button
          className="topbar-button"
          type="button"
          onClick={() => {
            void createMarkdownFile();
          }}
          disabled={isCreatingFile || isOpeningFile}
        >
          New...
        </button>
        <button
          className="topbar-button"
          type="button"
          onClick={() => {
            void restoreCurrentFileFromGit();
          }}
          disabled={!loadedDocument || isRestoringFromGit}
        >
          {isRestoringFromGit ? 'Resetting...' : 'Reset'}
        </button>
        <button
          className="topbar-button"
          type="button"
          onClick={() => {
            void saveCurrentFileToGitWithStockMessage();
          }}
          disabled={isSaveCurrentFileToGitActionDisabled}
          title="Save this file by committing it with a stock git message"
        >
          {isSavingCurrentFileToGit ? 'Saving...' : 'Save'}
        </button>
        <div className="file-path">{loadedDocument?.filePath ?? ''}</div>
        <div className="save-status">{saveStatusText}</div>
        <button
          className={`topbar-icon-button topbar-explorer-toggle-button ${
            isExplorerPaneVisible ? 'topbar-icon-button--active' : ''
          }`.trim()}
          type="button"
          aria-label={explorerPaneToggleLabel}
          aria-pressed={isExplorerPaneVisible}
          title={
            isExplorerRepositoryAvailable
              ? explorerPaneToggleLabel
              : 'File explorer unavailable for non-git files'
          }
          disabled={!isExplorerRepositoryAvailable}
          onClick={() => {
            toggleExplorerPaneCollapsedState();
          }}
        >
          <ExplorerPaneToggleIcon
            isExplorerPaneVisible={isExplorerPaneVisible}
          />
        </button>
        <button
          className={`topbar-icon-button topbar-terminal-toggle-button ${
            isTerminalPaneVisible ? 'topbar-icon-button--active' : ''
          }`.trim()}
          type="button"
          aria-label={terminalPaneToggleLabel}
          aria-pressed={isTerminalPaneVisible}
          title={terminalPaneToggleLabel}
          onClick={() => {
            toggleTerminalPaneCollapsedState();
          }}
        >
          <TerminalPaneToggleIcon
            isTerminalPaneVisible={isTerminalPaneVisible}
          />
        </button>
      </header>
      <main
        className={`workspace workspace--split ${
          isExplorerPaneVisible ? '' : 'workspace--explorer-collapsed'
        } ${
          isTerminalPaneVisible ? '' : 'workspace--terminal-collapsed'
        }`.trim()}
        ref={workspaceElementRef}
        style={
          {
            '--workspace-split-columns': buildWorkspaceSplitColumnsValue({
              explorerPaneWidthPixels,
              isExplorerPaneVisible,
              isTerminalPaneVisible,
              terminalPaneWidthPixels,
            }),
          } as CSSProperties
        }
      >
        <RepositoryFileExplorerPane
          onRequestOpenFile={openMarkdownFileAtPath}
          onRepositoryAvailabilityChanged={setExplorerRepositoryAvailability}
        />
        <div
          className={`workspace-divider workspace-divider--explorer ${
            isExplorerPaneVisible ? '' : 'workspace-divider--collapsed'
          }`.trim()}
          aria-hidden="true"
          onMouseDown={startExplorerDividerDrag}
        />
        <section className="pane workspace-pane workspace-pane--editor">
          <div className="pane-title">
            <span>Document</span>
            <span className="pane-title-word-count">
              {activeDocumentWordCountLabel}
            </span>
          </div>
          <DocumentCommentsPane
            ref={documentCommentsPaneRef}
            loadedDocumentContent={loadedDocument?.content ?? null}
            loadedDocumentRevision={loadedDocumentRevision}
            onUserEditedDocument={(content) => {
              setEditorContentForWordCount(content);
              saveController.scheduleSave(content);
            }}
            onDocumentContentReplacedFromDisk={
              handleDocumentContentReplacedFromDisk
            }
            onSelectionDetailsChanged={(details) => {
              if (!details || !activeDocumentFilePath) {
                handleIdeSelectionChanged(null);
                return;
              }
              handleIdeSelectionChanged({
                filePath: activeDocumentFilePath,
                selectedText: details.selectedText,
                range: details.range,
              });
            }}
          />
        </section>
        <div
          className={`workspace-divider workspace-divider--terminal ${
            isTerminalPaneVisible ? '' : 'workspace-divider--collapsed'
          }`.trim()}
          aria-hidden="true"
          onMouseDown={startTerminalDividerDrag}
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
