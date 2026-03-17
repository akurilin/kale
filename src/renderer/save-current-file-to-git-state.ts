type ShouldDisableSaveCurrentFileToGitActionOptions = {
  hasLoadedDocument: boolean;
  isCurrentFileInsideGitRepository: boolean;
  hasPersistedGitChanges: boolean;
  hasUnsavedEditorChanges: boolean;
  isSavingCurrentFileToGit: boolean;
  isRestoringFromGit: boolean;
};

/**
 * Why: the top-bar Save action only makes sense when the current document can
 * actually produce a git commit, so this helper centralizes that gate for UI
 * code and keeps the decision testable without rendering the full app.
 */
export const shouldDisableSaveCurrentFileToGitAction = ({
  hasLoadedDocument,
  isCurrentFileInsideGitRepository,
  hasPersistedGitChanges,
  hasUnsavedEditorChanges,
  isSavingCurrentFileToGit,
  isRestoringFromGit,
}: ShouldDisableSaveCurrentFileToGitActionOptions) => {
  return (
    !hasLoadedDocument ||
    !isCurrentFileInsideGitRepository ||
    isSavingCurrentFileToGit ||
    isRestoringFromGit ||
    (!hasPersistedGitChanges && !hasUnsavedEditorChanges)
  );
};
