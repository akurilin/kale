import { describe, expect, it } from 'vitest';
import { countWordsInMarkdownContent } from './word-count';

describe('countWordsInMarkdownContent', () => {
  it('returns 0 for null content', () => {
    expect(countWordsInMarkdownContent(null)).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(countWordsInMarkdownContent('')).toBe(0);
  });

  it('counts words in plain text', () => {
    expect(countWordsInMarkdownContent('hello world foo')).toBe(3);
  });

  // --- Frontmatter ---

  it('ignores YAML frontmatter at the start of the document', () => {
    const content = `---
title: My Essay
date: 2026-03-08
tags: [writing, test]
---
Hello world.`;
    expect(countWordsInMarkdownContent(content)).toBe(2);
  });

  it('does not strip a fenced block that appears mid-document', () => {
    const content = `Some intro.\n\n---\nnot: frontmatter\n---\n\nMore text.`;
    // --- lines have no letters/digits and are excluded by the word pattern,
    // but "not:", "frontmatter" are visible prose tokens alongside "Some",
    // "intro.", "More", "text." = 6.
    expect(countWordsInMarkdownContent(content)).toBe(6);
  });

  it('ignores TOML frontmatter delimited with +++', () => {
    const content = `+++\ntitle = "My Essay"\ndate = 2026-03-08\n+++\nHello world.`;
    expect(countWordsInMarkdownContent(content)).toBe(2);
  });

  it('handles frontmatter with Windows-style line endings', () => {
    const content = '---\r\ntitle: Test\r\n---\r\nHello world.';
    expect(countWordsInMarkdownContent(content)).toBe(2);
  });

  // --- HTML comments ---

  it('ignores inline @comment markers', () => {
    const content =
      '<!-- @comment:c_abc123 start | "fix this" -->Hello world<!-- @comment:c_abc123 end -->';
    expect(countWordsInMarkdownContent(content)).toBe(2);
  });

  it('ignores regular HTML comments', () => {
    expect(countWordsInMarkdownContent('Hello <!-- hidden --> world.')).toBe(2);
  });

  it('ignores multiline HTML comments', () => {
    const content = `Hello\n<!--\nThis is a\nmultiline comment\n-->\nworld.`;
    expect(countWordsInMarkdownContent(content)).toBe(2);
  });

  // --- Fenced code blocks ---

  it('ignores fenced code blocks with backticks', () => {
    const content = `One two.\n\n\`\`\`js\nconst x = 1;\nreturn x + 2;\n\`\`\`\n\nThree four.`;
    expect(countWordsInMarkdownContent(content)).toBe(4);
  });

  it('ignores fenced code blocks with tildes', () => {
    const content = `One two.\n\n~~~\ncode here\n~~~\n\nThree four.`;
    expect(countWordsInMarkdownContent(content)).toBe(4);
  });

  // --- Links and images ---

  it('counts link display text but not the URL', () => {
    expect(
      countWordsInMarkdownContent(
        'Read [this article](https://example.com/path) today.',
      ),
    ).toBe(4);
  });

  it('counts image alt text but not the URL', () => {
    expect(
      countWordsInMarkdownContent(
        'See ![a cute cat](https://img.example.com/cat.png) here.',
      ),
    ).toBe(5);
  });

  it('ignores reference-style link definitions', () => {
    const content = `Click [here][1] for details.\n\n[1]: https://example.com "Example"`;
    // "Click", "[here][1]" (1 token), "for", "details." = 4 visible words
    expect(countWordsInMarkdownContent(content)).toBe(4);
  });

  // --- Heading markers ---

  it('does not count heading markers as words', () => {
    expect(countWordsInMarkdownContent('## My Heading')).toBe(2);
    expect(countWordsInMarkdownContent('# Title')).toBe(1);
    expect(countWordsInMarkdownContent('### Three Words Here')).toBe(3);
  });

  // --- Blockquote markers ---

  it('does not count blockquote markers as words', () => {
    expect(countWordsInMarkdownContent('> A quoted sentence.')).toBe(3);
    expect(countWordsInMarkdownContent('>> Nested quote.')).toBe(2);
  });

  // --- Horizontal rules ---

  it('does not count horizontal rules as words', () => {
    const content = `Above.\n\n---\n\nBelow.`;
    expect(countWordsInMarkdownContent(content)).toBe(2);
  });

  it('does not count asterisk horizontal rules as words', () => {
    const content = `Above.\n\n***\n\nBelow.`;
    expect(countWordsInMarkdownContent(content)).toBe(2);
  });

  // --- Emphasis and formatting ---

  it('does not inflate count for bold text', () => {
    expect(countWordsInMarkdownContent('This is **bold** text.')).toBe(4);
  });

  it('does not inflate count for italic text', () => {
    expect(countWordsInMarkdownContent('This is *italic* text.')).toBe(4);
  });

  it('does not inflate count for strikethrough text', () => {
    expect(countWordsInMarkdownContent('This is ~~deleted~~ text.')).toBe(4);
  });

  // --- List markers ---

  it('does not count unordered list bullet markers as words', () => {
    const content = `- First item\n- Second item\n- Third item`;
    expect(countWordsInMarkdownContent(content)).toBe(6);
  });

  it('does not count ordered list number markers as words', () => {
    const content = `1. First item\n2. Second item\n3. Third item`;
    expect(countWordsInMarkdownContent(content)).toBe(6);
  });

  // --- Inline code ---

  it('counts inline code content but not backticks', () => {
    expect(countWordsInMarkdownContent('Run `npm install` now.')).toBe(4);
  });

  // --- Combined / realistic ---

  it('handles a realistic document with mixed markdown syntax', () => {
    const content = `---
title: My Essay
---

# Introduction

This is a **bold** claim with a [source](https://example.com).

> Someone once said something wise.

## Code Example

\`\`\`js
const x = 1;
\`\`\`

<!-- @comment:c_abc start | "revise this" -->The conclusion<!-- @comment:c_abc end --> is clear.

1. First point
2. Second point`;
    // "This is a bold claim with a source" = 8
    // "Someone once said something wise" = 5
    // "The conclusion is clear" = 4
    // "First point" = 2
    // "Second point" = 2
    // "Introduction" = 1, "Code Example" = 2
    expect(countWordsInMarkdownContent(content)).toBe(24);
  });
});
