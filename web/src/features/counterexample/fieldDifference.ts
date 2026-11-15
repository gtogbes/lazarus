/**
 * Requirements 9.5 and 9.7: name the first place a field differs.
 *
 * For a numeric field where both sides fit the PIC, the first differing
 * character is classified by its position:
 * - the separate sign gives `sign`;
 * - the leftmost integer digit gives `high-order`, the digit COBOL drops
 *   first when a value is too large for the PIC (no ON SIZE ERROR);
 * - any other integer digit gives `low-order` with its place value ("10");
 * - a decimal digit gives `decimal-places` with its place value ("0.01").
 * Alphanumeric fields, and numeric fields where either side does not fit the
 * PIC, give `text`. Equal fields give `null`.
 *
 * Pure: no React, no DOM.
 */
import type { Field } from '../../../../src/semantics/layout';
import { digitBoxes, type DigitBox } from './digitBoxes';

export type FirstDifference =
  | { readonly kind: 'sign' | 'high-order' | 'text' }
  | { readonly kind: 'low-order' | 'decimal-places'; readonly place: string };

export function firstDifference(
  field: Pick<Field, 'type'>,
  cobolRaw: string,
  portRaw: string,
): FirstDifference | null {
  if (cobolRaw === portRaw) return null;
  if (field.type.kind !== 'numeric') return { kind: 'text' };
  const cobol = digitBoxes(field.type.pic, cobolRaw);
  const port = digitBoxes(field.type.pic, portRaw);
  if (!cobol.valid || !port.valid) return { kind: 'text' };
  // Both fit the PIC, so the box lists have the same shape.
  const index = cobol.boxes.findIndex((box, i) => box.char !== port.boxes[i]!.char);
  const box: DigitBox = cobol.boxes[index]!;
  switch (box.kind) {
    case 'sign':
      return { kind: 'sign' };
    case 'int':
      return cobol.boxes.findIndex((b) => b.kind === 'int') === index
        ? { kind: 'high-order' }
        : { kind: 'low-order', place: box.place! };
    case 'frac':
      return { kind: 'decimal-places', place: box.place! };
    default:
      // 'point' never differs (both sides draw '.'), and 'raw' only appears when invalid.
      return { kind: 'text' };
  }
}
