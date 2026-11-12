/**
 * Mutants of the INVOICE port (Requirement 4). Each port is a copy of
 * `processRecord` in ./invoice.ts with one change, marked `// MUTANT:`.
 */
import {
  add,
  div,
  formatDisplay,
  fromInt,
  fromScaled,
  mul,
  parseDisplay,
  store,
  sub,
} from '../semantics/decimal.js';
import { PICS, RECORD_LENGTH } from './invoice.js';
import type { Mutant } from './mutant.js';

/** VAT rates by code, scaled by 1 to match WS-VAT-RATE PIC 9(2)V9. */
const VAT_RATES: Readonly<Record<string, bigint>> = { S: 175n, R: 50n, Z: 0n };

function halfUpVat(record: string): string {
  if (record.length !== RECORD_LENGTH) {
    throw new RangeError(`INVOICE expects ${RECORD_LENGTH}-character records, got ${record.length}`);
  }
  const invId = record.slice(0, 6);
  const qty = parseDisplay(record.slice(6, 10), PICS.qty);
  const price = parseDisplay(record.slice(10, 17), PICS.price);
  const discPct = parseDisplay(record.slice(17, 20), PICS.discPct);
  const vatCode = record.slice(20, 21);
  const amount = (scaled: bigint) => fromScaled(scaled, 2);

  // COMPUTE WS-LINE = IN-QTY * IN-PRICE
  const line = store(mul(fromInt(qty), amount(price)), PICS.amount).scaled;
  // COMPUTE WS-DISC = WS-LINE * IN-DISC-PCT / 100   (truncated to the penny)
  const disc = store(div(mul(amount(line), fromScaled(discPct, 1)), fromInt(100n)), PICS.amount).scaled;
  // COMPUTE WS-NET = WS-LINE - WS-DISC
  const net = store(sub(amount(line), amount(disc)), PICS.amount).scaled;

  // EVALUATE IN-VAT-CODE ... WHEN OTHER MOVE "VC" TO OUT-STATUS
  const vatRate = VAT_RATES[vatCode];
  const status = vatRate === undefined ? 'VC' : 'OK';

  // COMPUTE WS-VAT ROUNDED MODE NEAREST-EVEN = WS-NET * WS-VAT-RATE / 100
  const vat = store(div(mul(amount(net), fromScaled(vatRate ?? 0n, 1)), fromInt(100n)), PICS.amount, {
    rounded: true, // MUTANT: MODE NEAREST-EVEN dropped
  }).scaled;
  // COMPUTE WS-TOTAL = WS-NET + WS-VAT
  const total = store(add(amount(net), amount(vat)), PICS.amount).scaled;

  return [
    invId,
    status,
    formatDisplay(line, PICS.amount),
    formatDisplay(disc, PICS.amount),
    formatDisplay(vat, PICS.amount),
    formatDisplay(total, PICS.amount),
  ].join(' ');
}

function roundDiscount(record: string): string {
  if (record.length !== RECORD_LENGTH) {
    throw new RangeError(`INVOICE expects ${RECORD_LENGTH}-character records, got ${record.length}`);
  }
  const invId = record.slice(0, 6);
  const qty = parseDisplay(record.slice(6, 10), PICS.qty);
  const price = parseDisplay(record.slice(10, 17), PICS.price);
  const discPct = parseDisplay(record.slice(17, 20), PICS.discPct);
  const vatCode = record.slice(20, 21);
  const amount = (scaled: bigint) => fromScaled(scaled, 2);

  // COMPUTE WS-LINE = IN-QTY * IN-PRICE
  const line = store(mul(fromInt(qty), amount(price)), PICS.amount).scaled;
  // COMPUTE WS-DISC = WS-LINE * IN-DISC-PCT / 100   (truncated to the penny)
  const disc = store(div(mul(amount(line), fromScaled(discPct, 1)), fromInt(100n)), PICS.amount, {
    rounded: true, // MUTANT: the discount is rounded instead of truncated
  }).scaled;
  // COMPUTE WS-NET = WS-LINE - WS-DISC
  const net = store(sub(amount(line), amount(disc)), PICS.amount).scaled;

  // EVALUATE IN-VAT-CODE ... WHEN OTHER MOVE "VC" TO OUT-STATUS
  const vatRate = VAT_RATES[vatCode];
  const status = vatRate === undefined ? 'VC' : 'OK';

  // COMPUTE WS-VAT ROUNDED MODE NEAREST-EVEN = WS-NET * WS-VAT-RATE / 100
  const vat = store(div(mul(amount(net), fromScaled(vatRate ?? 0n, 1)), fromInt(100n)), PICS.amount, {
    rounded: true,
    mode: 'nearest-even',
  }).scaled;
  // COMPUTE WS-TOTAL = WS-NET + WS-VAT
  const total = store(add(amount(net), amount(vat)), PICS.amount).scaled;

  return [
    invId,
    status,
    formatDisplay(line, PICS.amount),
    formatDisplay(disc, PICS.amount),
    formatDisplay(vat, PICS.amount),
    formatDisplay(total, PICS.amount),
  ].join(' ');
}

export const MUTANTS: readonly Mutant[] = [
  {
    id: 'half-up-vat',
    title: "Use normal rounding instead of banker's rounding for VAT",
    rule: 'COMPUTE WS-VAT ROUNDED MODE NEAREST-EVEN',
    explanation:
      'COBOL rounds VAT to the nearest even penny when it lands exactly on a half penny, so 0.125 becomes 0.12. ' +
      'Normal rounding always goes up on a half and gives 0.13, so the VAT and total are a penny out.',
    port: halfUpVat,
  },
  {
    id: 'round-discount',
    title: 'Round the discount instead of truncating it',
    rule: 'COMPUTE WS-DISC = WS-LINE * IN-DISC-PCT / 100',
    explanation:
      'The discount COMPUTE has no ROUNDED phrase, so COBOL drops fractions of a penny. ' +
      'Rounding gives the customer up to a penny more discount, which changes the discount, VAT and total.',
    port: roundDiscount,
  },
];
