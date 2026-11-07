export type Comparison =
  | { readonly equal: true }
  | {
      readonly equal: false;
      /** 0-based index of the first differing record. */
      readonly line: number;
      /** 0-based column of the first differing character within that record. */
      readonly column: number;
      readonly expected: string | undefined;
      readonly actual: string | undefined;
    };

/** Compare COBOL output (expected) with port output (actual), record by record. */
export function compareOutputs(expected: readonly string[], actual: readonly string[]): Comparison {
  const lines = Math.max(expected.length, actual.length);
  for (let line = 0; line < lines; line++) {
    const e = expected[line];
    const a = actual[line];
    if (e === a) continue;
    let column = 0;
    if (e !== undefined && a !== undefined) {
      while (column < e.length && column < a.length && e[column] === a[column]) column++;
    }
    return { equal: false, line, column, expected: e, actual: a };
  }
  return { equal: true };
}
