import { describe, expect, it } from 'vitest';
import { pic } from './decimal.js';
import { compareRecords, decodeRecord, parseNumericPicture, parsePicture, recordLayout } from './layout.js';

describe('parsePicture', () => {
  it('reads alphanumeric fields', () => {
    expect(parsePicture('X(8)')).toEqual({ type: { kind: 'alphanumeric' }, length: 8 });
    expect(parsePicture('X')).toEqual({ type: { kind: 'alphanumeric' }, length: 1 });
  });

  it('reads unsigned numeric fields with implied decimals', () => {
    expect(parsePicture('9(2)V9(4)')).toEqual({ type: { kind: 'numeric', pic: pic(2, 4, false) }, length: 6 });
    expect(parsePicture('9(5)V99')).toEqual({ type: { kind: 'numeric', pic: pic(5, 2, false) }, length: 7 });
    expect(parsePicture('9(3)')).toEqual({ type: { kind: 'numeric', pic: pic(3, 0, false) }, length: 3 });
  });

  it('counts the separate sign in the width', () => {
    expect(parsePicture('S9(9)V99 SIGN LEADING SEPARATE')).toEqual({
      type: { kind: 'numeric', pic: pic(9, 2, true) },
      length: 12,
    });
  });

  it('rejects pictures it cannot decode', () => {
    expect(() => parsePicture('S9(5)V99')).toThrow(SyntaxError); // embedded sign
    expect(() => parsePicture('9(5)V99 SIGN LEADING SEPARATE')).toThrow(SyntaxError);
    expect(() => parsePicture('Z(5)9')).toThrow(SyntaxError);
    expect(() => parsePicture('9V9V9')).toThrow(SyntaxError);
    expect(() => parsePicture('X(2)9')).toThrow(SyntaxError);
  });
});

describe('parseNumericPicture', () => {
  it('reads the working-storage PICs of the sample programs', () => {
    expect(parseNumericPicture('9(2)V9(4)')).toEqual(pic(2, 4, false)); // INTCALC WS-RATE
    expect(parseNumericPicture('S9(7)V99')).toEqual(pic(7, 2, true)); // INTCALC WS-INTEREST
    expect(parseNumericPicture('S9(9)V99')).toEqual(pic(9, 2, true)); // INTCALC WS-NEW-BAL
    expect(parseNumericPicture('9(7)V99')).toEqual(pic(7, 2, false)); // INVOICE WS-LINE
    expect(parseNumericPicture('9(2)V9')).toEqual(pic(2, 1, false)); // INVOICE WS-VAT-RATE
    expect(parseNumericPicture('9(2)V99   COMP-3')).toEqual(pic(2, 2, false)); // PAYROLL WS-OT-HOURS
    expect(parseNumericPicture('9(5)V99 COMP-3')).toEqual(pic(5, 2, false)); // PAYROLL WS-GROSS
    expect(parseNumericPicture('S9(5)V99  COMP-3')).toEqual(pic(5, 2, true)); // PAYROLL WS-NET
  });
  it('reads record PICs with a separate sign the same way as parsePicture', () => {
    for (const p of ['S9(9)V99 SIGN LEADING SEPARATE', '9(3)', '9(5)V99', 'S9(5)V99 SIGN IS LEADING SEPARATE CHARACTER']) {
      const parsed = parsePicture(p).type;
      expect(parsed.kind).toBe('numeric');
      if (parsed.kind === 'numeric') expect(parseNumericPicture(p)).toEqual(parsed.pic);
    }
  });
  it('accepts the other spellings of packed and display usage', () => {
    expect(parseNumericPicture('s9(5)v99 usage is comp-3')).toEqual(pic(5, 2, true));
    expect(parseNumericPicture('9(5)V99 PACKED-DECIMAL')).toEqual(pic(5, 2, false));
    expect(parseNumericPicture('9(5)V99 COMPUTATIONAL-3')).toEqual(pic(5, 2, false));
    expect(parseNumericPicture('S9(5) USAGE DISPLAY')).toEqual(pic(5, 0, true));
  });
  it('rejects pictures that are not numeric or not supported', () => {
    expect(() => parseNumericPicture('X(8)')).toThrow(SyntaxError);
    expect(() => parseNumericPicture('X')).toThrow(SyntaxError);
    expect(() => parseNumericPicture('9(5)V99 SIGN LEADING SEPARATE')).toThrow(SyntaxError);
    expect(() => parseNumericPicture('S9(5)V99 SIGN LEADING SEPARATE COMP-3')).toThrow(SyntaxError);
    expect(() => parseNumericPicture('9(5) COMP')).toThrow(SyntaxError);
    expect(() => parseNumericPicture('9(5)V99 VALUE 0')).toThrow(SyntaxError);
    expect(() => parseNumericPicture('9V9V9')).toThrow(SyntaxError);
    expect(() => parseNumericPicture('Z(5)9')).toThrow(SyntaxError);
    expect(() => parseNumericPicture('S')).toThrow(SyntaxError);
    expect(() => parseNumericPicture('V')).toThrow(SyntaxError);
  });
});

const LAYOUT = recordLayout('REC', [
  { name: 'ID', picture: 'X(3)' },
  { name: 'FILLER', picture: 'X' },
  { name: 'AMT', picture: 'S9(3)V99 SIGN LEADING SEPARATE' },
  { name: 'QTY', picture: '9(2)' },
]);

describe('recordLayout', () => {
  it('places fields one after another', () => {
    expect(LAYOUT.length).toBe(12);
    expect(LAYOUT.fields.map((f) => [f.name, f.offset, f.length])).toEqual([
      ['ID', 0, 3],
      ['FILLER', 3, 1],
      ['AMT', 4, 6],
      ['QTY', 10, 2],
    ]);
  });
});

describe('decodeRecord', () => {
  it('shows numeric fields as decimals', () => {
    const decoded = decodeRecord(LAYOUT, 'AB  +0012507');
    expect(decoded.lengthMatches).toBe(true);
    expect(decoded.fields.map((f) => [f.name, f.raw, f.value, f.valid])).toEqual([
      ['ID', 'AB ', 'AB ', true],
      ['FILLER', ' ', ' ', true],
      ['AMT', '+00125', '+1.25', true],
      ['QTY', '07', '7', true],
    ]);
  });

  it('keeps the sign of a negative zero', () => {
    const amt = (record: string) => decodeRecord(LAYOUT, record).fields[2]!.value;
    expect(amt('ABC -0000000')).toBe('-0.00');
    expect(amt('ABC +0000000')).toBe('+0.00');
  });

  it('marks bad numeric text invalid and shows it raw', () => {
    const fields = decodeRecord(LAYOUT, 'ABC  00125AB').fields;
    expect(fields[2]).toMatchObject({ raw: ' 00125', value: ' 00125', valid: false });
    expect(fields[3]).toMatchObject({ raw: 'AB', value: 'AB', valid: false });
  });

  it('copes with short and long records without throwing', () => {
    const short = decodeRecord(LAYOUT, 'ABC +001');
    expect(short.lengthMatches).toBe(false);
    expect(short.fields[2]).toMatchObject({ raw: '+001', valid: false });
    expect(short.fields[3]).toMatchObject({ raw: '', valid: false });

    const long = decodeRecord(LAYOUT, 'ABC +0012507XYZ');
    expect(long.lengthMatches).toBe(false);
    expect(long.extra).toBe('XYZ');
    expect(long.fields.every((f) => f.valid)).toBe(true);
  });
});

describe('compareRecords', () => {
  it('flags only the fields that differ, including a sign-only difference', () => {
    const diff = compareRecords(LAYOUT, 'ABC -0000007', 'ABC +0000007');
    expect(diff.filter((d) => d.differs).map((d) => [d.name, d.cobol.value, d.port.value])).toEqual([
      ['AMT', '-0.00', '+0.00'],
    ]);
  });
});
