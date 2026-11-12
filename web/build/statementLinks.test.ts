// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROGRAM_META } from '../../src/ports/programs.meta';
import { linkStatements, StatementLinkError } from './statementLinks';

const COBOL = [
  '      * Comment lines are ignored: COMPUTE X = 1',
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. DEMO.',
  '       DATA DIVISION.',
  '       01  WS-A  PIC 9.',
  '       PROCEDURE DIVISION.',
  '       MAIN-PARA.',
  '           MOVE ZERO TO WS-A',
  '           COMPUTE WS-A ROUNDED =',
  '               WS-B * 2',
  '           EVALUATE TRUE',
  '               WHEN WS-A > 1',
  '                   MOVE 1 TO WS-C',
  '           END-EVALUATE',
  '           MOVE 1 TO WS-C',
  '           STOP RUN.',
].join('\n');

const repoFile = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('linkStatements', () => {
  it('pairs a quote with its COBOL statement across lines, ignoring whitespace and case', () => {
    const port = ['function f() {', '  // COMPUTE ws-a   ROUNDED = ws-b * 2', '  const a = 2n;', '', '  return a;', '}'].join('\n');
    expect(linkStatements(COBOL, port)).toEqual([
      { quote: 'COMPUTE ws-a ROUNDED = ws-b * 2', port: { start: 2, end: 3 }, cobol: { start: 9, end: 10 } },
    ]);
  });

  it('continues a quote on following comment lines and spans "..." ranges', () => {
    const port = [
      '  // MOVE ZERO TO WS-A, COMPUTE WS-A ROUNDED =',
      '  //     WS-B * 2',
      '  const a = 1n;',
      '  // EVALUATE TRUE ... END-EVALUATE (the bands)',
      '  if (a > 1n) {',
      '    c = 1n;',
      '  }',
    ].join('\n');
    const links = linkStatements(COBOL, port);
    expect(links.map((l) => [l.port, l.cobol])).toEqual([
      [{ start: 1, end: 3 }, { start: 8, end: 10 }],
      [{ start: 4, end: 7 }, { start: 11, end: 14 }],
    ]);
  });

  it('links to the first match, and ends a port statement at a closing brace', () => {
    const port = ['if (x) {', '  // MOVE 1 TO WS-C', '  c = 1n;', '}', 'done();'].join('\n');
    expect(linkStatements(COBOL, port)).toEqual([
      { quote: 'MOVE 1 TO WS-C', port: { start: 2, end: 3 }, cobol: { start: 13, end: 13 } },
    ]);
  });

  it('ignores prose comments that do not start with a COBOL verb', () => {
    const port = ['// Round half away from zero.', 'const x = 1;', '// 9(2)V99', 'const y = 2;'].join('\n');
    expect(linkStatements(COBOL, port)).toEqual([]);
  });

  it('fails loudly, listing every quote that matches nothing', () => {
    const port = [
      '// COMPUTE WS-A = WS-B * 3',
      'a = 3n;',
      '// MOVE ZERO TO WS-A',
      'a = 0n;',
      '// EVALUATE TRUE ... END-PERFORM',
      'x();',
      '// MOVE 1 TO WS-C',
    ].join('\n');
    let error: unknown;
    try {
      linkStatements(COBOL, port, 'src/ports/demo.ts');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(StatementLinkError);
    const { problems, message } = error as StatementLinkError;
    expect(message).toContain('src/ports/demo.ts');
    expect(problems).toEqual([
      'line 1 "COMPUTE WS-A = WS-B * 3": no COBOL statement matches "COMPUTE WS-A = WS-B * 3"',
      'line 5 "EVALUATE TRUE ... END-PERFORM": no COBOL statement matches "END-PERFORM" after the previous segment',
      'line 7 "MOVE 1 TO WS-C": the comment is not followed by any code',
    ]);
  });

  it('does not match a longer data name or text in COBOL comment lines', () => {
    expect(() => linkStatements(COBOL, '// MOVE ZERO TO WS\nx();')).toThrow(StatementLinkError);
    expect(() => linkStatements(COBOL, '// COMPUTE X = 1\nx();')).toThrow(StatementLinkError);
  });

  it('rejects a COBOL source without a PROCEDURE DIVISION', () => {
    expect(() => linkStatements('       IDENTIFICATION DIVISION.', '')).toThrow(/no PROCEDURE DIVISION/);
  });

  it.each(PROGRAM_META.map((p) => p.id))('links every COBOL quote in the %s port', (id) => {
    const cobol = repoFile(`cobol/programs/${id}.cbl`);
    const port = repoFile(`src/ports/${id.toLowerCase()}.ts`);
    const links = linkStatements(cobol, port);
    const quoteLines = port.split('\n').filter((line) => /^\s*\/\/ (COMPUTE|MOVE|IF|EVALUATE)\b/.test(line));
    expect(links).toHaveLength(quoteLines.length);
    const cobolLines = cobol.split('\n');
    for (const link of links) {
      // The first quoted word is on the first linked COBOL line.
      const verb = link.quote.split(' ')[0] ?? '';
      expect(cobolLines[link.cobol.start - 1]).toContain(verb);
      expect(link.port.end).toBeGreaterThan(link.port.start);
    }
  });
});
