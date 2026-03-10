/**
 * Non-git file-explorer scenario: verifies the explorer stays unavailable when
 * the active file does not belong to a git repository.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runIsolatedE2ETest } = require('../harness');

/**
 * Why: this scenario needs a real standalone markdown file so the app does not
 * fall back to its default git-backed repository during startup.
 */
const createNonGitMarkdownFixture = () => {
  const fixtureDirectoryPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'kale-explorer-non-git-'),
  );
  const startupFilePath = path.join(fixtureDirectoryPath, 'standalone.md');
  fs.writeFileSync(startupFilePath, '# Standalone\n');
  return {
    fixtureDirectoryPath,
    startupFilePath,
  };
};

/**
 * Why: the explorer should disappear entirely for non-git documents rather
 * than leaving a dead sidebar visible in the workspace.
 */
const runRepositoryFileExplorerNonGitScenario = async () => {
  const { fixtureDirectoryPath, startupFilePath } =
    createNonGitMarkdownFixture();

  try {
    await runIsolatedE2ETest({
      testName: 'E2E repository file-explorer non-git behavior',
      launchEnv: {
        KALE_STARTUP_MARKDOWN_FILE_PATH: startupFilePath,
      },
      testBody: async ({ page }) => {
        await page.waitForSelector('.topbar-explorer-toggle-button', {
          timeout: 10_000,
        });

        const explorerButtonDisabled = await page.$eval(
          '.topbar-explorer-toggle-button',
          (explorerToggleButtonElement) => {
            return explorerToggleButtonElement.hasAttribute('disabled');
          },
        );
        assert.strictEqual(
          explorerButtonDisabled,
          true,
          'Explorer toggle should be disabled when the active file is outside git.',
        );

        const explorerTreeCount = await page
          .locator('.repository-file-explorer-tree')
          .count();
        assert.strictEqual(
          explorerTreeCount,
          0,
          'Explorer tree should not render for a non-git file.',
        );
      },
    });
  } finally {
    fs.rmSync(fixtureDirectoryPath, { recursive: true, force: true });
  }
};

module.exports = { runRepositoryFileExplorerNonGitScenario };
