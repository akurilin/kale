//
// This file isolates CodeMirror markdown presentation extensions so the
// renderer entry stays focused on app composition instead of editor internals.
//
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type Range,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type Transaction,
} from '@codemirror/state';
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

const livePreviewLinkLabelCssClassName = 'cm-live-link-label';

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

export type LivePreviewDecorationInstruction =
  | {
      type: 'replace';
      from: number;
      to: number;
    }
  | {
      type: 'mark';
      from: number;
      to: number;
      className: string;
    };

// Direct child-node filtering keeps link destination concealment strictly
// syntax-aware and avoids brittle text scanning for parsed token boundaries.
const listDirectChildSyntaxNodesByName = (
  parentSyntaxNode: SyntaxNode,
  childName: string,
): SyntaxNode[] => {
  const matchingChildNodes: SyntaxNode[] = [];
  let childNode = parentSyntaxNode.firstChild;

  while (childNode) {
    if (childNode.name === childName) {
      matchingChildNodes.push(childNode);
    }
    childNode = childNode.nextSibling;
  }

  return matchingChildNodes;
};

// Link live-preview transforms need exact label bracket ranges so the visible
// label can remain while only markdown control characters are concealed.
const findMarkdownLinkLabelBoundaryMarkerRanges = (
  linkSyntaxNode: SyntaxNode,
): {
  openingLabelMarkerRange: { from: number; to: number };
  closingLabelMarkerRange: { from: number; to: number };
} | null => {
  const linkMarkerNodes = listDirectChildSyntaxNodesByName(
    linkSyntaxNode,
    'LinkMark',
  );
  if (linkMarkerNodes.length < 2) {
    return null;
  }

  const openingLabelMarkerNode = linkMarkerNodes[0];
  const closingLabelMarkerNode = linkMarkerNodes[1];
  return {
    openingLabelMarkerRange: {
      from: openingLabelMarkerNode.from,
      to: openingLabelMarkerNode.to,
    },
    closingLabelMarkerRange: {
      from: closingLabelMarkerNode.from,
      to: closingLabelMarkerNode.to,
    },
  };
};

// Inline markdown links can contain URL plus optional title text, so hiding the
// full `(destination ...)` span prevents stray whitespace leakage in preview.
const findMarkdownInlineLinkDestinationRange = (
  editorState: EditorState,
  linkSyntaxNode: SyntaxNode,
): { from: number; to: number } | null => {
  let destinationStart: number | null = null;
  let destinationEnd: number | null = null;
  let childNode = linkSyntaxNode.firstChild;

  while (childNode) {
    if (childNode.name !== 'LinkMark') {
      childNode = childNode.nextSibling;
      continue;
    }

    const markerText = editorState.sliceDoc(childNode.from, childNode.to);
    if (markerText === '(' && destinationStart === null) {
      destinationStart = childNode.from;
      childNode = childNode.nextSibling;
      continue;
    }

    if (markerText === ')' && destinationStart !== null) {
      destinationEnd = childNode.to;
      break;
    }

    childNode = childNode.nextSibling;
  }

  if (destinationStart === null || destinationEnd === null) {
    return null;
  }

  return { from: destinationStart, to: destinationEnd };
};

// Reference-style links encode destination metadata as a trailing label token
// that should be hidden in preview so only the prose label remains visible.
const findMarkdownReferenceLinkDestinationRange = (
  linkSyntaxNode: SyntaxNode,
): { from: number; to: number } | null => {
  const referenceLabelNode = listDirectChildSyntaxNodesByName(
    linkSyntaxNode,
    'LinkLabel',
  )[0];
  if (!referenceLabelNode) {
    return null;
  }

  return { from: referenceLabelNode.from, to: referenceLabelNode.to };
};

// Hugo shortcode detection operates on a parenthesized same-line segment so we
// only conceal explicit shortcode destinations and never cross line boundaries.
const findParenthesizedSegmentOnSameLine = (
  editorState: EditorState,
  parenthesisOpenPos: number,
): { from: number; to: number; content: string } | null => {
  if (
    editorState.sliceDoc(parenthesisOpenPos, parenthesisOpenPos + 1) !== '('
  ) {
    return null;
  }

  const lineAtParenthesisOpen = editorState.doc.lineAt(parenthesisOpenPos);
  let openParenthesisDepth = 0;
  for (
    let cursorPos = parenthesisOpenPos;
    cursorPos < lineAtParenthesisOpen.to;
    cursorPos += 1
  ) {
    const nextCharacter = editorState.sliceDoc(cursorPos, cursorPos + 1);
    if (nextCharacter === '(') {
      openParenthesisDepth += 1;
      continue;
    }

    if (nextCharacter !== ')') {
      continue;
    }

    openParenthesisDepth -= 1;
    if (openParenthesisDepth !== 0) {
      continue;
    }

    return {
      from: parenthesisOpenPos,
      to: cursorPos + 1,
      content: editorState.sliceDoc(parenthesisOpenPos + 1, cursorPos),
    };
  }

  return null;
};

// This predicate intentionally matches both Hugo shortcode delimiters (`{{<`
// and `{{%`) so ref/relref and percent-shortcode forms share one code path.
const isHugoShortcodeDestinationContent = (
  destinationContent: string,
): boolean => {
  const trimmedDestinationContent = destinationContent.trim();
  return (
    /^\{\{<[\s\S]*>\}\}$/.test(trimmedDestinationContent) ||
    /^\{\{%[\s\S]*%\}\}$/.test(trimmedDestinationContent)
  );
};

// Hugo links are often authored as `[label]({{< ref ... >}})`, where only the
// label is parsed as a Link node, so we conceal the raw shortcode destination.
const findHugoShortcodeLinkDestinationRange = (
  editorState: EditorState,
  linkLabelEndPos: number,
): { from: number; to: number } | null => {
  const parenthesizedSegment = findParenthesizedSegmentOnSameLine(
    editorState,
    linkLabelEndPos,
  );
  if (!parenthesizedSegment) {
    return null;
  }

  if (!isHugoShortcodeDestinationContent(parenthesizedSegment.content)) {
    return null;
  }

  return { from: parenthesizedSegment.from, to: parenthesizedSegment.to };
};

// Inactive markdown links should show only visible label prose with link
// styling, while raw destination syntax stays hidden until the line is active.
const appendInactiveMarkdownLinkDecorations = (
  editorState: EditorState,
  linkSyntaxNode: SyntaxNode,
  decorationInstructions: LivePreviewDecorationInstruction[],
) => {
  const labelBoundaryMarkerRanges =
    findMarkdownLinkLabelBoundaryMarkerRanges(linkSyntaxNode);
  if (!labelBoundaryMarkerRanges) {
    return;
  }

  const inlineDestinationRange = findMarkdownInlineLinkDestinationRange(
    editorState,
    linkSyntaxNode,
  );
  const referenceDestinationRange =
    findMarkdownReferenceLinkDestinationRange(linkSyntaxNode);
  const hugoDestinationRange = findHugoShortcodeLinkDestinationRange(
    editorState,
    labelBoundaryMarkerRanges.closingLabelMarkerRange.to,
  );
  const destinationRangeToConceal =
    inlineDestinationRange ?? referenceDestinationRange ?? hugoDestinationRange;

  // Links without a destination (for example bracketed prose like "[0]") stay
  // source-visible so this extension does not hide non-hyperlink content.
  if (!destinationRangeToConceal) {
    return;
  }

  decorationInstructions.push({
    type: 'replace',
    from: labelBoundaryMarkerRanges.openingLabelMarkerRange.from,
    to: labelBoundaryMarkerRanges.openingLabelMarkerRange.to,
  });
  decorationInstructions.push({
    type: 'replace',
    from: labelBoundaryMarkerRanges.closingLabelMarkerRange.from,
    to: labelBoundaryMarkerRanges.closingLabelMarkerRange.to,
  });
  decorationInstructions.push({
    type: 'replace',
    from: destinationRangeToConceal.from,
    to: destinationRangeToConceal.to,
  });

  const linkLabelFrom = labelBoundaryMarkerRanges.openingLabelMarkerRange.to;
  const linkLabelTo = labelBoundaryMarkerRanges.closingLabelMarkerRange.from;
  if (linkLabelFrom < linkLabelTo) {
    decorationInstructions.push({
      type: 'mark',
      from: linkLabelFrom,
      to: linkLabelTo,
      className: livePreviewLinkLabelCssClassName,
    });
  }
};

// Autolinks already expose the URL text itself as the visible title, so this
// path hides only angle brackets and applies the same link label styling.
const appendInactiveAutolinkDecorations = (
  autolinkSyntaxNode: SyntaxNode,
  decorationInstructions: LivePreviewDecorationInstruction[],
) => {
  const autolinkMarkerNodes = listDirectChildSyntaxNodesByName(
    autolinkSyntaxNode,
    'LinkMark',
  );
  for (const autolinkMarkerNode of autolinkMarkerNodes) {
    decorationInstructions.push({
      type: 'replace',
      from: autolinkMarkerNode.from,
      to: autolinkMarkerNode.to,
    });
  }

  const autolinkUrlNode = listDirectChildSyntaxNodesByName(
    autolinkSyntaxNode,
    'URL',
  )[0];
  if (!autolinkUrlNode || autolinkUrlNode.from >= autolinkUrlNode.to) {
    return;
  }

  decorationInstructions.push({
    type: 'mark',
    from: autolinkUrlNode.from,
    to: autolinkUrlNode.to,
    className: livePreviewLinkLabelCssClassName,
  });
};

// Exposing instruction generation keeps live-preview behavior testable without
// spinning up DOM-backed EditorView instances in unit tests.
export const buildLivePreviewDecorationInstructionsForState = (
  editorState: EditorState,
): LivePreviewDecorationInstruction[] => {
  const decorationInstructions: LivePreviewDecorationInstruction[] = [];
  const tree = syntaxTree(editorState);

  tree.iterate({
    enter: (node) => {
      const { name, from, to } = node;
      if (from >= to) {
        return;
      }

      if (
        markerNodes.has(name) &&
        !isSelectionContextActive(editorState, from, to)
      ) {
        let hideTo = to;

        if (
          (name === 'HeaderMark' ||
            name === 'QuoteMark' ||
            name === 'ListMark') &&
          editorState.sliceDoc(to, to + 1) === ' '
        ) {
          hideTo = to + 1;
        }

        decorationInstructions.push({
          type: 'replace',
          from,
          to: hideTo,
        });
        return;
      }

      if (name === 'Link' && !isSelectionContextActive(editorState, from, to)) {
        appendInactiveMarkdownLinkDecorations(
          editorState,
          node.node,
          decorationInstructions,
        );
        return;
      }

      if (
        name === 'Autolink' &&
        !isSelectionContextActive(editorState, from, to)
      ) {
        appendInactiveAutolinkDecorations(node.node, decorationInstructions);
      }
    },
  });

  return decorationInstructions;
};

// Syntax-tree-driven decoration generation is less fragile than regex parsing
// and stays aligned with CodeMirror markdown semantics.
const buildLivePreviewMarkerDecorations = (
  view: EditorView,
): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];

  for (const instruction of buildLivePreviewDecorationInstructionsForState(
    view.state,
  )) {
    if (instruction.type === 'replace') {
      decorations.push(
        Decoration.replace({}).range(instruction.from, instruction.to),
      );
      continue;
    }

    decorations.push(
      Decoration.mark({ class: instruction.className }).range(
        instruction.from,
        instruction.to,
      ),
    );
  }

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

  // When an inline comment wraps a full heading line, the start marker
  // (<!-- @comment:... -->) lands before the `###` prefix, which stops the
  // markdown parser from recognizing the heading. This fallback detects
  // heading syntax hidden behind comment markers so styling is preserved.
  for (let lineNum = 1; lineNum <= state.doc.lines; lineNum++) {
    const line = state.doc.line(lineNum);
    if (decoratedLineStarts.has(line.from)) {
      continue;
    }

    // Quick guard: only process lines starting with an HTML comment marker,
    // since those are the only ones where a comment could obscure heading
    // syntax at the line start.
    if (!line.text.startsWith('<!--')) {
      continue;
    }

    // Strip all HTML comment markers and check whether the remaining text
    // begins with an ATX heading prefix (one to six `#` followed by a space).
    const textWithoutHtmlComments = line.text.replace(/<!--[\s\S]*?-->/g, '');
    const headingPrefixMatch = textWithoutHtmlComments.match(/^(#{1,6})\s/);
    if (headingPrefixMatch) {
      const headingLevel = headingPrefixMatch[1].length;
      decoratedLineStarts.add(line.from);
      decorations.push(
        Decoration.line({
          class: `cm-live-heading-line cm-live-heading-line--${headingLevel}`,
        }).range(line.from),
      );
    }
  }

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
const inlineCommentRangeCssClassName = 'cm-inline-comment-range';
const activeInlineCommentRangeCssClassName = 'cm-inline-comment-range--active';

/**
 * Why: active inline comment focus can change without document mutations, so a
 * dedicated effect carries activation state transitions into CodeMirror.
 */
const setActiveInlineCommentIdEffect = StateEffect.define<string | null>();

/**
 * Why: inline comment highlighting needs one canonical active-comment source of
 * truth inside editor state so decorations and imperative React bridges agree.
 */
const activeInlineCommentIdField = StateField.define<string | null>({
  create: () => null,
  update: (currentActiveInlineCommentId, transaction) => {
    let nextActiveInlineCommentId = currentActiveInlineCommentId;

    for (const effect of transaction.effects) {
      if (effect.is(setActiveInlineCommentIdEffect)) {
        nextActiveInlineCommentId = effect.value;
      }
    }

    if (!transaction.docChanged || nextActiveInlineCommentId === null) {
      return nextActiveInlineCommentId;
    }

    const activeCommentStillExists = parseInlineCommentsFromMarkdown(
      transaction.newDoc.toString(),
    ).some((comment) => comment.id === nextActiveInlineCommentId);
    return activeCommentStillExists ? nextActiveInlineCommentId : null;
  },
});

/**
 * Why: decoration rebuild predicates only need to know whether the active-id
 * effect exists in a transaction, so this helper keeps that check readable.
 */
const transactionIncludesActiveInlineCommentIdEffect = (
  transaction: Transaction,
): boolean => {
  return transaction.effects.some((effect) =>
    effect.is(setActiveInlineCommentIdEffect),
  );
};

/**
 * Why: React owns active-comment orchestration, but CodeMirror owns rendering;
 * this helper is the narrow bridge that syncs active IDs into editor state.
 */
export const setActiveInlineCommentIdForEditorView = (
  view: EditorView,
  activeInlineCommentId: string | null,
): void => {
  const currentActiveInlineCommentId = view.state.field(
    activeInlineCommentIdField,
  );
  if (currentActiveInlineCommentId === activeInlineCommentId) {
    return;
  }

  view.dispatch({
    effects: setActiveInlineCommentIdEffect.of(activeInlineCommentId),
  });
};

const buildInlineCommentDecorations = (
  view: EditorView,
): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const activeInlineCommentId = view.state.field(activeInlineCommentIdField);
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
      const inlineCommentRangeClassName =
        comment.id === activeInlineCommentId
          ? `${inlineCommentRangeCssClassName} ${activeInlineCommentRangeCssClassName}`
          : inlineCommentRangeCssClassName;
      decorations.push(
        Decoration.mark({
          class: inlineCommentRangeClassName,
          attributes: {
            'data-inline-comment-range-id': comment.id,
          },
        }).range(comment.contentFrom, comment.contentTo),
      );
    }
  }

  return decorations;
};

// Inline comments are stored as markdown HTML comment markers, so this plugin
// hides the marker syntax and highlights the anchored text range for editing.
export const inlineCommentDecorationExtension = (): Extension => [
  activeInlineCommentIdField,
  createDecorationViewPlugin(
    (update) =>
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.transactions.some(transactionIncludesActiveInlineCommentIdEffect),
    buildInlineCommentDecorations,
  ),
];

// ---------------------------------------------------------------------------
// Inline comment marker cursor/deletion protection and edge typing policy
//
// The replace decorations above hide the HTML comment markers visually, but
// the underlying document characters remain. Without explicit protection the
// cursor can land inside a hidden marker (one arrow-key press at a time) and
// Backspace/Delete can remove individual marker characters, corrupting the
// comment syntax and causing raw marker text to suddenly appear.
//
// We also need boundary-aware typing behavior: when the cursor sits exactly at
// a comment edge, whitespace insertion should happen outside the comment range
// (matching Google Docs-style anchoring) rather than expanding the annotation
// by accident.
//
// Three complementary behaviors solve this:
//
// 1. atomicRanges – tells CodeMirror that cursor motion should skip over
//    marker character ranges entirely, jumping from one boundary to the other.
//
// 2. A high-precedence keymap interceptor for edge whitespace insertion –
//    Space/Tab/Enter inserted at a comment boundary is redirected outside.
//
// 3. A high-precedence keymap interceptor for Backspace/Delete – when the
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

// Find whether a collapsed cursor sits exactly on an inline comment boundary.
// Returning the outside insertion position lets edge typing keep ranges stable
// while preserving the same visible caret behavior.
const findInlineCommentEdgeInsertionPosition = (
  cursorPos: number,
  comments: InlineComment[],
): number | null => {
  for (const comment of comments) {
    if (cursorPos === comment.contentFrom) {
      return comment.startMarkerFrom;
    }
    if (cursorPos === comment.contentTo) {
      return comment.endMarkerTo;
    }
  }

  return null;
};

// Insert whitespace outside a comment range when the cursor is exactly on a
// comment edge. Returning false defers to default CodeMirror key handling.
const insertWhitespaceOutsideInlineCommentEdge = (
  view: EditorView,
  whitespaceText: string,
): boolean => {
  const { state } = view;
  const { main } = state.selection;
  if (!main.empty) {
    return false;
  }

  const comments = parseInlineCommentsFromMarkdown(state.doc.toString());
  const insertionFrom = findInlineCommentEdgeInsertionPosition(
    main.head,
    comments,
  );
  if (insertionFrom === null) {
    return false;
  }

  view.dispatch({
    changes: { from: insertionFrom, insert: whitespaceText },
    selection: { anchor: insertionFrom + whitespaceText.length },
    userEvent: 'input.type',
  });
  return true;
};

// Space at a comment boundary should not silently expand the highlighted range.
const inlineCommentEdgeAwareSpace = (view: EditorView): boolean => {
  return insertWhitespaceOutsideInlineCommentEdge(view, ' ');
};

// Tab at a comment boundary should shift content outside the annotation range.
const inlineCommentEdgeAwareTab = (view: EditorView): boolean => {
  return insertWhitespaceOutsideInlineCommentEdge(view, '\t');
};

// Enter at a comment boundary should create a newline outside the annotation.
const inlineCommentEdgeAwareEnter = (view: EditorView): boolean => {
  return insertWhitespaceOutsideInlineCommentEdge(view, '\n');
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
// hidden comment markers, and prevents edge whitespace typing from expanding
// inline comment ranges accidentally.
export const inlineCommentEditGuardExtension = (): Extension =>
  Prec.high(
    keymap.of([
      { key: 'Space', run: inlineCommentEdgeAwareSpace },
      { key: 'Tab', run: inlineCommentEdgeAwareTab },
      { key: 'Enter', run: inlineCommentEdgeAwareEnter },
      { key: 'Shift-Enter', run: inlineCommentEdgeAwareEnter },
      { key: 'Backspace', run: markerAwareBackspace },
      { key: 'Delete', run: markerAwareDelete },
    ]),
  );

const markdownStrongFormattingMarker = '**';
const markdownEmphasisFormattingMarker = '*';
const MIN_MARKDOWN_HEADING_LEVEL = 1;
const MAX_MARKDOWN_HEADING_LEVEL = 6;
const markdownAtxHeadingPrefixPattern = /^#{1,6}(?:\s+|$)/;

// Markdown formatting shortcuts should keep selection direction stable after
// wrapping/unwrapping so keyboard workflows feel predictable for users who
// select from either direction.
const createSelectionRangePreservingSelectionDirection = (
  originalSelectionRange: SelectionRange,
  nextFrom: number,
  nextTo: number,
): SelectionRange =>
  originalSelectionRange.anchor <= originalSelectionRange.head
    ? EditorSelection.range(nextFrom, nextTo)
    : EditorSelection.range(nextTo, nextFrom);

// Formatting toggles should remove existing markers when the selection is
// already wrapped so repeated shortcut presses behave like a true toggle.
const selectionIsWrappedWithMarkdownMarker = (
  editorState: EditorState,
  selectionFrom: number,
  selectionTo: number,
  markdownMarker: string,
): boolean => {
  if (selectionFrom < markdownMarker.length) {
    return false;
  }
  if (selectionTo + markdownMarker.length > editorState.doc.length) {
    return false;
  }

  const leadingMarker = editorState.sliceDoc(
    selectionFrom - markdownMarker.length,
    selectionFrom,
  );
  const trailingMarker = editorState.sliceDoc(
    selectionTo,
    selectionTo + markdownMarker.length,
  );

  return leadingMarker === markdownMarker && trailingMarker === markdownMarker;
};

// A single selection-range transformer centralizes wrap/unwrap semantics so
// bold and italic shortcuts share the same offset math and cursor behavior.
const buildMarkdownFormattingToggleForSelectionRange = (
  editorState: EditorState,
  selectionRange: SelectionRange,
  markdownMarker: string,
): {
  changes: ChangeSpec | readonly ChangeSpec[];
  range: SelectionRange;
} => {
  const selectionFrom = Math.min(selectionRange.from, selectionRange.to);
  const selectionTo = Math.max(selectionRange.from, selectionRange.to);

  if (selectionFrom === selectionTo) {
    return {
      changes: {
        from: selectionFrom,
        insert: `${markdownMarker}${markdownMarker}`,
      },
      range: EditorSelection.cursor(selectionFrom + markdownMarker.length),
    };
  }

  const isWrappedWithFormattingMarker = selectionIsWrappedWithMarkdownMarker(
    editorState,
    selectionFrom,
    selectionTo,
    markdownMarker,
  );

  if (isWrappedWithFormattingMarker) {
    return {
      changes: [
        {
          from: selectionTo,
          to: selectionTo + markdownMarker.length,
          insert: '',
        },
        {
          from: selectionFrom - markdownMarker.length,
          to: selectionFrom,
          insert: '',
        },
      ],
      range: createSelectionRangePreservingSelectionDirection(
        selectionRange,
        selectionFrom - markdownMarker.length,
        selectionTo - markdownMarker.length,
      ),
    };
  }

  return {
    changes: [
      {
        from: selectionTo,
        insert: markdownMarker,
      },
      {
        from: selectionFrom,
        insert: markdownMarker,
      },
    ],
    range: createSelectionRangePreservingSelectionDirection(
      selectionRange,
      selectionFrom + markdownMarker.length,
      selectionTo + markdownMarker.length,
    ),
  };
};

// Exposing the state update builder lets unit tests verify markdown shortcut
// transformations without needing a DOM-backed EditorView instance.
export const buildMarkdownFormattingToggleSelectionUpdate = (
  editorState: EditorState,
  markdownMarker: string,
) =>
  editorState.changeByRange((selectionRange) =>
    buildMarkdownFormattingToggleForSelectionRange(
      editorState,
      selectionRange,
      markdownMarker,
    ),
  );

// Heading level commands should stay within markdown's supported ATX heading
// range so unexpected keymap wiring cannot emit invalid heading syntax.
const clampMarkdownHeadingLevel = (headingLevel: number): number =>
  Math.max(
    MIN_MARKDOWN_HEADING_LEVEL,
    Math.min(MAX_MARKDOWN_HEADING_LEVEL, Math.floor(headingLevel)),
  );

// Block-level heading shortcuts should operate on full selected lines, and a
// selection ending exactly at the next line's start should not include it.
const listUniqueSelectedLineNumbers = (editorState: EditorState): number[] => {
  const selectedLineNumbers = new Set<number>();

  for (const selectionRange of editorState.selection.ranges) {
    const selectionFrom = Math.min(selectionRange.from, selectionRange.to);
    const selectionTo = Math.max(selectionRange.from, selectionRange.to);
    const selectionEndsAtStartOfLine =
      !selectionRange.empty &&
      selectionTo > selectionFrom &&
      editorState.sliceDoc(selectionTo - 1, selectionTo) === '\n';
    const inclusiveSelectionTo = selectionEndsAtStartOfLine
      ? selectionTo - 1
      : selectionTo;

    const startLineNumber = editorState.doc.lineAt(selectionFrom).number;
    const endLineNumber = editorState.doc.lineAt(inclusiveSelectionTo).number;
    for (
      let lineNumber = startLineNumber;
      lineNumber <= endLineNumber;
      lineNumber += 1
    ) {
      selectedLineNumbers.add(lineNumber);
    }
  }

  return Array.from(selectedLineNumbers).sort(
    (leftLineNumber, rightLineNumber) => leftLineNumber - rightLineNumber,
  );
};

// Heading shortcuts should preserve indentation and replace any existing ATX
// prefix so repeated level changes stay deterministic on the same line.
const buildLineTextWithMarkdownHeadingLevel = (
  lineText: string,
  headingLevel: number,
): string => {
  const indentationPrefixLength = lineText.match(/^\s*/)?.[0].length ?? 0;
  const indentationPrefix = lineText.slice(0, indentationPrefixLength);
  const textWithoutIndentation = lineText.slice(indentationPrefixLength);
  const textWithoutExistingHeadingPrefix = textWithoutIndentation.replace(
    markdownAtxHeadingPrefixPattern,
    '',
  );
  return `${indentationPrefix}${'#'.repeat(headingLevel)} ${textWithoutExistingHeadingPrefix}`;
};

// Exposing heading-change specs keeps keyboard behavior unit-testable without
// constructing a DOM-backed EditorView for command execution.
export const buildMarkdownHeadingShortcutChangesForState = (
  editorState: EditorState,
  headingLevel: number,
): readonly ChangeSpec[] => {
  const normalizedHeadingLevel = clampMarkdownHeadingLevel(headingLevel);
  const selectedLineNumbers = listUniqueSelectedLineNumbers(editorState);
  const headingShortcutChanges: ChangeSpec[] = [];

  for (const lineNumber of selectedLineNumbers) {
    const line = editorState.doc.line(lineNumber);
    const lineTextWithTargetHeadingLevel =
      buildLineTextWithMarkdownHeadingLevel(line.text, normalizedHeadingLevel);
    if (lineTextWithTargetHeadingLevel === line.text) {
      continue;
    }

    headingShortcutChanges.push({
      from: line.from,
      to: line.to,
      insert: lineTextWithTargetHeadingLevel,
    });
  }

  return headingShortcutChanges;
};

// ---------------------------------------------------------------------------
// Frontmatter line decoration
//
// TOML (+++) and YAML (---) frontmatter at the start of a document is metadata,
// not prose. Greying it out visually separates it from article content so the
// writer's eye naturally skips to the first real paragraph.
// ---------------------------------------------------------------------------

/** Matches YAML (---) or TOML (+++) frontmatter at the very start of the file. */
const FRONTMATTER_PATTERN = /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?:\r?\n|$)/;

// Frontmatter detection operates on raw document text rather than the syntax
// tree because the standard CodeMirror markdown parser does not recognise TOML
// `+++` delimiters and may not emit a dedicated node for YAML `---` blocks.
const buildFrontmatterLineDecorations = (
  view: EditorView,
): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const { state } = view;
  const docText = state.doc.toString();
  const frontmatterMatch = FRONTMATTER_PATTERN.exec(docText);

  if (!frontmatterMatch) {
    return decorations;
  }

  const frontmatterEndOffset = frontmatterMatch[0].length;
  const firstLine = state.doc.lineAt(0);
  const lastFrontmatterLine = state.doc.lineAt(
    // The match may include a trailing newline; step back to land on the
    // closing delimiter line rather than the first content line after it.
    Math.max(0, frontmatterEndOffset - 1),
  );

  for (
    let lineNumber = firstLine.number;
    lineNumber <= lastFrontmatterLine.number;
    lineNumber++
  ) {
    const line = state.doc.line(lineNumber);
    decorations.push(
      Decoration.line({ class: 'cm-frontmatter-line' }).range(line.from),
    );
  }

  return decorations;
};

// Frontmatter styling is applied as line decorations so the greyed-out
// appearance covers delimiter lines and all key-value content between them.
export const frontmatterLineDecorationExtension = (): Extension =>
  createDecorationViewPlugin(
    (update) => update.docChanged || update.viewportChanged,
    buildFrontmatterLineDecorations,
  );

// Formatting shortcuts are editor-native commands so they can participate in
// CodeMirror's multi-selection mapping and history transaction semantics.
const runMarkdownFormattingToggleShortcut = (
  view: EditorView,
  markdownMarker: string,
): boolean => {
  const selectionMappedFormattingUpdate =
    buildMarkdownFormattingToggleSelectionUpdate(view.state, markdownMarker);

  view.dispatch(
    view.state.update(selectionMappedFormattingUpdate, {
      scrollIntoView: true,
      userEvent: 'input.type',
    }),
  );
  return true;
};

// Bold formatting should be reachable from the conventional Mod-b shortcut in
// markdown editing flows.
const toggleMarkdownStrongFormattingShortcut = (view: EditorView): boolean =>
  runMarkdownFormattingToggleShortcut(view, markdownStrongFormattingMarker);

// Italic formatting should use Mod-i and intentionally override CodeMirror's
// default selectParentSyntax behavior for prose-editor ergonomics.
const toggleMarkdownEmphasisFormattingShortcut = (view: EditorView): boolean =>
  runMarkdownFormattingToggleShortcut(view, markdownEmphasisFormattingMarker);

// Heading-level shortcuts mirror common writer tooling (Google Docs/Obsidian)
// by rewriting whole selected lines to the requested markdown heading level.
const runMarkdownHeadingShortcut = (
  view: EditorView,
  headingLevel: number,
): boolean => {
  const headingShortcutChanges = buildMarkdownHeadingShortcutChangesForState(
    view.state,
    headingLevel,
  );
  if (headingShortcutChanges.length === 0) {
    return false;
  }

  view.dispatch(
    view.state.update({
      changes: headingShortcutChanges,
      scrollIntoView: true,
      userEvent: 'input.type',
    }),
  );
  return true;
};

// A high-precedence keymap ensures prose shortcuts run before CodeMirror's
// bundled defaults, including heading-level shortcuts on Mod-Alt-1..6.
export const markdownFormattingShortcutExtension = (): Extension =>
  Prec.high(
    keymap.of([
      {
        key: 'Mod-b',
        run: toggleMarkdownStrongFormattingShortcut,
        preventDefault: true,
      },
      {
        key: 'Mod-i',
        run: toggleMarkdownEmphasisFormattingShortcut,
        preventDefault: true,
      },
      ...Array.from({ length: MAX_MARKDOWN_HEADING_LEVEL }, (_, index) => {
        const headingLevel = index + 1;
        return {
          key: `Mod-Alt-${headingLevel}`,
          run: (view: EditorView) =>
            runMarkdownHeadingShortcut(view, headingLevel),
          preventDefault: true,
        };
      }),
    ]),
  );
