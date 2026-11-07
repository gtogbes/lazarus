/**
 * Port of cobol/programs/PAYROLL.cbl: weekly gross-to-net pay.
 * One 23-character input record in, one 34-character output record out.
 */
import {
  add,
  formatDisplay,
  fromInt,
  fromScaled,
  mul,
  parseDisplay,
  pic,
  store,
  sub,
  type Rational,
} from '../semantics/decimal.js';

export const PICS = {
  hours: pic(2, 2, false), // 9(2)V99
  rate: pic(3, 2, false), // 9(3)V99
  adjust: pic(5, 2, true), // S9(5)V99 SIGN LEADING SEPARATE
  otHours: pic(2, 2, false), // 9(2)V99 COMP-3
  gross: pic(5, 2, false), // 9(5)V99 COMP-3
  tax: pic(5, 2, false), // 9(5)V99 COMP-3
  net: pic(5, 2, true), // S9(5)V99 COMP-3
} as const;

export const RECORD_LENGTH = 23;

const FORTY_HOURS = 4000n; // 40.00 scaled by 2
const money = (scaled: bigint): Rational => fromScaled(scaled, 2);
const nearestEven = { rounded: true, mode: 'nearest-even' } as const;

export function processRecord(record: string): string {
  if (record.length !== RECORD_LENGTH) {
    throw new RangeError(`PAYROLL expects ${RECORD_LENGTH}-character records, got ${record.length}`);
  }
  const empId = record.slice(0, 6);
  const hours = parseDisplay(record.slice(6, 10), PICS.hours);
  const rate = parseDisplay(record.slice(10, 15), PICS.rate);
  const adjust = parseDisplay(record.slice(15, 23), PICS.adjust);

  // MOVE "OK" TO OUT-STATUS, MOVE ZERO TO WS-GROSS WS-TAX
  let status = 'OK';
  let gross = 0n;

  if (hours > FORTY_HOURS) {
    // COMPUTE WS-OT-HOURS = IN-HOURS - 40
    const otHours = store(sub(money(hours), fromInt(40n)), PICS.otHours).scaled;
    // COMPUTE WS-GROSS ROUNDED = 40 * IN-RATE + WS-OT-HOURS * IN-RATE * 1.5
    //     ON SIZE ERROR MOVE "SE" TO OUT-STATUS
    const exact = add(
      mul(fromInt(40n), money(rate)),
      mul(mul(money(otHours), money(rate)), fromScaled(15n, 1)),
    );
    const result = store(exact, PICS.gross, { rounded: true });
    if (result.sizeError) status = 'SE'; // WS-GROSS keeps its previous value (zero)
    else gross = result.scaled;
  } else {
    // COMPUTE WS-GROSS ROUNDED = IN-HOURS * IN-RATE
    gross = store(mul(money(hours), money(rate)), PICS.gross, { rounded: true }).scaled;
  }

  // EVALUATE TRUE ... tax bands, ROUNDED MODE NEAREST-EVEN
  let tax: bigint;
  if (gross <= 100000n) {
    tax = 0n;
  } else if (gross <= 400000n) {
    tax = store(mul(sub(money(gross), fromInt(1000n)), fromScaled(25n, 2)), PICS.tax, nearestEven).scaled;
  } else {
    const exact = add(fromInt(750n), mul(sub(money(gross), fromInt(4000n)), fromScaled(45n, 2)));
    tax = store(exact, PICS.tax, nearestEven).scaled;
  }

  // COMPUTE WS-NET = WS-GROSS - WS-TAX + IN-ADJUST
  const net = store(add(sub(money(gross), money(tax)), money(adjust)), PICS.net);

  return [
    empId,
    status,
    formatDisplay(gross, PICS.gross),
    formatDisplay(tax, PICS.tax),
    formatDisplay(net, PICS.net),
  ].join(' ');
}
