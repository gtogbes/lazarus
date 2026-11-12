import { describe, expect, it } from 'vitest';
import { parseRecording, recordingFileName, recordingUrl } from './recording';
import { DIVERGED_RESULT, EQUIVALENT_RESULT, recordingOf } from './testing';

const VALID = recordingOf(EQUIVALENT_RESULT, {
  progress: [
    { type: 'progress', executions: 400, divergences: 0, elapsedMs: 250 },
    { type: 'progress', executions: 2000, divergences: 0, elapsedMs: 1412 },
  ],
});

const withEvents = (events: unknown[]) => ({ version: 1, events });
const [STARTED_EVENT, P1, P2, RESULT_EVENT] = VALID.events;

describe('recordingFileName', () => {
  it('names program and mutant recordings', () => {
    expect(recordingFileName({ program: 'PAYROLL' })).toBe('PAYROLL.json');
    expect(recordingFileName({ program: 'PAYROLL', mutant: null })).toBe('PAYROLL.json');
    expect(recordingFileName({ program: 'PAYROLL', mutant: 'half-up-tax' })).toBe('PAYROLL.half-up-tax.json');
    expect(recordingUrl({ program: 'PAYROLL', mutant: 'half-up-tax' })).toBe('/recorded/PAYROLL.half-up-tax.json');
  });
});

describe('parseRecording', () => {
  it('splits a recording into started, progress snapshots and result', () => {
    const recording = parseRecording(VALID, { program: 'PAYROLL' });
    expect(recording?.started).toMatchObject({ program: 'PAYROLL', seed: 42 });
    expect(recording?.progress.map((p) => p.executions)).toEqual([400, 2000]);
    expect(recording?.result).toEqual(EQUIVALENT_RESULT);
  });

  it('accepts a mutant recording for that mutant only', () => {
    const file = recordingOf(DIVERGED_RESULT, { mutant: 'half-up-tax' });
    expect(parseRecording(file, { program: 'PAYROLL', mutant: 'half-up-tax' })?.result.status).toBe('diverged');
    expect(parseRecording(file, { program: 'PAYROLL' })).toBeNull();
    expect(parseRecording(file, { program: 'PAYROLL', mutant: 'ignore-size-error' })).toBeNull();
    expect(parseRecording(VALID, { program: 'PAYROLL', mutant: 'half-up-tax' })).toBeNull();
  });

  it('drops unknown fields', () => {
    const file = withEvents([{ ...STARTED_EVENT, extra: '<script>' }, RESULT_EVENT]);
    expect(parseRecording(file)?.started).not.toHaveProperty('extra');
  });

  it.each([
    ['null', null],
    ['an array', [VALID]],
    ['a bare result', EQUIVALENT_RESULT],
    ['another version', { ...VALID, version: 2 }],
    ['no events', withEvents([])],
    ['no result', withEvents([STARTED_EVENT, P1])],
    ['no started', withEvents([P1, RESULT_EVENT])],
    ['an invalid event', withEvents([STARTED_EVENT, { type: 'progress', executions: -1 }, RESULT_EVENT])],
    ['an error event', withEvents([STARTED_EVENT, { type: 'error', message: 'x' }, RESULT_EVENT])],
    ['two results', withEvents([STARTED_EVENT, RESULT_EVENT, RESULT_EVENT])],
    ['progress going back in time', withEvents([STARTED_EVENT, P2, P1, RESULT_EVENT])],
    ['a result for another program', withEvents([STARTED_EVENT, { type: 'result', result: { ...EQUIVALENT_RESULT, program: 'INVOICE' } }])],
    ['a result with another seed', withEvents([STARTED_EVENT, { type: 'result', result: { ...EQUIVALENT_RESULT, seed: 7 } }])],
    ['an undatable result', withEvents([STARTED_EVENT, { type: 'result', result: { ...EQUIVALENT_RESULT, generatedAt: 'soon' } }])],
    ['too many events', withEvents([STARTED_EVENT, ...Array<unknown>(600).fill(P1), RESULT_EVENT])],
  ])('rejects %s', (_name, value) => {
    expect(parseRecording(value)).toBeNull();
  });

  it('rejects a recording of another program', () => {
    expect(parseRecording(VALID, { program: 'INVOICE' })).toBeNull();
  });
});

/**
 * The files scripts/record-proofs.ts wrote must parse in the browser. Skipped while
 * web/public/recorded/ holds no recordings; completeness is checked by
 * scripts/record-proofs.test.ts at the root.
 */
const shipped = Object.entries(
  import.meta.glob<unknown>('../../../public/recorded/*.json', { eager: true, import: 'default' }),
).map(([path, value]) => [path.slice(path.lastIndexOf('/') + 1), value] as const);

describe.skipIf(shipped.length === 0)('shipped recordings', () => {
  it.each(shipped)('%s parses as the recording its name says', (name, value) => {
    const [program = '', mutant] = name.replace(/\.json$/, '').split('.');
    expect(parseRecording(value, { program, mutant: mutant ?? null })).not.toBeNull();
  });
});
