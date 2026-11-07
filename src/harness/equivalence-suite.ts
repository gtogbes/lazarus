import type fc from 'fast-check';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { CobolSession } from './cobol.js';
import { checkEquivalence, type Port } from './equivalence.js';
import { describeResult, writeResult } from './results.js';

/**
 * Register the standard equivalence test for one program: start a GnuCOBOL
 * session, check the port against it, write results/<PROGRAM>.json, and fail
 * with the shrunk counterexample if they differ.
 */
export function equivalenceSuite(program: string, port: Port, record: fc.Arbitrary<string>): void {
  let session: CobolSession;

  beforeAll(() => {
    session = CobolSession.start(program);
  });

  afterAll(async () => {
    expect(await session.close()).toBe(0);
  });

  it(`${program} port matches GnuCOBOL on generated records`, async () => {
    const result = await checkEquivalence({ program, session, port, record });
    writeResult(result);
    const summary = describeResult(result);
    console.log(summary);
    if (result.status !== 'equivalent') expect.fail(summary);
  });
}
