import { describe, expect, it } from 'vitest';
import { compareOutputs } from './compare.js';

describe('compareOutputs', () => {
  it('reports equal outputs', () => {
    expect(compareOutputs(['a', 'b'], ['a', 'b'])).toEqual({ equal: true });
  });

  it('reports the first differing line and column', () => {
    expect(compareOutputs(['abc', '+000000107'], ['abc', '+000000108'])).toEqual({
      equal: false,
      line: 1,
      column: 9,
      expected: '+000000107',
      actual: '+000000108',
    });
  });

  it('reports a missing record', () => {
    expect(compareOutputs(['a', 'b'], ['a'])).toEqual({
      equal: false,
      line: 1,
      column: 0,
      expected: 'b',
      actual: undefined,
    });
  });
});
