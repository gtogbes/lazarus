/**
 * Exact COBOL numeric semantics for ports.
 *
 * Values are exact rationals while an expression is evaluated (as in a COMPUTE),
 * then stored into a PIC field with COBOL's rules: optional ROUNDED (half away
 * from zero) and silent loss of high-order digits when the field is too small.
 */

export interface Pic {
  /** Digits before the implied decimal point (the 9s before V). */
  readonly intDigits: number;
  /** Digits after the implied decimal point (the 9s after V). */
  readonly scale: number;
  /** True for PIC S..., false for unsigned fields. */
  readonly signed: boolean;
}

/** An exact rational number. `den` is always positive. */
export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

export function pic(intDigits: number, scale: number, signed: boolean): Pic {
  return { intDigits, scale, signed };
}

export function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

const abs = (v: bigint): bigint => (v < 0n ? -v : v);

/** A value with an implied decimal point, e.g. (12345n, 2) is 123.45. */
export function fromScaled(value: bigint, scale: number): Rational {
  return { num: value, den: pow10(scale) };
}

export function fromInt(value: bigint): Rational {
  return { num: value, den: 1n };
}

export function add(a: Rational, b: Rational): Rational {
  return { num: a.num * b.den + b.num * a.den, den: a.den * b.den };
}

export function sub(a: Rational, b: Rational): Rational {
  return add(a, { num: -b.num, den: b.den });
}

export function mul(a: Rational, b: Rational): Rational {
  return { num: a.num * b.num, den: a.den * b.den };
}

export function div(a: Rational, b: Rational): Rational {
  if (b.num === 0n) throw new RangeError('Division by zero');
  const sign = b.num < 0n ? -1n : 1n;
  return { num: a.num * b.den * sign, den: a.den * abs(b.num) };
}

export type RoundingMode = 'nearest-away-from-zero' | 'nearest-even';

export interface StoreOptions {
  /** COBOL ROUNDED phrase. Default truncates. */
  readonly rounded?: boolean;
  /** ROUNDED MODE. COBOL's default is nearest-away-from-zero. */
  readonly mode?: RoundingMode;
}

/**
 * The contents of a numeric field. `negative` is kept separately because COBOL
 * fields can hold a negative zero, which bigint cannot represent.
 */
export interface Stored {
  /** Scaled integer value, e.g. 12345n in a V99 field is 123.45. */
  readonly scaled: bigint;
  /** Sign held by the field. Can be true when `scaled` is 0n. */
  readonly negative: boolean;
  /**
   * True when high-order digits were lost. A COMPUTE with ON SIZE ERROR must
   * then leave its receiving field unchanged instead of using `scaled`.
   */
  readonly sizeError: boolean;
}

/**
 * Store a rational into a PIC field. Mirrors a COBOL receiving item with no
 * ON SIZE ERROR phrase.
 *
 * GnuCOBOL decides the sign after scaling and rounding but before dropping
 * high-order digits. So -49999999.999 ROUNDED into S9(7)V99 becomes -0.00
 * (found by the INTCALC equivalence test), while -0.0025 ROUNDED becomes +0.00.
 */
export function store(value: Rational, target: Pic, options: StoreOptions = {}): Stored {
  const scaledNum = value.num * pow10(target.scale);
  let q = scaledNum / value.den; // bigint division truncates toward zero
  if (options.rounded) {
    const twiceRem = abs(scaledNum % value.den) * 2n;
    const half = twiceRem === value.den;
    const awayFromZero =
      twiceRem > value.den ||
      (half && (options.mode !== 'nearest-even' || abs(q) % 2n === 1n));
    if (awayFromZero) q += scaledNum < 0n ? -1n : 1n;
  }
  const capacity = pow10(target.intDigits + target.scale);
  const magnitude = abs(q) % capacity;
  const negative = target.signed && q < 0n;
  return { scaled: negative ? -magnitude : magnitude, negative, sizeError: abs(q) >= capacity };
}

function digits(value: bigint, field: Pic): string {
  return abs(value).toString().padStart(field.intDigits + field.scale, '0');
}

/** Parse a DISPLAY field. Signed fields use SIGN LEADING SEPARATE. */
export function parseDisplay(text: string, field: Pic): bigint {
  const width = field.intDigits + field.scale + (field.signed ? 1 : 0);
  if (text.length !== width) {
    throw new RangeError(`Expected ${width} characters, got ${text.length}: "${text}"`);
  }
  const body = field.signed ? text.slice(1) : text;
  if (!/^\d+$/.test(body)) throw new RangeError(`Not numeric: "${text}"`);
  const magnitude = BigInt(body);
  if (!field.signed) return magnitude;
  const sign = text[0];
  if (sign === '+') return magnitude;
  if (sign === '-') return -magnitude;
  throw new RangeError(`Expected leading sign, got "${text}"`);
}

/** Format a DISPLAY field. Signed fields use SIGN LEADING SEPARATE. */
export function formatDisplay(value: bigint | Stored, field: Pic): string {
  const { scaled, negative } = typeof value === 'bigint' ? { scaled: value, negative: value < 0n } : value;
  if (!field.signed) return digits(scaled, field);
  return (negative ? '-' : '+') + digits(scaled, field);
}
