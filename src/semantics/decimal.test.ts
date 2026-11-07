import { describe, expect, it } from 'vitest';
import { div, formatDisplay, fromScaled, parseDisplay, pic, store } from './decimal.js';

const S7V2 = pic(7, 2, true);
const U2V4 = pic(2, 4, false);

const scaled = (...args: Parameters<typeof store>): bigint => store(...args).scaled;

describe('store', () => {
  it('truncates extra decimals by default', () => {
    expect(scaled(fromScaled(12349n, 3), S7V2)).toBe(1234n); // 12.349 -> 12.34
  });

  it('rounds half away from zero when ROUNDED', () => {
    expect(scaled(fromScaled(12345n, 3), S7V2, { rounded: true })).toBe(1235n);
    expect(scaled(fromScaled(-12345n, 3), S7V2, { rounded: true })).toBe(-1235n);
    expect(scaled(fromScaled(12344n, 3), S7V2, { rounded: true })).toBe(1234n);
  });

  it('drops high-order digits that do not fit', () => {
    expect(scaled(fromScaled(1025000n, 4), U2V4)).toBe(25000n); // 102.5 -> 02.5
    // -1234567890.12 keeps 7 integer digits: -4567890.12
    expect(scaled(fromScaled(-123456789012n, 2), S7V2)).toBe(-456789012n);
  });

  it('rounds half to even with ROUNDED MODE NEAREST-EVEN', () => {
    const even = { rounded: true, mode: 'nearest-even' } as const;
    expect(scaled(fromScaled(25n, 3), S7V2, even)).toBe(2n); // 0.025 -> 0.02
    expect(scaled(fromScaled(75n, 3), S7V2, even)).toBe(8n); // 0.075 -> 0.08
    expect(scaled(fromScaled(-75n, 3), S7V2, even)).toBe(-8n);
    expect(scaled(fromScaled(251n, 4), S7V2, even)).toBe(3n); // 0.0251 is not a tie
  });

  it('flags a size error when high-order digits are lost', () => {
    expect(store(fromScaled(99999999n, 2), pic(5, 2, false)).sizeError).toBe(true);
    expect(store(fromScaled(9999999n, 2), pic(5, 2, false)).sizeError).toBe(false);
    // Rounding can push a value over the limit.
    expect(store(fromScaled(9999999500n, 5), pic(5, 2, false), { rounded: true }).sizeError).toBe(true);
  });

  it('stores the magnitude in unsigned fields', () => {
    expect(store(fromScaled(-15000n, 4), U2V4)).toEqual({ scaled: 15000n, negative: false, sizeError: false });
  });

  it('keeps the sign when truncation leaves zero (negative zero)', () => {
    // Found by the INTCALC equivalence test after 3,974 generated cases.
    const v = store(fromScaled(-49999999999n, 3), S7V2, { rounded: true }); // -> -50000000.00
    expect(v).toEqual({ scaled: 0n, negative: true, sizeError: true });
    expect(formatDisplay(v, S7V2)).toBe('-000000000');
  });

  it('gives positive zero when rounding reaches zero', () => {
    const v = store(fromScaled(-25n, 4), S7V2, { rounded: true }); // -0.0025
    expect(formatDisplay(v, S7V2)).toBe('+000000000');
  });

  it('divides values that have implied decimals', () => {
    // Found by the INTCALC equivalence test: 0.10 / 4 must be 0.025, not 2.5.
    const q = div(fromScaled(10n, 2), fromScaled(4n, 0));
    expect(scaled(q, pic(1, 3, false))).toBe(25n);
  });

  it('rounds exact rationals, not floating point', () => {
    // 1/3 = 0.333... -> 0.33; 2/3 -> 0.67
    expect(scaled(div(fromScaled(1n, 0), fromScaled(3n, 0)), S7V2, { rounded: true })).toBe(33n);
    expect(scaled(div(fromScaled(2n, 0), fromScaled(3n, 0)), S7V2, { rounded: true })).toBe(67n);
  });
});

describe('DISPLAY fields', () => {
  it('round-trips sign leading separate', () => {
    expect(parseDisplay('-000000107', S7V2)).toBe(-107n);
    expect(formatDisplay(-107n, S7V2)).toBe('-000000107');
  });

  it('formats zero with a plus sign', () => {
    expect(formatDisplay(0n, S7V2)).toBe('+000000000');
  });

  it('rejects malformed input', () => {
    expect(() => parseDisplay('12', U2V4)).toThrow(RangeError);
    expect(() => parseDisplay('*000000107', S7V2)).toThrow(RangeError);
  });
});
