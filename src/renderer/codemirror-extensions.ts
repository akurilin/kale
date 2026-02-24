//
// This file isolates CodeMirror markdown presentation extensions so the
// renderer entry stays focused on app composition instead of editor internals.
//
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language';
import { type Extension, type Range } from '@codemirror/state';
import { tags } from '@lezer/highlight';
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

const markdownHeadingNodeNameToLevel = new Map<string, number>([
  ['ATXHeading1', 1],
  ['ATXHeading2', 2],
  ['ATXHeading3', 3],
  ['ATXHeading4', 4],
  ['ATXHeading5', 5],
  ['ATXHeading6', 6],
  ['SetextHeading1', 1],
  ['SetextHeading2', 2],
]);

// CodeMirror decorations operate on character ranges, so selection-aware
// marker hiding needs a shared overlap helper to stay readable and correct.
const overlaps = (
  fromA: number,
  toA: number,
  fromB: number,
  toB: number,
): boolean => fromA < toB && toA > fromB;

// The markdown parser already distinguishes ATX and setext heading levels, so
// this helper translates parser node names into a single heading-level scale
// the styling layer can use without duplicating parser-specific knowledge.
const getMarkdownHeadingLevel = (nodeName: string): number | null =>
  markdownHeadingNodeNameToLevel.get(nodeName) ?? null;

// CodeMirror's default markdown highlighting underlines headings, which reads
// like links in a prose editor. This override keeps semantic heading tokens
// while removing the underline so line-level typography can define the look.
export const headingUnderlineResetHighlightExtension = (): Extension =>
  syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: [
          tags.heading,
          tags.heading1,
          tags.heading2,
          tags.heading3,
          tags.heading4,
          tags.heading5,
          tags.heading6,
        ],
        textDecoration: 'none',
      },
    ]),
    { fallback: true },
  );

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

// Heading typography is applied as line decorations so level-specific sizing
// and spacing can be expressed in CSS without mutating markdown text or
// relying on syntax-token spans that are awkward for block-level layout.
export const headingLineDecorationExtension = (): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      // Heading line placement only depends on parsed content and viewport.
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      // Setext heading nodes span both the text line and underline marker
      // line, but typography should only be applied to the visible content
      // line to avoid styling an effectively hidden underline row.
      buildDecorations(view: EditorView) {
        const decorations: Range<Decoration>[] = [];
        const { state } = view;
        const tree = syntaxTree(state);
        const decoratedLineStarts = new Set<number>();

        tree.iterate({
          enter: (node) => {
            const headingLevel = getMarkdownHeadingLevel(node.name);
            if (headingLevel === null) {
              return;
            }

            const headingTextLine = state.doc.lineAt(node.from);
            if (decoratedLineStarts.has(headingTextLine.from)) {
              return;
            }

            decoratedLineStarts.add(headingTextLine.from);
            decorations.push(
              Decoration.line({
                class: `cm-live-heading-line cm-live-heading-line--${headingLevel}`,
              }).range(headingTextLine.from),
            );
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
