import './index.css';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { basicSetup } from 'codemirror';

type LoadMarkdownResponse = {
  content: string;
  filePath: string;
};

type SaveMarkdownResponse = {
  ok: boolean;
};

declare global {
  interface Window {
    markdownApi: {
      loadMarkdown: () => Promise<LoadMarkdownResponse>;
      saveMarkdown: (content: string) => Promise<SaveMarkdownResponse>;
    };
  }
}

const SAVE_DELAY_MS = 5000;

const filePathEl = document.querySelector<HTMLElement>('#file-path');
const statusEl = document.querySelector<HTMLElement>('#save-status');
const editorEl = document.querySelector<HTMLElement>('#editor');

if (!filePathEl || !statusEl || !editorEl) {
  throw new Error('Missing required UI elements');
}

let view: EditorView | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedContent = '';
let isSaving = false;

const setStatus = (text: string) => {
  statusEl.textContent = text;
};

const saveNow = async (content: string) => {
  if (isSaving) {
    return;
  }

  if (content === lastSavedContent) {
    setStatus('Saved');
    return;
  }

  isSaving = true;
  setStatus('Saving...');
  try {
    await window.markdownApi.saveMarkdown(content);
    lastSavedContent = content;
    setStatus('Saved');
  } catch (error) {
    setStatus('Save failed');
    console.error(error);
  } finally {
    isSaving = false;
  }
};

const scheduleSave = (content: string) => {
  setStatus('Unsaved changes');
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    void saveNow(content);
  }, SAVE_DELAY_MS);
};

const overlaps = (
  fromA: number,
  toA: number,
  fromB: number,
  toB: number,
): boolean => fromA < toB && toA > fromB;

const isActiveContext = (state: EditorView['state'], from: number, to: number): boolean => {
  for (const range of state.selection.ranges) {
    if (overlaps(from, to, range.from, range.to)) {
      return true;
    }

    const headLine = state.doc.lineAt(range.head);
    if (overlaps(from, to, headLine.from, headLine.to + 1)) {
      return true;
    }

    const anchorLine = state.doc.lineAt(range.anchor);
    if (overlaps(from, to, anchorLine.from, anchorLine.to + 1)) {
      return true;
    }
  }

  return false;
};

const markerNodes = new Set([
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'EmphasisMark',
  'CodeMark',
]);

const livePreviewMarkersExtension = (): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.focusChanged
        ) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const decorations: Range<Decoration>[] = [];
        const { state } = view;
        const tree = syntaxTree(state);

        tree.iterate({
          enter: (node) => {
            const { name, from, to } = node;
            if (from >= to) {
              return;
            }

            if (markerNodes.has(name) && !isActiveContext(state, from, to)) {
              let hideTo = to;

              if (
                (name === 'HeaderMark' ||
                  name === 'QuoteMark' ||
                  name === 'ListMark') &&
                state.sliceDoc(to, to + 1) === ' '
              ) {
                hideTo = to + 1;
              }

              decorations.push(Decoration.replace({}).range(from, hideTo));
            }
          },
        });

        return Decoration.set(decorations, true);
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );

const quoteLineDecorationExtension = (): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const decorations: Range<Decoration>[] = [];
        const { state } = view;
        const tree = syntaxTree(state);
        const lineStarts = new Set<number>();

        tree.iterate({
          enter: (node) => {
            if (node.name !== 'Blockquote') {
              return;
            }

            let line = state.doc.lineAt(node.from);
            while (line.from <= node.to) {
              if (!lineStarts.has(line.from)) {
                lineStarts.add(line.from);
                decorations.push(
                  Decoration.line({ class: 'cm-live-quote-line' }).range(
                    line.from,
                  ),
                );
              }

              if (line.to >= node.to || line.number >= state.doc.lines) {
                break;
              }
              line = state.doc.line(line.number + 1);
            }
          },
        });

        return Decoration.set(decorations, true);
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );

const bootstrap = async () => {
  setStatus('Loading...');
  const { content, filePath } = await window.markdownApi.loadMarkdown();
  filePathEl.textContent = filePath;
  lastSavedContent = content;

  view = new EditorView({
    doc: content,
    extensions: [
      basicSetup,
      markdown(),
      quoteLineDecorationExtension(),
      livePreviewMarkersExtension(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) {
          return;
        }
        const nextContent = update.state.doc.toString();
        scheduleSave(nextContent);
      }),
    ],
    parent: editorEl,
  });

  setStatus('Saved');
};

window.addEventListener('blur', () => {
  if (!view) {
    return;
  }
  void saveNow(view.state.doc.toString());
});

window.addEventListener('beforeunload', () => {
  if (!view) {
    return;
  }
  void saveNow(view.state.doc.toString());
});

void bootstrap();
