import type { EditorSelection } from '../shared-types';

export type PiEditorContextSnapshot = {
  activeFilePath: string | null;
  selection: EditorSelection;
};

/**
 * Why: file changes can briefly leave the prior editor selection in main's
 * cache, so Pi must receive only a selection that belongs to the active file.
 */
export const buildPiEditorContextSnapshot = (
  activeFilePath: string | null,
  editorSelection: EditorSelection,
): PiEditorContextSnapshot => ({
  activeFilePath,
  selection:
    activeFilePath && editorSelection?.filePath === activeFilePath
      ? editorSelection
      : null,
});
