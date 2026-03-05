import { describe, expect, it } from 'vitest';

import { buildSideBySideDiffRows, countChangedDiffRows } from './git-diff';

// Test fixtures read better as explicit lines, so this helper keeps expectations
// compact while still preserving exact newline behavior in assertions.
const lines = (...parts: string[]) => parts.join('\n');

describe('buildSideBySideDiffRows', () => {
  it('returns unchanged rows when documents are identical', () => {
    const content = lines('alpha', 'beta', 'gamma');

    const rows = buildSideBySideDiffRows(content, content);

    expect(rows).toHaveLength(3);
    expect(countChangedDiffRows(rows)).toBe(0);
    expect(rows[0]).toMatchObject({
      leftLineNumber: 1,
      rightLineNumber: 1,
      leftLineText: 'alpha',
      rightLineText: 'alpha',
      hasLeftChange: false,
      hasRightChange: false,
    });
  });

  it('pairs replacements as a red-left and green-right modified row', () => {
    const previous = lines('alpha', 'beta', 'gamma');
    const current = lines('alpha', 'delta', 'gamma');

    const rows = buildSideBySideDiffRows(previous, current);

    expect(rows).toHaveLength(3);
    expect(countChangedDiffRows(rows)).toBe(1);
    expect(rows[1]).toMatchObject({
      leftLineNumber: 2,
      rightLineNumber: 2,
      leftLineText: 'beta',
      rightLineText: 'delta',
      hasLeftChange: true,
      hasRightChange: true,
    });
  });

  it('keeps deletions and insertions aligned when run lengths differ', () => {
    const previous = lines('alpha', 'beta', 'charlie', 'omega');
    const current = lines('alpha', 'beta-updated', 'omega', 'new-tail');

    const rows = buildSideBySideDiffRows(previous, current);

    expect(countChangedDiffRows(rows)).toBe(3);
    expect(rows[1]).toMatchObject({
      leftLineText: 'beta',
      rightLineText: 'beta-updated',
      hasLeftChange: true,
      hasRightChange: true,
    });
    expect(rows[2]).toMatchObject({
      leftLineText: 'charlie',
      rightLineText: '',
      hasLeftChange: true,
      hasRightChange: false,
    });
    expect(rows[4]).toMatchObject({
      leftLineText: '',
      rightLineText: 'new-tail',
      hasLeftChange: false,
      hasRightChange: true,
    });
  });

  it('treats new files as all-additions against an empty HEAD baseline', () => {
    const rows = buildSideBySideDiffRows('', lines('new', 'file'));

    expect(rows).toHaveLength(2);
    expect(countChangedDiffRows(rows)).toBe(2);
    expect(rows[0]).toMatchObject({
      leftLineNumber: null,
      rightLineNumber: 1,
      leftLineText: '',
      rightLineText: 'new',
      hasLeftChange: false,
      hasRightChange: true,
    });
  });
});
