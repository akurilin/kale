//
// Self-contained CodeMirror 6 spell-check extension. Uses the Electron
// spellchecker (exposed through the preload bridge) to underline misspelled
// words inside prose regions of the Markdown document.
//
// All Electron/IPC integration is encapsulated here — the caller just
// drops the returned Extension into the CM6 extensions array.
//

import { syntaxTree } from '@codemirror/language';
import { linter, forceLinting, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getSpellcheckApi } from './spellcheck-api';

// ---------------------------------------------------------------------------
// Word tokenization
// ---------------------------------------------------------------------------

// Matches sequences of letters (including common accented characters),
// optionally followed by apostrophe-letter sequences for contractions
// like "don't" and "they're". Single characters are excluded to reduce
// noise — they're almost never misspelled.
const WORD_PATTERN =
  /[a-zA-Z\u00C0-\u024F]{2,}(?:['''][a-zA-Z\u00C0-\u024F]+)*/g;

type TextRange = { from: number; to: number };

// ---------------------------------------------------------------------------
// Frontmatter detection
// ---------------------------------------------------------------------------

// YAML (---) or TOML (+++) frontmatter at the very start of the file.
// Duplicated from codemirror-extensions.ts to keep this module self-contained.
const FRONTMATTER_PATTERN = /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?:\r?\n|$)/;

// ---------------------------------------------------------------------------
// HTML comment detection (regex-based fallback)
// ---------------------------------------------------------------------------

// Matches all HTML comments including Kale's inline @comment markers.
// The Lezer Markdown syntax tree doesn't always classify inline HTML comments
// as recognised node types (especially complex markers with JSON payloads),
// so this regex provides a reliable fallback that mirrors the approach already
// used by the word-count module.
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

// Scans raw document text for HTML comment ranges. Exported for testing.
export const collectHtmlCommentRanges = (text: string): TextRange[] => {
  const ranges: TextRange[] = [];
  HTML_COMMENT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_COMMENT_PATTERN.exec(text)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
};

// ---------------------------------------------------------------------------
// Syntax-tree-based prose filtering
// ---------------------------------------------------------------------------

// Syntax tree nodes where the entire subtree should be excluded from
// spell checking — code, raw HTML, and HTML comments contain no prose.
const SKIP_SUBTREE_NODE_NAMES = new Set([
  'FencedCode',
  'CodeBlock',
  'InlineCode',
  'HTMLBlock',
  'HTMLTag',
  'Comment',
  'ProcessingInstruction',
]);

// Leaf-ish syntax nodes that should be excluded individually — these
// are markdown control tokens or URL strings inside otherwise-prose contexts.
const SKIP_LEAF_NODE_NAMES = new Set([
  'URL',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
  'HardBreak',
]);

// Build a sorted list of document ranges that should not be spell-checked.
// Uses the Markdown syntax tree to identify code, URLs, and other non-prose,
// supplemented by regex-based HTML comment detection for markers the parser
// may not classify as HTML nodes (e.g. Kale's inline @comment markers).
const collectNonProseRanges = (view: EditorView): TextRange[] => {
  const ranges: TextRange[] = [];
  const docText = view.state.doc.toString();

  // Frontmatter is metadata, not prose — skip it entirely.
  const frontmatterMatch = FRONTMATTER_PATTERN.exec(docText);
  if (frontmatterMatch) {
    ranges.push({ from: 0, to: frontmatterMatch[0].length });
  }

  // Regex-based HTML comment detection catches inline @comment markers and
  // any other HTML comments that the syntax tree might miss.
  ranges.push(...collectHtmlCommentRanges(docText));

  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (SKIP_SUBTREE_NODE_NAMES.has(node.name)) {
        ranges.push({ from: node.from, to: node.to });
        return false;
      }

      if (SKIP_LEAF_NODE_NAMES.has(node.name)) {
        ranges.push({ from: node.from, to: node.to });
      }
    },
  });

  // Sort by start position so the linear overlap scan in the linter works
  // correctly after merging syntax-tree and regex-based ranges.
  ranges.sort((a, b) => a.from - b.from);

  return ranges;
};

// ---------------------------------------------------------------------------
// Range overlap check (linear scan)
// ---------------------------------------------------------------------------

// Check whether a word overlaps with any non-prose range. Both the word
// list and skip ranges are sorted left-to-right, so we advance a shared
// cursor through the skip ranges for O(n+m) performance.
const isInsideNonProseRange = (
  wordFrom: number,
  wordTo: number,
  nonProseRanges: TextRange[],
  startSearchFromIndex: number,
): { overlaps: boolean; nextSearchIndex: number } => {
  let i = startSearchFromIndex;

  while (i < nonProseRanges.length && nonProseRanges[i].to <= wordFrom) {
    i++;
  }

  const overlaps = i < nonProseRanges.length && nonProseRanges[i].from < wordTo;
  return { overlaps, nextSearchIndex: i };
};

// ---------------------------------------------------------------------------
// Spellcheck result cache
// ---------------------------------------------------------------------------

// Caches per-word spellcheck results so subsequent linter runs (triggered by
// every edit after the debounce) only need to check words not seen before.
// Without this, every run re-checks every unique word in the document through
// contextBridge, which blocks the main thread noticeably on longer documents.
const spellcheckResultCache = new Map<string, boolean>();

// Words the user has added to the dictionary during this session. Checked
// before calling the Electron API so the underline disappears immediately
// after "Add to dictionary" — without waiting for the OS dictionary update
// to propagate back to webFrame.isWordMisspelled.
const localDictionaryAdditions = new Set<string>();

// ---------------------------------------------------------------------------
// Core linter
// ---------------------------------------------------------------------------

// Tokenizes the document into words, filters out non-prose ranges using the
// syntax tree, batch-checks spelling via the Electron bridge, and returns
// CM6 diagnostics with replacement suggestions.
const checkSpelling = (view: EditorView): Diagnostic[] => {
  const spellcheckApi = getSpellcheckApi();
  const docText = view.state.doc.toString();
  const nonProseRanges = collectNonProseRanges(view);

  // Collect all prose words and their positions.
  const wordOccurrences: Array<{ word: string; from: number; to: number }> = [];
  const uniqueWords = new Set<string>();
  let skipSearchIndex = 0;

  WORD_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_PATTERN.exec(docText)) !== null) {
    const wordFrom = match.index;
    const wordTo = wordFrom + match[0].length;

    const { overlaps, nextSearchIndex } = isInsideNonProseRange(
      wordFrom,
      wordTo,
      nonProseRanges,
      skipSearchIndex,
    );
    skipSearchIndex = nextSearchIndex;

    if (overlaps) {
      continue;
    }

    const word = match[0];
    wordOccurrences.push({ word, from: wordFrom, to: wordTo });
    uniqueWords.add(word);
  }

  if (uniqueWords.size === 0) {
    return [];
  }

  // Only send words we haven't checked before through the contextBridge.
  // This keeps subsequent linter runs (after a single keystroke) near-instant
  // since typically 0-1 words are new.
  const uncachedWords: string[] = [];
  for (const w of uniqueWords) {
    if (!localDictionaryAdditions.has(w) && !spellcheckResultCache.has(w)) {
      uncachedWords.push(w);
    }
  }

  if (uncachedWords.length > 0) {
    const newlyMisspelled = new Set(spellcheckApi.checkWords(uncachedWords));
    for (const w of uncachedWords) {
      spellcheckResultCache.set(w, newlyMisspelled.has(w));
    }
  }

  const misspelledWords = new Set(
    [...uniqueWords].filter(
      (w) =>
        !localDictionaryAdditions.has(w) &&
        spellcheckResultCache.get(w) === true,
    ),
  );

  if (misspelledWords.size === 0) {
    return [];
  }

  // Cache suggestions per unique misspelled word so repeated occurrences
  // don't trigger redundant calls through the preload bridge.
  const suggestionCache = new Map<string, string[]>();

  const diagnostics: Diagnostic[] = [];
  for (const { word, from, to } of wordOccurrences) {
    if (!misspelledWords.has(word)) {
      continue;
    }

    let suggestions = suggestionCache.get(word);
    if (!suggestions) {
      suggestions = spellcheckApi.getSuggestions(word);
      suggestionCache.set(word, suggestions);
    }

    diagnostics.push({
      from,
      to,
      severity: 'info',
      message: `Misspelled: "${word}"`,
      markClass: 'cm-spellcheck-misspelled',
      actions: [
        ...suggestions.slice(0, 5).map((suggestion) => ({
          name: suggestion,
          apply: (applyView: EditorView, diagFrom: number, diagTo: number) => {
            applyView.dispatch({
              changes: { from: diagFrom, to: diagTo, insert: suggestion },
            });
          },
        })),
        {
          name: 'Add to dictionary',
          apply: (applyView: EditorView) => {
            localDictionaryAdditions.add(word);
            spellcheckResultCache.delete(word);
            void spellcheckApi.addToDictionary(word);
            forceLinting(applyView);
          },
        },
      ],
    });
  }

  return diagnostics;
};

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

// Override the default CM6 lint underline for spell-check diagnostics
// with a red wavy underline that matches traditional spell-check UX.
const spellcheckTheme = EditorView.baseTheme({
  '.cm-lintRange.cm-spellcheck-misspelled': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy #d94040',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '2px',
    textDecorationThickness: '0.8px',
  },
});

// ---------------------------------------------------------------------------
// Public extension
// ---------------------------------------------------------------------------

// Returns a self-contained CM6 extension that spell-checks prose in the
// Markdown editor. Drop this into the extensions array to enable; remove
// it to disable. Nothing else in the app needs to change.
export const spellcheckExtension = (): Extension => [
  linter(checkSpelling, { delay: 500 }),
  spellcheckTheme,
];
