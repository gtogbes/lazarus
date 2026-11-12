// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildMutants, diffLines, extractMutants, type LineHighlighter } from './mutantDiffs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** One token per line, text unchanged: enough to check the diff without Shiki. */
const plain: LineHighlighter = (code) => code.split('\n').map((line) => (line ? [[line, '#ffffff'] as const] : []));

const PORT = `import { x } from './x.js';

/** Doc. */
export function processRecord(record: string): string {
  const a = record.length;
  const b = a * 2;
  const c = b + 1;
  return String(c);
}
`;

const mutantsModule = (body: string, extra = '') => `import type { Mutant } from './mutant.js';

function plusTwo(record: string): string {
${body}
}

export const MUTANTS: readonly Mutant[] = [
  {
    id: 'plus-two',
    title: 'Add two instead of one',
    rule: 'COMPUTE C = B + 1',
    explanation: 'COBOL adds one. ' + \`The mutant adds two.\`,${extra}
    port: plusTwo,
  },
];
`;

const CHANGED_BODY = `  const a = record.length;
  const b = a * 2;
  const c = b + 2; // MUTANT: + 1 became + 2
  return String(c);`;

const sources = (mutantsSource: string) => ({
  portPath: 'src/ports/demo.ts',
  portSource: PORT,
  mutantsPath: 'src/ports/demo.mutants.ts',
  mutantsSource,
});

describe('diffLines', () => {
  it('keeps common lines and puts removals before additions', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual([
      { kind: 'same', a: 0, b: 0 },
      { kind: 'removed', a: 1 },
      { kind: 'added', b: 1 },
      { kind: 'same', a: 2, b: 2 },
      { kind: 'added', b: 3 },
    ]);
  });
});

describe('buildMutants', () => {
  it('reads the metadata and diffs the mutant against processRecord (4.1, 4.3)', () => {
    const [mutant, ...rest] = buildMutants(sources(mutantsModule(CHANGED_BODY)), plain);
    expect(rest).toHaveLength(0);
    expect(mutant).toMatchObject({
      id: 'plus-two',
      title: 'Add two instead of one',
      rule: 'COMPUTE C = B + 1',
      explanation: 'COBOL adds one. The mutant adds two.',
      path: 'src/ports/demo.mutants.ts',
    });
    expect(mutant).not.toHaveProperty('equivalent');
    const lines = mutant?.hunks.flatMap((h) => h.lines.map((l) => ({ ...l, text: l.tokens.map(([t]) => t).join('') })));
    // The real port's header stands in for the mutant's own function name, which differs by design.
    expect(lines?.map(({ kind, text }) => [kind, text])).toEqual([
      ['context', 'export function processRecord(record: string): string {'],
      ['context', '  const a = record.length;'],
      ['context', '  const b = a * 2;'],
      ['removed', '  const c = b + 1;'],
      ['added', '  const c = b + 2; // MUTANT: + 1 became + 2'],
      ['context', '  return String(c);'],
      ['context', '}'],
    ]);
    // Line numbers are in each file: processRecord starts on line 4, plusTwo on line 3.
    expect(lines?.[0]).toMatchObject({ real: 4, mutant: 3 });
    expect(lines?.[3]).toMatchObject({ kind: 'removed', real: 7 });
    expect(lines?.[4]).toMatchObject({ kind: 'added', mutant: 6 });
  });

  it('keeps the reason for an equivalent mutant (4.4)', () => {
    const [mutant] = buildMutants(sources(mutantsModule(CHANGED_BODY, "\n    equivalent: 'No input reaches it.',")), plain);
    expect(mutant?.equivalent).toBe('No input reaches it.');
  });

  it('fails when a mutant has no // MUTANT: marker', () => {
    const body = CHANGED_BODY.replace(' // MUTANT: + 1 became + 2', '');
    expect(() => buildMutants(sources(mutantsModule(body)), plain)).toThrow(
      /src\/ports\/demo\.mutants\.ts: mutant plus-two \(plusTwo\) has no \/\/ MUTANT: marker/,
    );
  });

  it('fails when a mutant is identical to the real port', () => {
    // The marker is present, but the real port has the same line, so nothing changed.
    const same = '  const c = b + 1; // MUTANT: unchanged';
    const identical = mutantsModule(CHANGED_BODY.replace('  const c = b + 2; // MUTANT: + 1 became + 2', same));
    const portWithMarker = PORT.replace('  const c = b + 1;', same);
    expect(() => buildMutants({ ...sources(identical), portSource: portWithMarker }, plain)).toThrow(
      /mutant plus-two \(plusTwo\) is identical to processRecord: empty diff/,
    );
  });

  it('fails on metadata it cannot read statically', () => {
    const computed = mutantsModule(CHANGED_BODY).replace("title: 'Add two instead of one'", 'title: makeTitle()');
    expect(() => buildMutants(sources(computed), plain)).toThrow(/MUTANTS\[0\]: title must be a plain string/);
    const unknownPort = mutantsModule(CHANGED_BODY).replace('port: plusTwo', 'port: missing');
    expect(() => buildMutants(sources(unknownPort), plain)).toThrow(/no top-level function missing/);
  });
});

describe.each(['payroll', 'invoice', 'intcalc'])('%s mutants', (name) => {
  it('extracts every mutant from the real module', async () => {
    const source = await readFile(path.join(REPO_ROOT, `src/ports/${name}.mutants.ts`), 'utf8');
    const mutants = extractMutants(source, `${name}.mutants.ts`);
    expect(mutants.length).toBeGreaterThan(0);
    for (const m of mutants) {
      expect(m.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(m.title.length).toBeGreaterThan(0);
    }
  });
});

it('reads PAYROLL strict-band-edge as equivalent, with its reason', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'src/ports/payroll.mutants.ts'), 'utf8');
  const strict = extractMutants(source, 'payroll.mutants.ts').find((m) => m.id === 'strict-band-edge');
  expect(strict?.equivalent).toMatch(/no gross pay can tell the mutant from the real port/);
  expect(strict?.functionName).toBe('strictBandEdge');
});
