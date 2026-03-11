import type {
  GetCurrentFileRepositoryMarkdownTreeResponse,
  RepositoryMarkdownExplorerNode,
} from '../shared-types';

export type VisibleExplorerItem = {
  depth: number;
  node: RepositoryMarkdownExplorerNode;
  parentDirectoryPath: string | null;
};

type RepositoryExplorerSuccessResponse = Extract<
  GetCurrentFileRepositoryMarkdownTreeResponse,
  { ok: true }
>;

/**
 * Why: renderer-side explorer state should compare paths consistently across
 * platforms instead of re-normalizing at every call site.
 */
export const normalizeRepositoryExplorerPath = (filePath: string) => {
  return filePath.replace(/\\/g, '/');
};

/**
 * Why: the IPC payload carries a recursive tree, so normalization needs one
 * recursive helper to keep every descendant path in the same canonical form.
 */
const normalizeRepositoryExplorerNode = (
  node: RepositoryMarkdownExplorerNode,
): RepositoryMarkdownExplorerNode => {
  if (node.type === 'file') {
    return {
      ...node,
      path: normalizeRepositoryExplorerPath(node.path),
    };
  }

  return {
    ...node,
    path: normalizeRepositoryExplorerPath(node.path),
    children: node.children.map(normalizeRepositoryExplorerNode),
  };
};

/**
 * Why: the renderer should normalize the repository payload once when it
 * crosses the IPC boundary so component logic can stay platform-agnostic.
 */
export const normalizeRepositoryExplorerSuccessResponse = (
  response: RepositoryExplorerSuccessResponse,
): RepositoryExplorerSuccessResponse => {
  return {
    ...response,
    repositoryRoot: normalizeRepositoryExplorerPath(response.repositoryRoot),
    activeFilePath: normalizeRepositoryExplorerPath(response.activeFilePath),
    tree: response.tree.map(normalizeRepositoryExplorerNode),
  };
};

/**
 * Why: the active file should reveal itself inside the tree without forcing the
 * shell to understand folder structure or maintain explorer-specific state.
 */
export const collectAncestorDirectoryPaths = (
  filePath: string,
  repositoryRootPath: string,
) => {
  const ancestorDirectoryPaths: string[] = [];
  const normalizedRepositoryRootPath =
    normalizeRepositoryExplorerPath(repositoryRootPath);
  let currentDirectoryPath = normalizeRepositoryExplorerPath(filePath);
  let lastSlashIndex = currentDirectoryPath.lastIndexOf('/');

  while (lastSlashIndex > normalizedRepositoryRootPath.length) {
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
export const buildVisibleExplorerItems = (
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

    if (node.type === 'directory' && expandedDirectoryPaths.has(node.path)) {
      visibleExplorerItems.push(
        ...buildVisibleExplorerItems(
          node.children,
          expandedDirectoryPaths,
          depth + 1,
          node.path,
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
export const findVisibleItemIndexByPath = (
  visibleExplorerItems: VisibleExplorerItem[],
  targetPath: string | null,
) => {
  if (!targetPath) {
    return -1;
  }

  const normalizedTargetPath = normalizeRepositoryExplorerPath(targetPath);
  return visibleExplorerItems.findIndex(
    (visibleExplorerItem) =>
      visibleExplorerItem.node.path === normalizedTargetPath,
  );
};
