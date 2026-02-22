//
// This file isolates CodeMirror markdown presentation extensions so the
// renderer entry stays focused on app composition instead of editor internals.
//
import { syntaxTree } from '@codemirror/language';
import { type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

const markerNodes = new Set([
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'EmphasisMark',
  'CodeMark',
]);

// CodeMirror decorations operate on character ranges, so selection-aware
// marker hiding needs a shared overlap helper to stay readable and correct.
const overlaps = (
  fromA: number,
  toA: number,
  fromB: number,
  toB: number,
): boolean => fromA < toB && toA > fromB;

// live-preview marker tokens must remain visible when the cursor/selection
// is interacting with the same region so editing still feels source-oriented.
const isSelectionContextActive = (
  state: EditorView['state'],
  from: number,
  to: number,
): boolean => {
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

// this plugin implements the markdown live-preview behavior without
// mutating document text by hiding marker tokens via decorations only.
export const livePreviewMarkersExtension = (): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      // marker visibility depends on document content and cursor context.
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

      // syntax-tree-driven decoration generation is less fragile than
      // regex parsing and stays aligned with CodeMirror markdown semantics.
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

            if (
              markerNodes.has(name) &&
              !isSelectionContextActive(state, from, to)
            ) {
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
      decorations: (viewPluginInstance) => viewPluginInstance.decorations,
    },
  );

// blockquote styling is attached as line decorations so quote visuals stay
// aligned across wrapped and multi-line parser-recognized blockquote regions.
export const quoteLineDecorationExtension = (): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      // line decoration placement only depends on content/layout changes.
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      // each parsed blockquote spans one or more lines, and line
      // decorations must be anchored at line starts for stable rendering.
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
      decorations: (viewPluginInstance) => viewPluginInstance.decorations,
    },
  );
