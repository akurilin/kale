import { describe, expect, it } from 'vitest';

import { mergeDocumentLines } from './line-merge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Builds a multi-line string from an array of lines for readable test cases.
const lines = (...parts: string[]) => parts.join('\n');

// ---------------------------------------------------------------------------
// Trivial / short-circuit cases
// ---------------------------------------------------------------------------

describe('mergeDocumentLines — trivial cases', () => {
  it('returns ours unchanged when theirs equals base (no external change)', () => {
    const base = lines('Hello', 'World');
    const ours = lines('Hello', 'Beautiful World');
    const theirs = lines('Hello', 'World');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(ours);
    expect(result.hadConflicts).toBe(false);
  });

  it('returns theirs when ours equals base (no user change)', () => {
    const base = lines('Hello', 'World');
    const ours = lines('Hello', 'World');
    const theirs = lines('Hello', 'New World');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(theirs);
    expect(result.hadConflicts).toBe(false);
  });

  it('returns theirs when ours equals theirs (both made same change)', () => {
    const base = lines('Hello', 'World');
    const ours = lines('Hello', 'New World');
    const theirs = lines('Hello', 'New World');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(theirs);
    expect(result.hadConflicts).toBe(false);
  });

  it('returns ours when all three are identical', () => {
    const content = lines('Hello', 'World');

    const result = mergeDocumentLines(content, content, content);

    expect(result.content).toBe(content);
    expect(result.hadConflicts).toBe(false);
  });

  it('handles empty strings for all inputs', () => {
    const result = mergeDocumentLines('', '', '');

    expect(result.content).toBe('');
    expect(result.hadConflicts).toBe(false);
  });

  it('handles empty base with ours only adding content', () => {
    const base = '';
    const ours = lines('New paragraph');
    const theirs = '';

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(ours);
    expect(result.hadConflicts).toBe(false);
  });

  it('handles empty base with theirs only adding content', () => {
    const base = '';
    const ours = '';
    const theirs = lines('Claude added this');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(theirs);
    expect(result.hadConflicts).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Non-conflicting merges — edits to different regions
// ---------------------------------------------------------------------------

describe('mergeDocumentLines — non-conflicting edits to different regions', () => {
  it('merges edits to different lines in a short document', () => {
    const base = lines('Line one', 'Line two', 'Line three');
    const ours = lines('Line one EDITED', 'Line two', 'Line three');
    const theirs = lines('Line one', 'Line two', 'Line three EDITED');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(
      lines('Line one EDITED', 'Line two', 'Line three EDITED'),
    );
    expect(result.hadConflicts).toBe(false);
  });

  it('merges edits to different paragraphs', () => {
    const base = lines(
      '# Title',
      '',
      'First paragraph here.',
      '',
      'Second paragraph here.',
      '',
      'Third paragraph here.',
    );
    const ours = lines(
      '# Title',
      '',
      'First paragraph was edited by user.',
      '',
      'Second paragraph here.',
      '',
      'Third paragraph here.',
    );
    const theirs = lines(
      '# Title',
      '',
      'First paragraph here.',
      '',
      'Second paragraph here.',
      '',
      'Third paragraph was edited by Claude.',
    );

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(
      lines(
        '# Title',
        '',
        'First paragraph was edited by user.',
        '',
        'Second paragraph here.',
        '',
        'Third paragraph was edited by Claude.',
      ),
    );
    expect(result.hadConflicts).toBe(false);
  });

  it('preserves user edit at start when theirs edits end', () => {
    const base = lines('Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo');
    const ours = lines('ALPHA', 'Bravo', 'Charlie', 'Delta', 'Echo');
    const theirs = lines('Alpha', 'Bravo', 'Charlie', 'Delta', 'ECHO');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(
      lines('ALPHA', 'Bravo', 'Charlie', 'Delta', 'ECHO'),
    );
    expect(result.hadConflicts).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Non-conflicting merges — insertions
// ---------------------------------------------------------------------------

describe('mergeDocumentLines — non-conflicting insertions', () => {
  it('preserves user insertion when theirs edits a different region', () => {
    const base = lines('Line one', 'Line two', 'Line three');
    const ours = lines(
      'Line one',
      'Line one-and-a-half',
      'Line two',
      'Line three',
    );
    const theirs = lines('Line one', 'Line two', 'Line three EDITED');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(
      lines('Line one', 'Line one-and-a-half', 'Line two', 'Line three EDITED'),
    );
    expect(result.hadConflicts).toBe(false);
  });

  it('preserves theirs insertion when user edits a different region', () => {
    const base = lines('Line one', 'Line two', 'Line three');
    const ours = lines('Line one EDITED', 'Line two', 'Line three');
    const theirs = lines(
      'Line one',
      'Line two',
      'Line two-and-a-half',
      'Line three',
    );

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(
      lines('Line one EDITED', 'Line two', 'Line two-and-a-half', 'Line three'),
    );
    expect(result.hadConflicts).toBe(false);
  });

  it('merges insertions at different positions', () => {
    const base = lines('A', 'B', 'C');
    const ours = lines('A', 'A2', 'B', 'C');
    const theirs = lines('A', 'B', 'C', 'D');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(lines('A', 'A2', 'B', 'C', 'D'));
    expect(result.hadConflicts).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Non-conflicting merges — deletions
// ---------------------------------------------------------------------------

describe('mergeDocumentLines — non-conflicting deletions', () => {
  it('preserves user deletion when theirs edits a different region', () => {
    const base = lines('Keep', 'Delete me', 'Also keep', 'End');
    const ours = lines('Keep', 'Also keep', 'End');
    const theirs = lines('Keep', 'Delete me', 'Also keep', 'End EDITED');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(lines('Keep', 'Also keep', 'End EDITED'));
    expect(result.hadConflicts).toBe(false);
  });

  it('preserves theirs deletion when user edits a different region', () => {
    const base = lines('Start', 'Middle', 'Remove this', 'End');
    const ours = lines('Start EDITED', 'Middle', 'Remove this', 'End');
    const theirs = lines('Start', 'Middle', 'End');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(lines('Start EDITED', 'Middle', 'End'));
    expect(result.hadConflicts).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Conflicting merges — theirs wins
// ---------------------------------------------------------------------------

describe('mergeDocumentLines — conflicts (theirs wins)', () => {
  it('takes theirs when both edit the same line', () => {
    const base = lines('Hello World');
    const ours = lines('Hello Beautiful World');
    const theirs = lines('Hello Brave World');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(lines('Hello Brave World'));
    expect(result.hadConflicts).toBe(true);
  });

  it('takes theirs when both edit the same line among unchanged lines', () => {
    const base = lines('Before', 'Contested line', 'After');
    const ours = lines('Before', 'User version', 'After');
    const theirs = lines('Before', 'Disk version', 'After');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(lines('Before', 'Disk version', 'After'));
    expect(result.hadConflicts).toBe(true);
  });

  it('takes theirs on conflicting region but preserves non-conflicting user edits', () => {
    const base = lines('User area', '', 'Contested area', '', 'Untouched area');
    const ours = lines(
      'User area EDITED',
      '',
      'User also edited contested',
      '',
      'Untouched area',
    );
    const theirs = lines(
      'User area',
      '',
      'Claude edited contested',
      '',
      'Untouched area',
    );

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(
      lines(
        'User area EDITED',
        '',
        'Claude edited contested',
        '',
        'Untouched area',
      ),
    );
    expect(result.hadConflicts).toBe(true);
  });

  it('takes theirs when both delete and replace the same line differently', () => {
    const base = lines('A', 'B', 'C');
    const ours = lines('A', 'B-user', 'C');
    const theirs = lines('A', 'B-disk', 'C');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(lines('A', 'B-disk', 'C'));
    expect(result.hadConflicts).toBe(true);
  });

  it('reports no conflict when both sides make the exact same edit (false conflict)', () => {
    const base = lines('A', 'B', 'C');
    const ours = lines('A', 'SAME', 'C');
    const theirs = lines('A', 'SAME', 'C');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(lines('A', 'SAME', 'C'));
    expect(result.hadConflicts).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mixed scenarios — multiple conflicts and clean merges in one document
// ---------------------------------------------------------------------------

describe('mergeDocumentLines — mixed conflicts and clean merges', () => {
  it('handles interleaved conflicting and non-conflicting edits', () => {
    const base = lines(
      '# Document',
      '',
      'Paragraph one content.',
      '',
      'Paragraph two content.',
      '',
      'Paragraph three content.',
      '',
      'Paragraph four content.',
    );
    // User edits paragraphs 1 and 3.
    const ours = lines(
      '# Document',
      '',
      'Paragraph one USER edit.',
      '',
      'Paragraph two content.',
      '',
      'Paragraph three USER edit.',
      '',
      'Paragraph four content.',
    );
    // Disk edits paragraphs 2 and 3 (paragraph 3 conflicts with user).
    const theirs = lines(
      '# Document',
      '',
      'Paragraph one content.',
      '',
      'Paragraph two DISK edit.',
      '',
      'Paragraph three DISK edit.',
      '',
      'Paragraph four content.',
    );

    const result = mergeDocumentLines(base, ours, theirs);

    // Paragraph 1: only user changed → user wins.
    // Paragraph 2: only disk changed → disk wins.
    // Paragraph 3: both changed → disk wins (conflict).
    // Paragraph 4: unchanged.
    expect(result.content).toBe(
      lines(
        '# Document',
        '',
        'Paragraph one USER edit.',
        '',
        'Paragraph two DISK edit.',
        '',
        'Paragraph three DISK edit.',
        '',
        'Paragraph four content.',
      ),
    );
    expect(result.hadConflicts).toBe(true);
  });

  it('handles multiple independent conflicts in one document', () => {
    const base = lines('A', 'B', 'C', 'D', 'E');
    const ours = lines('A-user', 'B', 'C-user', 'D', 'E');
    const theirs = lines('A-disk', 'B', 'C-disk', 'D', 'E');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(lines('A-disk', 'B', 'C-disk', 'D', 'E'));
    expect(result.hadConflicts).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Realistic prose editing scenarios
// ---------------------------------------------------------------------------

describe('mergeDocumentLines — realistic markdown scenarios', () => {
  it('user types in one section while Claude rewrites another', () => {
    const base = lines(
      '# My Essay',
      '',
      '## Introduction',
      '',
      'This is the intro.',
      '',
      '## Body',
      '',
      'This is the body.',
      '',
      '## Conclusion',
      '',
      'This is the conclusion.',
    );
    // User expands the introduction while typing.
    const ours = lines(
      '# My Essay',
      '',
      '## Introduction',
      '',
      'This is the intro. I am expanding on my thoughts here.',
      'Adding another sentence to the introduction.',
      '',
      '## Body',
      '',
      'This is the body.',
      '',
      '## Conclusion',
      '',
      'This is the conclusion.',
    );
    // Claude rewrites the conclusion from the terminal.
    const theirs = lines(
      '# My Essay',
      '',
      '## Introduction',
      '',
      'This is the intro.',
      '',
      '## Body',
      '',
      'This is the body.',
      '',
      '## Conclusion',
      '',
      'In conclusion, the evidence strongly supports the thesis.',
      'Further research is recommended.',
    );

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(
      lines(
        '# My Essay',
        '',
        '## Introduction',
        '',
        'This is the intro. I am expanding on my thoughts here.',
        'Adding another sentence to the introduction.',
        '',
        '## Body',
        '',
        'This is the body.',
        '',
        '## Conclusion',
        '',
        'In conclusion, the evidence strongly supports the thesis.',
        'Further research is recommended.',
      ),
    );
    expect(result.hadConflicts).toBe(false);
  });

  it('user fixes a typo while Claude adds a new section', () => {
    const base = lines(
      '# Notes',
      '',
      'The quikc brown fox.',
      '',
      'End of notes.',
    );
    const ours = lines(
      '# Notes',
      '',
      'The quick brown fox.',
      '',
      'End of notes.',
    );
    const theirs = lines(
      '# Notes',
      '',
      'The quikc brown fox.',
      '',
      '## New Section',
      '',
      'Claude added this section.',
      '',
      'End of notes.',
    );

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(
      lines(
        '# Notes',
        '',
        'The quick brown fox.',
        '',
        '## New Section',
        '',
        'Claude added this section.',
        '',
        'End of notes.',
      ),
    );
    expect(result.hadConflicts).toBe(false);
  });

  it('user deletes a paragraph while Claude edits a different one', () => {
    // When user deletes paragraph B and Claude edits paragraph C, the
    // deletion and the edit touch adjacent regions. diff3 sees them as a
    // single conflict hunk because there are no unchanged lines between
    // the deletion endpoint and the edit. Theirs wins for the whole hunk,
    // so paragraph B is preserved. This is a known limitation — in real
    // prose the blank line separators usually provide enough context.
    const base = lines(
      'Paragraph A.',
      '',
      'Paragraph B to be deleted.',
      '',
      'Paragraph C.',
    );
    const ours = lines('Paragraph A.', '', 'Paragraph C.');
    const theirs = lines(
      'Paragraph A.',
      '',
      'Paragraph B to be deleted.',
      '',
      'Paragraph C was improved.',
    );

    const result = mergeDocumentLines(base, ours, theirs);

    // Theirs wins for the conflicting region, keeping paragraph B.
    expect(result.content).toBe(
      lines(
        'Paragraph A.',
        '',
        'Paragraph B to be deleted.',
        '',
        'Paragraph C was improved.',
      ),
    );
    expect(result.hadConflicts).toBe(true);
  });

  it('user deletes a paragraph while Claude edits a distant one (clean merge)', () => {
    // When there is enough unchanged context between edits, diff3 can
    // cleanly merge the deletion and the edit without a conflict.
    const base = lines(
      'Paragraph A.',
      '',
      'Paragraph B to be deleted.',
      '',
      'Unchanged separator paragraph.',
      '',
      'Paragraph C.',
    );
    const ours = lines(
      'Paragraph A.',
      '',
      'Unchanged separator paragraph.',
      '',
      'Paragraph C.',
    );
    const theirs = lines(
      'Paragraph A.',
      '',
      'Paragraph B to be deleted.',
      '',
      'Unchanged separator paragraph.',
      '',
      'Paragraph C was improved.',
    );

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(
      lines(
        'Paragraph A.',
        '',
        'Unchanged separator paragraph.',
        '',
        'Paragraph C was improved.',
      ),
    );
    expect(result.hadConflicts).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('mergeDocumentLines — edge cases', () => {
  it('handles single-line documents', () => {
    const base = 'One line';
    const ours = 'One line edited by user';
    const theirs = 'One line edited by disk';

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe('One line edited by disk');
    expect(result.hadConflicts).toBe(true);
  });

  it('treats adjacent line edits as conflict (theirs wins)', () => {
    // When both sides edit adjacent lines (lines 1 and 2 in a 3-line doc)
    // with no unchanged context between them, diff3 treats the whole run
    // as a conflict. Theirs wins. This is expected — in real markdown,
    // paragraph separators (blank lines) provide context between edits.
    const base = lines('Line one', 'Line two', '');
    const ours = lines('Line one EDITED', 'Line two', '');
    const theirs = lines('Line one', 'Line two EDITED', '');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(lines('Line one', 'Line two EDITED', ''));
    expect(result.hadConflicts).toBe(true);
  });

  it('cleanly merges non-adjacent line edits with context between them', () => {
    const base = lines('Line one', 'Unchanged middle', 'Line three', '');
    const ours = lines('Line one EDITED', 'Unchanged middle', 'Line three', '');
    const theirs = lines(
      'Line one',
      'Unchanged middle',
      'Line three EDITED',
      '',
    );

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(
      lines('Line one EDITED', 'Unchanged middle', 'Line three EDITED', ''),
    );
    expect(result.hadConflicts).toBe(false);
  });

  it('handles documents where theirs completely replaces content', () => {
    const base = lines('Old content', 'More old content');
    const ours = lines('Old content with user tweak', 'More old content');
    const theirs = lines('Completely new document', 'Written by Claude');

    const result = mergeDocumentLines(base, ours, theirs);

    // Theirs wins for everything since it's a full rewrite.
    expect(result.content).toBe(
      lines('Completely new document', 'Written by Claude'),
    );
    expect(result.hadConflicts).toBe(true);
  });

  it('handles documents where ours completely replaces content', () => {
    const base = lines('Old content', 'More old content');
    const ours = lines('User rewrote everything');
    const theirs = lines('Old content', 'More old content');

    const result = mergeDocumentLines(base, ours, theirs);

    // No external change, so user's rewrite stands.
    expect(result.content).toBe(lines('User rewrote everything'));
    expect(result.hadConflicts).toBe(false);
  });

  it('treats whitespace insertion adjacent to external edit as conflict', () => {
    // User inserts a blank line right before the line that theirs edited.
    // diff3 sees these as touching the same region → conflict, theirs wins.
    const base = lines('Hello', '', 'World');
    const ours = lines('Hello', '', '', 'World');
    const theirs = lines('Hello', '', 'World EDITED');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toContain('World EDITED');
    expect(result.hadConflicts).toBe(true);
  });

  it('handles very long documents with a single small user edit', () => {
    const manyLines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
    const base = manyLines.join('\n');

    const oursLines = [...manyLines];
    oursLines[5] = 'Line 6 EDITED BY USER';
    const ours = oursLines.join('\n');

    const theirsLines = [...manyLines];
    theirsLines[95] = 'Line 96 EDITED BY DISK';
    const theirs = theirsLines.join('\n');

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toContain('Line 6 EDITED BY USER');
    expect(result.content).toContain('Line 96 EDITED BY DISK');
    expect(result.hadConflicts).toBe(false);
  });

  it('treats adjacent edits to prose and inline comment markers as conflict', () => {
    // User edits line 1, theirs edits line 2 — adjacent, no context. Conflict.
    const base = lines(
      'Some text',
      '<!-- comment-start:abc {} -->highlighted<!-- comment-end:abc -->',
      'More text',
    );
    const ours = lines(
      'Some text EDITED',
      '<!-- comment-start:abc {} -->highlighted<!-- comment-end:abc -->',
      'More text',
    );
    const theirs = lines(
      'Some text',
      '<!-- comment-start:abc {"text":"note"} -->highlighted<!-- comment-end:abc -->',
      'More text',
    );

    const result = mergeDocumentLines(base, ours, theirs);

    // Theirs wins for the conflict hunk (adjacent edits on lines 1-2).
    expect(result.content).toBe(
      lines(
        'Some text',
        '<!-- comment-start:abc {"text":"note"} -->highlighted<!-- comment-end:abc -->',
        'More text',
      ),
    );
    expect(result.hadConflicts).toBe(true);
  });

  it('cleanly merges inline comment markers when edits have context between them', () => {
    const base = lines(
      'Some text',
      '',
      '<!-- comment-start:abc {} -->highlighted<!-- comment-end:abc -->',
      '',
      'More text',
    );
    const ours = lines(
      'Some text EDITED',
      '',
      '<!-- comment-start:abc {} -->highlighted<!-- comment-end:abc -->',
      '',
      'More text',
    );
    const theirs = lines(
      'Some text',
      '',
      '<!-- comment-start:abc {"text":"note"} -->highlighted<!-- comment-end:abc -->',
      '',
      'More text',
    );

    const result = mergeDocumentLines(base, ours, theirs);

    expect(result.content).toBe(
      lines(
        'Some text EDITED',
        '',
        '<!-- comment-start:abc {"text":"note"} -->highlighted<!-- comment-end:abc -->',
        '',
        'More text',
      ),
    );
    expect(result.hadConflicts).toBe(false);
  });
});
