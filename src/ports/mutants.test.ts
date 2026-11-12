/**
 * In-process checks of the mutant definitions (no Docker). The proof that
 * GnuCOBOL catches each mutant is in mutants.equivalence.test.ts.
 */
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Port } from '../harness/equivalence.js';
import * as intcalc from './intcalc.js';
import { MUTANTS as INTCALC_MUTANTS } from './intcalc.mutants.js';
import * as invoice from './invoice.js';
import { MUTANTS as INVOICE_MUTANTS } from './invoice.mutants.js';
import type { Mutant } from './mutant.js';
import * as payroll from './payroll.js';
import { MUTANTS as PAYROLL_MUTANTS } from './payroll.mutants.js';
import { INTCALC_RECORD, INVOICE_RECORD, PAYROLL_RECORD } from './records.js';

const PROGRAMS: ReadonlyArray<{
  program: string;
  port: Port;
  record: fc.Arbitrary<string>;
  mutants: readonly Mutant[];
}> = [
  { program: 'INTCALC', port: intcalc.processRecord, record: INTCALC_RECORD, mutants: INTCALC_MUTANTS },
  { program: 'PAYROLL', port: payroll.processRecord, record: PAYROLL_RECORD, mutants: PAYROLL_MUTANTS },
  { program: 'INVOICE', port: invoice.processRecord, record: INVOICE_RECORD, mutants: INVOICE_MUTANTS },
];

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();

function cobolSource(program: string): string {
  return normalise(readFileSync(new URL(`../../cobol/programs/${program}.cbl`, import.meta.url), 'utf8'));
}

describe.each(PROGRAMS)('$program mutants', ({ program, port, record, mutants }) => {
  it('has at least two mutants with unique kebab-case ids and complete metadata', () => {
    expect(mutants.length).toBeGreaterThanOrEqual(2);
    expect(new Set(mutants.map((m) => m.id)).size).toBe(mutants.length);
    for (const m of mutants) {
      expect(m.id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
      expect(m.title.trim()).not.toBe('');
      expect(m.explanation.trim()).not.toBe('');
      if (m.equivalent !== undefined) expect(m.equivalent.trim()).not.toBe('');
    }
  });

  it('quotes each broken rule as it appears in the COBOL source', () => {
    const source = cobolSource(program);
    for (const m of mutants) expect(source, m.id).toContain(normalise(m.rule));
  });

  for (const m of mutants.filter((m) => m.equivalent === undefined)) {
    it(`${m.id} differs from the real port within 2,000 cases`, () => {
      const details = fc.check(
        fc.property(record, (r) => m.port(r) === port(r)),
        { numRuns: 2000, seed: 1 },
      );
      expect(details.failed).toBe(true);
    });
  }

  for (const m of mutants.filter((m) => m.equivalent !== undefined)) {
    it(`${m.id} agrees with the real port on every generated record`, () => {
      fc.assert(
        fc.property(record, (r) => m.port(r) === port(r)),
        { numRuns: 10_000 },
      );
    });
  }
});

describe('PAYROLL strict-band-edge (equivalent mutant)', () => {
  const mutant = PAYROLL_MUTANTS.find((m) => m.id === 'strict-band-edge');

  it('is marked equivalent', () => {
    expect(mutant?.equivalent).toBeDefined();
  });

  it.each([
    ['40 hours at 25.00', 'EMP001400002500+0000000'],
    ['10 hours at 100.00', 'EMP002100010000-0000100'],
  ])('gives nil tax at exactly 1,000.00 gross (%s)', (_label, input) => {
    const real = payroll.processRecord(input);
    expect(real.slice(10, 17)).toBe('0100000'); // OUT-GROSS 1,000.00
    expect(real.slice(18, 25)).toBe('0000000'); // OUT-TAX 0.00
    expect(mutant?.port(input)).toBe(real);
  });
});
