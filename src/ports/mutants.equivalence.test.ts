/**
 * Requirement 4.5: GnuCOBOL must catch every mutant not marked equivalent
 * within 2,000 cases. Equivalent mutants must survive the same run, or their
 * label is wrong (Requirement 4.4). Needs Docker and the GnuCOBOL image.
 */
import type fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CobolSession } from '../harness/cobol.js';
import { checkEquivalence } from '../harness/equivalence.js';
import { describeResult } from '../harness/results.js';
import { MUTANTS as INTCALC_MUTANTS } from './intcalc.mutants.js';
import { MUTANTS as INVOICE_MUTANTS } from './invoice.mutants.js';
import type { Mutant } from './mutant.js';
import { MUTANTS as PAYROLL_MUTANTS } from './payroll.mutants.js';
import { INTCALC_RECORD, INVOICE_RECORD, PAYROLL_RECORD } from './records.js';

const MAX_CASES = 2000;

const PROGRAMS: ReadonlyArray<{ program: string; record: fc.Arbitrary<string>; mutants: readonly Mutant[] }> = [
  { program: 'INTCALC', record: INTCALC_RECORD, mutants: INTCALC_MUTANTS },
  { program: 'PAYROLL', record: PAYROLL_RECORD, mutants: PAYROLL_MUTANTS },
  { program: 'INVOICE', record: INVOICE_RECORD, mutants: INVOICE_MUTANTS },
];

describe.each(PROGRAMS)('$program mutants against GnuCOBOL', ({ program, record, mutants }) => {
  let session: CobolSession;

  beforeAll(() => {
    session = CobolSession.start(program);
  });

  afterAll(async () => {
    expect(await session.close()).toBe(0);
  });

  for (const mutant of mutants) {
    const expected = mutant.equivalent === undefined ? 'diverged' : 'equivalent';
    it(`${mutant.id} is ${expected === 'diverged' ? 'caught' : 'never caught'} within ${MAX_CASES} cases`, async () => {
      const result = await checkEquivalence({
        program: `${program}.${mutant.id}`,
        session,
        port: mutant.port,
        record,
        numRuns: MAX_CASES,
      });
      console.log(describeResult(result));
      expect(result.status, describeResult(result)).toBe(expected);
      expect(result.cases).toBeLessThanOrEqual(MAX_CASES);
    });
  }
});
