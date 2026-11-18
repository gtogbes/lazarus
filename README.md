# Lazarus

Lazarus ports three COBOL batch programs (INTCALC, PAYROLL and INVOICE) to
TypeScript and proves each port behaves the same as the original. fast-check
generates thousands of input records, runs them through real GnuCOBOL 3.1.2 and
through the port, and diffs the outputs. Any divergence is reported with the
smallest input that reproduces it. A web lab shows the proof live, with a 3D
scene, a sabotage panel of deliberate porting mistakes and a recorded demo mode.

## The programs

- **INTCALC.** Works out the interest a loan account earns over a number of days, and its new balance; overdrawn accounts pay 12.5 points more on the rate. COBOL rounds the interest half a cent away from zero, and an amount too big for its field silently loses its leading digits instead of failing. A port using floating point or ordinary rounding gets cents wrong, and cannot print the -0.00 that COBOL gives when a cut-off negative amount leaves zero. Two mutants: drop the rounding, or charge the penalty on a zero balance.
- **PAYROLL.** Turns weekly hours and an hourly rate into gross pay, tax and net pay: hours over 40 pay time and a half, and tax is nil up to 1,000.00, 25% to 4,000.00 and 45% above. The working fields are packed decimal (COMP-3), so every step is exact decimal arithmetic, and tax rounds an exact half penny to the even penny where a naive port rounds it up. When gross pay is too big for its field, ON SIZE ERROR marks the record "SE" and leaves gross at zero; a naive port keeps the overflowed amount. Three mutants: normal rounding, ignoring the size error, and a tax band edge change that turns out to be equivalent.
- **INVOICE.** Prices one invoice line: quantity times unit price, less a percentage discount, plus VAT at 17.5%, 5% or 0% by code. The discount is cut to the penny rather than rounded, VAT rounds an exact half penny to the even penny, and a line too big for its field silently loses its leading digits. An unknown VAT code is not rejected: it is charged no VAT and the record is marked "VC". Two mutants: round VAT halves up, or round the discount instead of cutting it.

The summaries come from `src/ports/programs.meta.ts`; a test checks this list matches it.

## Requirements

- Node.js 22 or later
- Docker (GnuCOBOL runs in a container; no local install needed)

## Run locally

```sh
npm install
npm run cobol:image   # build the pinned GnuCOBOL 3.1.2 image (once)
npm run api:dev       # terminal 1: proof API on http://127.0.0.1:8787
npm run web:dev       # terminal 2: lab UI on http://localhost:5173 (proxies /api)
```

Open http://localhost:5173 and press **Prove it** on a program. For the demo,
open `/program/PAYROLL?demo=1`: it replays the recordings in
`web/public/recorded/` and needs no API.

## Tests

```sh
npm run test:unit                      # unit tests (no Docker)
npm test                               # unit + equivalence tests against GnuCOBOL (needs the image)
npm test -w web                        # web unit tests
npm run test:e2e -w web                # Playwright end-to-end tests
```

Set `LAZARUS_RUNS` to change the case count and `LAZARUS_SEED` to replay a
reported failure, e.g. `LAZARUS_SEED=-1501918552 npm run test:equivalence`.

## Deploy

Run `npm run web:build` at the root, then from `infra/` (after `npm install` there):
`npx cdk deploy --all -c budgetEmail=<email>`. A custom domain in an existing
Route 53 zone is optional: add `-c domainName=<domain> -c hostedZoneDomain=<zone> -c hostedZoneId=<id>`.
Without one, the site is served on its `*.cloudfront.net` address.

## Repository layout

```
cobol/    Original COBOL programs
src/      Equivalence harness, COBOL semantics, TypeScript ports, proof API
web/      Lab UI (React, three.js)
infra/    AWS CDK app (S3 + CloudFront site, Lambda proof API)
docker/   GnuCOBOL and Lambda images
art/      Blender source and build script for the 3D lab
scripts/  Recording and smoke-test scripts
spikes/   Lambda response-streaming spike (see docs/adr/0001)
docs/     ADRs and developer notes
.kiro/    Kiro specs, steering and hooks used to build the project
```

## License

[MIT](LICENSE)
