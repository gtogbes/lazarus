/**
 * Fixed-width record layouts, read from a COBOL record description, and a
 * decoder that turns one record into named fields for the counterexample card
 * (Requirement 5).
 *
 * Only the DISPLAY usages the sample programs put in their records are
 * supported: X(n), 9(n)V9(n), and S9(n)V9(n) SIGN LEADING SEPARATE.
 */
import { pic, type Pic } from './decimal.js';

/** One elementary item as written in the COBOL source. */
export interface FieldSpec {
  /** COBOL data name, e.g. `IN-BALANCE`, or `FILLER`. */
  readonly name: string;
  /** PIC clause as written, plus `SIGN LEADING SEPARATE` where the source has it. */
  readonly picture: string;
}

export type FieldType =
  | { readonly kind: 'alphanumeric' }
  | { readonly kind: 'numeric'; readonly pic: Pic };

export interface Field extends FieldSpec {
  /** 0-based character offset within the record. */
  readonly offset: number;
  /** Width in characters, including a separate sign. */
  readonly length: number;
  readonly type: FieldType;
}

export interface RecordLayout {
  readonly name: string;
  readonly length: number;
  /** Every item in source order, FILLER included, so the fields tile the record. */
  readonly fields: readonly Field[];
}

export interface ProgramLayout {
  readonly input: RecordLayout;
  readonly output: RecordLayout;
}

const SIGN_SEPARATE = /\s+SIGN\s+(?:IS\s+)?LEADING\s+SEPARATE(?:\s+CHARACTER)?$/;

/** Expand `9(3)V99` style repeats into a count of each symbol. */
function countSymbols(body: string, picture: string): { x: number; nines: number; scale: number } {
  let x = 0;
  let nines = 0;
  let scale = 0;
  let afterV = false;
  const token = /([X9V])(?:\((\d+)\))?/gy;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = token.exec(body)) !== null) {
    consumed = token.lastIndex;
    const [, symbol, repeat] = match;
    const count = repeat === undefined ? 1 : Number(repeat);
    if (symbol === 'V') {
      if (afterV || repeat !== undefined) throw new SyntaxError(`Bad V in PIC "${picture}"`);
      afterV = true;
    } else if (symbol === 'X') {
      x += count;
    } else if (afterV) {
      scale += count;
    } else {
      nines += count;
    }
  }
  if (consumed !== body.length || body.length === 0) {
    throw new SyntaxError(`Unsupported PIC "${picture}"`);
  }
  return { x, nines, scale };
}

/** Read a PIC clause into a field type and its DISPLAY width. */
export function parsePicture(picture: string): { type: FieldType; length: number } {
  const text = picture.trim().toUpperCase();
  const signSeparate = SIGN_SEPARATE.test(text);
  let body = text.replace(SIGN_SEPARATE, '');
  const signed = body.startsWith('S');
  if (signed) body = body.slice(1);
  if (signed !== signSeparate) {
    throw new SyntaxError(`Signed fields must be SIGN LEADING SEPARATE: "${picture}"`);
  }
  const { x, nines, scale } = countSymbols(body, picture);
  if (x > 0) {
    if (nines > 0 || scale > 0 || signed) throw new SyntaxError(`Mixed PIC "${picture}"`);
    return { type: { kind: 'alphanumeric' }, length: x };
  }
  return {
    type: { kind: 'numeric', pic: pic(nines, scale, signed) },
    length: nines + scale + (signed ? 1 : 0),
  };
}

/** Lay fields out one after another, as COBOL does for a group item. */
export function recordLayout(name: string, specs: readonly FieldSpec[]): RecordLayout {
  let offset = 0;
  const fields = specs.map((spec): Field => {
    const { type, length } = parsePicture(spec.picture);
    const field = { ...spec, offset, length, type };
    offset += length;
    return field;
  });
  return { name, length: offset, fields };
}

export interface DecodedField {
  readonly name: string;
  readonly picture: string;
  readonly offset: number;
  readonly length: number;
  /** The characters at this field's position (shorter if the record was short). */
  readonly raw: string;
  /**
   * Value for display. Numeric fields become decimals with the sign kept, so
   * a negative zero shows as `-0.00`. Alphanumeric fields are shown as is.
   * Equal to `raw` when the field is not valid.
   */
  readonly value: string;
  /** False when the text does not fit the PIC (wrong width, not numeric, no sign). */
  readonly valid: boolean;
}

export interface DecodedRecord {
  readonly fields: readonly DecodedField[];
  /** False when the record length differs from the layout. */
  readonly lengthMatches: boolean;
  /** Characters past the end of the layout, if any. */
  readonly extra: string;
}

function numericValue(raw: string, field: Pic): string | undefined {
  const width = field.intDigits + field.scale + (field.signed ? 1 : 0);
  if (raw.length !== width) return undefined;
  const sign = field.signed ? raw[0] : '';
  if (field.signed && sign !== '+' && sign !== '-') return undefined;
  const digits = field.signed ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return undefined;
  const intPart = digits.slice(0, field.intDigits).replace(/^0+(?=\d)/, '') || '0';
  const fraction = digits.slice(field.intDigits);
  return sign + intPart + (field.scale > 0 ? `.${fraction}` : '');
}

/**
 * Split a record into its fields. Never throws on bad data: a divergent port
 * can write anything, and the UI must still show it.
 */
export function decodeRecord(layout: RecordLayout, record: string): DecodedRecord {
  const fields = layout.fields.map((field): DecodedField => {
    const raw = record.slice(field.offset, field.offset + field.length);
    const value =
      raw.length !== field.length
        ? undefined
        : field.type.kind === 'alphanumeric'
          ? raw
          : numericValue(raw, field.type.pic);
    return {
      name: field.name,
      picture: field.picture,
      offset: field.offset,
      length: field.length,
      raw,
      value: value ?? raw,
      valid: value !== undefined,
    };
  });
  return {
    fields,
    lengthMatches: record.length === layout.length,
    extra: record.slice(layout.length),
  };
}

export interface FieldDifference {
  readonly name: string;
  readonly picture: string;
  readonly cobol: DecodedField;
  readonly port: DecodedField;
  readonly differs: boolean;
}

/**
 * Decode the COBOL and port versions of one output record side by side.
 * `differs` compares the raw text, so `-0.00` and `+0.00` differ.
 */
export function compareRecords(layout: RecordLayout, cobol: string, port: string): FieldDifference[] {
  const left = decodeRecord(layout, cobol).fields;
  const right = decodeRecord(layout, port).fields;
  return layout.fields.map((field, i) => {
    const c = left[i]!;
    const p = right[i]!;
    return { name: field.name, picture: field.picture, cobol: c, port: p, differs: c.raw !== p.raw };
  });
}
