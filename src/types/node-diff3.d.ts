//
// Ambient module declaration for node-diff3. The package ships types via the
// "exports" map which moduleResolution: "node" cannot resolve. This file
// re-exports the subset of the API that we use so the rest of the codebase
// can import from "node-diff3" without changing the project-wide tsconfig.
//
declare module 'node-diff3' {
  export interface MergeRegion<T> {
    ok?: T[];
    conflict?: {
      a: T[];
      aIndex: number;
      b: T[];
      bIndex: number;
      o: T[];
      oIndex: number;
    };
  }

  export interface IMergeOptions {
    excludeFalseConflicts?: boolean;
    stringSeparator?: string | RegExp;
  }

  export function diff3Merge<T>(
    a: string | T[],
    o: string | T[],
    b: string | T[],
    options?: IMergeOptions,
  ): MergeRegion<T>[];
}
