/**
 * Record layouts for the counterexample card (Requirement 5.1). The layout
 * modules and `src/semantics/layout.ts` are pure (no Node, no fast-check, no
 * ports), so they are bundled into the lazy program view chunk, never the entry.
 */
import { LAYOUT as INTCALC } from '../../../../src/ports/intcalc.layout';
import { LAYOUT as INVOICE } from '../../../../src/ports/invoice.layout';
import { LAYOUT as PAYROLL } from '../../../../src/ports/payroll.layout';
import type { ProgramId } from '../../../../src/ports/programs.meta';
import type { ProgramLayout } from '../../../../src/semantics/layout';

/** Keyed by id so the compiler insists every program has a layout. */
const LAYOUTS: Readonly<Record<ProgramId, ProgramLayout>> = { INTCALC, PAYROLL, INVOICE };

export function layoutFor(program: string): ProgramLayout | undefined {
  return Object.hasOwn(LAYOUTS, program) ? LAYOUTS[program as ProgramId] : undefined;
}
