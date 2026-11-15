import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { charDiff } from './charDiff';

describe('charDiff', () => {
  it('returns no segments for two empty records', () => {
    expect(charDiff('', '')).toEqual([]);
  });

  it('returns one same segment for equal records', () => {
    expect(charDiff('ABC 123', 'ABC 123')).toEqual([{ kind: 'same', from: 0, cobol: 'ABC 123', port: 'ABC 123' }]);
  });

  it('groups differing columns into changed runs by position', () => {
    expect(charDiff('+0001234', '+0001299')).toEqual([
      { kind: 'same', from: 0, cobol: '+00012', port: '+00012' },
      { kind: 'changed', from: 6, cobol: '34', port: '99' },
    ]);
    expect(charDiff('A1B2C', 'X1Y2C')).toEqual([
      { kind: 'changed', from: 0, cobol: 'A', port: 'X' },
      { kind: 'same', from: 1, cobol: '1', port: '1' },
      { kind: 'changed', from: 2, cobol: 'B', port: 'Y' },
      { kind: 'same', from: 3, cobol: '2C', port: '2C' },
    ]);
  });

  it('compares column by column, not by alignment, for a shifted field', () => {
    // An LCS diff would report one inserted space; positionally every column after 0 differs.
    expect(charDiff('1234', ' 123')).toEqual([{ kind: 'changed', from: 0, cobol: '1234', port: ' 123' }]);
  });

  it('puts the tail of the longer record in an extra segment', () => {
    expect(charDiff('ABCDE', 'ABX')).toEqual([
      { kind: 'same', from: 0, cobol: 'AB', port: 'AB' },
      { kind: 'changed', from: 2, cobol: 'C', port: 'X' },
      { kind: 'extra', from: 3, cobol: 'DE', port: '' },
    ]);
    expect(charDiff('AB', 'ABCD')).toEqual([
      { kind: 'same', from: 0, cobol: 'AB', port: 'AB' },
      { kind: 'extra', from: 2, cobol: '', port: 'CD' },
    ]);
  });

  it('handles one empty record as a single extra segment', () => {
    expect(charDiff('', 'XYZ')).toEqual([{ kind: 'extra', from: 0, cobol: '', port: 'XYZ' }]);
    expect(charDiff('XYZ', '')).toEqual([{ kind: 'extra', from: 0, cobol: 'XYZ', port: '' }]);
  });
});

// Feature: graphical-proof, Property 14: Character diff round trip
describe('Property 14: character diff round trip', () => {
  /** Validates: Requirements 9.1 */
  // A small alphabet makes equal columns common, so same and changed runs both occur.
  const record = fc.string({ unit: fc.constantFrom('0', '1', '9', ' ', '+', '-', 'A', 'é'), maxLength: 24 });
  // Pairs are either independent or one derived from the other by a few column edits and a length change.
  const pair = fc.oneof(
    fc.tuple(record, record),
    fc
      .tuple(record, fc.array(fc.tuple(fc.nat(), fc.constantFrom('0', '9', ' ', 'X')), { maxLength: 4 }), fc.integer({ min: -3, max: 3 }), record)
      .map(([a, edits, delta, tail]): [string, string] => {
        const chars = [...a];
        for (const [i, c] of edits) if (chars.length > 0) chars[i % chars.length] = c;
        const b = chars.join('');
        return [a, delta < 0 ? b.slice(0, Math.max(0, b.length + delta)) : b + tail.slice(0, delta)];
      }),
  );

  it('rebuilds both records, marks exactly the differing columns, and puts the tail in extra', () => {
    fc.assert(
      fc.property(pair, ([cobol, port]) => {
        const segments = charDiff(cobol, port);
        expect(segments.map((s) => s.cobol).join('')).toBe(cobol);
        expect(segments.map((s) => s.port).join('')).toBe(port);

        const common = Math.min(cobol.length, port.length);
        const expectedChanged: number[] = [];
        for (let i = 0; i < common; i++) if (cobol[i] !== port[i]) expectedChanged.push(i);
        const changed: number[] = [];
        let column = 0;
        for (const s of segments) {
          expect(s.from).toBe(column);
          if (s.kind === 'extra') continue;
          expect(s.cobol.length).toBe(s.port.length);
          expect(s.cobol.length).toBeGreaterThan(0);
          if (s.kind === 'changed') for (let k = 0; k < s.cobol.length; k++) changed.push(s.from + k);
          column += s.cobol.length;
        }
        expect(changed).toEqual(expectedChanged);

        const extras = segments.filter((s) => s.kind === 'extra');
        if (cobol.length === port.length) {
          expect(extras).toEqual([]);
        } else {
          expect(extras).toHaveLength(1);
          expect(segments.at(-1)).toEqual({ kind: 'extra', from: common, cobol: cobol.slice(common), port: port.slice(common) });
        }
      }),
      { numRuns: 500 },
    );
  });
});
