//
// This is the renderer entry point that composes the editor UI, save
// behavior, and file-open lifecycle into one startup/wiring module.
//

import './index.css';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';

import {
  livePreviewMarkersExtension,
  quoteLineDecorationExtension,
} from './renderer/codemirror-extensions';
import { createSaveController } from './renderer/save-controller';
import type {
  LoadMarkdownResponse,
  OpenMarkdownFileResponse,
  SaveMarkdownResponse,
} from './shared-types';

// The renderer process owns the interactive editor UI only.
// It does not touch the filesystem directly; all file I/O goes through the
// preload bridge (`window.markdownApi`) which delegates to the main process.
declare global {
  interface Window {
    markdownApi: {
      loadMarkdown: () => Promise<LoadMarkdownResponse>;
      openMarkdownFile: () => Promise<OpenMarkdownFileResponse>;
      saveMarkdown: (content: string) => Promise<SaveMarkdownResponse>;
    };
  }
}

// Cache the shell UI elements up front so later logic can assume they exist.
const openFileButtonEl =
  document.querySelector<HTMLButtonElement>('#open-file');
const filePathEl = document.querySelector<HTMLElement>('#file-path');
const statusEl = document.querySelector<HTMLElement>('#save-status');
const editorEl = document.querySelector<HTMLElement>('#editor');

if (!openFileButtonEl || !filePathEl || !statusEl || !editorEl) {
  throw new Error('Missing required UI elements');
}

// Renderer state:
// - `view` is the CodeMirror instance
// - `isApplyingLoadedDocument` prevents programmatic loads from triggering autosave
// - `isOpeningFile` prevents overlapping native file-picker flows
let view: EditorView | null = null;
let isApplyingLoadedDocument = false;
let isOpeningFile = false;

// all user-visible save state flows through one helper so wording stays
// consistent across autosave, manual flushes, file loading, and errors.
const setStatus = (text: string) => {
  statusEl.textContent = text;
};

const saveController = createSaveController({
  // the controller owns debounced autosave behavior while renderer.ts
  // remains focused on composition and event wiring.
  saveMarkdownContent: async (content) => {
    await window.markdownApi.saveMarkdown(content);
  },
  setSaveStatusText: setStatus,
});

// editor construction is isolated so startup and later document switches
// reuse the same setup and keep renderer.ts focused on app composition.
const createEditorView = (content: string) => {
  view?.destroy();
  view = new EditorView({
    doc: content,
    extensions: [
      basicSetup,
      markdown(),
      quoteLineDecorationExtension(),
      livePreviewMarkersExtension(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        // Ignore programmatic file loads so they do not trigger autosave.
        if (!update.docChanged || isApplyingLoadedDocument) {
          return;
        }
        saveController.scheduleSave(update.state.doc.toString());
      }),
    ],
    parent: editorEl,
  });
};

// loading a file updates both editor content and surrounding shell UI, so
// startup and "Open..." share one implementation and remain behaviorally aligned.
const applyLoadedDocument = ({ content, filePath }: LoadMarkdownResponse) => {
  saveController.markContentAsSavedFromLoad(content);
  filePathEl.textContent = filePath;

  if (!view) {
    createEditorView(content);
    setStatus('Saved');
    return;
  }

  // Reuse the existing editor instance so extensions and DOM wiring stay stable
  // while swapping in the newly opened file contents.
  isApplyingLoadedDocument = true;
  try {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  } finally {
    isApplyingLoadedDocument = false;
  }

  setStatus('Saved');
};

// opening another file should behave like switching documents in an editor
// and not allow duplicate dialogs or lost edits due to debounce timing.
const openMarkdownFile = async () => {
  if (isOpeningFile) {
    return;
  }

  isOpeningFile = true;
  openFileButtonEl.disabled = true;
  try {
    const activeView = view;
    if (activeView) {
      // Save first so "Open..." behaves like a document switch, not a discard.
      await saveController.flushPendingSave(() =>
        activeView.state.doc.toString(),
      );
    }
    setStatus('Opening...');
    const response = await window.markdownApi.openMarkdownFile();
    if (response.canceled) {
      setStatus(view ? 'Saved' : 'Ready');
      return;
    }

    applyLoadedDocument(response);
  } catch (error) {
    setStatus('Open failed');
    console.error(error);
  } finally {
    isOpeningFile = false;
    openFileButtonEl.disabled = false;
  }
};

// startup is async because the main process decides which file to restore
// (remembered file vs writable fallback) and returns both path and contents.
const bootstrap = async () => {
  setStatus('Loading...');
  const document = await window.markdownApi.loadMarkdown();
  applyLoadedDocument(document);
};

// `void` makes it explicit that event handlers intentionally fire async
// work without awaiting on the DOM event call stack.
openFileButtonEl.addEventListener('click', () => {
  void openMarkdownFile();
});

// blur-triggered saves reduce the chance of losing edits when users switch
// apps or windows before the debounce timer expires.
window.addEventListener('blur', () => {
  if (!view) {
    return;
  }
  void saveController.saveNow(view.state.doc.toString());
});

window.addEventListener('beforeunload', () => {
  if (!view) {
    return;
  }
  // Best-effort flush on close. This is async and can still race teardown
  // (tracked in docs/todos.md), but it reduces losses during normal exits.
  void saveController.saveNow(view.state.doc.toString());
});

// startup runs after handlers/helpers are registered so lifecycle behavior
// is in place before the initial async load completes.
void bootstrap();
