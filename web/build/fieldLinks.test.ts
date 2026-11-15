// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { recordLayout, type FieldSpec } from '../../src/semantics/layout';
import { FieldLinkError, linkFields, picsKeyFor } from './fieldLinks';

// Generators for consistent COBOL, port and layout triples, shared by Properties 10 and 11.
type Pic =
  | { readonly kind: 'x'; readonly n: number; readonly short: boolean }
  | { readonly kind: '9'; readonly i: number; readonly s: number; readonly signed: boolean; readonly short: boolean };
/** How a numeric item gets its `PICS` entry: none, by the name rule, or by a name in the comment. */
type Entry = 'none' | 'rule' | 'comment';
interface RecordGen {
  readonly pic: Pic;
  readonly entry: Entry;
  /** The port code reads `PICS.key` (only when there is an entry). */
  readonly ref: boolean;
  /** Input: width of a FILLER before the field. Output: write the separator as a bare `05 PIC X`. */
  readonly filler: number | null;
  readonly bare: boolean;
}
interface WsGen {
  readonly pic: Pic;
  readonly entry: Entry;
  readonly comp3: boolean;
  readonly value: boolean;
}

const digits = (n: number, short: boolean) => (short && n <= 3 ? '9'.repeat(n) : `9(${n})`);
const numericText = (p: Extract<Pic, { kind: '9' }>) =>
  `${p.signed ? 'S' : ''}${digits(p.i, p.short)}${p.s > 0 ? `V${digits(p.s, p.short)}` : ''}`;
const picText = (p: Pic, record: boolean) =>
  p.kind === 'x'
    ? p.short && p.n === 1 ? 'X' : `X(${p.n})`
    : `${numericText(p)}${record && p.signed ? ' SIGN LEADING SEPARATE' : ''}`;
const width = (p: Pic) => (p.kind === 'x' ? p.n : p.i + p.s + (p.signed ? 1 : 0));

const xPic = fc.record({ kind: fc.constant('x' as const), n: fc.integer({ min: 1, max: 12 }), short: fc.boolean() });
const nPic = fc.record({
  kind: fc.constant('9' as const),
  i: fc.integer({ min: 1, max: 9 }),
  s: fc.integer({ min: 0, max: 4 }),
  signed: fc.boolean(),
  short: fc.boolean(),
});
const anyPic: fc.Arbitrary<Pic> = fc.oneof(xPic, nPic);
const entry = fc.constantFrom<Entry>('none', 'rule', 'comment');
const recordGen = fc.record({
  pic: anyPic,
  entry,
  ref: fc.boolean(),
  filler: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
  bare: fc.boolean(),
});
const wsGen = fc.record({ pic: fc.oneof(nPic, nPic, xPic), entry, comp3: fc.boolean(), value: fc.boolean() });
/** COBOL base names, 1–2 hyphenated segments, unique by their `PICS` key. */
const base = fc
  .array(fc.stringMatching(/^[A-Z]{1,4}$/), { minLength: 1, maxLength: 2 })
  .map((parts) => parts.join('-'));

const shapes = fc
  .record({
    input: fc.array(recordGen, { minLength: 1, maxLength: 4 }),
    output: fc.array(recordGen, { minLength: 1, maxLength: 3 }),
    ws: fc.array(wsGen, { maxLength: 3 }),
  })
  .chain((shape) => {
    const count = shape.input.length + shape.output.length + shape.ws.length;
    const names = fc.uniqueArray(base, { minLength: count, maxLength: count, selector: (b) => picsKeyFor(b) });
    return names.map((bases) => ({ ...shape, bases }));
  });

interface Expected {
  readonly name: string;
  readonly section: 'input' | 'output' | 'working';
  readonly cobolLine: number;
  readonly primary: number;
  readonly entryLine: number | null;
  readonly offset?: number;
  readonly length?: number;
}

/** COBOL, port and layout generated from one shape, with the links they should produce. */
interface Shape {
  readonly input: readonly RecordGen[];
  readonly output: readonly RecordGen[];
  readonly ws: readonly WsGen[];
  readonly bases: readonly string[];
}

function build(shape: Shape) {
  const cobol: string[] = [
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. GEN.',
    '       DATA DIVISION.',
    '      * 05  IN-COMMENTED  PIC X(3).',
    '       FILE SECTION.',
    '       FD  IN-FILE.',
    '       01  IN-REC.',
  ];
  const port: string[] = ["import { pic } from './decimal';", ''];
  const body: string[] = [];
  const entries: { key: string; text: string; owner: number }[] = [];
  const expected: (Omit<Expected, 'primary' | 'entryLine'> & { primary: () => number; entry: number | null })[] = [];
  const inSpecs: FieldSpec[] = [];
  const outSpecs: FieldSpec[] = [];
  let b = 0;

  const addEntry = (name: string, p: Pic, how: Entry, record: boolean): string | null => {
    if (p.kind !== '9' || how === 'none') return null;
    const key = how === 'rule' ? picsKeyFor(name) : `k${entries.length}`;
    const comment = `${picText(p, record)}${how === 'comment' ? `: ${name}` : ''}`;
    entries.push({ key, text: `  ${key}: pic(${p.i}, ${p.s}, ${p.signed}), // ${comment}`, owner: expected.length });
    return key;
  };

  let offset = 0;
  shape.input.forEach((f, i) => {
    if (f.filler !== null) {
      cobol.push(`           05  FILLER  PIC X(${f.filler}).`);
      inSpecs.push({ name: 'FILLER', picture: `X(${f.filler})` });
      offset += f.filler;
    }
    const name = `IN-${shape.bases[b++]!}`;
    const picture = picText(f.pic, true);
    cobol.push(`           05  ${name}  PIC ${picture}.`);
    inSpecs.push({ name, picture });
    const key = addEntry(name, f.pic, f.entry, true);
    const end = offset + width(f.pic);
    const read = `record.slice(${offset}, ${end})`;
    body.push(`  const i${i} = ${f.pic.kind === '9' && key !== null && f.ref ? `parseDisplay(${read}, PICS.${key})` : read};`);
    const bodyIndex = body.length - 1;
    expected.push({
      name,
      section: 'input',
      cobolLine: cobol.length,
      primary: () => bodyIndex,
      entry: key === null ? null : entries.length - 1,
      offset,
      length: width(f.pic),
    });
    offset = end;
  });

  cobol.push('       FD  OUT-FILE.', '       01  OUT-REC.');
  const elements: string[] = [];
  offset = 0;
  shape.output.forEach((f, i) => {
    if (i > 0) {
      cobol.push(f.bare ? '           05  PIC X.' : '           05  FILLER  PIC X  VALUE SPACE.');
      outSpecs.push({ name: 'FILLER', picture: 'X' });
      offset += 1;
    }
    const name = `OUT-${shape.bases[b++]!}`;
    const picture = picText(f.pic, true);
    cobol.push(`           05  ${name}  PIC ${picture}.`);
    outSpecs.push({ name, picture });
    const key = addEntry(name, f.pic, f.entry, true);
    const p = f.pic;
    elements.push(
      p.kind === 'x'
        ? `o${i}.padEnd(${p.n})`
        : `formatDisplay(o${i}, ${key !== null && f.ref ? `PICS.${key}` : `pic(${p.i}, ${p.s}, ${p.signed})`})`,
    );
    const elementIndex = elements.length - 1;
    expected.push({
      name,
      section: 'output',
      cobolLine: cobol.length,
      primary: () => body.length + 1 + elementIndex,
      entry: key === null ? null : entries.length - 1,
      offset,
      length: width(p),
    });
    offset += width(p);
  });

  cobol.push('       WORKING-STORAGE SECTION.');
  for (const w of shape.ws) {
    const name = `WS-${shape.bases[b++]!}`;
    const p = w.pic;
    const usage = p.kind === '9' && w.comp3 ? ' COMP-3' : '';
    const value = w.value ? (p.kind === 'x' ? " VALUE 'N'" : ' VALUE ZERO') : '';
    cobol.push(`       01  ${name}  PIC ${picText(p, false)}${usage}${value}.`);
    const key = addEntry(name, p, w.entry, false);
    if (key === null) continue;
    const entryIndex = entries.length - 1;
    expected.push({ name, section: 'working', cobolLine: cobol.length, primary: () => -1, entry: entryIndex });
  }
  cobol.push('       PROCEDURE DIVISION.', '       MAIN-PARA.', '           STOP RUN.');

  // Port: PICS block, then processRecord with the slices and the returned array.
  const picsStart = port.length; // `export const PICS = {` is line picsStart + 1
  const entryLine = (index: number) => picsStart + 2 + index;
  if (entries.length > 0) port.push('export const PICS = {', ...entries.map((e) => e.text), '} as const;', '');
  const bodyStart = port.length + 1; // the `export function processRecord` line
  port.push('export function processRecord(record: string): string {', ...body, '  return [');
  port.push(...elements.map((e) => `    ${e},`), "  ].join(' ');", '}');

  const links: Expected[] = expected.map((e) => ({
    name: e.name,
    section: e.section,
    cobolLine: e.cobolLine,
    primary: e.section === 'working' ? entryLine(e.entry!) : bodyStart + e.primary() + 1,
    entryLine: e.entry === null ? null : entryLine(e.entry),
    ...(e.offset === undefined ? {} : { offset: e.offset, length: e.length }),
  }));
  return {
    cobol: cobol.join('\n'),
    port: port.join('\n'),
    layout: { input: recordLayout('IN-REC', inSpecs), output: recordLayout('OUT-REC', outSpecs) },
    links,
    entryLines: entries.map((_, i) => entryLine(i)),
  };
}

// Feature: graphical-proof, Property 10: Field map is complete for consistent sources
describe('linkFields completeness (Property 10)', () => {
  it('links every non-FILLER record field and every PICS entry, with offsets and lines', () => {
    fc.assert(
      fc.property(shapes, (shape) => {
        const { cobol, port, layout, links, entryLines } = build(shape);
        const actual = linkFields(cobol, port, layout, 'generated.ts');
        const cobolLines = cobol.split('\n');
        const portLines = port.split('\n');

        expect(actual.map((l) => l.name).sort()).toEqual(links.map((l) => l.name).sort());
        for (const want of links) {
          const got = actual.find((l) => l.name === want.name)!;
          expect(got.section).toBe(want.section);
          expect(got.cobolLine).toBe(want.cobolLine);
          expect(cobolLines[got.cobolLine - 1]).toContain(want.name);
          expect(got.portLines[0]).toBe(want.primary);
          expect(portLines[want.primary - 1]!.trim().replace(/[;,]$/, '')).toContain(got.portCode.replace(/^const \w+ = /, ''));
          if (want.entryLine !== null) expect(got.portLines).toContain(want.entryLine);
          expect(got.offset).toBe(want.offset);
          expect(got.length).toBe(want.length);
        }
        // Every PICS entry is the primary or a referenced line of some link.
        for (const line of entryLines) expect(actual.some((l) => l.portLines.includes(line))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: graphical-proof, Property 11: Field map catches every broken mapping
describe('linkFields perturbations (Property 11)', () => {
  type Perturbation =
    | { readonly kind: 'shift-slice'; readonly pick: number; readonly by: number }
    | { readonly kind: 'change-pic'; readonly pick: number; readonly part: 'int' | 'scale' | 'sign'; readonly inline: boolean }
    | { readonly kind: 'rename-fd'; readonly pick: number }
    | { readonly kind: 'remove-element'; readonly pick: number }
    | { readonly kind: 'extra-element'; readonly pick: number }
    | { readonly kind: 'wrong-comment-name'; readonly pick: number };

  const pick = fc.nat({ max: 15 });
  const perturbation: fc.Arbitrary<Perturbation> = fc.oneof(
    fc.record({ kind: fc.constant('shift-slice' as const), pick, by: fc.constantFrom(-2, -1, 1, 2) }),
    fc.record({ kind: fc.constant('change-pic' as const), pick, part: fc.constantFrom('int' as const, 'scale' as const, 'sign' as const), inline: fc.boolean() }),
    fc.record({ kind: fc.constant('rename-fd' as const), pick }),
    fc.record({ kind: fc.constant('remove-element' as const), pick }),
    fc.record({ kind: fc.constant('extra-element' as const), pick }),
    fc.record({ kind: fc.constant('wrong-comment-name' as const), pick }),
  );

  const EXTRA = "'EXTRA'.padEnd(5)";

  /**
   * Applies one perturbation to a consistent triple. Returns the broken sources
   * and the name a problem must mention, or null when the shape has nothing to perturb.
   */
  function perturb(g: ReturnType<typeof build>, p: Perturbation): { cobol: string; port: string; named: string } | null {
    const cobol = g.cobol.split('\n');
    const port = g.port.split('\n');
    const choose = <T,>(xs: readonly T[]): T | null => (xs.length === 0 ? null : xs[p.pick % xs.length]!);
    const done = (named: string) => ({ cobol: cobol.join('\n'), port: port.join('\n'), named });
    const outputs = g.links.filter((l) => l.section === 'output');

    switch (p.kind) {
      case 'shift-slice': {
        const f = choose(g.links.filter((l) => l.section === 'input'));
        if (f === null) return null;
        const start = f.offset!;
        const end = start + f.length!;
        const by = start + p.by < 0 ? -p.by : p.by;
        port[f.primary - 1] = port[f.primary - 1]!.replace(
          `record.slice(${start}, ${end})`,
          `record.slice(${start + by}, ${end + by})`,
        );
        return done(f.name);
      }
      case 'change-pic': {
        // A PICS entry, or an inline pic(...) in a returned element.
        const inline = (l: Expected) => l.section === 'output' && /\bpic\(/.test(port[l.primary - 1]!);
        const f = choose(g.links.filter((l) => l.entryLine !== null || inline(l)));
        if (f === null) return null;
        const line = (inline(f) && (f.entryLine === null || p.inline) ? f.primary : f.entryLine!) - 1;
        port[line] = port[line]!.replace(/pic\((\d+), (\d+), (true|false)\)/, (_, i: string, s: string, signed: string) =>
          p.part === 'int'
            ? `pic(${Number(i) + 1}, ${s}, ${signed})`
            : p.part === 'scale'
              ? `pic(${i}, ${Number(s) + 1}, ${signed})`
              : `pic(${i}, ${s}, ${signed === 'true' ? 'false' : 'true'})`,
        );
        return done(f.name);
      }
      case 'rename-fd': {
        // Bases are letters only, so a trailing digit never collides with another item.
        const f = choose(g.links.filter((l) => l.section !== 'working'));
        if (f === null) return null;
        cobol[f.cobolLine - 1] = cobol[f.cobolLine - 1]!.replace(`  ${f.name}  `, `  ${f.name}9  `);
        return done(f.name);
      }
      case 'remove-element': {
        const f = choose(outputs);
        if (f === null) return null;
        port.splice(f.primary - 1, 1);
        return done(f.name);
      }
      case 'extra-element': {
        // Before any output element, or after the last one.
        const at = choose([...outputs.map((l) => l.primary), outputs[outputs.length - 1]!.primary + 1]);
        if (at === null) return null;
        port.splice(at - 1, 0, `    ${EXTRA},`);
        return done(EXTRA);
      }
      case 'wrong-comment-name': {
        const f = choose(g.links.filter((l) => l.entryLine !== null && port[l.entryLine - 1]!.endsWith(`: ${l.name}`)));
        if (f === null) return null;
        const line = f.entryLine! - 1;
        port[line] = `${port[line]!}9`;
        return done(`${f.name}9`);
      }
    }
  }

  const mentions = (name: string) =>
    new RegExp(`(?<![A-Z0-9-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Z0-9-])`);

  it('names the field whose element is missing mid-array, not the one the shift lands on', () => {
    const field = (pic: Pic): RecordGen => ({ pic, entry: 'none', ref: false, filler: null, bare: false });
    const g = build({
      input: [field({ kind: 'x', n: 1, short: true })],
      output: [field({ kind: 'x', n: 1, short: true }), field({ kind: '9', i: 1, s: 0, signed: false, short: true })],
      ws: [],
      bases: ['A', 'B', 'C'],
    });
    const broken = perturb(g, { kind: 'remove-element', pick: 0 })!;
    expect(broken.named).toBe('OUT-B');
    expect(() => linkFields(broken.cobol, broken.port, g.layout)).toThrow(mentions('OUT-B'));
  });

  it('throws FieldLinkError naming the perturbed field for any single broken mapping', () => {
    fc.assert(
      fc.property(shapes, perturbation, (shape, p) => {
        const g = build(shape);
        const broken = perturb(g, p);
        fc.pre(broken !== null);
        let error: unknown;
        try {
          linkFields(broken!.cobol, broken!.port, g.layout, 'generated.ts');
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(FieldLinkError);
        expect((error as FieldLinkError).problems).toContainEqual(expect.stringMatching(mentions(broken!.named)));
      }),
      { numRuns: 300 },
    );
  });
});
