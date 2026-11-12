import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHighlighter, type BundledLanguage, type Highlighter } from 'shiki';
import type { Plugin } from 'vite';
import type { HighlightedFile, HighlightedToken, ProgramSource } from '../src/features/program/types.ts';
import { buildMutants } from './mutantDiffs.ts';
import { linkStatements } from './statementLinks.ts';

/**
 * Build step for the program view (Requirement 2): highlights each program's COBOL
 * and port with Shiki, links port statements to COBOL statements, and diffs each
 * mutant against the real port (Requirement 4, see ./mutantDiffs.ts). It runs inside
 * Vite (dev, build and Vitest), so the output is generated in memory and cannot go
 * stale. The browser receives plain token arrays, never the Shiki runtime or HTML.
 */

/** High-contrast theme: every token colour clears 4.5:1 on its background (checked in tests). */
export const THEME = 'github-dark-high-contrast';

export const INDEX_ID = 'virtual:lazarus/program-sources';
const PROGRAM_ID_PREFIX = 'virtual:lazarus/program-source/';

export interface ProgramFiles {
  readonly id: string;
  readonly cobolPath: string;
  readonly portPath: string;
  readonly mutantsPath: string;
}

/** Conventional locations, relative to the repository root. */
export function programFiles(id: string): ProgramFiles {
  const base = `src/ports/${id.toLowerCase()}`;
  return { id, cobolPath: `cobol/programs/${id}.cbl`, portPath: `${base}.ts`, mutantsPath: `${base}.mutants.ts` };
}

let highlighter: Promise<Highlighter> | undefined;
function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({ themes: [THEME], langs: ['cobol', 'typescript'] });
  return highlighter;
}

function highlight(hl: Highlighter, code: string, lang: BundledLanguage, filePath: string) {
  const result = hl.codeToTokens(code.replace(/\r?\n$/, ''), { lang, theme: THEME });
  const foreground = result.fg ?? '#ffffff';
  const lines = result.tokens.map((line) => {
    // Merge neighbours of the same colour to keep the shipped data small.
    const merged: [string, string][] = [];
    for (const token of line) {
      const color = (token.color ?? foreground).toLowerCase();
      const previous = merged.at(-1);
      if (previous && previous[1] === color) previous[0] += token.content;
      else merged.push([token.content, color]);
    }
    return merged as readonly HighlightedToken[];
  });
  const file: HighlightedFile = { path: filePath, lines };
  return { file, background: (result.bg ?? '#000000').toLowerCase(), foreground: foreground.toLowerCase() };
}

/**
 * Highlights, links and diffs one program from its source text. Throws on a broken
 * statement link or a mutant without a marker or without a change.
 */
export async function buildProgramSource(
  files: ProgramFiles,
  cobolSource: string,
  portSource: string,
  mutantsSource: string,
): Promise<ProgramSource> {
  const links = linkStatements(cobolSource, portSource, files.portPath);
  const hl = await getHighlighter();
  const mutants = buildMutants(
    { portPath: files.portPath, portSource, mutantsPath: files.mutantsPath, mutantsSource },
    (code) => highlight(hl, code, 'typescript', files.mutantsPath).file.lines,
  );
  const cobol = highlight(hl, cobolSource, 'cobol', files.cobolPath);
  const port = highlight(hl, portSource, 'typescript', files.portPath);
  return {
    id: files.id,
    background: port.background,
    foreground: port.foreground,
    cobol: cobol.file,
    port: port.file,
    links,
    mutants,
  };
}

export async function readProgramSource(repoRoot: string, files: ProgramFiles): Promise<ProgramSource> {
  const [cobolSource, portSource, mutantsSource] = await Promise.all(
    [files.cobolPath, files.portPath, files.mutantsPath].map((p) => readFile(path.join(repoRoot, p), 'utf8')),
  );
  return buildProgramSource(files, cobolSource!, portSource!, mutantsSource!);
}

export interface ProgramSourcesOptions {
  readonly repoRoot: string;
  readonly programIds: readonly string[];
}

/**
 * `virtual:lazarus/program-sources` exports `loaders`, one dynamic import per program,
 * so each program's highlighted source is its own chunk, fetched only on its route.
 */
export function programSourcesPlugin({ repoRoot, programIds }: ProgramSourcesOptions): Plugin {
  const programs = new Map(programIds.map((id) => [id, programFiles(id)]));
  const sourcePaths = new Map(
    [...programs.values()].flatMap((files) =>
      [files.cobolPath, files.portPath, files.mutantsPath].map((p) => [path.join(repoRoot, p), files.id] as const),
    ),
  );

  return {
    name: 'lazarus-program-sources',
    async buildStart() {
      // Fail fast on dev start, build and test, not only when a program route is opened.
      await Promise.all([...programs.values()].map((files) => readProgramSource(repoRoot, files)));
    },
    resolveId(id) {
      if (id === INDEX_ID) return `\0${id}`;
      if (id.startsWith(PROGRAM_ID_PREFIX) && programs.has(id.slice(PROGRAM_ID_PREFIX.length))) return `\0${id}`;
      return null;
    },
    async load(id) {
      if (id === `\0${INDEX_ID}`) {
        const entries = programIds.map(
          (programId) => `  ${JSON.stringify(programId)}: () => import(${JSON.stringify(PROGRAM_ID_PREFIX + programId)}),`,
        );
        return `export const loaders = {\n${entries.join('\n')}\n};\n`;
      }
      if (!id.startsWith(`\0${PROGRAM_ID_PREFIX}`)) return null;
      const files = programs.get(id.slice(PROGRAM_ID_PREFIX.length + 1));
      if (!files) return null;
      this.addWatchFile(path.join(repoRoot, files.cobolPath));
      this.addWatchFile(path.join(repoRoot, files.portPath));
      this.addWatchFile(path.join(repoRoot, files.mutantsPath));
      const source = await readProgramSource(repoRoot, files);
      return `export default ${JSON.stringify(source)};\n`;
    },
    configureServer(server) {
      server.watcher.add([...sourcePaths.keys()]);
      server.watcher.on('change', (file) => {
        const programId = sourcePaths.get(path.resolve(file));
        if (programId === undefined) return;
        const module = server.moduleGraph.getModuleById(`\0${PROGRAM_ID_PREFIX}${programId}`);
        if (module) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}
