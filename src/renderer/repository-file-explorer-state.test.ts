import { describe, expect, it } from 'vitest';

import type { GetCurrentFileRepositoryMarkdownTreeResponse } from '../shared-types';

import {
  buildVisibleExplorerItems,
  collectAncestorDirectoryPaths,
  findVisibleItemIndexByPath,
  normalizeRepositoryExplorerSuccessResponse,
} from './repository-file-explorer-state';

const WINDOWS_STYLE_REPOSITORY_RESPONSE = {
  ok: true,
  repositoryRoot: 'C:\\repo',
  activeFilePath: 'C:\\repo\\docs\\guides\\deep.md',
  tree: [
    {
      type: 'directory',
      name: 'docs',
      path: 'C:\\repo\\docs',
      children: [
        {
          type: 'directory',
          name: 'guides',
          path: 'C:\\repo\\docs\\guides',
          children: [
            {
              type: 'file',
              name: 'deep.md',
              path: 'C:\\repo\\docs\\guides\\deep.md',
            },
          ],
        },
        {
          type: 'file',
          name: 'guide.md',
          path: 'C:\\repo\\docs\\guide.md',
        },
      ],
    },
    {
      type: 'file',
      name: 'README.md',
      path: 'C:\\repo\\README.md',
    },
  ],
} satisfies Extract<GetCurrentFileRepositoryMarkdownTreeResponse, { ok: true }>;

describe('repository-file-explorer-state', () => {
  it('normalizes repository explorer response paths once at the IPC boundary', () => {
    expect(
      normalizeRepositoryExplorerSuccessResponse(
        WINDOWS_STYLE_REPOSITORY_RESPONSE,
      ),
    ).toEqual({
      ok: true,
      repositoryRoot: 'C:/repo',
      activeFilePath: 'C:/repo/docs/guides/deep.md',
      tree: [
        {
          type: 'directory',
          name: 'docs',
          path: 'C:/repo/docs',
          children: [
            {
              type: 'directory',
              name: 'guides',
              path: 'C:/repo/docs/guides',
              children: [
                {
                  type: 'file',
                  name: 'deep.md',
                  path: 'C:/repo/docs/guides/deep.md',
                },
              ],
            },
            {
              type: 'file',
              name: 'guide.md',
              path: 'C:/repo/docs/guide.md',
            },
          ],
        },
        {
          type: 'file',
          name: 'README.md',
          path: 'C:/repo/README.md',
        },
      ],
    });
  });

  it('collects normalized ancestor directories for the active file reveal state', () => {
    expect(
      collectAncestorDirectoryPaths(
        'C:\\repo\\docs\\guides\\deep.md',
        'C:\\repo',
      ),
    ).toEqual(['C:/repo/docs', 'C:/repo/docs/guides']);
  });

  it('flattens only expanded directories and matches targets across path separators', () => {
    const normalizedResponse = normalizeRepositoryExplorerSuccessResponse(
      WINDOWS_STYLE_REPOSITORY_RESPONSE,
    );
    const docsDirectory = normalizedResponse.tree[0];
    const rootReadmeFile = normalizedResponse.tree[1];
    if (docsDirectory.type !== 'directory') {
      throw new Error('Expected docs node to be a directory.');
    }
    const guidesDirectory = docsDirectory.children[0];
    const guideFile = docsDirectory.children[1];
    if (guidesDirectory.type !== 'directory') {
      throw new Error('Expected guides node to be a directory.');
    }

    const visibleExplorerItems = buildVisibleExplorerItems(
      normalizedResponse.tree,
      new Set(['C:/repo/docs']),
    );

    expect(visibleExplorerItems).toEqual([
      {
        depth: 0,
        node: docsDirectory,
        parentDirectoryPath: null,
      },
      {
        depth: 1,
        node: guidesDirectory,
        parentDirectoryPath: 'C:/repo/docs',
      },
      {
        depth: 1,
        node: guideFile,
        parentDirectoryPath: 'C:/repo/docs',
      },
      {
        depth: 0,
        node: rootReadmeFile,
        parentDirectoryPath: null,
      },
    ]);

    expect(
      findVisibleItemIndexByPath(
        visibleExplorerItems,
        'C:\\repo\\docs\\guide.md',
      ),
    ).toBe(2);
  });
});
