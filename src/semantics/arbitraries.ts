import fc from 'fast-check';
import { formatDisplay, pow10, type Pic } from './decimal.js';

/**
 * Scaled integer values that fit a PIC field, biased toward boundaries:
 * zero, +/-1 in the last digit, the maximum, and half-way rounding cases.
 */
export function picValue(field: Pic): fc.Arbitrary<bigint> {
  const max = pow10(field.intDigits + field.scale) - 1n;
  const min = field.signed ? -max : 0n;
  const boundaries = [0n, 1n, max, max - 1n, 5n, 50n].filter((v) => v <= max);
  const signedBoundaries = field.signed ? [...boundaries, ...boundaries.map((v) => -v)] : boundaries;
  return fc.oneof(
    { arbitrary: fc.constantFrom(...signedBoundaries), weight: 1 },
    { arbitrary: fc.bigInt({ min, max }), weight: 4 },
  );
}

/** DISPLAY text for a PIC field (SIGN LEADING SEPARATE when signed). */
export function picDisplay(field: Pic): fc.Arbitrary<string> {
  return picValue(field).map((v) => formatDisplay(v, field));
}
