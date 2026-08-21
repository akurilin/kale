import path from 'node:path';

import type { EditorSelection, SelectionRange } from '../shared-types';

export type CodexIdeFileDescriptor = {
  label: string;
  path: string;
  fsPath: string;
};

export type CodexIdeActiveFile = CodexIdeFileDescriptor & {
  selection: SelectionRange;
  activeSelectionContent: string;
  selections: SelectionRange[];
};

export type CodexIdeContext = {
  activeFile?: CodexIdeActiveFile;
  openTabs: CodexIdeFileDescriptor[];
};

type BuildCodexIdeContextOptions = {
  activeFilePath: string | null;
  workspaceFolders: string[];
  editorSelection: EditorSelection;
};

/**
 * Why: Codex expects paths relative to the matching workspace, while Kale can
 * also open a file before its workspace state has finished updating.
 */
const resolveWorkspaceRelativeFilePath = (
  filePath: string,
  workspaceFolders: string[],
) => {
  for (const workspaceFolder of workspaceFolders) {
    const relativeFilePath = path.relative(workspaceFolder, filePath);
    const isInsideWorkspace =
      relativeFilePath === '' ||
      (!relativeFilePath.startsWith(`..${path.sep}`) &&
        relativeFilePath !== '..' &&
        !path.isAbsolute(relativeFilePath));
    if (isInsideWorkspace) {
      return relativeFilePath || path.basename(filePath);
    }
  }

  return path.basename(filePath);
};

/**
 * Why: request-time context gives Codex the current file and exact selection,
 * but deliberately excludes a cursor-only range that could mislead the model.
 */
export const buildCodexIdeContext = ({
  activeFilePath,
  workspaceFolders,
  editorSelection,
}: BuildCodexIdeContextOptions): CodexIdeContext => {
  if (!activeFilePath) {
    return { openTabs: [] };
  }

  const fileDescriptor: CodexIdeFileDescriptor = {
    label: path.basename(activeFilePath),
    path: resolveWorkspaceRelativeFilePath(activeFilePath, workspaceFolders),
    fsPath: activeFilePath,
  };
  const matchingNonEmptySelection =
    editorSelection?.filePath === activeFilePath &&
    editorSelection.selectedText.length > 0
      ? editorSelection
      : null;
  if (!matchingNonEmptySelection) {
    // Codex requires a range on activeFile. Keeping only this one open tab
    // preserves file context without inventing a cursor range for the model.
    return { openTabs: [fileDescriptor] };
  }

  const activeFile: CodexIdeActiveFile = {
    ...fileDescriptor,
    selection: matchingNonEmptySelection.range,
    activeSelectionContent: matchingNonEmptySelection.selectedText,
    selections: [matchingNonEmptySelection.range],
  };
  return { activeFile, openTabs: [fileDescriptor] };
};
