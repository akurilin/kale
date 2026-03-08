// Word-counting utility for the document header badge. Strips markdown syntax
// and metadata so the count reflects only the prose a reader would see on the
// rendered page — heading markers, code fences, link URLs, and other structural
// characters are excluded.

/** Matches YAML (---) or TOML (+++) frontmatter at the very start of the file. */
const FRONTMATTER_PATTERN = /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?:\r?\n|$)/;

/** Matches all HTML comments, including inline @comment markers. */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/** Matches fenced code blocks delimited by backticks or tildes. */
const FENCED_CODE_BLOCK_PATTERN = /^(`{3,}|~{3,}).*\r?\n[\s\S]*?^\1\s*$/gm;

/** Matches reference-style link definitions (e.g. `[id]: http://...`). */
const REFERENCE_LINK_DEFINITION_PATTERN = /^\[.*?\]:\s+.*$/gm;

/** Matches images, capturing alt text: `![alt](url)` → `alt`. */
const IMAGE_PATTERN = /!\[([^\]]*)\]\([^)]*\)/g;

/** Matches inline links, capturing display text: `[text](url)` → `text`. */
const LINK_PATTERN = /\[([^\]]*)\]\([^)]*\)/g;

/** Matches HTML tags (e.g. `<br>`, `<div class="x">`). */
const HTML_TAG_PATTERN = /<[^>]+>/g;

/** Matches inline code backtick wrappers, keeping the inner content. */
const INLINE_CODE_PATTERN = /`([^`]*)`/g;

/** Matches ordered list markers at the start of a line (e.g. `1. `). */
const ORDERED_LIST_MARKER_PATTERN = /^\s*\d+[.)]\s/gm;

/**
 * A word token: any non-whitespace run that contains at least one Unicode
 * letter or digit. Stray punctuation-only tokens (`#`, `>`, `---`, `*`)
 * are naturally excluded.
 */
const WORD_TOKEN_PATTERN = /\S*[\p{L}\p{N}]\S*/gu;

/** Counts user-visible words in a markdown document by stripping structural
 *  syntax first so the badge reflects actual prose length, not the underlying
 *  markdown formatting. */
export const countWordsInMarkdownContent = (
  markdownContent: string | null,
): number => {
  if (!markdownContent) {
    return 0;
  }

  let text = markdownContent;

  // Remove metadata blocks that aren't rendered prose.
  text = text.replace(FRONTMATTER_PATTERN, '');
  text = text.replace(HTML_COMMENT_PATTERN, '');
  text = text.replace(FENCED_CODE_BLOCK_PATTERN, '');

  // Collapse link/image syntax to just the visible display text.
  text = text.replace(REFERENCE_LINK_DEFINITION_PATTERN, '');
  text = text.replace(IMAGE_PATTERN, '$1');
  text = text.replace(LINK_PATTERN, '$1');

  // Strip remaining HTML tags and inline code backticks (keep code content).
  text = text.replace(HTML_TAG_PATTERN, '');
  text = text.replace(INLINE_CODE_PATTERN, '$1');

  // Ordered list markers contain digits that would otherwise count as words.
  text = text.replace(ORDERED_LIST_MARKER_PATTERN, '');

  // Only count tokens that contain at least one letter or digit — this
  // naturally excludes heading markers (#), blockquote markers (>),
  // horizontal rules (---/***), unordered list bullets (- * +), and
  // emphasis wrappers (** * __ _ ~~).
  return text.match(WORD_TOKEN_PATTERN)?.length ?? 0;
};
