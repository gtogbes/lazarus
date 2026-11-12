import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createNdjsonDecoder } from './ndjson';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('NDJSON decoder', () => {
  it('reassembles lines split across chunks, including inside a UTF-8 character', () => {
    const decoder = createNdjsonDecoder();
    const all = bytes('{"a":1}\n{"b":"£€"}\n');
    // Split one byte into the two-byte "£".
    const cut = all.indexOf(0xc2) + 1;
    expect(decoder.push(all.slice(0, 3))).toEqual([]);
    expect(decoder.push(all.slice(3, cut))).toEqual([{ a: 1 }]);
    expect(decoder.push(all.slice(cut))).toEqual([{ b: '£€' }]);
    expect(decoder.end()).toEqual([]);
    expect(decoder.badLines).toBe(0);
  });

  it('skips and counts lines that are not JSON, and ignores blank lines and CRLF', () => {
    const decoder = createNdjsonDecoder();
    expect(decoder.push(bytes('{"a":1}\r\nnot json\n\n{"b":\n[1,2]\n'))).toEqual([{ a: 1 }, [1, 2]]);
    expect(decoder.badLines).toBe(2);
  });

  it('parses a valid trailing line without a newline and drops a truncated one', () => {
    const ok = createNdjsonDecoder();
    ok.push(bytes('{"a":1}\n{"b":2}'));
    expect(ok.end()).toEqual([{ b: 2 }]);

    const partial = createNdjsonDecoder();
    partial.push(bytes('{"a":1}\n{"b":'));
    expect(partial.end()).toEqual([]);
    expect(partial.badLines).toBe(1);
  });

  it('drops an over-long line without buffering it, then recovers at the next newline', () => {
    const decoder = createNdjsonDecoder(16);
    expect(decoder.push(bytes(`{"a":"${'x'.repeat(20)}`))).toEqual([]);
    expect(decoder.push(bytes(`${'x'.repeat(50)}"}\n{"ok":true}\n`))).toEqual([{ ok: true }]);
    expect(decoder.badLines).toBe(1);
  });

  it('decodes the same values however the byte stream is chunked', () => {
    fc.assert(
      fc.property(
        fc.array(fc.jsonValue(), { maxLength: 8 }),
        fc.array(fc.nat(), { maxLength: 10 }),
        (values, cuts) => {
          const all = bytes(values.map((v) => `${JSON.stringify(v)}\n`).join(''));
          const points = [...new Set(cuts.map((c) => c % (all.length + 1)))].sort((a, b) => a - b);
          const decoder = createNdjsonDecoder();
          const out: unknown[] = [];
          let start = 0;
          for (const point of [...points, all.length]) {
            out.push(...decoder.push(all.slice(start, point)));
            start = point;
          }
          out.push(...decoder.end());
          // JSON round-trip normalises -0 to 0, as the server's JSON.stringify would.
          expect(out).toEqual(values.map((v) => JSON.parse(JSON.stringify(v)) as unknown));
          expect(decoder.badLines).toBe(0);
        },
      ),
    );
  });
});
