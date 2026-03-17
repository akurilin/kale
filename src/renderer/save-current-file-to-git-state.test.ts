import { describe, expect, it } from 'vitest';

import { shouldDisableSaveCurrentFileToGitAction } from './save-current-file-to-git-state';

describe('shouldDisableSaveCurrentFileToGitAction', () => {
  it('disables save when no document is loaded', () => {
    expect(
      shouldDisableSaveCurrentFileToGitAction({
        hasLoadedDocument: false,
        isCurrentFileInsideGitRepository: true,
        hasPersistedGitChanges: true,
        hasUnsavedEditorChanges: true,
        isSavingCurrentFileToGit: false,
        isRestoringFromGit: false,
      }),
    ).toBe(true);
  });

  it('disables save when the current file is outside a git repository', () => {
    expect(
      shouldDisableSaveCurrentFileToGitAction({
        hasLoadedDocument: true,
        isCurrentFileInsideGitRepository: false,
        hasPersistedGitChanges: true,
        hasUnsavedEditorChanges: true,
        isSavingCurrentFileToGit: false,
        isRestoringFromGit: false,
      }),
    ).toBe(true);
  });

  it('disables save while a git save is already in progress', () => {
    expect(
      shouldDisableSaveCurrentFileToGitAction({
        hasLoadedDocument: true,
        isCurrentFileInsideGitRepository: true,
        hasPersistedGitChanges: true,
        hasUnsavedEditorChanges: true,
        isSavingCurrentFileToGit: true,
        isRestoringFromGit: false,
      }),
    ).toBe(true);
  });

  it('enables save when the editor has unsaved changes even if git is otherwise clean', () => {
    expect(
      shouldDisableSaveCurrentFileToGitAction({
        hasLoadedDocument: true,
        isCurrentFileInsideGitRepository: true,
        hasPersistedGitChanges: false,
        hasUnsavedEditorChanges: true,
        isSavingCurrentFileToGit: false,
        isRestoringFromGit: false,
      }),
    ).toBe(false);
  });

  it('enables save when the persisted file already has git changes', () => {
    expect(
      shouldDisableSaveCurrentFileToGitAction({
        hasLoadedDocument: true,
        isCurrentFileInsideGitRepository: true,
        hasPersistedGitChanges: true,
        hasUnsavedEditorChanges: false,
        isSavingCurrentFileToGit: false,
        isRestoringFromGit: false,
      }),
    ).toBe(false);
  });

  it('disables save when the file is clean in git and the editor has no new edits', () => {
    expect(
      shouldDisableSaveCurrentFileToGitAction({
        hasLoadedDocument: true,
        isCurrentFileInsideGitRepository: true,
        hasPersistedGitChanges: false,
        hasUnsavedEditorChanges: false,
        isSavingCurrentFileToGit: false,
        isRestoringFromGit: false,
      }),
    ).toBe(true);
  });
});
