# Design: Equivalence harness

## Overview
The harness answers one question: for any valid input, does the TypeScript port
produce the same output bytes as the original COBOL program? It compiles and runs
the COBOL in a pinned GnuCOBOL container, runs the port in-process, and lets
fast-check generate and shrink inputs until it finds a difference or runs out of
budget.

## Findings from the spike (2 Nov 2026)
Measured against GnuCOBOL 3.1.2 with `cobol/programs/INTCALC.cbl`:
- `ASSIGN TO KEYBOARD` / `ASSIGN TO DISPLAY` with LINE SEQUENTIAL reads stdin and
  writes stdout one record per line.
- Output is block-buffered when piped. Wrapping the program in `stdbuf -oL` makes
  it flush per record, so one long-lived container can answer record by record.
  This avoids paying container start-up (~0.5 s) per generated input.
- Storing into a smaller PIC silently drops high-order digits
  (`102.5000` into `9(2)V9(4)` becomes `02.5000`).
- A result that rounds to zero from a negative value is written with a `+` sign.

## Architecture

```
fast-check ──records──► CobolSession (docker run -i ... stdbuf -oL bin/PROG) ──lines──┐
          └─records──► port (in-process TypeScript)  ──lines────────────────────────┴─► compare
```

### Components
| Module | Responsibility |
|---|---|
| `src/harness/cobol.ts` | `compileCobol(program)`: compile in Docker, cache by SHA-256 of the source (Req 1.1-1.3). `CobolSession`: long-lived container, `send(records)` returns one output line per record (Req 1.4). |
| `src/harness/compare.ts` | `compareOutputs(expected, actual)`: first differing line and column (Req 3). |
| `src/harness/equivalence.ts` | `assertEquivalent(...)`: wires fast-check, the session and the port; reports counterexample and seed; emits progress (Req 4, 5.1). |
| `src/semantics/decimal.ts` | Exact COBOL numeric semantics: rationals for COMPUTE, ROUNDED (half away from zero), high-order truncation on store, DISPLAY formatting. |
| `src/semantics/arbitraries.ts` | Generators for PIC fields, biased toward boundary values (Req 4.2). |
| `src/ports/<prog>.ts` | One port per program. Exposes `processRecord(line): string`. |

### Decisions
- **Ports run in-process** (resolves open decision 2). The port interface is
  "record line in, record line out", which mirrors the COBOL program exactly, and
  avoids spawning Node per input. A CLI wrapper can be added for the UI later.
- **Programs must emit exactly one output line per input record.** This is the
  contract that makes per-record streaming possible. Programs that break it are
  out of scope for the hackathon.
- **Arithmetic uses exact rationals (bigint numerator/denominator).** GnuCOBOL
  keeps at least 38 extra digits in intermediate division, so exact rationals
  agree with it except within ~1e-38 of a rounding boundary, which PIC-limited
  inputs cannot reach.
- **Exit code** is checked once, when the session closes (expected 0).
- Hosted demo (open decision 1) stays open until the UI spec.

## Error handling
- Compile failure: `CompileError` with compiler stderr; no comparison runs.
- Missing Docker image: error telling the user to run `npm run cobol:image`.
- COBOL process exits mid-session: pending `send` rejects with stderr attached.
- Divergence: `DivergenceError` carrying input records, both outputs and position.

## Testing
- Unit tests for `decimal.ts` and `compare.ts` (no Docker).
- One equivalence test per port (`*.equivalence.test.ts`), 1,000 runs by default,
  `LAZARUS_RUNS` and `LAZARUS_SEED` environment variables override.
