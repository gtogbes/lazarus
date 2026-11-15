/**
 * Requirement 9.1: the data behind the Autopsy diff.
 *
 * `charDiff` compares the COBOL and port output records column by column.
 * Records are fixed width, so a positional diff is the right one: an LCS diff
 * would "realign" a shifted field and hide the column where the port went
 * wrong. Runs of equal columns become `same` segments, runs of differing
 * columns become `changed` segments, and the tail of the longer record (if the
 * lengths differ) is one `extra` segment, with `''` on the shorter side.
 *
 * Pure: no React, no DOM, so the Autopsy and the tests share it.
 */
export type CharDiffKind = 'same' | 'changed' | 'extra';

export interface CharDiffSegment {
  readonly kind: CharDiffKind;
  /** 0-based column where the segment starts. */
  readonly from: number;
  /** The COBOL characters in this segment ('' for a port-only tail). */
  readonly cobol: string;
  /** The port characters in this segment ('' for a COBOL-only tail). */
  readonly port: string;
}

export function charDiff(cobol: string, port: string): CharDiffSegment[] {
  const segments: CharDiffSegment[] = [];
  const common = Math.min(cobol.length, port.length);
  let start = 0;
  while (start < common) {
    const same = cobol[start] === port[start];
    let end = start + 1;
    while (end < common && (cobol[end] === port[end]) === same) end++;
    segments.push({
      kind: same ? 'same' : 'changed',
      from: start,
      cobol: cobol.slice(start, end),
      port: port.slice(start, end),
    });
    start = end;
  }
  if (cobol.length !== port.length) {
    segments.push({ kind: 'extra', from: common, cobol: cobol.slice(common), port: port.slice(common) });
  }
  return segments;
}
