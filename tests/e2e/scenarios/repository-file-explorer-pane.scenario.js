/**
 * Repository file-explorer scenario: verifies markdown tree rendering, file
 * opening from the explorer, and left-pane collapse/expand behavior.
 */

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runIsolatedE2ETest } = require('../harness');

const WINDOW_WIDTH_STABILITY_TOLERANCE_PIXELS = 2;
const COLLAPSED_EXPLORER_AREA_MAX_PRIMARY_AXIS_PIXELS = 4;

/**
 * Why: explorer coverage needs a real git repository because the pane should
 * only appear when the active file belongs to one.
 */
const createRepositoryFixture = () => {
  const repositoryRootPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'kale-explorer-repo-'),
  );

  fs.mkdirSync(path.join(repositoryRootPath, 'docs', 'guides'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(repositoryRootPath, 'README.md'), '# Root\n');
  fs.writeFileSync(
    path.join(repositoryRootPath, 'docs', 'guide.md'),
    '# Guide\n',
  );
  fs.writeFileSync(
    path.join(repositoryRootPath, 'docs', 'guides', 'deep.md'),
    '# Deep\n',
  );
  fs.writeFileSync(
    path.join(repositoryRootPath, 'docs', 'notes.txt'),
    'ignore me',
  );

  execFileSync('git', ['init'], { cwd: repositoryRootPath });
  execFileSync('git', ['config', 'user.email', 'kale-e2e@example.com'], {
    cwd: repositoryRootPath,
  });
  execFileSync('git', ['config', 'user.name', 'Kale E2E'], {
    cwd: repositoryRootPath,
  });
  execFileSync('git', ['add', '.'], { cwd: repositoryRootPath });
  execFileSync('git', ['commit', '-m', 'Initial'], { cwd: repositoryRootPath });

  const untrackedMarkdownFilePath = path.join(
    repositoryRootPath,
    'docs',
    'scratch.md',
  );
  fs.writeFileSync(untrackedMarkdownFilePath, '# Scratch\n');

  const canonicalRepositoryRootPath = fs.realpathSync(repositoryRootPath);
  const canonicalStartupFilePath = fs.realpathSync(
    path.join(repositoryRootPath, 'README.md'),
  );
  const canonicalUntrackedMarkdownFilePath = fs.realpathSync(
    untrackedMarkdownFilePath,
  );

  return {
    repositoryRootPath: canonicalRepositoryRootPath,
    startupFilePath: canonicalStartupFilePath,
    untrackedMarkdownFilePath: canonicalUntrackedMarkdownFilePath,
  };
};

/**
 * Why: geometry assertions should read the left-pane state directly so pane
 * visibility and native window stability are verified from one snapshot.
 */
const readExplorerGeometrySnapshot = async (page) => {
  return page.evaluate(() => {
    const workspaceElement = document.querySelector('.workspace');
    const explorerPaneElement = document.querySelector(
      '.workspace-pane--explorer',
    );
    const explorerDividerElement = document.querySelector(
      '.workspace-divider--explorer',
    );
    const explorerToggleButtonElement = document.querySelector(
      '.topbar-explorer-toggle-button',
    );
    const workspaceComputedStyle = workspaceElement
      ? window.getComputedStyle(workspaceElement)
      : null;
    const isVerticalStackedLayout =
      workspaceComputedStyle?.display === 'flex' &&
      workspaceComputedStyle?.flexDirection === 'column';
    const explorerPaneWidth =
      explorerPaneElement?.getBoundingClientRect().width ?? 0;
    const explorerPaneHeight =
      explorerPaneElement?.getBoundingClientRect().height ?? 0;
    const explorerDividerWidth =
      explorerDividerElement?.getBoundingClientRect().width ?? 0;
    const explorerDividerHeight =
      explorerDividerElement?.getBoundingClientRect().height ?? 0;
    const explorerPanePrimaryAxisFootprint = isVerticalStackedLayout
      ? explorerPaneHeight + explorerDividerHeight
      : explorerPaneWidth + explorerDividerWidth;

    return {
      innerWindowWidth: window.innerWidth,
      explorerPaneAreaWidth: explorerPaneWidth + explorerDividerWidth,
      explorerPanePrimaryAxisFootprint,
      explorerToggleLabel:
        explorerToggleButtonElement?.getAttribute('aria-label') ?? null,
      explorerTogglePressed:
        explorerToggleButtonElement?.getAttribute('aria-pressed') ?? null,
    };
  });
};

/**
 * Why: left-pane toggle transitions are async, so dedicated waiting keeps the
 * scenario deterministic under Electron timing variance.
 */
const waitForExplorerToggleLabel = async (page, expectedLabel) => {
  await page.waitForFunction(
    (expectedExplorerToggleLabel) => {
      const explorerToggleButtonElement = document.querySelector(
        '.topbar-explorer-toggle-button',
      );
      return (
        explorerToggleButtonElement?.getAttribute('aria-label') ===
        expectedExplorerToggleLabel
      );
    },
    expectedLabel,
    { timeout: 10_000 },
  );
};

/**
 * Why: explorer regression coverage should ensure the left pane behaves like a
 * first-class workspace sidebar rather than a static file list.
 */
const runRepositoryFileExplorerPaneScenario = async () => {
  const { repositoryRootPath, startupFilePath, untrackedMarkdownFilePath } =
    createRepositoryFixture();

  try {
    await runIsolatedE2ETest({
      testName: 'E2E repository file-explorer pane',
      launchEnv: {
        KALE_STARTUP_MARKDOWN_FILE_PATH: startupFilePath,
      },
      testBody: async ({ page }) => {
        await page.waitForSelector('.workspace-pane--explorer', {
          timeout: 10_000,
        });
        await page.waitForSelector('.topbar-explorer-toggle-button', {
          timeout: 10_000,
        });
        await page.waitForSelector('.repository-file-explorer-tree', {
          timeout: 10_000,
        });

        const rootLabelText = await page.textContent(
          '.repository-file-explorer-root-label',
        );
        assert.strictEqual(
          rootLabelText?.trim(),
          path.basename(repositoryRootPath),
          'Explorer root label should show the git repository name.',
        );

        await page.getByRole('treeitem', { name: 'docs' }).click();
        await page.getByRole('treeitem', { name: 'scratch.md' }).click();

        await page.waitForFunction(
          (expectedFilePath) => {
            return (
              document.querySelector('.file-path')?.textContent?.trim() ===
              expectedFilePath
            );
          },
          untrackedMarkdownFilePath,
          { timeout: 10_000 },
        );
        await page.waitForSelector('.repository-file-explorer-tree', {
          timeout: 10_000,
        });
        await page.waitForSelector(
          `[data-explorer-path=\"${untrackedMarkdownFilePath.replace(/\\/g, '\\\\')}\"]`,
          {
            timeout: 10_000,
          },
        );

        const visibleExplorerLabels = await page
          .locator('.repository-file-explorer-row-label')
          .allTextContents();
        assert.ok(
          visibleExplorerLabels.includes('scratch.md'),
          `Explorer should include untracked markdown files. Got ${JSON.stringify(
            visibleExplorerLabels,
          )}.`,
        );
        assert.ok(
          !visibleExplorerLabels.includes('notes.txt'),
          `Explorer should exclude non-markdown files. Got ${JSON.stringify(
            visibleExplorerLabels,
          )}.`,
        );

        const initialGeometrySnapshot =
          await readExplorerGeometrySnapshot(page);
        assert.strictEqual(
          initialGeometrySnapshot.explorerToggleLabel,
          'Collapse file explorer pane',
        );
        assert.strictEqual(
          initialGeometrySnapshot.explorerTogglePressed,
          'true',
        );
        assert.ok(
          initialGeometrySnapshot.explorerPaneAreaWidth > 100,
          `Expanded explorer area should be visible. Got ${initialGeometrySnapshot.explorerPaneAreaWidth}.`,
        );

        await page
          .getByRole('button', { name: 'Collapse file explorer pane' })
          .click();
        await waitForExplorerToggleLabel(page, 'Expand file explorer pane');

        const collapsedGeometrySnapshot =
          await readExplorerGeometrySnapshot(page);
        assert.strictEqual(
          collapsedGeometrySnapshot.explorerTogglePressed,
          'false',
        );
        assert.ok(
          collapsedGeometrySnapshot.explorerPanePrimaryAxisFootprint <=
            COLLAPSED_EXPLORER_AREA_MAX_PRIMARY_AXIS_PIXELS,
          `Collapsed explorer footprint should stay <= ${COLLAPSED_EXPLORER_AREA_MAX_PRIMARY_AXIS_PIXELS}px. Got ${collapsedGeometrySnapshot.explorerPanePrimaryAxisFootprint}.`,
        );
        assert.ok(
          Math.abs(
            collapsedGeometrySnapshot.innerWindowWidth -
              initialGeometrySnapshot.innerWindowWidth,
          ) <= WINDOW_WIDTH_STABILITY_TOLERANCE_PIXELS,
          [
            'Collapsed window width should stay unchanged.',
            `Initial width: ${initialGeometrySnapshot.innerWindowWidth}.`,
            `Collapsed width: ${collapsedGeometrySnapshot.innerWindowWidth}.`,
          ].join(' '),
        );

        await page
          .getByRole('button', { name: 'Expand file explorer pane' })
          .click();
        await waitForExplorerToggleLabel(page, 'Collapse file explorer pane');

        const reExpandedGeometrySnapshot =
          await readExplorerGeometrySnapshot(page);
        assert.strictEqual(
          reExpandedGeometrySnapshot.explorerTogglePressed,
          'true',
        );
        assert.ok(
          reExpandedGeometrySnapshot.explorerPaneAreaWidth > 100,
          `Re-expanded explorer area should be visible. Got ${reExpandedGeometrySnapshot.explorerPaneAreaWidth}.`,
        );
        assert.ok(
          Math.abs(
            reExpandedGeometrySnapshot.innerWindowWidth -
              initialGeometrySnapshot.innerWindowWidth,
          ) <= WINDOW_WIDTH_STABILITY_TOLERANCE_PIXELS,
          [
            'Re-expanded window width should stay unchanged.',
            `Initial width: ${initialGeometrySnapshot.innerWindowWidth}.`,
            `Re-expanded width: ${reExpandedGeometrySnapshot.innerWindowWidth}.`,
          ].join(' '),
        );
      },
    });
  } finally {
    fs.rmSync(repositoryRootPath, { recursive: true, force: true });
  }
};

module.exports = { runRepositoryFileExplorerPaneScenario };
