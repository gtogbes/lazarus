// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { PROGRAM_META } from '../../src/ports/programs.meta';
import {
  DIFF_ADDED_BACKGROUND,
  DIFF_REMOVED_BACKGROUND,
  GUTTER_COLOR,
  HIGHLIGHT_BACKGROUND,
} from '../src/features/program/theme';
import { programFiles, programSourcesPlugin, readProgramSource } from './programSources';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(PROGRAM_META.map((p) => p.id))('%s program source', (id) => {
  it('highlights both files without losing or changing any text (2.1)', async () => {
    const files = programFiles(id);
    const source = await readProgramSource(REPO_ROOT, files);
    for (const [file, sourcePath] of [
      [source.cobol, files.cobolPath],
      [source.port, files.portPath],
    ] as const) {
      const original = (await readFile(path.join(REPO_ROOT, sourcePath), 'utf8')).replace(/\n$/, '');
      expect(file.path).toBe(sourcePath);
      expect(file.lines.map((line) => line.map(([text]) => text).join('')).join('\n')).toBe(original);
      // Colours are distinct per token kind: highlighting actually happened.
      expect(new Set(file.lines.flat().map(([, color]) => color)).size).toBeGreaterThan(2);
    }
    expect(source.links.length).toBeGreaterThan(0);
  });

  it('diffs every mutant against the real port, with the marked line added (4.3)', async () => {
    const source = await readProgramSource(REPO_ROOT, programFiles(id));
    expect(source.mutants.length).toBeGreaterThan(0);
    for (const mutant of source.mutants) {
      const lines = mutant.hunks.flatMap((h) => h.lines);
      const text = (kind: string) =>
        lines.filter((l) => l.kind === kind).map((l) => l.tokens.map(([t]) => t).join(''));
      expect(text('removed').length + text('added').length, mutant.id).toBeGreaterThan(0);
      expect(text('added').some((line) => line.includes('// MUTANT:')), mutant.id).toBe(true);
      expect(text('removed').some((line) => line.includes('// MUTANT:')), mutant.id).toBe(false);
    }
  });

  it('keeps every token at 4.5:1 contrast or better, highlighted or not', async () => {
    const source = await readProgramSource(REPO_ROOT, programFiles(id));
    const colors = new Set([GUTTER_COLOR, ...[source.cobol, source.port].flatMap((f) => f.lines.flat().map(([, c]) => c))]);
    for (const color of colors) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(color, source.background), color).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color, HIGHLIGHT_BACKGROUND), color).toBeGreaterThanOrEqual(4.5);
    }
    // Mutant diffs: every token, the gutter and the default text on the plain, removed and added lines.
    const diffColors = new Set([
      GUTTER_COLOR,
      source.foreground,
      ...source.mutants.flatMap((m) => m.hunks.flatMap((h) => h.lines.flatMap((l) => l.tokens.map(([, c]) => c)))),
    ]);
    for (const color of diffColors) {
      for (const background of [source.background, DIFF_REMOVED_BACKGROUND, DIFF_ADDED_BACKGROUND]) {
        expect(contrast(color, background), `${color} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('programSourcesPlugin', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  /** A throwaway repo with one DEMO program, built by Vite with only this plugin. */
  const DEMO_MUTANTS = (marker: string) => `function plusTwo(record: string): string {
  return record + 'b';${marker}
}

export const MUTANTS = [
  { id: 'plus-two', title: 'Append b', rule: 'COMPUTE WS-A = WS-B + 1', explanation: 'Wrong.', port: plusTwo },
];
`;
  const DEMO_PORT = "// COMPUTE WS-A = WS-B + 1\nexport function processRecord(record: string): string {\n  return record + 'a';\n}\n";

  async function buildDemo(portSource: string, mutantsSource = DEMO_MUTANTS(' // MUTANT: a became b')) {
    const root = await mkdtemp(path.join(tmpdir(), 'lazarus-sources-'));
    dirs.push(root);
    await mkdir(path.join(root, 'cobol/programs'), { recursive: true });
    await mkdir(path.join(root, 'src/ports'), { recursive: true });
    await writeFile(
      path.join(root, 'cobol/programs/DEMO.cbl'),
      '       PROCEDURE DIVISION.\n           COMPUTE WS-A = WS-B + 1\n           STOP RUN.\n',
    );
    await writeFile(path.join(root, 'src/ports/demo.ts'), portSource);
    await writeFile(path.join(root, 'src/ports/demo.mutants.ts'), mutantsSource);
    await writeFile(
      path.join(root, 'main.js'),
      "import { loaders } from 'virtual:lazarus/program-sources';\nexport const load = () => loaders.DEMO();\n",
    );
    return build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [programSourcesPlugin({ repoRoot: root, programIds: ['DEMO'] })],
      build: { write: false, lib: { entry: path.join(root, 'main.js'), formats: ['es'] } },
    });
  }

  it('emits each program as its own lazily imported chunk with its links', async () => {
    const output = (await buildDemo(DEMO_PORT)) as Rollup.RollupOutput[];
    const chunks = output.flatMap((o) => o.output).filter((c): c is Rollup.OutputChunk => c.type === 'chunk');
    const entry = chunks.find((c) => c.isEntry);
    const demo = chunks.find((c) => !c.isEntry);
    expect(chunks).toHaveLength(2);
    expect(entry?.code).toContain(`import("./${demo?.fileName ?? ''}")`);
    expect(entry?.code).not.toContain('links');
    // Unminified library output: an object literal holding the link and the highlighted lines.
    expect(demo?.code).toMatch(/quote: "COMPUTE WS-A = WS-B \+ 1",\s*port: \{\s*start: 1,\s*end: 4\s*\},\s*cobol: \{\s*start: 2,\s*end: 2\s*\}/);
    expect(demo?.code).toContain('"PROCEDURE DIVISION"');
    // The mutant's metadata and diff are plain data in the same lazy chunk, not in the entry.
    expect(demo?.code).toContain('title: "Append b"');
    expect(demo?.code).toMatch(/kind: "added",\s*mutant: 2,/);
    expect(entry?.code).not.toContain('Append b');
  });

  it('fails the build when a port quotes COBOL that does not exist', async () => {
    const result = buildDemo(DEMO_PORT.replace('+ 1', '+ 2'));
    await expect(result).rejects.toThrow(/line 1 "COMPUTE WS-A = WS-B \+ 2": no COBOL statement matches/);
  });

  it('fails the build when a mutant has no // MUTANT: marker', async () => {
    await expect(buildDemo(DEMO_PORT, DEMO_MUTANTS(''))).rejects.toThrow(
      /src\/ports\/demo\.mutants\.ts: mutant plus-two \(plusTwo\) has no \/\/ MUTANT: marker/,
    );
  });
});
