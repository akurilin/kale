//
// This component owns the repository-backed markdown explorer so the app shell
// can treat it as an isolated sidebar pane instead of another special-case UI.
//

import { useEffect, useRef, useState, type CSSProperties } from 'react';

import type { RepositoryMarkdownExplorerNode } from '../shared-types';
import { getMarkdownApi } from './markdown-api';

type RepositoryFileExplorerPaneProps = {
  onRequestOpenFile: (filePath: string) => Promise<void>;
  onRepositoryAvailabilityChanged?: (isAvailable: boolean) => void;
  title?: string;
};

type VisibleExplorerItem = {
  depth: number;
  node: RepositoryMarkdownExplorerNode;
  parentDirectoryPath: string | null;
};

/**
 * Why: the active file should reveal itself inside the tree without forcing the
 * shell to understand folder structure or maintain explorer-specific state.
 */
const collectAncestorDirectoryPaths = (
  filePath: string,
  repositoryRootPath: string,
) => {
  const ancestorDirectoryPaths: string[] = [];
  const repositoryRootWithForwardSlashes = repositoryRootPath.replace(
    /\\/g,
    '/',
  );
  let currentDirectoryPath = filePath.replace(/\\/g, '/');
  let lastSlashIndex = currentDirectoryPath.lastIndexOf('/');

  while (lastSlashIndex > repositoryRootWithForwardSlashes.length) {
    currentDirectoryPath = currentDirectoryPath.slice(0, lastSlashIndex);
    ancestorDirectoryPaths.unshift(currentDirectoryPath);
    lastSlashIndex = currentDirectoryPath.lastIndexOf('/');
  }

  return ancestorDirectoryPaths;
};

/**
 * Why: tree keyboard navigation and rendering both operate on the visible row
 * order, so one flattening helper keeps those views perfectly in sync.
 */
const buildVisibleExplorerItems = (
  nodes: RepositoryMarkdownExplorerNode[],
  expandedDirectoryPaths: Set<string>,
  depth = 0,
  parentDirectoryPath: string | null = null,
): VisibleExplorerItem[] => {
  const visibleExplorerItems: VisibleExplorerItem[] = [];

  for (const node of nodes) {
    visibleExplorerItems.push({
      depth,
      node,
      parentDirectoryPath,
    });

    if (
      node.type === 'directory' &&
      expandedDirectoryPaths.has(node.path.replace(/\\/g, '/'))
    ) {
      visibleExplorerItems.push(
        ...buildVisibleExplorerItems(
          node.children,
          expandedDirectoryPaths,
          depth + 1,
          node.path.replace(/\\/g, '/'),
        ),
      );
    }
  }

  return visibleExplorerItems;
};

/**
 * Why: focus should never land on a row that is currently hidden, so this
 * lookup keeps keyboard handling tied to the actual rendered tree order.
 */
const findVisibleItemIndexByPath = (
  visibleExplorerItems: VisibleExplorerItem[],
  targetPath: string | null,
) => {
  if (!targetPath) {
    return -1;
  }

  const normalizedTargetPath = targetPath.replace(/\\/g, '/');
  return visibleExplorerItems.findIndex(
    (visibleExplorerItem) =>
      visibleExplorerItem.node.path.replace(/\\/g, '/') ===
      normalizedTargetPath,
  );
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

  const visibleExplorerItems = buildVisibleExplorerItems(
    tree,
    expandedDirectoryPaths,
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

      const previousRepositoryRootPath = latestRepositoryRootPathRef.current;
      latestRepositoryRootPathRef.current = response.repositoryRoot;

      setTree(response.tree);
      setRepositoryRootPath(response.repositoryRoot);
      setActiveFilePath(response.activeFilePath);
      setLoadErrorText(null);
      setIsLoadingTree(false);
      onRepositoryAvailabilityChanged?.(true);

      const activeFileAncestorDirectoryPaths = collectAncestorDirectoryPaths(
        response.activeFilePath,
        response.repositoryRoot,
      );
      setExpandedDirectoryPaths((previousExpandedDirectoryPaths) => {
        const nextExpandedDirectoryPaths =
          previousRepositoryRootPath === response.repositoryRoot
            ? new Set(previousExpandedDirectoryPaths)
            : new Set<string>();
        for (const ancestorDirectoryPath of activeFileAncestorDirectoryPaths) {
          nextExpandedDirectoryPaths.add(
            ancestorDirectoryPath.replace(/\\/g, '/'),
          );
        }
        return nextExpandedDirectoryPaths;
      });
      setFocusedItemPath(response.activeFilePath);
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
        visibleExplorerItems[activeVisibleItemIndex].node.path.replace(
          /\\/g,
          '/',
        ),
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

    setFocusedItemPath(
      visibleExplorerItems[0]?.node.path.replace(/\\/g, '/') ?? null,
    );
  }, [activeFilePath, focusedItemPath, visibleExplorerItems]);

  /**
   * Why: directory expansion updates should stay normalized so comparisons work
   * even when upstream paths arrive with platform-specific separators.
   */
  const toggleDirectoryExpandedState = (directoryPath: string) => {
    const normalizedDirectoryPath = directoryPath.replace(/\\/g, '/');
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
    setFocusedItemPath(filePath.replace(/\\/g, '/'));
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

    const normalizedTargetPath = targetPath.replace(/\\/g, '/');
    const targetRowElement =
      rowElementByPathRef.current.get(normalizedTargetPath) ?? null;
    targetRowElement?.focus();
    setFocusedItemPath(normalizedTargetPath);
  };

  const rootLabelText = repositoryRootPath
    ? repositoryRootPath.replace(/\\/g, '/').split('/').pop()
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
              const normalizedNodePath = visibleExplorerItem.node.path.replace(
                /\\/g,
                '/',
              );
              const isDirectory = visibleExplorerItem.node.type === 'directory';
              const isExpanded =
                isDirectory && expandedDirectoryPaths.has(normalizedNodePath);
              const isActiveFile =
                visibleExplorerItem.node.type === 'file' &&
                activeFilePath?.replace(/\\/g, '/') === normalizedNodePath;
              const rowTabIndex =
                focusedItemPath?.replace(/\\/g, '/') === normalizedNodePath
                  ? 0
                  : -1;

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
