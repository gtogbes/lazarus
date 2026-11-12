import { describe, expect, it } from 'vitest';
import type { Pic } from '../semantics/decimal.js';
import { decodeRecord, type ProgramLayout } from '../semantics/layout.js';
import * as intcalc from './intcalc.js';
import { LAYOUT as INTCALC } from './intcalc.layout.js';
import * as invoice from './invoice.js';
import { LAYOUT as INVOICE } from './invoice.layout.js';
import * as payroll from './payroll.js';
import { LAYOUT as PAYROLL } from './payroll.layout.js';

/** Decoded values by field name, FILLER left out. */
function values(layout: ProgramLayout['input'], record: string): Record<string, string> {
  const decoded = decodeRecord(layout, record);
  expect(decoded.lengthMatches).toBe(true);
  expect(decoded.fields.every((f) => f.valid)).toBe(true);
  return Object.fromEntries(decoded.fields.filter((f) => f.name !== 'FILLER').map((f) => [f.name, f.value]));
}

function picOf(layout: ProgramLayout['input'], name: string): Pic | undefined {
  const type = layout.fields.find((f) => f.name === name)?.type;
  return type?.kind === 'numeric' ? type.pic : undefined;
}

describe('INTCALC layout', () => {
  it('matches the port record length and PICs', () => {
    expect(INTCALC.input.length).toBe(intcalc.RECORD_LENGTH);
    expect(picOf(INTCALC.input, 'IN-BALANCE')).toEqual(intcalc.PICS.balance);
    expect(picOf(INTCALC.input, 'IN-RATE')).toEqual(intcalc.PICS.rate);
    expect(picOf(INTCALC.input, 'IN-DAYS')).toEqual(intcalc.PICS.days);
    expect(picOf(INTCALC.output, 'OUT-INTEREST')).toEqual(intcalc.PICS.interest);
    expect(picOf(INTCALC.output, 'OUT-NEW-BAL')).toEqual(intcalc.PICS.newBalance);
  });

  it('decodes an overdrawn account', () => {
    const input = 'ACCT0001-00000010000050000030';
    expect(values(INTCALC.input, input)).toEqual({
      'IN-ACCT-ID': 'ACCT0001',
      'IN-BALANCE': '-100.00',
      'IN-RATE': '5.0000',
      'IN-DAYS': '30',
    });
    const output = intcalc.processRecord(input);
    expect(output.length).toBe(INTCALC.output.length);
    // -100.00 * 17.5% * 30 / 365 = -1.438..., ROUNDED to -1.44
    expect(values(INTCALC.output, output)).toEqual({
      'OUT-ACCT-ID': 'ACCT0001',
      'OUT-RATE': '17.5000',
      'OUT-INTEREST': '-1.44',
      'OUT-NEW-BAL': '-101.44',
    });
  });
});

describe('PAYROLL layout', () => {
  it('matches the port record length and PICs', () => {
    expect(PAYROLL.input.length).toBe(payroll.RECORD_LENGTH);
    expect(picOf(PAYROLL.input, 'IN-HOURS')).toEqual(payroll.PICS.hours);
    expect(picOf(PAYROLL.input, 'IN-RATE')).toEqual(payroll.PICS.rate);
    expect(picOf(PAYROLL.input, 'IN-ADJUST')).toEqual(payroll.PICS.adjust);
    expect(picOf(PAYROLL.output, 'OUT-GROSS')).toEqual(payroll.PICS.gross);
    expect(picOf(PAYROLL.output, 'OUT-TAX')).toEqual(payroll.PICS.tax);
    expect(picOf(PAYROLL.output, 'OUT-NET')).toEqual(payroll.PICS.net);
  });

  it('decodes a week with overtime', () => {
    const input = 'EMP001450002000-0001000';
    expect(values(PAYROLL.input, input)).toEqual({
      'IN-EMP-ID': 'EMP001',
      'IN-HOURS': '45.00',
      'IN-RATE': '20.00',
      'IN-ADJUST': '-10.00',
    });
    const output = payroll.processRecord(input);
    expect(output.length).toBe(PAYROLL.output.length);
    // 40 * 20 + 5 * 20 * 1.5 = 950.00, under the 1000.00 tax band
    expect(values(PAYROLL.output, output)).toEqual({
      'OUT-EMP-ID': 'EMP001',
      'OUT-STATUS': 'OK',
      'OUT-GROSS': '950.00',
      'OUT-TAX': '0.00',
      'OUT-NET': '+940.00',
    });
  });
});

describe('INVOICE layout', () => {
  it('matches the port record length and PICs', () => {
    expect(INVOICE.input.length).toBe(invoice.RECORD_LENGTH);
    expect(picOf(INVOICE.input, 'IN-QTY')).toEqual(invoice.PICS.qty);
    expect(picOf(INVOICE.input, 'IN-PRICE')).toEqual(invoice.PICS.price);
    expect(picOf(INVOICE.input, 'IN-DISC-PCT')).toEqual(invoice.PICS.discPct);
    for (const name of ['OUT-LINE', 'OUT-DISC', 'OUT-VAT', 'OUT-TOTAL']) {
      expect(picOf(INVOICE.output, name)).toEqual(invoice.PICS.amount);
    }
  });

  it('decodes a standard-rated line', () => {
    const input = 'INV00100030000100100S';
    expect(values(INVOICE.input, input)).toEqual({
      'IN-INV-ID': 'INV001',
      'IN-QTY': '3',
      'IN-PRICE': '1.00',
      'IN-DISC-PCT': '10.0',
      'IN-VAT-CODE': 'S',
    });
    const output = invoice.processRecord(input);
    expect(output.length).toBe(INVOICE.output.length);
    // 3 * 1.00 = 3.00, less 10% = 2.70, VAT 17.5% = 0.4725 -> 0.47
    expect(values(INVOICE.output, output)).toEqual({
      'OUT-INV-ID': 'INV001',
      'OUT-STATUS': 'OK',
      'OUT-LINE': '3.00',
      'OUT-DISC': '0.30',
      'OUT-VAT': '0.47',
      'OUT-TOTAL': '3.17',
    });
  });
});
