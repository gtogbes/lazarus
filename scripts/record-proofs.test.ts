import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Port } from '../src/harness/equivalence.js';
import type { ProveOptions, ProveSession } from '../src/api/prove.js';
import { findProgram, PROGRAMS } from '../src/ports/registry.js';
import {
  checkRecording,
  expectedStatus,
  RECORDED_DIR,
  recordAll,
  recordingFileName,
  recordingTargets,
  RECORDING_SEED,
  type RecordingFile,
} from './record-proofs.js';
import { recordingV2Corruptions } from '../web/src/features/proof/fixtures/recordingV2Corruptions.js';

/**
 * Stands in for GnuCOBOL by answering with the real port of the program (or
 * `reference` when given), so the real port proves equivalent and every
 * non-equivalent mutant diverges, as they do against real COBOL.
 */
function fakeProve(reference?: (program: string) => Port | undefined): ProveOptions {
  return {
    reference: 'fake-gnucobol',
    startSession: (program): ProveSession => {
      const port = reference?.(program) ?? findProgram(program)?.port;
      if (!port) throw new Error(`no port for ${program}`);
      return { send: async (records) => records.map(port), close: async () => 0 };
    },
  };
}

let outDir: string;

beforeEach(async () => {
  vi.stubEnv('LAZARUS_RUNS', '');
  vi.stubEnv('LAZARUS_SEED', '');
  outDir = await mkdtemp(path.join(tmpdir(), 'lazarus-recorded-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(outDir, { recursive: true, force: true });
});

const readRecording = async (file: string): Promise<RecordingFile> =>
  JSON.parse(await readFile(path.join(outDir, file), 'utf8')) as RecordingFile;

describe('recordingTargets', () => {
  it('covers every program and every mutant (Requirement 6.3)', () => {
    expect(recordingTargets().map(recordingFileName)).toEqual([
      'INTCALC.json',
      'INTCALC.truncate-interest.json',
      'INTCALC.penalty-at-zero.json',
      'PAYROLL.json',
      'PAYROLL.half-up-tax.json',
      'PAYROLL.ignore-size-error.json',
      'PAYROLL.strict-band-edge.json',
      'INVOICE.json',
      'INVOICE.half-up-vat.json',
      'INVOICE.round-discount.json',
    ]);
  });
});

describe('recordAll with a fake GnuCOBOL session', () => {
  it('writes one recording per program and mutant, in the replay format, with the fixed seed', async () => {
    const report = await recordAll({ outDir, prove: fakeProve() });

    expect(report.failures).toEqual([]);
    const expectedFiles = recordingTargets().map(recordingFileName);
    expect(report.written).toEqual(expectedFiles);
    expect((await readdir(outDir)).sort()).toEqual([...expectedFiles].sort());

    const payroll = await readRecording('PAYROLL.json');
    expect(payroll.version).toBe(2);
    expect(payroll.events[0]).toEqual({
      type: 'started',
      program: 'PAYROLL',
      seed: RECORDING_SEED,
      reference: 'fake-gnucobol',
      numRuns: 2000,
    });
    expect(payroll.events.at(-2)).toMatchObject({ type: 'progress', divergences: 0 });
    expect(payroll.events.at(-1)).toMatchObject({
      type: 'result',
      result: { program: 'PAYROLL', status: 'equivalent', seed: RECORDING_SEED, reference: 'fake-gnucobol', cases: 2000 },
    });

    const mutant = await readRecording('PAYROLL.half-up-tax.json');
    expect(mutant.events[0]).toMatchObject({ type: 'started', mutant: 'half-up-tax' });
    expect(mutant.events.at(-1)).toMatchObject({ type: 'result', result: { status: 'diverged', counterexample: {} } });

    const equivalentMutant = await readRecording('PAYROLL.strict-band-edge.json');
    expect(equivalentMutant.events.at(-1)).toMatchObject({ type: 'result', result: { status: 'equivalent' } });

    // Every file is version 2: cases and phase on each progress event, a Shrink_Path on each divergence.
    for (const name of expectedFiles) {
      const recording = await readRecording(name);
      expect(recording.version, name).toBe(2);
      for (const event of recording.events.slice(1, -1)) {
        expect(event, name).toMatchObject({ type: 'progress', cases: expect.any(Number) });
        expect(['generating', 'shrinking'], name).toContain((event as { phase?: unknown }).phase);
      }
      const last = recording.events.at(-1);
      if (last?.type === 'result' && last.result.status === 'diverged') {
        expect(last.result.shrinkPath, name).toMatchObject({ total: expect.any(Number), steps: expect.any(Array) });
      }
    }
  });

  it('snapshots progress every 20 ms, not at the live 4 Hz (graphical-proof Requirement 3.2)', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    let intervals: unknown[];
    try {
      const report = await recordAll({ outDir, targets: [{ program: findProgram('PAYROLL')! }], prove: fakeProve() });
      expect(report.failures).toEqual([]);
      intervals = setIntervalSpy.mock.calls.map(([, ms]) => ms);
    } finally {
      setIntervalSpy.mockRestore();
    }
    expect(intervals).toEqual([20]);
  });

  it('writes nothing when the run produces more than 500 events (graphical-proof Requirement 3.3)', async () => {
    // A COBOL session that stalls for a second while progress ticks every millisecond.
    const port = findProgram('PAYROLL')!.port;
    let stalled = false;
    const report = await recordAll({
      outDir,
      targets: [{ program: findProgram('PAYROLL')! }],
      prove: {
        reference: 'fake-gnucobol',
        progressIntervalMs: 1,
        startSession: () => ({
          send: async (records) => {
            if (!stalled) {
              stalled = true;
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            return records.map(port);
          },
          close: async () => 0,
        }),
      },
    });
    expect(report.written).toEqual([]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.problems.join('; ')).toMatch(/events, more than 500/);
    expect(await readdir(outDir)).toEqual([]);
  });

  it('fails loudly and writes nothing for a recording that contradicts its label', async () => {
    // A "reference" that rounds tax half-up: now the real PAYROLL port diverges from it.
    const payroll = findProgram('PAYROLL');
    const halfUp = payroll?.mutants.find((m) => m.id === 'half-up-tax')?.port;
    const log: string[] = [];
    const report = await recordAll({
      outDir,
      targets: recordingTargets().filter((t) => t.program.id === 'PAYROLL' && t.mutant === undefined),
      prove: fakeProve((program) => (program === 'PAYROLL' ? halfUp : undefined)),
      log: (line) => log.push(line),
    });

    expect(report.written).toEqual([]);
    expect(report.failures).toEqual([
      { file: 'PAYROLL.json', problems: ['diverged, but the real port must be equivalent'] },
    ]);
    expect(log.join('\n')).toContain('FAIL PAYROLL.json');
    expect(await readdir(outDir)).toEqual([]);
  });

  it('reports a failed run instead of writing it', async () => {
    const report = await recordAll({
      outDir,
      targets: [{ program: PROGRAMS[0]! }],
      prove: {
        startSession: () => ({
          send: async () => Promise.reject(new Error('COBOL crashed')),
          close: async () => 0,
        }),
      },
    });
    expect(report.written).toEqual([]);
    expect(report.failures[0]?.problems[0]).toContain('the proof run failed');
    expect(await readdir(outDir)).toEqual([]);
  });
});

describe('checkRecording', () => {
  const payroll = findProgram('PAYROLL')!;
  const halfUp = { program: payroll, mutant: payroll.mutants.find((m) => m.id === 'half-up-tax')! };
  const result = {
    program: 'PAYROLL',
    status: 'equivalent',
    reference: 'r',
    generatedAt: '2026-11-08T10:00:00.000Z',
    seed: RECORDING_SEED,
    cases: 2000,
    shrinks: 0,
    durationMs: 10,
  } as const;
  const file = (overrides: object = {}, mutant?: string): RecordingFile => ({
    version: 2,
    events: [
      { type: 'started', program: 'PAYROLL', ...(mutant ? { mutant } : {}), seed: RECORDING_SEED, reference: 'r', numRuns: 2000 },
      { type: 'result', result: { ...result, ...overrides } },
    ],
  });

  it('expects the real port and equivalent mutants to be equivalent, other mutants to diverge', () => {
    expect(expectedStatus({ program: payroll })).toBe('equivalent');
    expect(expectedStatus({ program: payroll, mutant: payroll.mutants.find((m) => m.id === 'strict-band-edge')! })).toBe(
      'equivalent',
    );
    expect(expectedStatus(halfUp)).toBe('diverged');
  });

  it('rejects an undetected non-equivalent mutant, a truncated run, a wrong seed and a wrong label', () => {
    expect(checkRecording({ program: payroll }, file())).toEqual([]);
    expect(checkRecording(halfUp, file({}, 'half-up-tax'))).toEqual([
      'equivalent after 2000 cases, but the mutant is not marked equivalent (Requirement 4.5)',
    ]);
    expect(checkRecording({ program: payroll }, file({ truncated: true }))).toEqual([
      'the run hit the time cap; a recording must be a complete proof',
    ]);
    expect(checkRecording({ program: payroll }, file({ seed: 7 }))[0]).toContain('seed 7');
    expect(checkRecording({ program: payroll }, file({}, 'half-up-tax'))[0]).toContain('recorded mutant half-up-tax');
  });
});

describe('checkRecording applies the web client checks (graphical-proof Requirement 3.3)', () => {
  // The same fixture and corruptions as web/src/features/proof/recordingV2.test.ts runs through parseRecording.
  const fixture = path.join(import.meta.dirname, '../web/src/features/proof/fixtures/PAYROLL.half-up-tax.v2.json');
  const base = JSON.parse(readFileSync(fixture, 'utf8')) as unknown;
  const payroll = findProgram('PAYROLL')!;
  const target = { program: payroll, mutant: payroll.mutants.find((m) => m.id === 'half-up-tax')! };

  it('accepts the version 2 fixture', () => {
    expect(checkRecording(target, base as RecordingFile)).toEqual([]);
  });

  it.each(recordingV2Corruptions(base))('rejects %s', (_name, corrupted) => {
    expect(checkRecording(target, corrupted as unknown as RecordingFile)).not.toEqual([]);
  });
});

/**
 * Requirement 6.3: the site ships a recording for every program and mutant.
 * Skipped while web/public/recorded/ holds no recordings (they need real GnuCOBOL:
 * `npm run record:proofs`). Set LAZARUS_REQUIRE_RECORDINGS=1 to make absence a failure.
 */
const shippedFiles = existsSync(RECORDED_DIR) ? readdirSync(RECORDED_DIR).filter((f) => f.endsWith('.json')) : [];
const requireRecordings = process.env.LAZARUS_REQUIRE_RECORDINGS === '1';

describe.skipIf(shippedFiles.length === 0 && !requireRecordings)('shipped recordings (web/public/recorded)', () => {
  it.each(recordingTargets().map((target) => [recordingFileName(target), target] as const))(
    '%s exists and matches its label',
    (file, target) => {
      expect(shippedFiles).toContain(file);
      const recording = JSON.parse(readFileSync(path.join(RECORDED_DIR, file), 'utf8')) as RecordingFile;
      expect(checkRecording(target, recording)).toEqual([]);
    },
  );
});
