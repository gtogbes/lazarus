import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkEquivalence } from './equivalence.js';
import { validateShrinkPath } from './shrinkPath.js';

/** Three-digit records. The fake COBOL echoes them; the port breaks any record containing a 7. */
const RECORD = fc.integer({ min: 0, max: 999 }).map((n) => String(n).padStart(3, '0'));
const echo = { send: async (records: readonly string[]) => [...records] };
const brokenPort = (record: string) => (record.includes('7') ? `X${record.slice(1)}` : record);

describe('checkEquivalence shrink path', () => {
  it('attaches a valid path that ends at the counterexample and matches fast-check failures', async () => {
    const seed = 42;
    const result = await checkEquivalence({ program: 'FAKE', session: echo, port: brokenPort, record: RECORD, numRuns: 200, seed });
    expect(result.status).toBe('diverged');
    const path = result.shrinkPath!;
    expect(validateShrinkPath(path, result)).toEqual([]);
    expect(path.total).toBe(result.shrinks + 1);
    expect(path.steps.at(-1)!.records).toEqual(result.counterexample!.records);
    expect(path.steps.at(-1)!.line).toBe(result.counterexample!.line);

    // Reference: the same property, run synchronously with verbose failures.
    const reference = fc.check(
      fc.property(fc.array(RECORD, { minLength: 1, maxLength: 10 }), (records) => records.every((r) => brokenPort(r) === r)),
      { numRuns: 200, seed, verbose: 1 },
    );
    const failures = reference.failures.map(([records]) => records);
    expect(failures).toHaveLength(path.total);
    for (const s of path.steps) expect(s.records).toEqual(failures[s.step]);
  });

  // Feature: graphical-proof, Property 4: The recorded shrink path is fast-check's failure list
  // **Validates: Requirements 2.1, 2.4**
  it('records every failing input in fast-check order, ending at the counterexample', async () => {
    /** A per-record failure predicate: contains one of `digits`, or is at least `threshold`. */
    const predicate = fc.record({
      digits: fc.uniqueArray(fc.constantFrom(...'0123456789'), { maxLength: 3 }),
      threshold: fc.option(fc.integer({ min: 0, max: 999 }), { nil: undefined }),
    });
    await fc.assert(
      fc.asyncProperty(
        predicate,
        fc.integer(),
        fc.integer({ min: 1, max: 10 }),
        async ({ digits, threshold }, seed, maxRecords) => {
          const fails = (r: string) => digits.some((d) => r.includes(d)) || (threshold !== undefined && Number(r) >= threshold);
          const port = (r: string) => (fails(r) ? `X${r.slice(1)}` : r);
          // The fake COBOL session sees every call, so it can log the unsampled failing inputs.
          const failing: { records: string[]; line: number }[] = [];
          const session = {
            send: async (records: readonly string[]) => {
              const line = records.findIndex(fails);
              if (line >= 0) failing.push({ records: [...records], line });
              return [...records];
            },
          };
          const numRuns = 50;
          const result = await checkEquivalence({ program: 'FAKE', session, port, record: RECORD, numRuns, seed, maxRecords });
          const reference = fc.check(
            fc.property(fc.array(RECORD, { minLength: 1, maxLength: maxRecords }), (records) => !records.some(fails)),
            { numRuns, seed, verbose: 1 },
          );
          if (!reference.failed) {
            expect(result.status).toBe('equivalent');
            expect(failing).toEqual([]);
            return;
          }
          expect(result.status).toBe('diverged');
          // Unsampled steps equal details.failures in order, shrinks + 1 of them, each failing.
          const failures = reference.failures.map(([records]) => records);
          expect(failing.map((f) => f.records)).toEqual(failures);
          expect(failing).toHaveLength(result.shrinks + 1);
          // The last step is the counterexample.
          expect(failing.at(-1)!.records).toEqual(result.counterexample!.records);
          expect(failing.at(-1)!.line).toBe(result.counterexample!.line);
          // The stored (sampled) path is a valid subset of those steps with their real indices.
          const path = result.shrinkPath!;
          expect(validateShrinkPath(path, result)).toEqual([]);
          expect(path.total).toBe(failures.length);
          for (const s of path.steps) expect(s).toEqual({ step: s.step, ...failing[s.step]! });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('attaches no path to an equivalent result', async () => {
    const result = await checkEquivalence({ program: 'FAKE', session: echo, port: (r) => r, record: RECORD, numRuns: 20, seed: 1 });
    expect(result.status).toBe('equivalent');
    expect(result.shrinkPath).toBeUndefined();
  });

  it('attaches the partial path when the signal stops shrinking', async () => {
    const controller = new AbortController();
    const result = await checkEquivalence({
      program: 'FAKE',
      session: echo,
      port: brokenPort,
      record: RECORD,
      numRuns: 200,
      seed: 42,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.divergences === 3) controller.abort();
      },
    });
    expect(result.status).toBe('diverged');
    expect(result.truncated).toBe(true);
    expect(result.shrinkPath!.total).toBe(3);
    expect(validateShrinkPath(result.shrinkPath, result)).toEqual([]);
  });
});
