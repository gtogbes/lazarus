/**
 * Incremental NDJSON decoding for the proof stream. The stream is untrusted:
 * chunks may split lines (or UTF-8 sequences) anywhere, lines may not be JSON,
 * and the last line may have no newline. Bad lines are counted and skipped.
 */

/** A line longer than this is dropped, so a hostile stream cannot grow memory without bound. */
export const MAX_LINE_BYTES = 1024 * 1024;

export interface NdjsonDecoder {
  /** Values completed by this chunk, in order. */
  push(chunk: Uint8Array): unknown[];
  /** Values from a trailing line with no newline, once the stream has ended. */
  end(): unknown[];
  /** Lines skipped so far because they were not JSON or were too long. */
  readonly badLines: number;
}

export function createNdjsonDecoder(maxLineBytes = MAX_LINE_BYTES): NdjsonDecoder {
  const text = new TextDecoder('utf-8');
  let buffer = '';
  // True while discarding the rest of an over-long line.
  let skipping = false;
  let badLines = 0;

  const parseLine = (line: string, out: unknown[]) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      badLines++;
    }
  };

  const take = (chunkText: string): unknown[] => {
    const out: unknown[] = [];
    let start = 0;
    for (let newline = chunkText.indexOf('\n'); newline !== -1; newline = chunkText.indexOf('\n', start)) {
      const piece = chunkText.slice(start, newline);
      start = newline + 1;
      if (skipping) {
        skipping = false;
      } else {
        parseLine(buffer + piece, out);
      }
      buffer = '';
    }
    if (!skipping) {
      buffer += chunkText.slice(start);
      // UTF-16 length is a lower bound on the UTF-8 size, close enough for a safety cap.
      if (buffer.length > maxLineBytes) {
        buffer = '';
        skipping = true;
        badLines++;
      }
    }
    return out;
  };

  return {
    push: (chunk) => take(text.decode(chunk, { stream: true })),
    end: () => {
      const out = take(text.decode());
      if (!skipping) parseLine(buffer, out);
      buffer = '';
      skipping = false;
      return out;
    },
    get badLines() {
      return badLines;
    },
  };
}
