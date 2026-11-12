/**
 * Mutants of the INTCALC port (Requirement 4). Each port is a copy of
 * `processRecord` in ./intcalc.ts with one change, marked `// MUTANT:`.
 */
import { add, div, formatDisplay, fromInt, fromScaled, mul, parseDisplay, store } from '../semantics/decimal.js';
import { PICS, RECORD_LENGTH } from './intcalc.js';
import type { Mutant } from './mutant.js';

const PENALTY_RATE = fromScaled(125n, 1); // 12.5

function truncateInterest(record: string): string {
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
  const interest = store(exactInterest, PICS.interest); // MUTANT: ROUNDED dropped, so the store truncates

  // COMPUTE WS-NEW-BAL = IN-BALANCE + WS-INTEREST
  const newBalance = store(add(fromScaled(balance, 2), fromScaled(interest.scaled, 2)), PICS.newBalance);

  return [
    acctId,
    formatDisplay(rate, PICS.rate),
    formatDisplay(interest, PICS.interest),
    formatDisplay(newBalance, PICS.newBalance),
  ].join(' ');
}

function penaltyAtZero(record: string): string {
  if (record.length !== RECORD_LENGTH) {
    throw new RangeError(`INTCALC expects ${RECORD_LENGTH}-character records, got ${record.length}`);
  }
  const acctId = record.slice(0, 8);
  const balance = parseDisplay(record.slice(8, 20), PICS.balance);
  const inRate = parseDisplay(record.slice(20, 26), PICS.rate);
  const days = parseDisplay(record.slice(26, 29), PICS.days);

  // IF IN-BALANCE < 0  COMPUTE WS-RATE = IN-RATE + 12.5  ELSE MOVE IN-RATE TO WS-RATE
  const rate =
    balance <= 0n ? store(add(fromScaled(inRate, 4), PENALTY_RATE), PICS.rate).scaled : inRate; // MUTANT: < became <=

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

export const MUTANTS: readonly Mutant[] = [
  {
    id: 'truncate-interest',
    title: 'Truncate the interest instead of rounding it',
    rule: 'COMPUTE WS-INTEREST ROUNDED',
    explanation:
      'The COBOL COMPUTE says ROUNDED, so half a cent or more rounds away from zero to the next cent. ' +
      'Without it the port cuts the extra digits off, so the interest and new balance can be a cent out.',
    port: truncateInterest,
  },
  {
    id: 'penalty-at-zero',
    title: 'Charge the overdraft penalty on a zero balance',
    rule: 'IF IN-BALANCE < 0',
    explanation:
      'COBOL adds the 12.5 point penalty only when the balance is below zero. Testing "zero or less" also ' +
      'penalises accounts at exactly 0.00. Their interest is still 0.00, but the applied rate in the output is 12.5 points too high.',
    port: penaltyAtZero,
  },
];
