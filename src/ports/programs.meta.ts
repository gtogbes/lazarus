/**
 * Display metadata for each program, with no runtime imports so the web bundle
 * can use it without pulling in fast-check or the ports. `registry.ts` builds the
 * allowlist from this list, so it is the one source of truth for ids, order,
 * descriptions and behaviours.
 */
export interface ProgramMeta {
  /** COBOL PROGRAM-ID and binary name, e.g. `PAYROLL`. */
  readonly id: string;
  /** One-line description for the morgue (Requirement 1.1). */
  readonly description: string;
  /** COBOL behaviours the program exercises (Requirement 1.1). */
  readonly behaviours: readonly string[];
  /**
   * Plain-English explanation for someone who does not read COBOL, 2 to 4 short
   * sentences: what the program computes, which COBOL behaviours make it hard to
   * port and why a naive port gets them wrong, and how many mutants it has.
   * Written from cobol/programs/<id>.cbl and src/ports/<id>.mutants.ts;
   * registry.test.ts checks the mutant count against the registry.
   */
  readonly summary: string;
}

export const PROGRAM_META = [
  {
    id: 'INTCALC',
    description: 'Interest accrual with an overdraft penalty',
    behaviours: ['ROUNDED', 'High-order truncation', 'Negative zero'],
    summary:
      'Works out the interest a loan account earns over a number of days, and its new balance; overdrawn accounts pay 12.5 points more on the rate. ' +
      'COBOL rounds the interest half a cent away from zero, and an amount too big for its field silently loses its leading digits instead of failing. ' +
      'A port using floating point or ordinary rounding gets cents wrong, and cannot print the -0.00 that COBOL gives when a cut-off negative amount leaves zero. ' +
      'Two mutants: drop the rounding, or charge the penalty on a zero balance.',
  },
  {
    id: 'PAYROLL',
    description: 'Weekly gross-to-net pay with tax bands',
    behaviours: ['COMP-3', 'ON SIZE ERROR', "Banker's rounding"],
    summary:
      'Turns weekly hours and an hourly rate into gross pay, tax and net pay: hours over 40 pay time and a half, and tax is nil up to 1,000.00, 25% to 4,000.00 and 45% above. ' +
      'The working fields are packed decimal (COMP-3), so every step is exact decimal arithmetic, and tax rounds an exact half penny to the even penny where a naive port rounds it up. ' +
      'When gross pay is too big for its field, ON SIZE ERROR marks the record "SE" and leaves gross at zero; a naive port keeps the overflowed amount. ' +
      'Three mutants: normal rounding, ignoring the size error, and a tax band edge change that turns out to be equivalent.',
  },
  {
    id: 'INVOICE',
    description: 'Invoice line with discount and VAT',
    behaviours: ['Silent overflow', 'Truncated discount', 'Bad input codes'],
    summary:
      'Prices one invoice line: quantity times unit price, less a percentage discount, plus VAT at 17.5%, 5% or 0% by code. ' +
      'The discount is cut to the penny rather than rounded, VAT rounds an exact half penny to the even penny, and a line too big for its field silently loses its leading digits. ' +
      'An unknown VAT code is not rejected: it is charged no VAT and the record is marked "VC". ' +
      'Two mutants: round VAT halves up, or round the discount instead of cutting it.',
  },
] as const satisfies readonly ProgramMeta[];

export type ProgramId = (typeof PROGRAM_META)[number]['id'];
