//
// This file isolates CodeMirror markdown presentation extensions so the
// renderer entry stays focused on app composition instead of editor internals.
//
import { syntaxTree } from '@codemirror/language';
import { Prec, type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type ViewUpdate,
} from '@codemirror/view';
import {
  parseInlineCommentsFromMarkdown,
  type InlineComment,
} from './inline-comments';

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

// ---------------------------------------------------------------------------
// ViewPlugin factory
//
// Every decoration-producing CodeMirror plugin follows the same skeleton:
// build decorations in the constructor, rebuild when specified conditions are
// met in the update handler, and expose the set via an accessor. This factory
// extracts that boilerplate so each extension only supplies the two pieces
// that actually vary: the rebuild predicate and the decoration builder.
// ---------------------------------------------------------------------------

const createDecorationViewPlugin = (
  shouldRebuildDecorations: (update: ViewUpdate) => boolean,
  buildDecorations: (view: EditorView) => Range<Decoration>[],
): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations;
      constructor(view: EditorView) {
        this.decorations = Decoration.set(buildDecorations(view), true);
      }
      update(update: ViewUpdate) {
        if (shouldRebuildDecorations(update)) {
          this.decorations = Decoration.set(
            buildDecorations(update.view),
            true,
          );
        }
      }
    },
    { decorations: (viewPluginInstance) => viewPluginInstance.decorations },
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

// syntax-tree-driven decoration generation is less fragile than
// regex parsing and stays aligned with CodeMirror markdown semantics.
const buildLivePreviewMarkerDecorations = (
  view: EditorView,
): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const { state } = view;
  const tree = syntaxTree(state);

  tree.iterate({
    enter: (node) => {
      const { name, from, to } = node;
      if (from >= to) {
        return;
      }

      if (markerNodes.has(name) && !isSelectionContextActive(state, from, to)) {
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

  return decorations;
};

// This plugin implements the markdown live-preview behavior without
// mutating document text by hiding marker tokens via decorations only.
// Marker visibility depends on document content and cursor context.
export const livePreviewMarkersExtension = (): Extension =>
  createDecorationViewPlugin(
    (update) =>
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.focusChanged,
    buildLivePreviewMarkerDecorations,
  );

// Setext heading nodes span both the text line and underline marker line, but
// typography should only be applied to the visible content line to avoid
// styling an effectively hidden underline row.
const buildHeadingLineDecorations = (view: EditorView): Range<Decoration>[] => {
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

  return decorations;
};

// Heading typography is applied as line decorations so level-specific sizing
// and spacing can be expressed in CSS without mutating markdown text or
// relying on syntax-token spans that are awkward for block-level layout.
export const headingLineDecorationExtension = (): Extension =>
  createDecorationViewPlugin(
    (update) => update.docChanged || update.viewportChanged,
    buildHeadingLineDecorations,
  );

// Each parsed blockquote spans one or more lines, and line decorations must
// be anchored at line starts for stable rendering.
const buildQuoteLineDecorations = (view: EditorView): Range<Decoration>[] => {
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
            Decoration.line({ class: 'cm-live-quote-line' }).range(line.from),
          );
        }

        if (line.to >= node.to || line.number >= state.doc.lines) {
          break;
        }
        line = state.doc.line(line.number + 1);
      }
    },
  });

  return decorations;
};

// Blockquote styling is attached as line decorations so quote visuals stay
// aligned across wrapped and multi-line parser-recognized blockquote regions.
export const quoteLineDecorationExtension = (): Extension =>
  createDecorationViewPlugin(
    (update) => update.docChanged || update.viewportChanged,
    buildQuoteLineDecorations,
  );

// Marker ranges are replaced so users interact with highlighted prose while
// the raw comment syntax remains persisted in the document source.
const buildInlineCommentDecorations = (
  view: EditorView,
): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const parsedComments = parseInlineCommentsFromMarkdown(
    view.state.doc.toString(),
  );

  for (const comment of parsedComments) {
    decorations.push(
      Decoration.replace({}).range(
        comment.startMarkerFrom,
        comment.startMarkerTo,
      ),
    );
    decorations.push(
      Decoration.replace({}).range(comment.endMarkerFrom, comment.endMarkerTo),
    );

    if (comment.contentFrom < comment.contentTo) {
      decorations.push(
        Decoration.mark({ class: 'cm-inline-comment-range' }).range(
          comment.contentFrom,
          comment.contentTo,
        ),
      );
    }
  }

  return decorations;
};

// Inline comments are stored as markdown HTML comment markers, so this plugin
// hides the marker syntax and highlights the anchored text range for editing.
export const inlineCommentDecorationExtension = (): Extension =>
  createDecorationViewPlugin(
    (update) => update.docChanged || update.viewportChanged,
    buildInlineCommentDecorations,
  );

// ---------------------------------------------------------------------------
// Inline comment marker cursor/deletion protection
//
// The replace decorations above hide the HTML comment markers visually, but
// the underlying document characters remain. Without explicit protection the
// cursor can land inside a hidden marker (one arrow-key press at a time) and
// Backspace/Delete can remove individual marker characters, corrupting the
// comment syntax and causing raw marker text to suddenly appear.
//
// Two complementary extensions solve this:
//
// 1. atomicRanges – tells CodeMirror that cursor motion should skip over
//    marker character ranges entirely, jumping from one boundary to the other.
//
// 2. A high-precedence keymap interceptor for Backspace/Delete – when the
//    character that would normally be deleted falls inside a hidden marker,
//    the deletion is redirected to the nearest visible character instead.
// ---------------------------------------------------------------------------

// Check whether a document position falls inside any comment marker range.
// Returns the marker boundaries if so, or null if the position is in visible
// content or outside any comment altogether.
const findContainingMarkerRange = (
  pos: number,
  comments: InlineComment[],
): { markerFrom: number; markerTo: number } | null => {
  for (const comment of comments) {
    if (pos >= comment.startMarkerFrom && pos < comment.startMarkerTo) {
      return {
        markerFrom: comment.startMarkerFrom,
        markerTo: comment.startMarkerTo,
      };
    }
    if (pos >= comment.endMarkerFrom && pos < comment.endMarkerTo) {
      return {
        markerFrom: comment.endMarkerFrom,
        markerTo: comment.endMarkerTo,
      };
    }
  }
  return null;
};

// Intercepts Backspace when the character behind the cursor is inside a hidden
// comment marker. Instead of corrupting the marker, the deletion skips the
// marker and removes the nearest visible character before it.
const markerAwareBackspace = (view: EditorView): boolean => {
  const { state } = view;
  const { main } = state.selection;

  // Only handle collapsed cursors – selection-based deletion is fine as-is.
  if (!main.empty || main.head === 0) {
    return false;
  }

  const comments = parseInlineCommentsFromMarkdown(state.doc.toString());
  const marker = findContainingMarkerRange(main.head - 1, comments);

  if (!marker) {
    return false;
  }

  // Skip the entire marker and delete the character just before it instead.
  if (marker.markerFrom > 0) {
    view.dispatch({
      changes: { from: marker.markerFrom - 1, to: marker.markerFrom },
      selection: { anchor: marker.markerFrom - 1 },
    });
  }
  return true;
};

// Intercepts Delete (forward) when the character at the cursor is inside a
// hidden comment marker. The deletion skips the marker and removes the nearest
// visible character after it.
const markerAwareDelete = (view: EditorView): boolean => {
  const { state } = view;
  const { main } = state.selection;

  if (!main.empty || main.head >= state.doc.length) {
    return false;
  }

  const comments = parseInlineCommentsFromMarkdown(state.doc.toString());
  const marker = findContainingMarkerRange(main.head, comments);

  if (!marker) {
    return false;
  }

  // Skip the entire marker and delete the character just after it instead.
  if (marker.markerTo < state.doc.length) {
    view.dispatch({
      changes: { from: marker.markerTo, to: marker.markerTo + 1 },
    });
  }
  return true;
};

// Explicit atomic ranges ensure cursor motion (arrow keys, Home/End, mouse
// clicks) never places the caret inside a hidden comment marker. This is a
// belt-and-suspenders complement to the replace decorations which also imply
// atomicity, guarding against edge cases in decoration timing or focus.
export const inlineCommentAtomicRangesExtension = (): Extension =>
  EditorView.atomicRanges.of((view) => {
    const comments = parseInlineCommentsFromMarkdown(view.state.doc.toString());
    const ranges: Range<Decoration>[] = [];

    for (const comment of comments) {
      if (comment.startMarkerFrom < comment.startMarkerTo) {
        ranges.push(
          Decoration.mark({}).range(
            comment.startMarkerFrom,
            comment.startMarkerTo,
          ),
        );
      }
      if (comment.endMarkerFrom < comment.endMarkerTo) {
        ranges.push(
          Decoration.mark({}).range(comment.endMarkerFrom, comment.endMarkerTo),
        );
      }
    }

    return Decoration.set(ranges, true);
  });

// High-precedence keymap that prevents Backspace and Delete from corrupting
// hidden comment markers by redirecting the deletion to visible content.
export const inlineCommentEditGuardExtension = (): Extension =>
  Prec.high(
    keymap.of([
      { key: 'Backspace', run: markerAwareBackspace },
      { key: 'Delete', run: markerAwareDelete },
    ]),
  );
