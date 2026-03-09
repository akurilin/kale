import { describe, expect, it } from 'vitest';
import { collectHtmlCommentRanges } from './spellcheck-extension';

describe('collectHtmlCommentRanges', () => {
  it('returns empty array for text with no comments', () => {
    expect(collectHtmlCommentRanges('Hello world')).toEqual([]);
  });

  it('finds a single inline HTML comment', () => {
    const text = 'Hello <!-- hidden --> world';
    //            0123456
    //                   <!-- hidden --> = positions 6..21
    expect(collectHtmlCommentRanges(text)).toEqual([{ from: 6, to: 21 }]);
  });

  it('finds Kale inline comment start and end markers', () => {
    const text =
      '<!-- @comment:c_abc123 start | "fix this" -->Hello world<!-- @comment:c_abc123 end -->';
    const ranges = collectHtmlCommentRanges(text);
    expect(ranges).toEqual([
      { from: 0, to: 45 },
      { from: 56, to: 86 },
    ]);
  });

  it('finds multiple comments in a document', () => {
    const text = 'Before <!-- first --> middle <!-- second --> after';
    expect(collectHtmlCommentRanges(text)).toEqual([
      { from: 7, to: 21 },
      { from: 29, to: 44 },
    ]);
  });

  it('finds multiline HTML comments', () => {
    const text = 'Hello\n<!--\nThis is a\nmultiline comment\n-->\nworld';
    expect(collectHtmlCommentRanges(text)).toEqual([{ from: 6, to: 42 }]);
  });

  it('finds comments with encoded JSON payloads', () => {
    const text =
      '<!-- @comment:c_ff00aa start | "review our \\u002d\\u002d compliance" -->text<!-- @comment:c_ff00aa end -->';
    const ranges = collectHtmlCommentRanges(text);
    // The start marker spans from 0 to the closing -->
    expect(ranges[0].from).toBe(0);
    expect(text.slice(ranges[0].from, ranges[0].to)).toMatch(/^<!--.*-->$/);
    // The end marker
    expect(ranges[1]).toBeDefined();
    expect(text.slice(ranges[1].from, ranges[1].to)).toMatch(/^<!--.*-->$/);
  });
});
