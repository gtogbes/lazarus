import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CompileError, compileCobol } from './cobol.js';

const HELLO = [
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. HELLO.',
  '       PROCEDURE DIVISION.',
  '           DISPLAY "HELLO".',
  '           STOP RUN.',
  '',
].join('\n');

let dir: string;

function writeProgram(name: string, source: string): void {
  writeFileSync(join(dir, 'programs', `${name}.cbl`), source);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazarus-cobol-'));
  mkdirSync(join(dir, 'programs'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('compileCobol', () => {
  it('compiles once, then reuses the binary while the source is unchanged', () => {
    writeProgram('HELLO', HELLO);
    expect(compileCobol('HELLO', dir)).toBe('compiled');
    expect(compileCobol('HELLO', dir)).toBe('cached');
  });

  it('recompiles when the source changes', () => {
    writeProgram('HELLO', HELLO);
    compileCobol('HELLO', dir);
    writeProgram('HELLO', HELLO.replace('"HELLO"', '"HELLO AGAIN"'));
    expect(compileCobol('HELLO', dir)).toBe('compiled');
  });

  it('reports compiler output for invalid COBOL', () => {
    writeProgram('BROKEN', HELLO.replace('HELLO.', 'BROKEN.').replace('STOP RUN.', 'STOPP RUN.'));
    let error: unknown;
    try {
      compileCobol('BROKEN', dir);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CompileError);
    expect((error as CompileError).compilerOutput).toMatch(/BROKEN\.cbl/);
  });

  it('rejects program names that could escape the container path', () => {
    expect(() => compileCobol('../ETC', dir)).toThrow(RangeError);
    expect(() => compileCobol('hello', dir)).toThrow(RangeError);
  });

  it('reports a missing source file', () => {
    expect(() => compileCobol('NOPE', dir)).toThrow(/not found/);
  });
});
