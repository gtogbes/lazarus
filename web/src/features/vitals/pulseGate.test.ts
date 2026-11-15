import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { acceptPulse, MIN_PULSE_INTERVAL_MS } from './pulseGate';
describe('acceptPulse', () => {
  it('accepts the first pulse', () => {
    expect(acceptPulse(0, null)).toBe(true);
  });
  it('refuses a pulse under 1 s after the last and accepts one at 1 s', () => {
    expect(MIN_PULSE_INTERVAL_MS).toBe(1000);
    expect(acceptPulse(1999, 1000)).toBe(false);
    expect(acceptPulse(2000, 1000)).toBe(true);
  });
  it('refuses a pulse when the clock went backwards', () => {
    expect(acceptPulse(500, 1000)).toBe(false);
  });
});
/** Feed requests through the gate the way a pulse source does; return the starts it lets through. */
function gate(requests: readonly number[]): number[] {
  const accepted: number[] = [];
  let last: number | null = null;
  for (const now of requests) {
    if (acceptPulse(now, last)) {
      accepted.push(now);
      last = now;
    }
  }
  return accepted;
}
// Request times: bursts of close requests, any order (clocks can go backwards), fractional ms.
const requestTime = fc.oneof(
  fc.integer({ min: 0, max: 10_000 }),
  fc.double({ min: 0, max: 1e7, noNaN: true, noDefaultInfinity: true }),
);
describe('pulse gate flash limit', () => {
  // Feature: graphical-proof, Property 18: Pulses stay under the flash limit
  // **Validates: Requirements 14.5, 10.3**
  it('lets through pulses at least 1,000 ms apart, so no 1 s window holds more than one', () => {
    fc.assert(
      fc.property(fc.array(requestTime, { maxLength: 200 }), (requests) => {
        const accepted = gate(requests);
        let prev: number | null = null;
        for (const t of accepted) {
          if (prev !== null) expect(t - prev).toBeGreaterThanOrEqual(MIN_PULSE_INTERVAL_MS);
          prev = t;
        }
        // WCAG 2.3.1: any 1 s window holds at most 3 flashes; the gate allows at most one.
        // The fullest window starts at an accepted pulse, so checking those covers all windows.
        for (const start of accepted) {
          const inWindow = accepted.filter((t) => t >= start && t < start + 1000).length;
          expect(inWindow).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 500 },
    );
  });
});
