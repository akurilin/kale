//
// This component owns the repository-backed markdown explorer so the app shell
// can treat it as an isolated sidebar pane instead of another special-case UI.
//

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import type { RepositoryMarkdownExplorerNode } from '../shared-types';
import { getMarkdownApi } from './markdown-api';
import {
  buildVisibleExplorerItems,
  collectAncestorDirectoryPaths,
  findVisibleItemIndexByPath,
  normalizeRepositoryExplorerPath,
  normalizeRepositoryExplorerSuccessResponse,
} from './repository-file-explorer-state';

type RepositoryFileExplorerPaneProps = {
  onRequestOpenFile: (filePath: string) => Promise<void>;
  onRepositoryAvailabilityChanged?: (isAvailable: boolean) => void;
  title?: string;
};

export const RepositoryFileExplorerPane = ({
  onRequestOpenFile,
  onRepositoryAvailabilityChanged,
  title = 'Explorer',
}: RepositoryFileExplorerPaneProps) => {
  const [tree, setTree] = useState<RepositoryMarkdownExplorerNode[]>([]);
  const [repositoryRootPath, setRepositoryRootPath] = useState<string | null>(
    null,
  );
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [focusedItemPath, setFocusedItemPath] = useState<string | null>(null);
  const [expandedDirectoryPaths, setExpandedDirectoryPaths] = useState<
    Set<string>
  >(new Set());
  const [isLoadingTree, setIsLoadingTree] = useState(true);
  const [loadErrorText, setLoadErrorText] = useState<string | null>(null);

  const rowElementByPathRef = useRef<Map<string, HTMLButtonElement | null>>(
    new Map(),
  );
  const latestRepositoryRootPathRef = useRef<string | null>(null);
  const latestLoadRequestIdRef = useRef(0);

  const visibleExplorerItems = useMemo(
    () => buildVisibleExplorerItems(tree, expandedDirectoryPaths),
    [tree, expandedDirectoryPaths],
  );

  useEffect(() => {
    let isDisposed = false;

    const loadRepositoryTree = async () => {
      setIsLoadingTree(true);
      const currentLoadRequestId = latestLoadRequestIdRef.current + 1;
      latestLoadRequestIdRef.current = currentLoadRequestId;

      const response =
        await getMarkdownApi().getCurrentFileRepositoryMarkdownTree();
      if (
        isDisposed ||
        latestLoadRequestIdRef.current !== currentLoadRequestId
      ) {
        return;
      }

      if (!response.ok) {
        setTree([]);
        setRepositoryRootPath(null);
        setActiveFilePath(null);
        setFocusedItemPath(null);
        setExpandedDirectoryPaths(new Set());
        setLoadErrorText(
          response.reason === 'load-failed'
            ? (response.errorMessage ?? 'Could not load repository files.')
            : null,
        );
        setIsLoadingTree(false);
        latestRepositoryRootPathRef.current = null;
        onRepositoryAvailabilityChanged?.(false);
        return;
      }

      const normalizedResponse =
        normalizeRepositoryExplorerSuccessResponse(response);
      const previousRepositoryRootPath = latestRepositoryRootPathRef.current;
      latestRepositoryRootPathRef.current = normalizedResponse.repositoryRoot;

      setTree(normalizedResponse.tree);
      setRepositoryRootPath(normalizedResponse.repositoryRoot);
      setActiveFilePath(normalizedResponse.activeFilePath);
      setLoadErrorText(null);
      setIsLoadingTree(false);
      onRepositoryAvailabilityChanged?.(true);

      const activeFileAncestorDirectoryPaths = collectAncestorDirectoryPaths(
        normalizedResponse.activeFilePath,
        normalizedResponse.repositoryRoot,
      );
      setExpandedDirectoryPaths((previousExpandedDirectoryPaths) => {
        const nextExpandedDirectoryPaths =
          previousRepositoryRootPath === normalizedResponse.repositoryRoot
            ? new Set(previousExpandedDirectoryPaths)
            : new Set<string>();
        for (const ancestorDirectoryPath of activeFileAncestorDirectoryPaths) {
          nextExpandedDirectoryPaths.add(ancestorDirectoryPath);
        }
        return nextExpandedDirectoryPaths;
      });
      setFocusedItemPath(normalizedResponse.activeFilePath);
    };

    void loadRepositoryTree();

    const removeCurrentMarkdownFilePathChangedListener =
      getMarkdownApi().onCurrentMarkdownFilePathChanged(() => {
        void loadRepositoryTree();
      });

    return () => {
      isDisposed = true;
      removeCurrentMarkdownFilePathChangedListener();
    };
  }, [onRepositoryAvailabilityChanged]);

  useEffect(() => {
    const activeVisibleItemIndex = findVisibleItemIndexByPath(
      visibleExplorerItems,
      activeFilePath,
    );
    if (activeVisibleItemIndex >= 0) {
      setFocusedItemPath(
        visibleExplorerItems[activeVisibleItemIndex].node.path,
      );
      return;
    }

    const focusedVisibleItemIndex = findVisibleItemIndexByPath(
      visibleExplorerItems,
      focusedItemPath,
    );
    if (focusedVisibleItemIndex >= 0) {
      return;
    }

    setFocusedItemPath(visibleExplorerItems[0]?.node.path ?? null);
  }, [activeFilePath, focusedItemPath, visibleExplorerItems]);

  /**
   * Why: directory expansion updates should stay normalized so comparisons work
   * even when upstream paths arrive with platform-specific separators.
   */
  const toggleDirectoryExpandedState = (directoryPath: string) => {
    const normalizedDirectoryPath =
      normalizeRepositoryExplorerPath(directoryPath);
    setExpandedDirectoryPaths((previousExpandedDirectoryPaths) => {
      const nextExpandedDirectoryPaths = new Set(
        previousExpandedDirectoryPaths,
      );
      if (nextExpandedDirectoryPaths.has(normalizedDirectoryPath)) {
        nextExpandedDirectoryPaths.delete(normalizedDirectoryPath);
      } else {
        nextExpandedDirectoryPaths.add(normalizedDirectoryPath);
      }
      return nextExpandedDirectoryPaths;
    });
  };

  /**
   * Why: the explorer should request document switches through one callback so
   * the shell can preserve save-before-switch behavior for the active document.
   */
  const requestFileOpen = async (filePath: string) => {
    setFocusedItemPath(normalizeRepositoryExplorerPath(filePath));
    await onRequestOpenFile(filePath);
  };

  /**
   * Why: roving focus keeps the tree keyboard-accessible while avoiding many
   * tab stops across large repositories.
   */
  const focusRowByPath = (targetPath: string | null) => {
    if (!targetPath) {
      return;
    }

    const normalizedTargetPath = normalizeRepositoryExplorerPath(targetPath);
    const targetRowElement =
      rowElementByPathRef.current.get(normalizedTargetPath) ?? null;
    targetRowElement?.focus();
    setFocusedItemPath(normalizedTargetPath);
  };

  const rootLabelText = repositoryRootPath
    ? repositoryRootPath.split('/').pop()
    : null;

  return (
    <section className="pane workspace-pane workspace-pane--explorer repository-file-explorer-pane">
      <div className="pane-title">{title}</div>
      {repositoryRootPath ? (
        <div
          className="repository-file-explorer-root-label"
          title={repositoryRootPath}
        >
          {rootLabelText}
        </div>
      ) : null}
      {isLoadingTree ? (
        <div className="repository-file-explorer-empty-state">
          Loading repository files...
        </div>
      ) : loadErrorText ? (
        <div className="repository-file-explorer-empty-state">
          {loadErrorText}
        </div>
      ) : repositoryRootPath ? (
        visibleExplorerItems.length > 0 ? (
          <div
            className="repository-file-explorer-tree"
            aria-label="Repository file explorer"
            role="tree"
          >
            {visibleExplorerItems.map((visibleExplorerItem) => {
              const normalizedNodePath = visibleExplorerItem.node.path;
              const isDirectory = visibleExplorerItem.node.type === 'directory';
              const isExpanded =
                isDirectory && expandedDirectoryPaths.has(normalizedNodePath);
              const isActiveFile =
                visibleExplorerItem.node.type === 'file' &&
                activeFilePath === normalizedNodePath;
              const rowTabIndex =
                focusedItemPath === normalizedNodePath ? 0 : -1;

              return (
                <button
                  key={normalizedNodePath}
                  ref={(rowElement) => {
                    rowElementByPathRef.current.set(
                      normalizedNodePath,
                      rowElement,
                    );
                  }}
                  className={`repository-file-explorer-row ${
                    isActiveFile ? 'repository-file-explorer-row--active' : ''
                  }`.trim()}
                  type="button"
                  role="treeitem"
                  aria-expanded={isDirectory ? isExpanded : undefined}
                  aria-level={visibleExplorerItem.depth + 1}
                  aria-selected={isActiveFile}
                  data-explorer-path={normalizedNodePath}
                  tabIndex={rowTabIndex}
                  style={
                    {
                      '--repository-file-explorer-depth':
                        visibleExplorerItem.depth,
                    } as CSSProperties
                  }
                  onFocus={() => {
                    setFocusedItemPath(normalizedNodePath);
                  }}
                  onClick={() => {
                    if (isDirectory) {
                      toggleDirectoryExpandedState(normalizedNodePath);
                      return;
                    }

                    void requestFileOpen(visibleExplorerItem.node.path);
                  }}
                  onKeyDown={(event) => {
                    const currentVisibleItemIndex = findVisibleItemIndexByPath(
                      visibleExplorerItems,
                      normalizedNodePath,
                    );
                    if (currentVisibleItemIndex < 0) {
                      return;
                    }

                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      focusRowByPath(
                        visibleExplorerItems[currentVisibleItemIndex + 1]?.node
                          .path ?? null,
                      );
                      return;
                    }

                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      focusRowByPath(
                        visibleExplorerItems[currentVisibleItemIndex - 1]?.node
                          .path ?? null,
                      );
                      return;
                    }

                    if (event.key === 'ArrowRight' && isDirectory) {
                      event.preventDefault();
                      if (!isExpanded) {
                        toggleDirectoryExpandedState(normalizedNodePath);
                        return;
                      }

                      focusRowByPath(
                        visibleExplorerItems[currentVisibleItemIndex + 1]?.node
                          .path ?? null,
                      );
                      return;
                    }

                    if (event.key === 'ArrowLeft') {
                      if (isDirectory && isExpanded) {
                        event.preventDefault();
                        toggleDirectoryExpandedState(normalizedNodePath);
                        return;
                      }

                      if (visibleExplorerItem.parentDirectoryPath) {
                        event.preventDefault();
                        focusRowByPath(visibleExplorerItem.parentDirectoryPath);
                      }
                      return;
                    }

                    if (event.key === 'Home') {
                      event.preventDefault();
                      focusRowByPath(
                        visibleExplorerItems[0]?.node.path ?? null,
                      );
                      return;
                    }

                    if (event.key === 'End') {
                      event.preventDefault();
                      focusRowByPath(
                        visibleExplorerItems[visibleExplorerItems.length - 1]
                          ?.node.path ?? null,
                      );
                    }
                  }}
                >
                  <span
                    className={`repository-file-explorer-row-chevron ${
                      isDirectory && isExpanded
                        ? 'repository-file-explorer-row-chevron--expanded'
                        : ''
                    }`.trim()}
                    aria-hidden="true"
                  >
                    {isDirectory ? '▸' : ''}
                  </span>
                  <span className="repository-file-explorer-row-label">
                    {visibleExplorerItem.node.name}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="repository-file-explorer-empty-state">
            No markdown files in this repository.
          </div>
        )
      ) : null}
    </section>
  );
};
