import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';

import type { RepositoryMarkdownExplorerNode } from '../shared-types';

const MARKDOWN_FILE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdown',
  '.mkd',
]);

/**
 * Why: the explorer should reflect Kale's markdown-focused workflow and avoid
 * cluttering the tree with non-document files from the repository.
 */
const isMarkdownFilePath = (filePath: string) => {
  return MARKDOWN_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
};

/**
 * Why: Explorer ordering should feel familiar and predictable, so directories
 * always sort before files and names compare case-insensitively.
 */
const compareExplorerNodesByTypeAndName = (
  leftNode: RepositoryMarkdownExplorerNode,
  rightNode: RepositoryMarkdownExplorerNode,
) => {
  if (leftNode.type !== rightNode.type) {
    return leftNode.type === 'directory' ? -1 : 1;
  }

  return leftNode.name.localeCompare(rightNode.name, undefined, {
    sensitivity: 'accent',
    numeric: true,
  });
};

/**
 * Why: repository walks must never recurse into `.git` internals or symlinked
 * directories, because both add noise and can create expensive or cyclic scans.
 */
const shouldSkipDirectoryEntry = (directoryEntry: Dirent) => {
  if (directoryEntry.name === '.git') {
    return true;
  }

  if (directoryEntry.isSymbolicLink()) {
    return true;
  }

  return false;
};

/**
 * Why: tree construction belongs in one recursive helper so pruning empty
 * folders and sorting descendants stay consistent across every directory depth.
 */
const buildRepositoryMarkdownTreeAtPath = async (
  directoryPath: string,
): Promise<RepositoryMarkdownExplorerNode[]> => {
  const directoryEntries = await fs.readdir(directoryPath, {
    withFileTypes: true,
  });
  const childNodes: RepositoryMarkdownExplorerNode[] = [];

  for (const directoryEntry of directoryEntries) {
    const childPath = path.join(directoryPath, directoryEntry.name);

    if (directoryEntry.isDirectory()) {
      if (shouldSkipDirectoryEntry(directoryEntry)) {
        continue;
      }

      const directoryChildren =
        await buildRepositoryMarkdownTreeAtPath(childPath);
      if (directoryChildren.length === 0) {
        continue;
      }

      childNodes.push({
        type: 'directory',
        name: directoryEntry.name,
        path: childPath,
        children: directoryChildren,
      });
      continue;
    }

    if (!directoryEntry.isFile() || !isMarkdownFilePath(directoryEntry.name)) {
      continue;
    }

    childNodes.push({
      type: 'file',
      name: directoryEntry.name,
      path: childPath,
    });
  }

  childNodes.sort(compareExplorerNodesByTypeAndName);
  return childNodes;
};

/**
 * Why: the main process needs a single, explicit repository-tree entry point
 * that can be reused by IPC handlers and independently unit-tested.
 */
export const buildRepositoryMarkdownTree = async (
  repositoryRootPath: string,
) => {
  return buildRepositoryMarkdownTreeAtPath(repositoryRootPath);
};
