//
// This file hosts the React application shell so UI chrome, lifecycle events,
// and file actions become easier to evolve while CodeMirror remains imperative.
//

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type {
  CurrentMarkdownGitBranchState,
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
import { TerminalPane } from './TerminalPane';
import { getWindowApi } from './window-api';
import { countWordsInMarkdownContent } from './word-count';

// app-level status text starts neutral until the first async document load
// completes and the shell can report a concrete save state.
const INITIAL_SAVE_STATUS_TEXT = 'Ready';
const SAVE_SUCCESS_STATUS_TEXT = 'Saved';
const SAVE_SUCCESS_STATUS_VISIBLE_DURATION_MS = 3000;
const DEFAULT_EDITOR_PANE_WIDTH_RATIO = 3 / 5;
const MIN_EDITOR_PANE_WIDTH_RATIO = 0.25;
const MAX_EDITOR_PANE_WIDTH_RATIO = 0.8;
const DEFAULT_TERMINAL_PANE_COLLAPSED = false;
const DEFAULT_TERMINAL_PANE_AREA_WIDTH_PIXELS = 420;
const GIT_BRANCH_UNAVAILABLE_OPTION_VALUE = '__git-branch-unavailable__';

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

// The split grid is driven from one helper so expand/collapse can swap layouts
// without duplicating track strings across JSX and resize code.
const buildWorkspaceSplitColumnsValue = (
  editorPaneWidthRatio: number,
  isTerminalPaneCollapsed: boolean,
) => {
  if (isTerminalPaneCollapsed) {
    return '1fr 0px 0fr';
  }

  return `${editorPaneWidthRatio}fr 8px ${1 - editorPaneWidthRatio}fr`;
};

// The app resizes the native window by the exact hidden/revealed pane width so
// collapsing the terminal does not leave a blank canvas gap in the editor area.
const measureVisibleTerminalPaneAreaWidthPixels = (
  workspaceElement: HTMLElement | null,
) => {
  if (!workspaceElement) {
    return 0;
  }

  const terminalPaneElement =
    workspaceElement.querySelector<HTMLElement>('.terminal-pane');
  const workspaceDividerElement =
    workspaceElement.querySelector<HTMLElement>('.workspace-divider');
  const terminalPaneWidth =
    terminalPaneElement?.getBoundingClientRect().width ?? 0;
  const workspaceDividerWidth =
    workspaceDividerElement?.getBoundingClientRect().width ?? 0;
  return Math.max(0, Math.round(terminalPaneWidth + workspaceDividerWidth));
};

// Keeping the toggle icon as a tiny component avoids repeating SVG markup in
// the top bar and makes expanded/collapsed semantics explicit at the call site.
const TerminalPaneToggleIcon = ({
  isTerminalPaneCollapsed,
}: {
  isTerminalPaneCollapsed: boolean;
}) => (
  <svg
    className={`topbar-terminal-toggle-icon ${
      isTerminalPaneCollapsed ? '' : 'topbar-terminal-toggle-icon--active'
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

// Branches can be in detached HEAD state, so the UI labels that explicitly to
// avoid implying the user is currently on a named branch.
const buildGitBranchLabel = (
  branchName: string,
  detachedHeadCommitShortSha: string | null,
) => {
  if (branchName !== 'HEAD') {
    return branchName;
  }

  if (detachedHeadCommitShortSha) {
    return `HEAD (${detachedHeadCommitShortSha}, detached)`;
  }

  return 'HEAD (detached)';
};

// The title-row badge stays concise and readable by handling singular/plural
// label formatting in one place.
const formatWordCountLabel = (wordCount: number): string =>
  `${wordCount.toLocaleString()} ${wordCount === 1 ? 'word' : 'words'}`;

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
  const [gitBranchState, setGitBranchState] =
    useState<CurrentMarkdownGitBranchState | null>(null);
  const [gitBranchLoadErrorText, setGitBranchLoadErrorText] = useState<
    string | null
  >(null);
  const [isLoadingGitBranchState, setIsLoadingGitBranchState] = useState(false);
  const [isSwitchingGitBranch, setIsSwitchingGitBranch] = useState(false);
  const [pendingGitBranchSwitchTarget, setPendingGitBranchSwitchTarget] =
    useState<string | null>(null);
  const [isSavingCurrentFileToGit, setIsSavingCurrentFileToGit] =
    useState(false);
  const [editorPaneWidthRatio, setEditorPaneWidthRatio] = useState(
    DEFAULT_EDITOR_PANE_WIDTH_RATIO,
  );
  const [isTerminalPaneCollapsed, setIsTerminalPaneCollapsed] = useState(
    DEFAULT_TERMINAL_PANE_COLLAPSED,
  );
  const documentCommentsPaneRef = useRef<DocumentCommentsPaneHandle | null>(
    null,
  );
  const workspaceElementRef = useRef<HTMLElement | null>(null);
  const lastExpandedTerminalPaneAreaWidthPixelsRef = useRef<number>(
    DEFAULT_TERMINAL_PANE_AREA_WIDTH_PIXELS,
  );
  const activeWorkspaceDividerDragCleanupRef = useRef<(() => void) | null>(
    null,
  );
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
  const clearSaveSuccessStatusTimeoutRef = useRef<ReturnType<
    typeof window.setTimeout
  > | null>(null);

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
  const activeDocumentWordCount = countWordsInMarkdownContent(
    editorContentForWordCount ?? loadedDocument?.content ?? null,
  );
  const activeDocumentWordCountLabel = formatWordCountLabel(
    activeDocumentWordCount,
  );
  const isSaveCurrentFileToGitActionDisabled =
    !loadedDocument ||
    isSavingCurrentFileToGit ||
    isSwitchingGitBranch ||
    isRestoringFromGit;

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
  const applyLoadedDocument = useCallback(
    (nextLoadedDocument: LoadMarkdownResponse) => {
      setLoadedDocument(nextLoadedDocument);
      setLoadedDocumentRevision((previousRevision) => previousRevision + 1);
      setEditorContentForWordCount(nextLoadedDocument.content);
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

  // Git-branch safety checks should include in-memory unsaved edits because
  // those edits are not visible to git status but can still be lost on switch.
  const getWhetherCurrentEditorHasUnsavedEdits = useCallback(() => {
    const currentEditorContent =
      documentCommentsPaneRef.current?.getCurrentContent();
    if (currentEditorContent == null) {
      return false;
    }

    return currentEditorContent !== saveController.getLastSavedContent();
  }, [saveController]);

  // Top-bar branch controls need current branch metadata for the active file;
  // this helper keeps fetch/typing/error handling consistent across callers.
  const loadGitBranchStateForCurrentDocument = useCallback(
    async (
      showAlertOnError: boolean,
    ): Promise<CurrentMarkdownGitBranchState | null> => {
      if (!loadedDocument) {
        setGitBranchState(null);
        setGitBranchLoadErrorText(null);
        return null;
      }

      setIsLoadingGitBranchState(true);
      try {
        const response =
          await getMarkdownApi().getCurrentMarkdownGitBranchState();
        if (!response.ok) {
          setGitBranchState(null);
          setGitBranchLoadErrorText(response.errorMessage);
          if (showAlertOnError) {
            window.alert(
              `Could not read Git branch information.\n\n${response.errorMessage}`,
            );
          }
          return null;
        }

        setGitBranchState(response.gitBranchState);
        setGitBranchLoadErrorText(null);
        return response.gitBranchState;
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Unknown Git branch state error';
        setGitBranchState(null);
        setGitBranchLoadErrorText(errorMessage);
        if (showAlertOnError) {
          window.alert(
            `Could not read Git branch information.\n\n${errorMessage}`,
          );
        }
        return null;
      } finally {
        setIsLoadingGitBranchState(false);
      }
    },
    [loadedDocument],
  );

  // Branch switching is a destructive boundary for local edits, so this helper
  // centralizes save suppression, git IPC, and post-switch editor reloading.
  const switchCurrentFileToGitBranch = useCallback(
    async (targetBranchName: string, discardCurrentFileChanges: boolean) => {
      if (!loadedDocument || isSwitchingGitBranch) {
        return false;
      }

      isSuppressingLifecycleSaveRef.current = true;
      isSuppressingExternalMarkdownReloadRef.current = true;
      saveController.clearPendingSaveTimer();
      setIsSwitchingGitBranch(true);
      setSaveStatusText(`Switching to ${targetBranchName}...`);

      try {
        const response = await getMarkdownApi().switchCurrentMarkdownGitBranch({
          branchName: targetBranchName,
          discardCurrentFileChanges,
        });
        if (!response.ok) {
          setSaveStatusText('Branch switch failed');
          window.alert(
            `Could not switch branches.\n\n${response.errorMessage}`,
          );
          return false;
        }

        applyLoadedDocument({
          filePath: response.filePath,
          content: response.content,
        });
        setGitBranchState(response.gitBranchState);
        setGitBranchLoadErrorText(null);
        return true;
      } catch (error) {
        setSaveStatusText('Branch switch failed');
        console.error(error);
        return false;
      } finally {
        isSuppressingLifecycleSaveRef.current = false;
        isSuppressingExternalMarkdownReloadRef.current = false;
        setIsSwitchingGitBranch(false);
      }
    },
    [applyLoadedDocument, isSwitchingGitBranch, loadedDocument, saveController],
  );

  // Selecting a branch first checks for local edits and pauses for explicit
  // confirmation before any operation that could discard user-authored content.
  const requestGitBranchSwitch = useCallback(
    async (targetBranchName: string) => {
      if (!loadedDocument || isSwitchingGitBranch) {
        return;
      }

      const latestGitBranchState =
        await loadGitBranchStateForCurrentDocument(true);
      if (!latestGitBranchState) {
        return;
      }

      if (targetBranchName === latestGitBranchState.currentBranchName) {
        return;
      }

      const currentEditorHasUnsavedEdits =
        getWhetherCurrentEditorHasUnsavedEdits();
      const currentFileHasGitModifications =
        latestGitBranchState.isCurrentFileModified;
      if (currentEditorHasUnsavedEdits || currentFileHasGitModifications) {
        setPendingGitBranchSwitchTarget(targetBranchName);
        return;
      }

      await switchCurrentFileToGitBranch(targetBranchName, false);
    },
    [
      getWhetherCurrentEditorHasUnsavedEdits,
      isSwitchingGitBranch,
      loadGitBranchStateForCurrentDocument,
      loadedDocument,
      switchCurrentFileToGitBranch,
    ],
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
      void loadGitBranchStateForCurrentDocument(false);
    } catch (error) {
      setSaveStatusText('Save failed');
      console.error(error);
    } finally {
      setIsSavingCurrentFileToGit(false);
    }
  }, [
    isSaveCurrentFileToGitActionDisabled,
    loadGitBranchStateForCurrentDocument,
    saveController,
  ]);

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

  // Branch metadata follows the currently open file so the dropdown always
  // reflects the active git context after open/restore/switch transitions.
  useEffect(() => {
    if (!loadedDocument) {
      setGitBranchState(null);
      setGitBranchLoadErrorText(null);
      return;
    }

    void loadGitBranchStateForCurrentDocument(false);
  }, [loadedDocument, loadGitBranchStateForCurrentDocument]);

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
      activeWorkspaceDividerDragCleanupRef.current?.();
      activeWorkspaceDividerDragCleanupRef.current = null;
    };
  }, []);

  // File dialogs should return the top bar to a stable idle label when users
  // cancel, so this helper keeps the fallback text consistent across actions.
  const getIdleSaveStatusTextAfterFileDialog = () => {
    return documentCommentsPaneRef.current ? 'Saved' : 'Ready';
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
    if (isTerminalPaneCollapsed) {
      return;
    }

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

  // Expanding/collapsing should feel like one intentional layout action, so
  // this callback updates split state and asks main to resize the native window
  // by the pane area width that was hidden or restored.
  const toggleTerminalPaneCollapsedState = useCallback(() => {
    if (isTerminalPaneCollapsed) {
      const widthToExpandByPixels = Math.max(
        1,
        Math.round(lastExpandedTerminalPaneAreaWidthPixelsRef.current),
      );
      setIsTerminalPaneCollapsed(false);
      void getWindowApi()
        .adjustWindowWidthBy({ deltaWidth: widthToExpandByPixels })
        .catch((error: unknown) => {
          console.error(error);
        });
      return;
    }

    const measuredTerminalPaneAreaWidthPixels =
      measureVisibleTerminalPaneAreaWidthPixels(workspaceElementRef.current);
    if (measuredTerminalPaneAreaWidthPixels > 0) {
      lastExpandedTerminalPaneAreaWidthPixelsRef.current =
        measuredTerminalPaneAreaWidthPixels;
    }

    activeWorkspaceDividerDragCleanupRef.current?.();
    setIsTerminalPaneCollapsed(true);
    void getWindowApi()
      .adjustWindowWidthBy({
        deltaWidth: -lastExpandedTerminalPaneAreaWidthPixelsRef.current,
      })
      .catch((error: unknown) => {
        console.error(error);
      });
  }, [isTerminalPaneCollapsed]);

  // The label and title stay in sync so screen readers and pointer users both
  // get clear affordance for the same toggle action.
  const terminalPaneToggleLabel = isTerminalPaneCollapsed
    ? 'Expand terminal pane'
    : 'Collapse terminal pane';
  const gitBranchSelectorValue =
    gitBranchState?.currentBranchName ?? GIT_BRANCH_UNAVAILABLE_OPTION_VALUE;
  const isGitBranchSelectorDisabled =
    !loadedDocument ||
    isLoadingGitBranchState ||
    isRestoringFromGit ||
    isSwitchingGitBranch ||
    pendingGitBranchSwitchTarget !== null ||
    !gitBranchState;
  const gitBranchSelectorTitle = gitBranchLoadErrorText
    ? `Git branch unavailable: ${gitBranchLoadErrorText}`
    : 'Switch Git branch';

  // Cancel stale confirmations when file context changes so branch-switch
  // prompts never apply to a different document than the user selected from.
  useEffect(() => {
    setPendingGitBranchSwitchTarget(null);
  }, [activeDocumentFilePath]);

  // Escape-to-cancel keeps the confirmation modal aligned with desktop dialog
  // expectations while still requiring explicit "Yes" to discard work.
  useEffect(() => {
    if (!pendingGitBranchSwitchTarget) {
      return;
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      setPendingGitBranchSwitchTarget(null);
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [pendingGitBranchSwitchTarget]);

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

  // The branch dropdown is controlled by the canonical current branch value so
  // cancel/error flows always snap the selector back to the real active branch.
  const handleGitBranchSelectorChanged = (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    const requestedBranchName = event.target.value;
    if (requestedBranchName === GIT_BRANCH_UNAVAILABLE_OPTION_VALUE) {
      return;
    }

    void requestGitBranchSwitch(requestedBranchName);
  };

  // Confirmation keeps branch-switch discard semantics explicit whenever the
  // current file has local modifications that would otherwise be lost.
  const confirmPendingGitBranchSwitch = async () => {
    const targetBranchName = pendingGitBranchSwitchTarget;
    if (!targetBranchName) {
      return;
    }

    setPendingGitBranchSwitchTarget(null);
    await switchCurrentFileToGitBranch(targetBranchName, true);
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
          disabled={isOpeningFile || isCreatingFile || isSwitchingGitBranch}
        >
          Open...
        </button>
        <button
          className="topbar-button"
          type="button"
          onClick={() => {
            void createMarkdownFile();
          }}
          disabled={isCreatingFile || isOpeningFile || isSwitchingGitBranch}
        >
          New...
        </button>
        <button
          className="topbar-button"
          type="button"
          onClick={() => {
            void restoreCurrentFileFromGit();
          }}
          disabled={
            !loadedDocument || isRestoringFromGit || isSwitchingGitBranch
          }
        >
          {isRestoringFromGit ? 'Resetting...' : 'Reset'}
        </button>
        <label className="topbar-select-wrapper">
          <span className="topbar-select-label">Branch</span>
          <select
            className="topbar-select"
            value={gitBranchSelectorValue}
            disabled={isGitBranchSelectorDisabled}
            title={gitBranchSelectorTitle}
            aria-label="Switch Git branch"
            onChange={handleGitBranchSelectorChanged}
          >
            {gitBranchState ? (
              gitBranchState.branchNames.map((branchName) => (
                <option key={branchName} value={branchName}>
                  {buildGitBranchLabel(
                    branchName,
                    gitBranchState.detachedHeadCommitShortSha,
                  )}
                </option>
              ))
            ) : (
              <option value={GIT_BRANCH_UNAVAILABLE_OPTION_VALUE}>
                {isLoadingGitBranchState ? 'Loading...' : 'No Git branch'}
              </option>
            )}
          </select>
        </label>
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
          className={`topbar-icon-button ${
            isTerminalPaneCollapsed ? '' : 'topbar-icon-button--active'
          }`.trim()}
          type="button"
          aria-label={terminalPaneToggleLabel}
          aria-pressed={!isTerminalPaneCollapsed}
          title={terminalPaneToggleLabel}
          onClick={() => {
            toggleTerminalPaneCollapsedState();
          }}
        >
          <TerminalPaneToggleIcon
            isTerminalPaneCollapsed={isTerminalPaneCollapsed}
          />
        </button>
      </header>
      <main
        className={`workspace workspace--split ${
          isTerminalPaneCollapsed ? 'workspace--terminal-collapsed' : ''
        }`.trim()}
        ref={workspaceElementRef}
        style={
          {
            '--workspace-split-columns': buildWorkspaceSplitColumnsValue(
              editorPaneWidthRatio,
              isTerminalPaneCollapsed,
            ),
          } as CSSProperties
        }
      >
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
          className={`workspace-divider ${
            isTerminalPaneCollapsed ? 'workspace-divider--collapsed' : ''
          }`.trim()}
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
      {pendingGitBranchSwitchTarget ? (
        <div className="confirm-modal-backdrop" role="presentation">
          <div
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="branch-switch-confirmation-title"
          >
            <h2
              id="branch-switch-confirmation-title"
              className="confirm-modal-title"
            >
              Switch branch and discard local file changes?
            </h2>
            <p className="confirm-modal-body">
              The current file has local changes. Switching to{' '}
              <strong>{pendingGitBranchSwitchTarget}</strong> will discard those
              changes in this file.
            </p>
            <div className="confirm-modal-actions">
              <button
                className="topbar-button"
                type="button"
                onClick={() => {
                  setPendingGitBranchSwitchTarget(null);
                }}
              >
                Cancel
              </button>
              <button
                className="topbar-button topbar-button--danger"
                type="button"
                onClick={() => {
                  void confirmPendingGitBranchSwitch();
                }}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
