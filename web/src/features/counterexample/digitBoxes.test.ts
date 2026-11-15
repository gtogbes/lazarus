import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pic } from '../../../../src/semantics/decimal';
import { parsePicture } from '../../../../src/semantics/layout';
import { digitBoxes, placeValue } from './digitBoxes';

function picOf(picture: string) {
  const { type } = parsePicture(picture);
  if (type.kind !== 'numeric') throw new Error('not numeric');
  return type.pic;
}

describe('digitBoxes', () => {
  it('draws 9(5)V99 as five integer boxes, a point, then two decimal boxes', () => {
    const result = digitBoxes(picOf('9(5)V99'), '0012345');
    expect(result).toEqual({
      valid: true,
      boxes: [
        { kind: 'int', char: '0', place: '10000' },
        { kind: 'int', char: '0', place: '1000' },
        { kind: 'int', char: '1', place: '100' },
        { kind: 'int', char: '2', place: '10' },
        { kind: 'int', char: '3', place: '1' },
        { kind: 'point', char: '.' },
        { kind: 'frac', char: '4', place: '0.1' },
        { kind: 'frac', char: '5', place: '0.01' },
      ],
    });
  });

  it('puts a sign box first for a SIGN LEADING SEPARATE field', () => {
    const result = digitBoxes(picOf('S9(3)V9 SIGN LEADING SEPARATE'), '-1234');
    expect(result.valid).toBe(true);
    expect(result.boxes.map((b) => b.kind)).toEqual(['sign', 'int', 'int', 'int', 'point', 'frac']);
    expect(result.boxes[0]).toEqual({ kind: 'sign', char: '-' });
  });

  it('draws no point for an integer PIC and no integer boxes for V99', () => {
    expect(digitBoxes(pic(3, 0, false), '042').boxes.map((b) => b.kind)).toEqual(['int', 'int', 'int']);
    expect(digitBoxes(pic(0, 2, false), '07').boxes.map((b) => b.kind)).toEqual(['point', 'frac', 'frac']);
  });

  it.each([
    ['wrong width', pic(3, 2, false), '1234'],
    ['not digits', pic(3, 2, false), '12A45'],
    ['missing sign', pic(3, 2, true), '012345'],
    ['space for sign', pic(3, 2, true), ' 12345'],
  ])('marks raw text that does not fit the PIC as invalid (%s)', (_, field, raw) => {
    const result = digitBoxes(field, raw);
    expect(result.valid).toBe(false);
    expect(result.boxes).toEqual(Array.from(raw, (char) => ({ kind: 'raw', char })));
  });
});

/**
 * Property 15: Digit boxes follow the PIC.
 * **Validates: Requirements 9.6, 9.8**
 */
describe('Property 15: digit boxes follow the PIC', () => {
  const picArb = fc
    .record({ intDigits: fc.integer({ min: 0, max: 18 }), scale: fc.integer({ min: 0, max: 18 }), signed: fc.boolean() })
    .filter((p) => p.intDigits + p.scale > 0)
    .map((p) => pic(p.intDigits, p.scale, p.signed));
  const digits = (n: number) => fc.array(fc.constantFrom(...'0123456789'), { minLength: n, maxLength: n }).map((a) => a.join(''));
  const validArb = picArb.chain((field) =>
    fc
      .tuple(fc.constantFrom('+', '-'), digits(field.intDigits + field.scale))
      .map(([sign, ds]) => ({ field, raw: (field.signed ? sign : '') + ds })),
  );

  it('gives sign, integer, point and decimal boxes from the PIC, and their characters rebuild the raw text', () => {
    fc.assert(
      fc.property(validArb, ({ field, raw }) => {
        const { valid, boxes } = digitBoxes(field, raw);
        expect(valid).toBe(true);
        const count = (kind: string) => boxes.filter((b) => b.kind === kind).length;
        expect(count('sign')).toBe(field.signed ? 1 : 0);
        expect(count('int')).toBe(field.intDigits);
        expect(count('point')).toBe(field.scale > 0 ? 1 : 0);
        expect(count('frac')).toBe(field.scale);
        expect(count('raw')).toBe(0);
        // Order: sign, ints, point, fracs.
        const expectedKinds = [
          ...(field.signed ? ['sign'] : []),
          ...Array<string>(field.intDigits).fill('int'),
          ...(field.scale > 0 ? ['point'] : []),
          ...Array<string>(field.scale).fill('frac'),
        ];
        expect(boxes.map((b) => b.kind)).toEqual(expectedKinds);
        expect(boxes.filter((b) => b.kind !== 'point').map((b) => b.char).join('')).toBe(raw);
      }),
    );
  });

  // Invalid text built by breaking a valid value: wrong width, a non-digit, or a bad sign.
  const invalidArb = validArb.chain(({ field, raw }) => {
    const width = raw.length;
    const wrongWidth = fc
      .oneof(fc.constant(raw.slice(0, -1)), fc.constantFrom('0', '+', ' ').map((c) => raw + c))
      .map((r) => ({ field, raw: r }));
    const firstDigit = field.signed ? 1 : 0;
    const nonDigit = fc
      .tuple(fc.integer({ min: firstDigit, max: width - 1 }), fc.constantFrom(' ', 'A', '.', '+', '-', '}'))
      .map(([i, c]) => ({ field, raw: raw.slice(0, i) + c + raw.slice(i + 1) }));
    const badSign = fc.constantFrom(' ', '0', '5', 'A').map((c) => ({ field, raw: c + raw.slice(1) }));
    return field.signed ? fc.oneof(wrongWidth, nonDigit, badSign) : fc.oneof(wrongWidth, nonDigit);
  });

  it('marks text that does not fit the PIC as invalid and shows its raw characters', () => {
    fc.assert(
      fc.property(invalidArb, ({ field, raw }) => {
        const result = digitBoxes(field, raw);
        expect(result.valid).toBe(false);
        expect(result.boxes).toEqual(Array.from(raw, (char) => ({ kind: 'raw', char })));
      }),
    );
  });
});

describe('placeValue', () => {
  it('writes powers of ten as decimal text', () => {
    expect([placeValue(0), placeValue(3), placeValue(-1), placeValue(-3)]).toEqual(['1', '1000', '0.1', '0.001']);
  });
});
