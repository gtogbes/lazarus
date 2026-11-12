/**
 * The allowlist of programs the lab and the proof API know about (Requirement 8.2).
 * A request may only name a program id and mutant id listed here. Lookups take
 * `unknown` and match exact own keys, so inherited names such as "constructor"
 * or "__proto__" never resolve.
 */
import type fc from 'fast-check';
import type { Port } from '../harness/equivalence.js';
import type { ProgramLayout } from '../semantics/layout.js';
import * as intcalc from './intcalc.js';
import { LAYOUT as INTCALC_LAYOUT } from './intcalc.layout.js';
import { MUTANTS as INTCALC_MUTANTS } from './intcalc.mutants.js';
import * as invoice from './invoice.js';
import { LAYOUT as INVOICE_LAYOUT } from './invoice.layout.js';
import { MUTANTS as INVOICE_MUTANTS } from './invoice.mutants.js';
import type { Mutant } from './mutant.js';
import * as payroll from './payroll.js';
import { LAYOUT as PAYROLL_LAYOUT } from './payroll.layout.js';
import { MUTANTS as PAYROLL_MUTANTS } from './payroll.mutants.js';
import { PROGRAM_META, type ProgramId, type ProgramMeta } from './programs.meta.js';
import { INTCALC_RECORD, INVOICE_RECORD, PAYROLL_RECORD } from './records.js';

export interface Program extends ProgramMeta {
  readonly port: Port;
  readonly layout: ProgramLayout;
  /** Generator for one valid input record, shared with the equivalence tests. */
  readonly record: fc.Arbitrary<string>;
  readonly mutants: readonly Mutant[];
}

type ProgramImpl = Omit<Program, keyof ProgramMeta>;

/** Keyed by id so the compiler insists every program in PROGRAM_META has an implementation. */
const IMPLEMENTATIONS: Readonly<Record<ProgramId, ProgramImpl>> = {
  INTCALC: {
    port: intcalc.processRecord,
    layout: INTCALC_LAYOUT,
    record: INTCALC_RECORD,
    mutants: INTCALC_MUTANTS,
  },
  PAYROLL: {
    port: payroll.processRecord,
    layout: PAYROLL_LAYOUT,
    record: PAYROLL_RECORD,
    mutants: PAYROLL_MUTANTS,
  },
  INVOICE: {
    port: invoice.processRecord,
    layout: INVOICE_LAYOUT,
    record: INVOICE_RECORD,
    mutants: INVOICE_MUTANTS,
  },
};

/** Id, order, description, behaviours and summary come from PROGRAM_META (shared with the web app). */
export const PROGRAMS: readonly Program[] = PROGRAM_META.map((meta) => ({ ...meta, ...IMPLEMENTATIONS[meta.id] }));

const BY_ID: ReadonlyMap<string, Program> = new Map(PROGRAMS.map((p) => [p.id, p]));

/** The program with exactly this id, or undefined for anything else. */
export function findProgram(id: unknown): Program | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}

/** The mutant with exactly this id within the program, or undefined. */
export function findMutant(program: Program, id: unknown): Mutant | undefined {
  return typeof id === 'string' ? program.mutants.find((m) => m.id === id) : undefined;
}
