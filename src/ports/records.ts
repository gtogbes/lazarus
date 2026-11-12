/**
 * Input record generators, shared by the equivalence tests and the mutant tests
 * so a mutant is always proved on the same inputs as its real port.
 */
import fc from 'fast-check';
import { picDisplay } from '../semantics/arbitraries.js';
import * as intcalc from './intcalc.js';
import * as invoice from './invoice.js';
import * as payroll from './payroll.js';

export const INTCALC_RECORD: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[A-Z0-9]{8}$/),
    picDisplay(intcalc.PICS.balance),
    picDisplay(intcalc.PICS.rate),
    picDisplay(intcalc.PICS.days),
  )
  .map((fields) => fields.join(''));

export const PAYROLL_RECORD: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[A-Z0-9]{6}$/),
    picDisplay(payroll.PICS.hours),
    picDisplay(payroll.PICS.rate),
    picDisplay(payroll.PICS.adjust),
  )
  .map((fields) => fields.join(''));

export const INVOICE_RECORD: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[A-Z0-9]{6}$/),
    picDisplay(invoice.PICS.qty),
    picDisplay(invoice.PICS.price),
    picDisplay(invoice.PICS.discPct),
    // Known codes, plus unknown, lower-case and blank codes from bad data.
    fc.constantFrom('S', 'R', 'Z', 's', 'X', ' '),
  )
  .map((fields) => fields.join(''));
