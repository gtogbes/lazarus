# Lazarus

> Raise legacy COBOL from the dead, and prove it came back as itself.

Lazarus turns a COBOL batch program into a modern TypeScript module, then uses
property-based testing to show the two behave the same. It runs both versions
on thousands of generated inputs and diffs the outputs. Any divergence, such as
a rounding or truncation difference, is reported with the smallest input that
reproduces it.

Built for the Kiroween 2026 hackathon (Resurrection category).

## Hosted

The lab is hosted on AWS (S3 and CloudFront, with the proof API on Lambda), with
no login. The public URL is in the hackathon submission. "Prove it" runs real
GnuCOBOL 3.1.2 on AWS Lambda and streams progress back. The API runs one proof at a
time, so when it is busy the page offers a recorded proof instead. The demo
(`/program/PAYROLL?demo=1`) replays recordings and never calls the API. Smoke-test
results are in [ADR 0001](docs/adr/0001-proof-api-response-streaming.md).

To deploy your own copy (from `infra/`, after `npm run web:build` at the root):

```sh
npx cdk deploy --all -c budgetEmail=you@example.com
# Optional custom domain in an existing Route 53 public zone:
npx cdk deploy --all -c budgetEmail=you@example.com \
  -c domainName=lab.example.com -c hostedZoneDomain=example.com -c hostedZoneId=Z0123456789ABCDEFGHIJ
```

Without a domain the site is served on its `*.cloudfront.net` address. The domain
can also come from `LAZARUS_DOMAIN`, `LAZARUS_HOSTED_ZONE_DOMAIN` and
`LAZARUS_HOSTED_ZONE_ID`. CDK's context cache file in `infra/` (written by the zone
lookup; it holds the account id) is gitignored.

## Status

The equivalence harness works for three sample programs. Each TypeScript port
matches GnuCOBOL 3.1.2 on 50,000 generated cases.

| Program | What it does | COBOL behaviour it exercises |
|---|---|---|
| `INTCALC` | Interest accrual with an overdraft penalty | ROUNDED, high-order truncation, negative zero |
| `PAYROLL` | Weekly gross-to-net pay with tax bands | COMP-3, ON SIZE ERROR, banker's rounding |
| `INVOICE` | Invoice line with discount and VAT | Silent overflow, truncated discount, bad input codes |

### The programs in plain English

The same text appears on the morgue cards and the program pages. It comes from
`src/ports/programs.meta.ts`, so update it there and here together.

- **INTCALC.** Works out the interest a loan account earns over a number of days, and its new balance; overdrawn accounts pay 12.5 points more on the rate. COBOL rounds the interest half a cent away from zero, and an amount too big for its field silently loses its leading digits instead of failing. A port using floating point or ordinary rounding gets cents wrong, and cannot print the -0.00 that COBOL gives when a cut-off negative amount leaves zero. Two mutants: drop the rounding, or charge the penalty on a zero balance.
- **PAYROLL.** Turns weekly hours and an hourly rate into gross pay, tax and net pay: hours over 40 pay time and a half, and tax is nil up to 1,000.00, 25% to 4,000.00 and 45% above. The working fields are packed decimal (COMP-3), so every step is exact decimal arithmetic, and tax rounds an exact half penny to the even penny where a naive port rounds it up. When gross pay is too big for its field, ON SIZE ERROR marks the record "SE" and leaves gross at zero; a naive port keeps the overflowed amount. Three mutants: normal rounding, ignoring the size error, and a tax band edge change that turns out to be equivalent.
- **INVOICE.** Prices one invoice line: quantity times unit price, less a percentage discount, plus VAT at 17.5%, 5% or 0% by code. The discount is cut to the penny rather than rounded, VAT rounds an exact half penny to the even penny, and a line too big for its field silently loses its leading digits. An unknown VAT code is not rejected: it is charged no VAT and the record is marked "VC". Two mutants: round VAT halves up, or round the discount instead of cutting it.

Each run writes `results/<PROGRAM>.json` (status, seed, counterexample) for the UI.

## Quick start

```sh
npm install
npm run cobol:image        # build the pinned GnuCOBOL 3.1.2 image (once)
npm test                   # unit tests + equivalence tests (1,000 cases per program)
LAZARUS_RUNS=50000 npm run test:equivalence   # longer soak
LAZARUS_SEED=-1501918552 npm run test:equivalence   # replay a reported failure
npm run lambda:image && npm run lambda:smoke   # proof API Lambda image, checked locally under the Lambda emulator
```

## Run the lab locally

Needs Docker running and the `lazarus-gnucobol:3.1.2` image (`npm run cobol:image`).
Use two terminals, both in the repository root:

```sh
npm run api:dev   # terminal 1: proof API on http://127.0.0.1:8787 (runs GnuCOBOL in Docker)
npm run web:dev   # terminal 2: lab UI on http://localhost:5173, proxies /api to the proof API
```

Open http://localhost:5173 and press **Prove it** on a program. If the proof
API is not running, Prove fails with "The local proof API is not running".
Set `LAZARUS_API_HOST` and `LAZARUS_API_PORT` in both terminals to move the API.
If 5173 is taken, Vite moves to the next free port and prints it.

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
