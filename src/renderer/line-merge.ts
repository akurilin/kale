//
// Line-level three-way merge for markdown documents. Given a common ancestor
// (base), the user's live editor content (ours), and the current disk content
// (theirs), this produces a merged result that preserves non-conflicting edits
// from both sides. When both sides changed the same lines, the disk version
// (theirs) wins because external writers (like Claude) are authoritative.
//
import { diff3Merge } from 'node-diff3';

export type LineMergeResult = {
  content: string;
  hadConflicts: boolean;
};

// Line-level three-way merge where conflicts resolve in favor of theirs (disk).
// The caller is responsible for deciding whether a merge is needed at all (for
// example by checking whether base === theirs to detect self-save echo-back).
export const mergeDocumentLines = (
  base: string,
  ours: string,
  theirs: string,
): LineMergeResult => {
  // Short-circuit: if any two inputs are identical the answer is trivial and
  // we can avoid running the diff algorithm entirely.
  if (base === theirs) {
    return { content: ours, hadConflicts: false };
  }
  if (base === ours) {
    return { content: theirs, hadConflicts: false };
  }
  if (ours === theirs) {
    return { content: theirs, hadConflicts: false };
  }

  const baseLines = base.split('\n');
  const oursLines = ours.split('\n');
  const theirsLines = theirs.split('\n');

  // diff3Merge argument order: (a=ours, o=base, b=theirs).
  // excludeFalseConflicts treats identical changes from both sides as clean.
  const regions = diff3Merge(oursLines, baseLines, theirsLines, {
    excludeFalseConflicts: true,
  });

  let hadConflicts = false;
  const mergedLines: string[] = [];

  for (const region of regions) {
    if (region.ok) {
      mergedLines.push(...region.ok);
    } else if (region.conflict) {
      // Both sides changed the same region — the disk version wins.
      hadConflicts = true;
      mergedLines.push(...region.conflict.b);
    }
  }

  return {
    content: mergedLines.join('\n'),
    hadConflicts,
  };
};
