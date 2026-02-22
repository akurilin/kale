//
// This file encapsulates save/autosave debounce and status state so
// renderer composition code can use a small persistence controller API.
//
const DEFAULT_SAVE_DELAY_MS = 5000;

type SaveControllerOptions = {
  saveDelayMs?: number;
  saveMarkdownContent: (content: string) => Promise<void>;
  setSaveStatusText: (text: string) => void;
};

type SaveController = {
  clearPendingSaveTimer: () => void;
  markContentAsSavedFromLoad: (content: string) => void;
  saveNow: (content: string) => Promise<void>;
  scheduleSave: (content: string) => void;
  flushPendingSave: (getCurrentContent: () => string) => Promise<void>;
};

// autosave state and debounce behavior are cross-cutting renderer concerns
// that are easier to reason about when isolated behind a small controller API.
export const createSaveController = ({
  saveDelayMs = DEFAULT_SAVE_DELAY_MS,
  saveMarkdownContent,
  setSaveStatusText,
}: SaveControllerOptions): SaveController => {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSavedContent = '';
  let isSaving = false;

  // timer cleanup needs one source of truth so pending-save state does not
  // drift when file loads, manual saves, or flushes cancel the debounce.
  const clearPendingSaveTimer = () => {
    if (!saveTimer) {
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = null;
  };

  // file loads replace editor content with already-persisted text, so the
  // controller must reset dedupe state to avoid an immediate redundant save.
  const markContentAsSavedFromLoad = (content: string) => {
    clearPendingSaveTimer();
    lastSavedContent = content;
  };

  // all persistence writes go through one function so dedupe, in-flight
  // guarding, status text, and error handling behave consistently everywhere.
  const saveNow = async (content: string) => {
    if (isSaving) {
      return;
    }

    if (content === lastSavedContent) {
      setSaveStatusText('Saved');
      return;
    }

    isSaving = true;
    setSaveStatusText('Saving...');
    try {
      await saveMarkdownContent(content);
      lastSavedContent = content;
      setSaveStatusText('Saved');
    } catch (error) {
      setSaveStatusText('Save failed');
      console.error(error);
    } finally {
      isSaving = false;
    }
  };

  // typing should feel immediate, so the controller records dirty state
  // instantly and delays filesystem writes until input activity settles.
  const scheduleSave = (content: string) => {
    setSaveStatusText('Unsaved changes');
    clearPendingSaveTimer();
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveNow(content);
    }, saveDelayMs);
  };

  // file switches and lifecycle events need a single "save before leaving"
  // operation that also cancels the debounce to avoid duplicate writes.
  const flushPendingSave = async (getCurrentContent: () => string) => {
    clearPendingSaveTimer();
    await saveNow(getCurrentContent());
  };

  return {
    clearPendingSaveTimer,
    markContentAsSavedFromLoad,
    saveNow,
    scheduleSave,
    flushPendingSave,
  };
};
