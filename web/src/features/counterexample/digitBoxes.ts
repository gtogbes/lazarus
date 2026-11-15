/**
 * Requirements 9.6 and 9.8: the data behind the Digit_Inspector.
 *
 * `digitBoxes` draws one DISPLAY field as boxes from its PIC: a sign box for a
 * separate leading sign, one box per integer digit, a decimal point mark when
 * the scale is above 0, then one box per decimal digit. `9(5)V99` gives five
 * integer boxes, a point and two decimal boxes; `S9(5)V99` adds the sign box
 * in front. Each digit box carries its place value ("100", "0.01") so the
 * inspector can say which digit differs.
 *
 * Text that does not fit the PIC (wrong width, no sign, not digits) gives
 * `valid: false` and one `raw` box per character, so the UI can still show
 * what the port wrote.
 *
 * Pure: no React, no DOM.
 */
import type { Pic } from '../../../../src/semantics/decimal';

export type DigitBoxKind = 'sign' | 'int' | 'point' | 'frac' | 'raw';
export interface DigitBox {
  readonly kind: DigitBoxKind;
  /** The character in the box ('.' for the point mark, which is not in the raw text). */
  readonly char: string;
  /** Place value of a digit box, e.g. "1000", "1", "0.01". Absent for sign, point and raw. */
  readonly place?: string;
}
export type DigitBoxes =
  | { readonly valid: true; readonly boxes: readonly DigitBox[] }
  | { readonly valid: false; readonly boxes: readonly DigitBox[] };

/** Place value 10^k as decimal text: k = 2 gives "100", k = -2 gives "0.01". */
export function placeValue(k: number): string {
  return k >= 0 ? `1${'0'.repeat(k)}` : `0.${'0'.repeat(-k - 1)}1`;
}

/** The DISPLAY width of a PIC, including a separate sign. */
export function displayWidth(field: Pic): number {
  return field.intDigits + field.scale + (field.signed ? 1 : 0);
}

/** True when `raw` is a valid DISPLAY value for the PIC (same check as `decodeRecord`). */
export function fitsPicture(field: Pic, raw: string): boolean {
  if (raw.length !== displayWidth(field)) return false;
  if (field.signed && raw[0] !== '+' && raw[0] !== '-') return false;
  return /^[0-9]*$/.test(field.signed ? raw.slice(1) : raw);
}

export function digitBoxes(field: Pic, raw: string): DigitBoxes {
  if (!fitsPicture(field, raw)) {
    return { valid: false, boxes: Array.from(raw, (char): DigitBox => ({ kind: 'raw', char })) };
  }
  const boxes: DigitBox[] = [];
  let at = 0;
  if (field.signed) boxes.push({ kind: 'sign', char: raw[at++]! });
  for (let i = 0; i < field.intDigits; i++) {
    boxes.push({ kind: 'int', char: raw[at++]!, place: placeValue(field.intDigits - 1 - i) });
  }
  if (field.scale > 0) boxes.push({ kind: 'point', char: '.' });
  for (let i = 0; i < field.scale; i++) {
    boxes.push({ kind: 'frac', char: raw[at++]!, place: placeValue(-(i + 1)) });
  }
  return { valid: true, boxes };
}
