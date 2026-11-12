import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as payroll from './payroll.js';
import { MUTANTS as PAYROLL_MUTANTS } from './payroll.mutants.js';
import { PROGRAM_META } from './programs.meta.js';
import { findMutant, findProgram, PROGRAMS } from './registry.js';

describe('program registry', () => {
  it('lists the three sample programs with unique ids and metadata', () => {
    expect(PROGRAMS.map((p) => p.id)).toEqual(['INTCALC', 'PAYROLL', 'INVOICE']);
    for (const p of PROGRAMS) {
      expect(p.description.trim(), p.id).not.toBe('');
      expect(p.behaviours.length, p.id).toBeGreaterThan(0);
      expect(p.mutants.length, p.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('matches the fast-check-free metadata the web app uses', () => {
    expect(
      PROGRAMS.map(({ id, description, behaviours, summary }) => ({ id, description, behaviours, summary })),
    ).toEqual(PROGRAM_META);
  });

  it('gives each program a 2 to 4 sentence summary that states its real mutant count', () => {
    const COUNT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    for (const p of PROGRAMS) {
      const sentences = p.summary.split(/(?<=\.)\s+/);
      expect(sentences.length, p.id).toBeGreaterThanOrEqual(2);
      expect(sentences.length, p.id).toBeLessThanOrEqual(4);
      expect(p.summary, p.id).toContain(`${COUNT_WORDS[p.mutants.length]} mutants:`);
    }
  });

  it('has the same summaries in the README', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    for (const p of PROGRAMS) expect(readme, p.id).toContain(`- **${p.id}.** ${p.summary}`);
  });

  it('resolves a known program to its port, layout and mutants', () => {
    const program = findProgram('PAYROLL');
    expect(program?.port).toBe(payroll.processRecord);
    expect(program?.layout.input.length).toBe(payroll.RECORD_LENGTH);
    expect(program?.mutants).toBe(PAYROLL_MUTANTS);
  });

  it.each([
    'payroll', ' PAYROLL', 'PAYROLL ', 'NOPE', '', 'constructor', '__proto__', 'toString',
    undefined, null, 1, {}, ['PAYROLL'],
  ])('rejects program id %j', (id) => {
    expect(findProgram(id)).toBeUndefined();
  });

  it('resolves a known mutant only within its own program', () => {
    const payrollProgram = findProgram('PAYROLL');
    const intcalcProgram = findProgram('INTCALC');
    if (!payrollProgram || !intcalcProgram) throw new Error('registry is missing a program');
    expect(findMutant(payrollProgram, 'half-up-tax')?.id).toBe('half-up-tax');
    expect(findMutant(intcalcProgram, 'half-up-tax')).toBeUndefined();
  });

  it.each(['HALF-UP-TAX', 'half-up-tax ', '', 'constructor', undefined, null, 0, {}])(
    'rejects mutant id %j',
    (id) => {
      const program = findProgram('PAYROLL');
      if (!program) throw new Error('registry is missing PAYROLL');
      expect(findMutant(program, id)).toBeUndefined();
    },
  );
});
