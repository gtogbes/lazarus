/**
 * Diverged results for the counterexample card tests. Not imported by app code.
 *
 * HALF_UP_TAX: real output of src/ports/payroll.ts (the COBOL side, which it
 * matches) and of the `half-up-tax` mutant for the same records. Record 2 has
 * gross 1,000.02, so the tax is 0.02 x 0.25 = 0.005: COBOL's NEAREST-EVEN gives
 * 0.00, half-up gives 0.01, and net pay is a penny out.
 *
 * NEGATIVE_ZERO: a made-up real-port divergence where COBOL writes a net of
 * -0.00 and the port +0.00.
 */
import type { EquivalenceResult } from '../../../../src/harness/equivalence.types';

export const HALF_UP_TAX: EquivalenceResult = {
  program: 'PAYROLL',
  status: 'diverged',
  reference: 'gnucobol 3.1.2 (native)',
  generatedAt: '2026-11-10T10:00:00.000Z',
  seed: -1501918552,
  cases: 213,
  shrinks: 17,
  durationMs: 840,
  counterexample: {
    records: ['A1B2C3080001250-0001000', 'EMP001020050001+0000000'],
    cobol: ['A1B2C3 OK 0010000 0000000 +0009000', 'EMP001 OK 0100002 0000000 +0100002'],
    port: ['A1B2C3 OK 0010000 0000000 +0009000', 'EMP001 OK 0100002 0000001 +0100001'],
    line: 1,
    column: 24,
  },
};

export const NEGATIVE_ZERO: EquivalenceResult = {
  ...HALF_UP_TAX,
  seed: 42,
  cases: 5,
  shrinks: 1,
  counterexample: {
    records: ['ZZ0001000000000-0000000'],
    cobol: ['ZZ0001 OK 0000000 0000000 -0000000'],
    port: ['ZZ0001 OK 0000000 0000000 +0000000'],
    line: 0,
    column: 26,
  },
};
