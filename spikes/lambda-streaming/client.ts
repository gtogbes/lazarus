/**
 * Spike client: POST to the Runtime Interface Emulator and log when each
 * NDJSON line arrives. Streaming works if progress lines arrive spread over
 * the run; a buffered response delivers everything at the end.
 *
 * Usage: node spikes/lambda-streaming/client.ts [url] [seed] [numRuns]
 */
const url = process.argv[2] ?? 'http://localhost:9000/2015-03-31/functions/function/invocations';
const seed = Number(process.argv[3] ?? 123);
const numRuns = Number(process.argv[4] ?? 2000);
const event = { body: JSON.stringify({ program: 'INTCALC', seed, numRuns }), isBase64Encoded: false };

const started = performance.now();
const response = await fetch(url, { method: 'POST', body: JSON.stringify(event) });
console.log(`HTTP ${response.status}`, Object.fromEntries(response.headers));
if (!response.body) throw new Error('No response body');

const arrivals: number[] = [];
let buffer = '';
let firstChunk: number | undefined;
let chunks = 0;
const decoder = new TextDecoder();
for await (const chunk of response.body) {
  const t = performance.now() - started;
  firstChunk ??= t;
  chunks++;
  buffer += decoder.decode(chunk, { stream: true });
  // Function URL metadata prelude: JSON then 8 NUL bytes. Print and strip it.
  const prelude = buffer.indexOf('\0'.repeat(8));
  if (prelude !== -1) {
    console.log(`prelude: ${buffer.slice(0, prelude)}`);
    buffer = buffer.slice(prelude + 8);
  }
  let nl: number;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    arrivals.push(t);
    const e = JSON.parse(line) as { type: string; executions?: number; result?: { status: string; cases: number; durationMs: number; seed: number } };
    const what = e.type === 'result' ? JSON.stringify({ status: e.result?.status, cases: e.result?.cases, durationMs: e.result?.durationMs, seed: e.result?.seed }) : line.slice(0, 100);
    if (e.type !== 'progress' || arrivals.length % 4 === 0) console.log(`${t.toFixed(0).padStart(6)} ms  ${what}`);
  }
}
const total = performance.now() - started;
const gaps = arrivals.slice(1).map((t, i) => t - (arrivals[i] ?? t));
console.log(
  JSON.stringify({
    lines: arrivals.length,
    chunks,
    firstByteMs: Math.round(firstChunk ?? 0),
    totalMs: Math.round(total),
    medianGapMs: Math.round([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0),
    maxGapMs: Math.round(Math.max(0, ...gaps)),
    streamed: (firstChunk ?? total) < total * 0.5,
  }),
);
