//
// This module builds a read-only, side-by-side line diff model for the UI so
// App.tsx can stay focused on lifecycle/state wiring instead of diff mechanics.
//

export type SideBySideDiffRow = {
  leftLineNumber: number | null;
  leftLineText: string;
  rightLineNumber: number | null;
  rightLineText: string;
  hasLeftChange: boolean;
  hasRightChange: boolean;
};

type RawDiffOperation =
  | {
      kind: 'equal';
      leftLineNumber: number;
      leftLineText: string;
      rightLineNumber: number;
      rightLineText: string;
    }
  | {
      kind: 'delete';
      leftLineNumber: number;
      leftLineText: string;
    }
  | {
      kind: 'insert';
      rightLineNumber: number;
      rightLineText: string;
    };

const MAX_LCS_MATRIX_CELLS = 2_000_000;

// Diff rows are line-oriented in the UI, so this splitter keeps trailing blank
// lines (from trailing newlines) while still treating empty documents as empty.
const splitContentIntoLines = (content: string): string[] => {
  if (content.length === 0) {
    return [];
  }

  return content.split('\n');
};

// The LCS matrix gives stable line-level alignment for side-by-side diffs,
// letting replacements/deletions/insertions map to predictable visual rows.
const buildLongestCommonSubsequenceLengthMatrix = (
  leftLines: string[],
  rightLines: string[],
): number[][] => {
  const matrix = Array.from({ length: leftLines.length + 1 }, () =>
    Array<number>(rightLines.length + 1).fill(0),
  );

  for (let leftIndex = leftLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (
      let rightIndex = rightLines.length - 1;
      rightIndex >= 0;
      rightIndex -= 1
    ) {
      if (leftLines[leftIndex] === rightLines[rightIndex]) {
        matrix[leftIndex][rightIndex] =
          matrix[leftIndex + 1][rightIndex + 1] + 1;
      } else {
        matrix[leftIndex][rightIndex] = Math.max(
          matrix[leftIndex + 1][rightIndex],
          matrix[leftIndex][rightIndex + 1],
        );
      }
    }
  }

  return matrix;
};

// Converting aligned lines into primitive operations keeps row-rendering logic
// simple and lets us pair delete/insert runs into modified side-by-side rows.
const buildRawDiffOperationsFromLongestCommonSubsequence = (
  leftLines: string[],
  rightLines: string[],
  lcsLengthMatrix: number[][],
): RawDiffOperation[] => {
  const rawOperations: RawDiffOperation[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftLines.length || rightIndex < rightLines.length) {
    if (leftIndex >= leftLines.length) {
      rawOperations.push({
        kind: 'insert',
        rightLineNumber: rightIndex + 1,
        rightLineText: rightLines[rightIndex],
      });
      rightIndex += 1;
      continue;
    }

    if (rightIndex >= rightLines.length) {
      rawOperations.push({
        kind: 'delete',
        leftLineNumber: leftIndex + 1,
        leftLineText: leftLines[leftIndex],
      });
      leftIndex += 1;
      continue;
    }

    if (leftLines[leftIndex] === rightLines[rightIndex]) {
      rawOperations.push({
        kind: 'equal',
        leftLineNumber: leftIndex + 1,
        leftLineText: leftLines[leftIndex],
        rightLineNumber: rightIndex + 1,
        rightLineText: rightLines[rightIndex],
      });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    const deleteScore = lcsLengthMatrix[leftIndex + 1][rightIndex];
    const insertScore = lcsLengthMatrix[leftIndex][rightIndex + 1];

    if (deleteScore >= insertScore) {
      rawOperations.push({
        kind: 'delete',
        leftLineNumber: leftIndex + 1,
        leftLineText: leftLines[leftIndex],
      });
      leftIndex += 1;
      continue;
    }

    rawOperations.push({
      kind: 'insert',
      rightLineNumber: rightIndex + 1,
      rightLineText: rightLines[rightIndex],
    });
    rightIndex += 1;
  }

  return rawOperations;
};

// Very large documents can make quadratic LCS expensive, so this fallback
// preserves responsiveness with a straightforward row-by-row approximation.
const buildFallbackRawDiffOperations = (
  leftLines: string[],
  rightLines: string[],
): RawDiffOperation[] => {
  const rawOperations: RawDiffOperation[] = [];
  const maxLineCount = Math.max(leftLines.length, rightLines.length);

  for (let lineIndex = 0; lineIndex < maxLineCount; lineIndex += 1) {
    const leftLineText = leftLines[lineIndex];
    const rightLineText = rightLines[lineIndex];

    if (
      leftLineText !== undefined &&
      rightLineText !== undefined &&
      leftLineText === rightLineText
    ) {
      rawOperations.push({
        kind: 'equal',
        leftLineNumber: lineIndex + 1,
        leftLineText,
        rightLineNumber: lineIndex + 1,
        rightLineText,
      });
      continue;
    }

    if (leftLineText !== undefined) {
      rawOperations.push({
        kind: 'delete',
        leftLineNumber: lineIndex + 1,
        leftLineText,
      });
    }

    if (rightLineText !== undefined) {
      rawOperations.push({
        kind: 'insert',
        rightLineNumber: lineIndex + 1,
        rightLineText,
      });
    }
  }

  return rawOperations;
};

// Grouping adjacent delete/insert operations into one run lets the UI render
// classic modified rows: red on the left and green on the right.
const buildSideBySideRowsFromRawOperations = (
  rawOperations: RawDiffOperation[],
): SideBySideDiffRow[] => {
  const rows: SideBySideDiffRow[] = [];
  let operationIndex = 0;

  while (operationIndex < rawOperations.length) {
    const currentOperation = rawOperations[operationIndex];

    if (currentOperation.kind === 'equal') {
      rows.push({
        leftLineNumber: currentOperation.leftLineNumber,
        leftLineText: currentOperation.leftLineText,
        rightLineNumber: currentOperation.rightLineNumber,
        rightLineText: currentOperation.rightLineText,
        hasLeftChange: false,
        hasRightChange: false,
      });
      operationIndex += 1;
      continue;
    }

    const deletedOperations: Array<
      Extract<RawDiffOperation, { kind: 'delete' }>
    > = [];
    const insertedOperations: Array<
      Extract<RawDiffOperation, { kind: 'insert' }>
    > = [];

    while (operationIndex < rawOperations.length) {
      const runOperation = rawOperations[operationIndex];
      if (runOperation.kind === 'equal') {
        break;
      }

      if (runOperation.kind === 'delete') {
        deletedOperations.push(runOperation);
      } else {
        insertedOperations.push(runOperation);
      }

      operationIndex += 1;
    }

    const maxRunLength = Math.max(
      deletedOperations.length,
      insertedOperations.length,
    );

    for (let runLineIndex = 0; runLineIndex < maxRunLength; runLineIndex += 1) {
      const deletedOperation = deletedOperations[runLineIndex];
      const insertedOperation = insertedOperations[runLineIndex];

      rows.push({
        leftLineNumber: deletedOperation?.leftLineNumber ?? null,
        leftLineText: deletedOperation?.leftLineText ?? '',
        rightLineNumber: insertedOperation?.rightLineNumber ?? null,
        rightLineText: insertedOperation?.rightLineText ?? '',
        hasLeftChange: deletedOperation !== undefined,
        hasRightChange: insertedOperation !== undefined,
      });
    }
  }

  return rows;
};

// The rendered diff needs a row model independent from React so this function
// is pure and testable with predictable line-level output.
export const buildSideBySideDiffRows = (
  previousContent: string,
  currentContent: string,
): SideBySideDiffRow[] => {
  const previousLines = splitContentIntoLines(previousContent);
  const currentLines = splitContentIntoLines(currentContent);
  const matrixCellCount =
    (previousLines.length + 1) * (currentLines.length + 1);

  const rawOperations =
    matrixCellCount <= MAX_LCS_MATRIX_CELLS
      ? buildRawDiffOperationsFromLongestCommonSubsequence(
          previousLines,
          currentLines,
          buildLongestCommonSubsequenceLengthMatrix(
            previousLines,
            currentLines,
          ),
        )
      : buildFallbackRawDiffOperations(previousLines, currentLines);

  return buildSideBySideRowsFromRawOperations(rawOperations);
};

// Diff summaries in the UI should use a semantic count, so this helper only
// counts rows where at least one side has a changed line.
export const countChangedDiffRows = (rows: SideBySideDiffRow[]): number => {
  return rows.reduce((changedRowCount, row) => {
    if (row.hasLeftChange || row.hasRightChange) {
      return changedRowCount + 1;
    }

    return changedRowCount;
  }, 0);
};
