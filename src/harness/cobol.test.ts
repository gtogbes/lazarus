import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CobolSession, CompileError, compileCobol } from './cobol.js';

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

describe('CobolSession native runner', () => {
  // Shell scripts stand in for compiled binaries: same one-line-per-record contract.
  function writeBinary(name: string, script: string): void {
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'bin', name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  }
  const ECHO = 'while IFS= read -r line; do printf "%s!\\n" "$line"; done';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs <binDir>/<program> directly and returns one line per record', async () => {
    writeBinary('ECHO', ECHO);
    const session = CobolSession.start('ECHO', { runner: 'native', binDir: join(dir, 'bin') });
    expect(await session.send(['A 1', 'B 2'])).toEqual(['A 1!', 'B 2!']);
    expect(await session.send(['C'])).toEqual(['C!']);
    expect(await session.close()).toBe(0);
  });

  it('defaults binDir to LAZARUS_BIN_DIR', async () => {
    writeBinary('ECHO', ECHO);
    vi.stubEnv('LAZARUS_BIN_DIR', join(dir, 'bin'));
    const session = CobolSession.start('ECHO', { runner: 'native' });
    expect(await session.send(['X'])).toEqual(['X!']);
    expect(await session.close()).toBe(0);
  });

  it('rejects pending sends when the program exits early', async () => {
    writeBinary('CRASH', 'read -r line; echo "boom" >&2; exit 3');
    const session = CobolSession.start('CRASH', { runner: 'native', binDir: join(dir, 'bin') });
    await expect(session.send(['A'])).rejects.toThrow(/exited with code 3[\s\S]*boom/);
    expect(await session.close()).toBe(3);
  });

  it('fails fast on a missing binary or an unsafe program name', () => {
    expect(() => CobolSession.start('NOPE', { runner: 'native', binDir: join(dir, 'bin') })).toThrow(
      /binary not found/,
    );
    expect(() => CobolSession.start('../ETC', { runner: 'native', binDir: dir })).toThrow(RangeError);
  });
});
