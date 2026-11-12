/**
 * Port of cobol/programs/INVOICE.cbl: price one invoice line with discount and VAT.
 * One 21-character input record in, one 49-character output record out.
 */
import {
  add,
  div,
  formatDisplay,
  fromInt,
  fromScaled,
  mul,
  parseDisplay,
  pic,
  store,
  sub,
} from '../semantics/decimal.js';

export const PICS = {
  qty: pic(4, 0, false), // 9(4)
  price: pic(5, 2, false), // 9(5)V99
  discPct: pic(2, 1, false), // 9(2)V9
  amount: pic(7, 2, false), // 9(7)V99 (line, discount, net, VAT, total)
} as const;

export const RECORD_LENGTH = 21;

/** VAT rates by code, scaled by 1 to match WS-VAT-RATE PIC 9(2)V9. */
const VAT_RATES: Readonly<Record<string, bigint>> = { S: 175n, R: 50n, Z: 0n };

export function processRecord(record: string): string {
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

  // EVALUATE IN-VAT-CODE ... WHEN OTHER ... MOVE "VC" TO OUT-STATUS ... END-EVALUATE
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
