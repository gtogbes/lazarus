/**
 * Mutants of the PAYROLL port (Requirement 4). Each port is a copy of
 * `processRecord` in ./payroll.ts with one change, marked `// MUTANT:`.
 */
import {
  add,
  formatDisplay,
  fromInt,
  fromScaled,
  mul,
  parseDisplay,
  store,
  sub,
  type Rational,
} from '../semantics/decimal.js';
import type { Mutant } from './mutant.js';
import { PICS, RECORD_LENGTH } from './payroll.js';

const FORTY_HOURS = 4000n; // 40.00 scaled by 2
const money = (scaled: bigint): Rational => fromScaled(scaled, 2);
const nearestEven = { rounded: true, mode: 'nearest-even' } as const;

function halfUpTax(record: string): string {
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
    tax = store(mul(sub(money(gross), fromInt(1000n)), fromScaled(25n, 2)), PICS.tax, { rounded: true }).scaled; // MUTANT: MODE NEAREST-EVEN dropped
  } else {
    const exact = add(fromInt(750n), mul(sub(money(gross), fromInt(4000n)), fromScaled(45n, 2)));
    tax = store(exact, PICS.tax, { rounded: true }).scaled; // MUTANT: MODE NEAREST-EVEN dropped
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

function ignoreSizeError(record: string): string {
  if (record.length !== RECORD_LENGTH) {
    throw new RangeError(`PAYROLL expects ${RECORD_LENGTH}-character records, got ${record.length}`);
  }
  const empId = record.slice(0, 6);
  const hours = parseDisplay(record.slice(6, 10), PICS.hours);
  const rate = parseDisplay(record.slice(10, 15), PICS.rate);
  const adjust = parseDisplay(record.slice(15, 23), PICS.adjust);

  // MOVE "OK" TO OUT-STATUS, MOVE ZERO TO WS-GROSS WS-TAX
  const status = 'OK';
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
    gross = result.scaled; // MUTANT: size error ignored, the truncated gross is kept and status stays OK
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

function strictBandEdge(record: string): string {
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
  if (gross < 100000n) { // MUTANT: <= became <, so exactly 1,000.00 falls into the 25% band
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

export const MUTANTS: readonly Mutant[] = [
  {
    id: 'half-up-tax',
    title: "Use normal rounding instead of banker's rounding",
    rule: 'COMPUTE WS-TAX ROUNDED MODE NEAREST-EVEN',
    explanation:
      'COBOL rounds the tax to the nearest even penny when it lands exactly on a half penny, so 0.005 becomes 0.00. ' +
      'Normal rounding always goes up on a half and gives 0.01, so the tax and net pay are a penny out.',
    port: halfUpTax,
  },
  {
    id: 'ignore-size-error',
    title: 'Ignore ON SIZE ERROR and keep the overflowed gross',
    rule: 'ON SIZE ERROR MOVE "SE" TO OUT-STATUS',
    explanation:
      'When gross pay is too big for PIC 9(5)V99, ON SIZE ERROR leaves WS-GROSS unchanged (zero) and marks the record "SE". ' +
      'Without it the port keeps the gross with its high-order digits silently cut off and reports status OK.',
    port: ignoreSizeError,
  },
  {
    id: 'strict-band-edge',
    title: 'Use "less than" instead of "up to" on the 1,000.00 tax band',
    rule: 'WHEN WS-GROSS <= 1000',
    explanation:
      'COBOL taxes gross pay of up to and including 1,000.00 at nil. With "less than", exactly 1,000.00 moves into the 25% band.',
    equivalent:
      'At exactly 1,000.00 the 25% band charges (1,000.00 - 1,000) x 0.25 = 0.00, the same nil tax. ' +
      'The two bands meet at the same value, so no gross pay can tell the mutant from the real port.',
    port: strictBandEdge,
  },
];
