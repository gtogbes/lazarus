import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fillFraction, fillText } from './fill';

describe('fillFraction', () => {
  it('is passed out of total', () => {
    expect(fillFraction(0, 2000)).toBe(0);
    expect(fillFraction(500, 2000)).toBe(0.25);
    expect(fillFraction(2000, 2000)).toBe(1);
  });

  it('stays in [0, 1] for out-of-range input', () => {
    expect(fillFraction(3000, 2000)).toBe(1);
    expect(fillFraction(-5, 2000)).toBe(0);
    expect(fillFraction(10, 0)).toBe(0);
    expect(fillFraction(Number.NaN, 100)).toBe(0);
  });
});

describe('fillText', () => {
  it('shows the counts and a rounded-down percentage', () => {
    expect(fillText(1240, 2000)).toBe('1,240 / 2,000 cases passed (62%)');
    expect(fillText(1, 3)).toBe('1 / 3 cases passed (33.3%)');
    expect(fillText(2, 3)).toBe('2 / 3 cases passed (66.6%)');
    expect(fillText(0, 2000)).toBe('0 / 2,000 cases passed (0%)');
  });

  it('shows 100% only when every case passed', () => {
    expect(fillText(1999, 2000)).toBe('1,999 / 2,000 cases passed (99.9%)');
    expect(fillText(19_999, 20_000)).toBe('19,999 / 20,000 cases passed (99.9%)');
    expect(fillText(2000, 2000)).toBe('2,000 / 2,000 cases passed (100%)');
  });
});

/**
 * Property 13: Fill shows 100% only when all passed.
 * **Validates: Requirements 8.1, 8.2**
 */
describe('Property 13: fill shows 100% only when all passed', () => {
  const COUNTS = new Intl.NumberFormat('en-GB');
  // total > 0 and 0 ≤ passed ≤ total, biased towards the edges where rounding up would show.
  const cases = fc
    .integer({ min: 1, max: 1_000_000_000 })
    .chain((total) =>
      fc.tuple(
        fc.oneof(
          fc.constant(total),
          fc.constant(total - 1),
          fc.constant(0),
          fc.integer({ min: 0, max: total }),
        ),
        fc.constant(total),
      ),
    );

  it('shows passed / total, the percentage floored to tenths, and 100% exactly when all passed', () => {
    fc.assert(
      fc.property(cases, ([passed, total]) => {
        // Independent oracle: exact integer floor of 1000 × passed / total.
        const tenths = Number((1000n * BigInt(passed)) / BigInt(total));
        const text = fillText(passed, total);
        expect(text).toBe(`${COUNTS.format(passed)} / ${COUNTS.format(total)} cases passed (${tenths / 10}%)`);
        expect(text.endsWith('(100%)')).toBe(passed === total);

        const fraction = fillFraction(passed, total);
        expect(fraction).toBeGreaterThanOrEqual(0);
        expect(fraction).toBeLessThanOrEqual(1);
      }),
      { numRuns: 1000 },
    );
  });
});
