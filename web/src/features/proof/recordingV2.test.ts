import { describe, expect, it } from 'vitest';
import V2_FIXTURE from './fixtures/PAYROLL.half-up-tax.v2.json';
import { recordingV2Corruptions } from './fixtures/recordingV2Corruptions';
import { parseRecording } from './recording';

/**
 * The same fixture and corruptions as scripts/record-proofs.test.ts runs through
 * checkRecording, so the record script and the client reject the same files
 * (graphical-proof Requirement 3.3).
 */
describe('parseRecording with version 2 corruptions', () => {
  const target = { program: 'PAYROLL', mutant: 'half-up-tax' };

  it('accepts the version 2 fixture', () => {
    expect(parseRecording(V2_FIXTURE, target)?.result.shrinkPath).toBeDefined();
  });

  it.each(recordingV2Corruptions(V2_FIXTURE))('rejects %s', (_name, corrupted) => {
    expect(parseRecording(corrupted, target)).toBeNull();
  });
});
