import { parseSync, type ESTree } from 'vite';
import type { DiffHunk, DiffLine, HighlightedToken, MutantInfo } from '../src/features/program/types.ts';

/**
 * Build step for the sabotage panel (Requirement 4): reads each mutant's metadata
 * from `src/ports/<prog>.mutants.ts` and diffs its port function against the real
 * `processRecord`. Everything is read from the syntax tree; no port code runs, at
 * build time or in the browser.
 *
 * The mutants module must keep this shape (anything else fails the build):
 *
 *   function someMutant(record: string): string { ...copy of processRecord... }
 *   export const MUTANTS: readonly Mutant[] = [
 *     { id: '...', title: '...', rule: '...', explanation: '...' + '...', equivalent?: '...', port: someMutant },
 *   ];
 */

export const REAL_FUNCTION = 'processRecord';
export const MUTANT_MARKER = '// MUTANT:';
/** Unchanged lines shown around each change. */
export const CONTEXT_LINES = 3;

/** Text-only fields, read as string literals (or literals joined with `+`). */
const TEXT_FIELDS = ['id', 'title', 'explanation', 'rule', 'equivalent'] as const;
type TextField = (typeof TEXT_FIELDS)[number];

export interface MutantDeclaration {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
  readonly rule: string;
  readonly equivalent?: string;
  /** Name of the top-level function given as `port`. */
  readonly functionName: string;
}

/** A top-level function: where it starts, where its name ends, where it ends. */
interface FunctionSpan {
  readonly start: number;
  readonly nameEnd: number;
  readonly end: number;
}

function parse(source: string, filePath: string): ESTree.Program {
  const result = parseSync(filePath, source, { lang: 'ts' });
  if (result.errors.length > 0) {
    throw new Error(`${filePath}: could not parse: ${result.errors.map((e) => e.message).join('; ')}`);
  }
  return result.program;
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** A string literal, a template without substitutions, or `+` of those. */
function staticString(node: ESTree.Expression): string | null {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticString(node.left);
    const right = staticString(node.right);
    return left === null || right === null ? null : left + right;
  }
  if (node.type === 'ParenthesizedExpression') return staticString(node.expression);
  return null;
}

function unwrap(node: ESTree.Expression): ESTree.Expression {
  let current = node;
  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'ParenthesizedExpression'
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(property: ESTree.ObjectProperty): string | null {
  if (property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  return null;
}

/** Reads the `MUTANTS` array literal from a mutants module. */
export function extractMutants(source: string, filePath: string): MutantDeclaration[] {
  const program = parse(source, filePath);
  let array: ESTree.ArrayExpression | undefined;
  for (const statement of program.body) {
    if (statement.type !== 'ExportNamedDeclaration' || statement.declaration?.type !== 'VariableDeclaration') continue;
    for (const declarator of statement.declaration.declarations) {
      if (declarator.id.type !== 'Identifier' || declarator.id.name !== 'MUTANTS' || !declarator.init) continue;
      const init = unwrap(declarator.init);
      if (init.type !== 'ArrayExpression') throw new Error(`${filePath}: MUTANTS must be an array literal`);
      array = init;
    }
  }
  if (!array) throw new Error(`${filePath}: no \`export const MUTANTS = [...]\` found`);

  const ids = new Set<string>();
  return array.elements.map((element, index) => {
    const where = `${filePath}: MUTANTS[${index}]`;
    if (!element || element.type !== 'ObjectExpression') throw new Error(`${where} must be an object literal`);
    const text: Partial<Record<TextField, string>> = {};
    let functionName: string | undefined;
    for (const property of element.properties) {
      if (property.type !== 'Property') throw new Error(`${where}: spread properties are not supported`);
      const name = propertyName(property);
      if (name === 'port') {
        if (property.value.type !== 'Identifier') throw new Error(`${where}: port must name a top-level function`);
        functionName = property.value.name;
      } else if (name !== null && (TEXT_FIELDS as readonly string[]).includes(name)) {
        const value = staticString(property.value as ESTree.Expression);
        if (value === null) throw new Error(`${where}: ${name} must be a plain string`);
        text[name as TextField] = value;
      } else {
        throw new Error(`${where}: unexpected property ${name ?? '(computed)'}`);
      }
    }
    const { id, title, explanation, rule, equivalent } = text;
    if (!id || !title || !explanation || !rule || !functionName) {
      throw new Error(`${where}: id, title, explanation, rule and port are all required`);
    }
    if (ids.has(id)) throw new Error(`${where}: duplicate id ${id}`);
    ids.add(id);
    return { id, title, explanation, rule, ...(equivalent === undefined ? {} : { equivalent }), functionName };
  });
}

/** Finds a top-level `function name` or `export function name` declaration. */
export function findFunction(source: string, name: string, filePath: string): FunctionSpan {
  for (const statement of parse(source, filePath).body) {
    const fn =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : (statement as ESTree.Statement);
    if (fn?.type !== 'FunctionDeclaration' || fn.id?.name !== name) continue;
    // Offsets must index the JS string (UTF-16). Guard against a parser change.
    if (source.slice(fn.id.start, fn.id.end) !== name) throw new Error(`${filePath}: unexpected parser offsets`);
    return { start: statement.start, nameEnd: fn.id.end, end: fn.end };
  }
  throw new Error(`${filePath}: no top-level function ${name}`);
}

type Op = { kind: 'same'; a: number; b: number } | { kind: 'removed'; a: number } | { kind: 'added'; b: number };

/** Line diff by longest common subsequence. Removals come before additions in each change. */
export function diffLines(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // lcs[i][j]: LCS length of a[i..] and b[j..]. Port functions are ~60 lines, so O(n*m) is fine.
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push({ kind: 'same', a: i++, b: j++ });
    else if (i < n && (j === m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) ops.push({ kind: 'removed', a: i++ });
    else ops.push({ kind: 'added', b: j++ });
  }
  return ops;
}

/** Groups changes with up to `context` unchanged lines either side; close groups merge. */
function toHunks(ops: readonly Op[], context: number): Op[][] {
  const changed = ops.flatMap((op, index) => (op.kind === 'same' ? [] : [index]));
  const hunks: Op[][] = [];
  let from = -1;
  let to = -1;
  for (const index of changed) {
    if (from >= 0 && index - context <= to + 1) {
      to = Math.min(ops.length - 1, index + context);
      continue;
    }
    if (from >= 0) hunks.push(ops.slice(from, to + 1));
    from = Math.max(0, index - context);
    to = Math.min(ops.length - 1, index + context);
  }
  if (from >= 0) hunks.push(ops.slice(from, to + 1));
  return hunks;
}

/** Turns code into highlighted lines. Must not add, drop or change text. */
export type LineHighlighter = (code: string) => readonly (readonly HighlightedToken[])[];

export interface MutantSources {
  readonly portPath: string;
  readonly portSource: string;
  readonly mutantsPath: string;
  readonly mutantsSource: string;
}

/**
 * Metadata and diff for every mutant of one program. Throws (failing the build) when a
 * mutant function has no `// MUTANT:` marker or is identical to the real port.
 *
 * The mutant's own function name differs by design, so both sides are compared from
 * just after the function name, and the first line shows the real port's header.
 */
export function buildMutants(sources: MutantSources, highlight: LineHighlighter): MutantInfo[] {
  const { portPath, portSource, mutantsPath, mutantsSource } = sources;
  const real = findFunction(portSource, REAL_FUNCTION, portPath);
  const header = portSource.slice(real.start, real.nameEnd);
  const realText = header + portSource.slice(real.nameEnd, real.end);
  const realLines = realText.split('\n');
  const realTokens = highlight(realText);
  const realFirstLine = lineAt(portSource, real.start);

  return extractMutants(mutantsSource, mutantsPath).map(({ functionName, ...meta }) => {
    const where = `${mutantsPath}: mutant ${meta.id} (${functionName})`;
    const fn = findFunction(mutantsSource, functionName, mutantsPath);
    const body = mutantsSource.slice(fn.nameEnd, fn.end);
    if (!body.includes(MUTANT_MARKER)) throw new Error(`${where} has no ${MUTANT_MARKER} marker on its changed line`);
    const mutantText = header + body;
    const mutantLines = mutantText.split('\n');
    const ops = diffLines(realLines, mutantLines);
    if (ops.every((op) => op.kind === 'same')) throw new Error(`${where} is identical to ${REAL_FUNCTION}: empty diff`);

    const mutantTokens = highlight(mutantText);
    const mutantFirstLine = lineAt(mutantsSource, fn.start);
    const tokensOf = (lines: typeof realTokens, index: number) => lines[index] ?? [];
    const hunks: DiffHunk[] = toHunks(ops, CONTEXT_LINES).map((group) => ({
      lines: group.map((op): DiffLine => {
        switch (op.kind) {
          case 'same':
            return { kind: 'context', real: realFirstLine + op.a, mutant: mutantFirstLine + op.b, tokens: tokensOf(realTokens, op.a) };
          case 'removed':
            return { kind: 'removed', real: realFirstLine + op.a, tokens: tokensOf(realTokens, op.a) };
          case 'added':
            return { kind: 'added', mutant: mutantFirstLine + op.b, tokens: tokensOf(mutantTokens, op.b) };
        }
      }),
    }));
    return { ...meta, path: mutantsPath, hunks };
  });
}
