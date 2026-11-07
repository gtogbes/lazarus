/**
 * Port of cobol/programs/INTCALC.cbl: accrue simple interest on loan accounts.
 * One 29-character input record in, one 42-character output record out.
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
} from '../semantics/decimal.js';

export const PICS = {
  balance: pic(9, 2, true), // S9(9)V99 SIGN LEADING SEPARATE
  rate: pic(2, 4, false), // 9(2)V9(4)
  days: pic(3, 0, false), // 9(3)
  interest: pic(7, 2, true), // S9(7)V99
  newBalance: pic(9, 2, true), // S9(9)V99
} as const;

export const RECORD_LENGTH = 29;

const PENALTY_RATE = fromScaled(125n, 1); // 12.5

export function processRecord(record: string): string {
  if (record.length !== RECORD_LENGTH) {
    throw new RangeError(`INTCALC expects ${RECORD_LENGTH}-character records, got ${record.length}`);
  }
  const acctId = record.slice(0, 8);
  const balance = parseDisplay(record.slice(8, 20), PICS.balance);
  const inRate = parseDisplay(record.slice(20, 26), PICS.rate);
  const days = parseDisplay(record.slice(26, 29), PICS.days);

  // IF IN-BALANCE < 0  COMPUTE WS-RATE = IN-RATE + 12.5  ELSE MOVE IN-RATE TO WS-RATE
  const rate =
    balance < 0n ? store(add(fromScaled(inRate, 4), PENALTY_RATE), PICS.rate).scaled : inRate;

  // COMPUTE WS-INTEREST ROUNDED = IN-BALANCE * WS-RATE / 100 * IN-DAYS / 365
  const exactInterest = div(
    mul(div(mul(fromScaled(balance, 2), fromScaled(rate, 4)), fromInt(100n)), fromInt(days)),
    fromInt(365n),
  );
  const interest = store(exactInterest, PICS.interest, { rounded: true });

  // COMPUTE WS-NEW-BAL = IN-BALANCE + WS-INTEREST
  const newBalance = store(add(fromScaled(balance, 2), fromScaled(interest.scaled, 2)), PICS.newBalance);

  return [
    acctId,
    formatDisplay(rate, PICS.rate),
    formatDisplay(interest, PICS.interest),
    formatDisplay(newBalance, PICS.newBalance),
  ].join(' ');
}
