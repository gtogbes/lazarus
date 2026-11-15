import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pic } from '../../../../src/semantics/decimal';
import { parsePicture } from '../../../../src/semantics/layout';
import { placeValue } from './digitBoxes';
import { firstDifference } from './fieldDifference';

const field = (picture: string) => ({ type: parsePicture(picture).type });
const AMOUNT = field('S9(5)V99 SIGN LEADING SEPARATE');

describe('firstDifference', () => {
  it('returns null when the raw text is equal', () => {
    expect(firstDifference(AMOUNT, '+0012345', '+0012345')).toBeNull();
  });

  it('names a sign difference, including negative zero', () => {
    expect(firstDifference(AMOUNT, '-0000000', '+0000000')).toEqual({ kind: 'sign' });
  });

  it('names a difference in the leftmost integer digit as high-order (truncation)', () => {
    // COBOL dropped the leading 1 of 100123.45; the port kept a wider value's digit.
    expect(firstDifference(AMOUNT, '+0012345', '+1012345')).toEqual({ kind: 'high-order' });
  });

  it('names other integer digits as low-order with their place value', () => {
    expect(firstDifference(AMOUNT, '+0012345', '+0022345')).toEqual({ kind: 'low-order', place: '100' });
    expect(firstDifference(AMOUNT, '+0012345', '+0012445')).toEqual({ kind: 'low-order', place: '1' });
  });

  it('names decimal digits as decimal-places with their place value', () => {
    expect(firstDifference(AMOUNT, '+0012345', '+0012346')).toEqual({ kind: 'decimal-places', place: '0.01' });
    expect(firstDifference(field('V99'), '10', '20')).toEqual({ kind: 'decimal-places', place: '0.1' });
  });

  it('uses the first differing position when several differ', () => {
    expect(firstDifference(AMOUNT, '+0012345', '-9012399')).toEqual({ kind: 'sign' });
  });

  it('gives text for alphanumeric fields and for numeric text that does not fit the PIC', () => {
    expect(firstDifference(field('X(4)'), 'ABCD', 'ABCE')).toEqual({ kind: 'text' });
    expect(firstDifference(AMOUNT, '+0012345', '+00123X5')).toEqual({ kind: 'text' });
    expect(firstDifference(AMOUNT, '+0012345', '+001234')).toEqual({ kind: 'text' });
  });
});

/**
 * Property 16: The first difference is classified by its position.
 * **Validates: Requirements 9.5, 9.7**
 */
describe('Property 16: the first difference is classified by its position', () => {
  const picArb = fc
    .record({ intDigits: fc.integer({ min: 0, max: 18 }), scale: fc.integer({ min: 0, max: 18 }), signed: fc.boolean() })
    .filter((p) => p.intDigits + p.scale > 0)
    .map((p) => pic(p.intDigits, p.scale, p.signed));
  const digits = (n: number) =>
    fc.array(fc.constantFrom(...'0123456789'), { minLength: n, maxLength: n }).map((a) => a.join(''));
  // A valid value, a position in it, and a different character that keeps it valid for the PIC.
  const caseArb = picArb.chain((p) =>
    fc
      .tuple(
        fc.constantFrom('+', '-'),
        digits(p.intDigits + p.scale),
        fc.integer({ min: 0, max: p.intDigits + p.scale + (p.signed ? 1 : 0) - 1 }),
        fc.integer({ min: 1, max: 9 }),
      )
      .map(([sign, ds, i, shift]) => {
        const raw = (p.signed ? sign : '') + ds;
        const old = raw[i]!;
        const next =
          p.signed && i === 0 ? (old === '+' ? '-' : '+') : String((Number(old) + shift) % 10);
        return { p, raw, i, changed: raw.slice(0, i) + next + raw.slice(i + 1) };
      }),
  );

  it('gives the class of the changed position', () => {
    fc.assert(
      fc.property(caseArb, ({ p, raw, i, changed }) => {
        const f = { type: { kind: 'numeric' as const, pic: p } };
        const digit = i - (p.signed ? 1 : 0); // index among the digits; -1 is the sign
        const expected =
          digit < 0
            ? { kind: 'sign' }
            : digit === 0 && p.intDigits > 0
              ? { kind: 'high-order' }
              : digit < p.intDigits
                ? { kind: 'low-order', place: placeValue(p.intDigits - 1 - digit) }
                : { kind: 'decimal-places', place: placeValue(-(digit - p.intDigits + 1)) };
        expect(firstDifference(f, raw, changed)).toEqual(expected);
        expect(firstDifference(f, changed, raw)).toEqual(expected);
        expect(firstDifference(f, raw, raw)).toBeNull();
      }),
    );
  });
});
