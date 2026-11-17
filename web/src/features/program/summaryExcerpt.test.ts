import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PROGRAM_META } from '../../../../src/ports/programs.meta';
import { LEAD_CUT, LEAD_MAX_SENTENCE, summaryExcerpt } from './summaryExcerpt';

describe('summaryExcerpt', () => {
  it('leads with the first sentence when it is short enough', () => {
    expect(summaryExcerpt('Prices one line. Then VAT at 17.5% is added. Two mutants.')).toEqual({
      lead: 'Prices one line.',
      rest: 'Then VAT at 17.5% is added. Two mutants.',
    });
  });

  it('does not end a sentence at a decimal point', () => {
    expect(summaryExcerpt('Tax is nil up to 1,000.00, then 12.5 more. Rest.').lead).toBe('Tax is nil up to 1,000.00, then 12.5 more.');
  });

  it('cuts a long first sentence at a word, with an ellipsis on both sides', () => {
    const long = `${'word '.repeat(40).trim()}. Next.`;
    const { lead, rest } = summaryExcerpt(long);
    expect(lead.endsWith('word…')).toBe(true);
    expect(lead.length).toBeLessThanOrEqual(LEAD_CUT + 1);
    expect(rest.startsWith('…word')).toBe(true);
  });

  it('has no rest for a one-sentence summary', () => {
    expect(summaryExcerpt('Only this.')).toEqual({ lead: 'Only this.', rest: '' });
  });

  it('gives every real program a lead of at most a sentence and a rest to read', () => {
    for (const { summary } of PROGRAM_META) {
      const { lead, rest } = summaryExcerpt(summary);
      expect(lead.length).toBeLessThanOrEqual(LEAD_MAX_SENTENCE);
      expect(rest).not.toBe('');
    }
  });

  it('loses no words: lead and rest rejoin to the summary (property)', () => {
    const word = fc.stringMatching(/^[A-Za-z0-9,%]{1,12}$/);
    const sentence = fc.array(word, { minLength: 1, maxLength: 40 }).map((w) => `${w.join(' ')}.`);
    fc.assert(
      fc.property(fc.array(sentence, { minLength: 1, maxLength: 5 }), (sentences) => {
        const summary = sentences.join(' ');
        const { lead, rest } = summaryExcerpt(summary);
        const joined = `${lead.replace(/…$/, '')} ${rest.replace(/^…/, '')}`.replace(/\s+/g, ' ').trim();
        expect(joined).toBe(summary);
        expect(lead.length).toBeLessThanOrEqual(LEAD_MAX_SENTENCE + 1);
      }),
    );
  });
});
