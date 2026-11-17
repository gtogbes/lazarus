# Design: Reanimation lab

## Overview
A static React site (S3 + CloudFront) and one proof API (AWS Lambda running the
same pinned GnuCOBOL build as local development). The browser never runs COBOL;
it asks the API to run the existing harness and streams progress back. Recorded
proofs ship with the site so it still works if the API is down.

```
Browser ──GET──► CloudFront ──► S3 (site, COBOL + port sources, recorded proofs, stills, GLB)
   │
   └──POST /api/prove──► CloudFront ──OAC──► Lambda Function URL (response streaming)
                                              └─ harness: native GnuCOBOL binary + port in-process
```

## Key decisions

| Decision | Choice | Why | Alternatives rejected |
|---|---|---|---|
| Where COBOL runs when hosted | Lambda container image (arm64) | Pay per use, near-zero idle cost, fits a 2-month judging window | Fargate (always-on cost), COBOL to WebAssembly (no maintained toolchain, and the reference would no longer be real GnuCOBOL) |
| Reference build in Lambda | Same Debian bookworm + gnucobol3 3.1.2 as `docker/gnucobol` | The hosted proof must use the identical reference, or it proves nothing | Amazon Linux base (GnuCOBOL not packaged; different libcob) |
| Progress transport | NDJSON over Lambda response streaming | One HTTP request, cancellable with `AbortController`, no WebSocket infra | WebSockets via API Gateway (more infra), polling (laggy) |
| How mutants are defined | Hand-written mutant ports with metadata in `src/ports/<prog>.mutants.ts` | Realistic, explainable mistakes; doubles as a permanent mutation test | Random code mutation (unexplainable), letting visitors edit code (unsafe: arbitrary code execution on our Lambda) |
| No LLM in the hosted app | Ports and mutants are pre-written | Rule: free, unrestricted access until judging ends, without our cost exposure | Live translation (cost, abuse, non-determinism) |
| Frontend stack | Vite + React 19 + TypeScript strict + Tailwind CSS 4; Zustand for proof-run state; React Router | Matches workspace standards; small state surface | Next.js (no SSR needed for a static lab) |
| 3D | plain three.js (own render loop on THREE.Timer) + postprocessing, assets from Blender | See steering `design.md` | Pure CSS/2D (misses the realism goal) |

## Components

### Harness additions (`src/`)
| Module | Responsibility |
|---|---|
| `src/ports/<prog>.layout.ts` | Input and output record layouts: field name, offset, length, PIC. Used to decode records for Requirement 5. |
| `src/ports/<prog>.mutants.ts` | `Mutant[]`: `{ id, title, explanation, rule, equivalent?: string, port }`. `equivalent` holds the reason when no input can expose it. |
| `src/ports/registry.ts` | The allowlist: program ids, descriptions, behaviours, ports, layouts, mutants. The API validates against it. |
| `src/ports/mutants.test.ts` | Requirement 4.5: each non-equivalent mutant must diverge within 2,000 cases. Replaces the manual mutation script. |
| `src/harness/cobol.ts` | Add a runner option: `docker` (local, default) or `native` (Lambda: run `/opt/lazarus/bin/<PROG>` directly with `stdbuf -oL`). |
| `src/api/prove.ts` | Pure function `prove(request, emit, signal)`: validate, start session, call `checkEquivalence` with `onProgress` throttled to 4 Hz, emit events, enforce the 25 s cap, close the session. |
| `src/api/lambda.ts` | Lambda handler wrapping `prove` with `awslambda.streamifyResponse`. |
| `src/api/dev-server.ts` | Local `node:http` server exposing the same `POST /api/prove`, used by the Vite dev proxy. |
| `scripts/record-proofs.ts` | Runs every program and mutant locally with fixed seeds and writes `web/public/recorded/<PROG>[.<mutant>].json`. |

### API contract
`POST /api/prove` with JSON body `{ "program": "PAYROLL", "mutant": "half-up-tax", "seed": 123 }`
(`mutant` and `seed` optional). Response `200 application/x-ndjson`, one event per line:

```jsonc
{ "type": "started", "program": "PAYROLL", "mutant": "half-up-tax", "seed": 123, "reference": "gnucobol 3.1.2", "numRuns": 2000 }
{ "type": "progress", "executions": 412, "divergences": 0, "elapsedMs": 250 }
{ "type": "result", "result": { /* EquivalenceResult, see src/harness/equivalence.ts */ } }
{ "type": "error", "message": "..." }   // run failed (not a divergence)
```
`400` for unknown program or mutant, non-integer seed, or a body over 1 KB.
A run that hits the 25 s cap ends with a `result` of status `equivalent` and the
case count reached, flagged `"truncated": true`.

CloudFront signs requests to the Function URL with Origin Access Control. For
POST, Lambda OAC requires the viewer to send the body's SHA-256 in
`x-amz-content-sha256`; the web client computes it with `crypto.subtle.digest`.
CloudFront uses that viewer header as the payload hash when it signs the origin
request, so the `/api/*` origin request policy forwards only `Content-Type`:
CloudFront rejects `X-Amz-*` names in an origin request policy (task 22 deploy
failure).

### Web app (`web/`)
| Route | View | Notes |
|---|---|---|
| `/` | Landing: lab scene + headline + "Enter the morgue" | 2D overlay is interactive before 3D loads |
| `/morgue` | Program list (Req 1) | Reads `registry` metadata and `recorded/*.json` |
| `/program/:id` | Program view (Req 2-5) | Code panes, Prove button, sabotage panel, counterexample card |

State: one Zustand store `useProofRun` with `{ status, executions, divergences, elapsedMs, result, source: 'live' | 'recorded', error }`
and actions `start(program, mutant?)`, `cancel()`, `replayRecorded()`. The 3D
scene subscribes to the same store, so lighting always matches the real run.

Code panes: highlighted with Shiki at build time (no runtime highlighter cost).
Statement linking: a build step pairs each `// <COBOL statement>` comment in a
port with the first matching statement in the COBOL source (whitespace-normalised)
and emits line-range pairs.

Counterexample card: decodes the input and both outputs with the layout, shows
a table of fields (name, PIC, COBOL value, port value), highlights differences,
shows the mutant's `explanation`, shrink count, and
`LAZARUS_SEED=<seed> npm run test:equivalence`.

### Lab scene (`web/src/scene/`)
- Lazy-loaded chunk (`React.lazy`), mounted after first interaction or idle.
- Placeholder scene from primitives until Blender GLBs exist, so UI work is not blocked.
- Status to look:

| Status | Lighting and motion |
|---|---|
| Buried | Cold key light, dust motes, idle tape reels |
| Reanimating | Arc lights flicker at a rate proportional to cases/s (capped); reels spin |
| Alive | Arc burst, then warm steady light; bloom on the slab (under 3 s) |
| Relapsed | Red alarm light pulse, reels stop |

- Reduced motion or no WebGL: four Cycles stills (one per status), WebP/AVIF.

## Infrastructure (`infra/`, AWS CDK in TypeScript)
- `SiteStack`: private S3 bucket, CloudFront distribution with OAC, CSP and
  security headers via a response headers policy, `/api/*` behaviour to the Function URL (OAC, no caching).
  Optional custom domain, e.g. `lab.example.com` (context `domainName` / `hostedZoneDomain` /
  `hostedZoneId`, or `LAZARUS_DOMAIN` / `LAZARUS_HOSTED_ZONE_DOMAIN` / `LAZARUS_HOSTED_ZONE_ID`;
  never stored in the repo): DNS-validated ACM certificate, TLSv1.2_2021, A/AAAA alias records
  in the owner's existing zone (imported by id, or looked up and cached in CDK's gitignored
  context cache file). Without it the site uses the CloudFront domain and default certificate.
- `ProofApiStack`: Lambda from `docker/lambda/Dockerfile` (arm64, 1,024 MB,
  30 s timeout, reserved concurrency 1), Function URL with `AWS_IAM` auth and
  `RESPONSE_STREAM` invoke mode, log group with 90-day retention.
- No WAF: omitted for cost (owner decision). Protection is the `AWS_IAM` auth
  type, a resource policy that admits only this CloudFront distribution, and
  reserved concurrency 1.
- No VPC: a Function URL stays public even when the function is in a VPC (VPC
  config only changes outbound networking), so a VPC would add cost and cold-start
  time without blocking any request. The function needs no network access.
- Hero scene textures are WebP inside the Draco GLB, not KTX2.
- AWS Budget at USD 10/month with email alert. Tags: Project=lazarus,
  Environment=demo, Owner=gtogbes, CostCenter=kiroween-2026.
- Cost ceiling: worst case is 1 concurrent run, busy all month: 1 x 1 GB x
  2,592,000 s x USD 0.0000133334/GB-s (arm64) is about USD 34.56/month, plus
  requests. This is above Requirement 8.4's USD 20; the owner accepted it on
  task 22 (the budget alert at USD 10 is the backstop). A realistic judging load
  (hundreds of runs) costs well under USD 1/month.

**Deployment is high risk (infrastructure, public endpoint) and needs explicit
approval from the owner before `cdk deploy`.** Always run `cdk diff` first.

## Error handling
- API unreachable, 5xx, or stream ends without `result`: store goes to `error`,
  UI offers the recorded proof (Req 6).
- `error` event (for example the COBOL process crashed): shown as a failure,
  never as Relapsed. A crash is not a divergence.
- Cancel: client aborts the fetch; server sees the closed stream, aborts via
  `AbortSignal` and closes the session.

## Testing
- Unit: layout decoding, statement linking, NDJSON parser, `prove` validation and timeout.
- Mutation test: `mutants.test.ts` (Req 4.5).
- Component: React Testing Library for the morgue, the Prove flow (mocked stream), the counterexample card.
- E2E: one Playwright run against the local dev server: open PAYROLL, prove, sabotage, see the counterexample.
- Accessibility: axe in component tests plus a manual keyboard and VoiceOver pass.

## Risks
| Risk | Mitigation |
|---|---|
| Lambda response streaming with a Debian-based image and the runtime interface client does not work | Spike first (task 1). Fallback: buffered response with progress snapshots that the UI replays, labelled as such |
| 3D eats the schedule | 2D lab is complete first; 3D starts with a placeholder; fixed budget of 5 days for Blender work |
| Blender not installed | Owner installs it; placeholder scene unblocks everything else |
