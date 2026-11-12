import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const GNUCOBOL_IMAGE = 'lazarus-gnucobol:3.1.2';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const COBOL_DIR = join(REPO_ROOT, 'cobol');
const PROGRAM_NAME = /^[A-Z][A-Z0-9-]{0,29}$/;

export class CompileError extends Error {
  constructor(
    readonly program: string,
    readonly compilerOutput: string,
  ) {
    super(`GnuCOBOL failed to compile ${program}:\n${compilerOutput}`);
    this.name = 'CompileError';
  }
}

function assertProgramName(program: string): void {
  // The name is interpolated into container paths, so restrict it.
  if (!PROGRAM_NAME.test(program)) throw new RangeError(`Invalid program name: ${program}`);
}

function assertImage(): void {
  const result = spawnSync('docker', ['image', 'inspect', GNUCOBOL_IMAGE], { stdio: 'ignore' });
  if (result.error) throw new Error(`Docker is not available: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Docker image ${GNUCOBOL_IMAGE} not found. Run: npm run cobol:image`);
  }
}

function dockerArgs(cobolDir: string, ...command: string[]): string[] {
  return ['run', '--rm', '-i', '--network', 'none', '-v', `${cobolDir}:/work`, GNUCOBOL_IMAGE, ...command];
}

/**
 * Compile `<cobolDir>/programs/<program>.cbl` to `<cobolDir>/bin/<program>`.
 * Skips compilation when the source hash matches the last successful build.
 * `cobolDir` defaults to the repo's `cobol/` folder; tests pass a temp folder.
 */
export function compileCobol(program: string, cobolDir: string = COBOL_DIR): 'compiled' | 'cached' {
  assertProgramName(program);
  const source = join(cobolDir, 'programs', `${program}.cbl`);
  if (!existsSync(source)) throw new Error(`COBOL source not found: ${source}`);

  const hash = createHash('sha256').update(readFileSync(source)).digest('hex');
  const binary = join(cobolDir, 'bin', program);
  const hashFile = `${binary}.sha256`;
  if (existsSync(binary) && existsSync(hashFile) && readFileSync(hashFile, 'utf8') === hash) return 'cached';

  assertImage();
  mkdirSync(join(cobolDir, 'bin'), { recursive: true });
  const result = spawnSync(
    'docker',
    dockerArgs(cobolDir, 'cobc', '-x', '-o', `bin/${program}`, `programs/${program}.cbl`),
    { encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new CompileError(program, `${result.stdout}${result.stderr}`);
  writeFileSync(hashFile, hash);
  return 'compiled';
}

/** Where the GnuCOBOL binary runs: in the reference container, or directly on this host. */
export type CobolRunner = 'docker' | 'native';

/** Binary folder for the native runner in the Lambda image (ADR 0001). */
export const DEFAULT_NATIVE_BIN_DIR = '/opt/lazarus/bin';

export interface CobolSessionOptions {
  /** `docker` (default): compile if needed and run in `lazarus-gnucobol`. `native`: run a prebuilt binary. */
  readonly runner?: CobolRunner;
  /** Native runner only. Defaults to `LAZARUS_BIN_DIR`, then `/opt/lazarus/bin`. */
  readonly binDir?: string;
}

/**
 * A long-lived process running one compiled COBOL program, either in the
 * reference container or natively (inside an image with the same GnuCOBOL build).
 * The program must write exactly one output line per input record.
 */
export class CobolSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting: Array<{ resolve: (line: string) => void; reject: (err: Error) => void }> = [];
  private readonly buffered: string[] = [];
  private stderr = '';
  private exited: Error | undefined;
  private readonly exitPromise: Promise<number | null>;

  private constructor(
    readonly program: string,
    command: string,
    args: readonly string[],
  ) {
    this.child = spawn(command, args);
    this.child.stderr.setEncoding('utf8').on('data', (chunk: string) => (this.stderr += chunk));
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      const next = this.waiting.shift();
      if (next) next.resolve(line);
      else this.buffered.push(line);
    });
    this.exitPromise = new Promise((resolveExit) => {
      this.child.on('exit', (code) => {
        this.exited = new Error(`${program} exited with code ${code}. stderr:\n${this.stderr}`);
        for (const w of this.waiting.splice(0)) w.reject(this.exited);
        resolveExit(code);
      });
      this.child.on('error', (err) => {
        this.exited = err;
        for (const w of this.waiting.splice(0)) w.reject(err);
        resolveExit(null);
      });
    });
  }

  /**
   * Start a session. The docker runner compiles if needed; the native runner
   * expects `<binDir>/<program>` to exist already (the Lambda image is read-only).
   */
  static start(program: string, options: CobolSessionOptions = {}): CobolSession {
    // stdbuf -oL makes GnuCOBOL flush after every record instead of at exit.
    if (options.runner === 'native') {
      assertProgramName(program);
      const binary = join(options.binDir ?? process.env.LAZARUS_BIN_DIR ?? DEFAULT_NATIVE_BIN_DIR, program);
      if (!existsSync(binary)) throw new Error(`COBOL binary not found: ${binary}`);
      return new CobolSession(program, 'stdbuf', ['-oL', binary]);
    }
    compileCobol(program);
    return new CobolSession(program, 'docker', dockerArgs(COBOL_DIR, 'stdbuf', '-oL', `bin/${program}`));
  }

  private nextLine(): Promise<string> {
    const line = this.buffered.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.exited) return Promise.reject(this.exited);
    return new Promise((resolveLine, reject) => this.waiting.push({ resolve: resolveLine, reject }));
  }

  /** Send records and resolve with one output line per record. */
  async send(records: readonly string[]): Promise<string[]> {
    for (const record of records) {
      if (record.includes('\n')) throw new RangeError('Records must not contain newlines');
    }
    if (this.exited) throw this.exited;
    this.child.stdin.write(records.map((r) => `${r}\n`).join(''));
    const out: string[] = [];
    for (let i = 0; i < records.length; i++) out.push(await this.nextLine());
    return out;
  }

  /** Close stdin and resolve with the program's exit code. */
  async close(): Promise<number | null> {
    this.child.stdin.end();
    return this.exitPromise;
  }
}
