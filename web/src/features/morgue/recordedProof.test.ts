import { describe, expect, it } from 'vitest';
import { DIVERGED_RESULT, EQUIVALENT_RESULT, recordingOf } from '../proof/testing';
import { parseRecordedProof } from './recordedProof';

describe('parseRecordedProof', () => {
  it('keeps the summary fields of the recorded result', () => {
    expect(parseRecordedProof(recordingOf(EQUIVALENT_RESULT), 'PAYROLL')).toEqual({
      status: 'equivalent',
      cases: 2000,
      durationMs: 1412,
      generatedAt: '2026-11-08T10:00:00.000Z',
    });
    expect(parseRecordedProof(recordingOf(DIVERGED_RESULT))?.status).toBe('diverged');
  });

  it.each([
    ['a bare harness result (the old format)', EQUIVALENT_RESULT, undefined],
    ['an invalid recording', { version: 1, events: [] }, undefined],
    ['another program', recordingOf(EQUIVALENT_RESULT), 'INVOICE'],
    ['a mutant recording', recordingOf(EQUIVALENT_RESULT, { mutant: 'half-up-tax' }), 'PAYROLL'],
  ])('rejects %s', (_name, value, programId) => {
    expect(parseRecordedProof(value, programId)).toBeNull();
  });
});
