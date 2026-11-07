# Lazarus

> Raise legacy COBOL from the dead, and prove it came back as itself.

Lazarus turns a COBOL batch program into a modern TypeScript module, then uses
property-based testing to show the two behave the same. It runs both versions
on thousands of generated inputs and diffs the outputs. Any divergence, such as
a rounding or truncation difference, is reported with the smallest input that
reproduces it.

Built for the Kiroween 2026 hackathon (Resurrection category).

## Status

The equivalence harness works for three sample programs. Each TypeScript port
matches GnuCOBOL 3.1.2 on 50,000 generated cases.

| Program | What it does | COBOL behaviour it exercises |
|---|---|---|
| `INTCALC` | Interest accrual with an overdraft penalty | ROUNDED, high-order truncation, negative zero |
| `PAYROLL` | Weekly gross-to-net pay with tax bands | COMP-3, ON SIZE ERROR, banker's rounding |
| `INVOICE` | Invoice line with discount and VAT | Silent overflow, truncated discount, bad input codes |

Each run writes `results/<PROGRAM>.json` (status, seed, counterexample) for the UI.

## Quick start

```sh
npm install
npm run cobol:image        # build the pinned GnuCOBOL 3.1.2 image (once)
npm test                   # unit tests + equivalence tests (1,000 cases per program)
LAZARUS_RUNS=50000 npm run test:equivalence   # longer soak
LAZARUS_SEED=-1501918552 npm run test:equivalence   # replay a reported failure
```

## How it works (planned)

1. **Exhume**: compile the original COBOL with GnuCOBOL inside Docker.
2. **Reanimate**: Kiro generates a TypeScript port from a spec derived from the COBOL.
3. **Prove**: fast-check generates inputs, feeds them to both programs, and compares outputs.
4. **Report**: the reanimation lab UI shows both programs side by side with live
   run and divergence counts.

## Prerequisites

- Node.js 22 or later
- Docker (GnuCOBOL runs in a container, so no local install is needed)

## Repository layout (planned)

```
cobol/        Original COBOL programs and sample inputs
src/harness/  Equivalence harness (runs both sides, diffs outputs)
src/ports/    Generated TypeScript ports
web/          Reanimation lab UI
.kiro/        Kiro steering, specs and hooks used to build this project
```

## How Kiro was used

Written up as the project progresses. See `.kiro/` for the steering docs, specs and hooks.

## License

[MIT](LICENSE)
