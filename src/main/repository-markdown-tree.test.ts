import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildRepositoryMarkdownTree } from './repository-markdown-tree';

type SerializedExplorerNode =
  | {
      type: 'directory';
      name: string;
      path: string;
      children: SerializedExplorerNode[];
    }
  | {
      type: 'file';
      name: string;
      path: string;
    };

const temporaryDirectoryPaths: string[] = [];

/**
 * Why: repository-tree tests need isolated on-disk structures because the
 * implementation intentionally walks the real filesystem rather than mock data.
 */
const createTemporaryDirectory = async () => {
  const temporaryDirectoryPath = await fs.mkdtemp(
    path.join(os.tmpdir(), 'kale-repository-tree-'),
  );
  temporaryDirectoryPaths.push(temporaryDirectoryPath);
  return temporaryDirectoryPath;
};

/**
 * Why: assertions should stay readable even though the production tree uses
 * absolute paths, so tests normalize everything back to repository-relative
 * paths before comparing structures.
 */
const serializeExplorerTreeRelativeToRepositoryRoot = (
  repositoryRootPath: string,
  tree: Awaited<ReturnType<typeof buildRepositoryMarkdownTree>>,
): SerializedExplorerNode[] => {
  return tree.map((node) => {
    if (node.type === 'file') {
      return {
        type: 'file',
        name: node.name,
        path: path.relative(repositoryRootPath, node.path),
      };
    }

    return {
      type: 'directory',
      name: node.name,
      path: path.relative(repositoryRootPath, node.path),
      children: serializeExplorerTreeRelativeToRepositoryRoot(
        repositoryRootPath,
        node.children,
      ),
    };
  });
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectoryPaths
      .splice(0)
      .map((temporaryDirectoryPath) =>
        fs.rm(temporaryDirectoryPath, { recursive: true, force: true }),
      ),
  );
});

describe('buildRepositoryMarkdownTree', () => {
  it('includes only markdown files, prunes empty folders, and sorts directories before files', async () => {
    const repositoryRootPath = await createTemporaryDirectory();

    await fs.mkdir(path.join(repositoryRootPath, '.git', 'objects'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repositoryRootPath, 'chapters', 'drafts'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repositoryRootPath, 'assets'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repositoryRootPath, 'notes'), {
      recursive: true,
    });

    await Promise.all([
      fs.writeFile(path.join(repositoryRootPath, 'README.md'), '# Root\n'),
      fs.writeFile(
        path.join(repositoryRootPath, 'chapters', '01-intro.md'),
        '# Intro\n',
      ),
      fs.writeFile(
        path.join(repositoryRootPath, 'chapters', 'drafts', 'outline.markdown'),
        '# Outline\n',
      ),
      fs.writeFile(
        path.join(repositoryRootPath, 'notes', 'scratch.mkd'),
        '# Scratch\n',
      ),
      fs.writeFile(
        path.join(repositoryRootPath, 'assets', 'diagram.png'),
        'png',
      ),
      fs.writeFile(
        path.join(repositoryRootPath, 'chapters', 'drafts', 'todo.txt'),
        'todo',
      ),
      fs.writeFile(
        path.join(repositoryRootPath, '.git', 'HEAD'),
        'ref: refs/heads/main\n',
      ),
    ]);

    const tree = await buildRepositoryMarkdownTree(repositoryRootPath);

    expect(
      serializeExplorerTreeRelativeToRepositoryRoot(repositoryRootPath, tree),
    ).toEqual([
      {
        type: 'directory',
        name: 'chapters',
        path: 'chapters',
        children: [
          {
            type: 'directory',
            name: 'drafts',
            path: path.join('chapters', 'drafts'),
            children: [
              {
                type: 'file',
                name: 'outline.markdown',
                path: path.join('chapters', 'drafts', 'outline.markdown'),
              },
            ],
          },
          {
            type: 'file',
            name: '01-intro.md',
            path: path.join('chapters', '01-intro.md'),
          },
        ],
      },
      {
        type: 'directory',
        name: 'notes',
        path: 'notes',
        children: [
          {
            type: 'file',
            name: 'scratch.mkd',
            path: path.join('notes', 'scratch.mkd'),
          },
        ],
      },
      {
        type: 'file',
        name: 'README.md',
        path: 'README.md',
      },
    ]);
  });

  it('returns an empty tree when the repository contains no markdown files', async () => {
    const repositoryRootPath = await createTemporaryDirectory();

    await fs.mkdir(path.join(repositoryRootPath, 'docs', 'images'), {
      recursive: true,
    });
    await Promise.all([
      fs.writeFile(
        path.join(repositoryRootPath, 'docs', 'images', 'hero.png'),
        'png',
      ),
      fs.writeFile(path.join(repositoryRootPath, 'notes.txt'), 'plain text'),
    ]);

    await expect(
      buildRepositoryMarkdownTree(repositoryRootPath),
    ).resolves.toEqual([]);
  });
});
