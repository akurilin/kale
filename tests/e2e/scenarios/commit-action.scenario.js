/**
 * Commit action scenario: verifies that Git commits stay explicit and are not
 * triggered by the conventional file-save keyboard shortcut.
 */

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getGoToEndOfDocumentShortcut,
  runIsolatedE2ETest,
} = require('../harness');

/**
 * Why: commit behavior needs an isolated real repository so keyboard input can
 * be checked against actual Git history without touching a developer project.
 */
const createCommitActionRepositoryFixture = () => {
  const repositoryRootPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'kale-commit-action-repo-'),
  );
  const startupFilePath = path.join(repositoryRootPath, 'draft.md');

  fs.writeFileSync(startupFilePath, '# Draft\n');
  execFileSync('git', ['init'], { cwd: repositoryRootPath });
  execFileSync('git', ['config', 'user.email', 'kale-e2e@example.com'], {
    cwd: repositoryRootPath,
  });
  execFileSync('git', ['config', 'user.name', 'Kale E2E'], {
    cwd: repositoryRootPath,
  });
  execFileSync('git', ['add', '.'], { cwd: repositoryRootPath });
  execFileSync('git', ['commit', '-m', 'Initial'], { cwd: repositoryRootPath });

  return {
    repositoryRootPath: fs.realpathSync(repositoryRootPath),
    startupFilePath: fs.realpathSync(startupFilePath),
  };
};

/**
 * Why: the scenario compares history before and after the shortcut so a hidden
 * shortcut handler cannot create an unwanted commit.
 */
const readCommitCount = (repositoryRootPath) => {
  return Number(
    execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: repositoryRootPath,
      encoding: 'utf8',
    }).trim(),
  );
};

/**
 * Why: Git snapshots must use an explicit Commit action while normal save
 * shortcuts remain available for future file-save behavior.
 */
const runCommitActionScenario = async () => {
  const { repositoryRootPath, startupFilePath } =
    createCommitActionRepositoryFixture();

  try {
    await runIsolatedE2ETest({
      testName: 'E2E explicit commit action',
      launchEnv: {
        KALE_STARTUP_MARKDOWN_FILE_PATH: startupFilePath,
      },
      testBody: async ({ page }) => {
        const commitButton = page.getByRole('button', {
          name: 'Commit',
          exact: true,
        });
        await assert.doesNotReject(
          commitButton.waitFor({ state: 'visible', timeout: 10_000 }),
          'The Git action should be labeled Commit.',
        );

        await page.click('.cm-content');
        await page.keyboard.press(getGoToEndOfDocumentShortcut());
        await page.keyboard.press('Enter');
        await page.keyboard.type('Explicit commit test.');
        await commitButton.waitFor({ state: 'visible', timeout: 10_000 });
        await page.waitForFunction(() => {
          const topBarButtons = Array.from(
            document.querySelectorAll('.topbar-button'),
          );
          const commitButtonElement = topBarButtons.find(
            (topBarButtonElement) =>
              topBarButtonElement.textContent?.trim() === 'Commit',
          );
          return commitButtonElement?.hasAttribute('disabled') === false;
        });

        const commitCountBeforeShortcut = readCommitCount(repositoryRootPath);
        const saveShortcut =
          process.platform === 'darwin' ? 'Meta+S' : 'Control+S';
        await page.keyboard.press(saveShortcut);
        await page.waitForTimeout(2_000);

        assert.strictEqual(
          readCommitCount(repositoryRootPath),
          commitCountBeforeShortcut,
          'Cmd/Ctrl+S should not create a Git commit.',
        );
      },
    });
  } finally {
    fs.rmSync(repositoryRootPath, { recursive: true, force: true });
  }
};

module.exports = { runCommitActionScenario };
