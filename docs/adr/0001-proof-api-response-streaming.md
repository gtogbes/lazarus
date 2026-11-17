# ADR 0001: Proof API uses Lambda response streaming

- Status: Accepted (2026-11-17, after the real-AWS check in reanimation-lab task 22).
  Cancel propagation is not verified on AWS: the owner's log search found no events (see below).
- Date: 2026-11-07
- Spec: `.kiro/specs/reanimation-lab/` task 1 (Requirements 3.1, 3.2)
- Region: us-east-1

## Context
The proof API must run real GnuCOBOL 3.1.2 and stream progress at 4 Hz or more
(Requirement 3.2). The design runs it as a Lambda container image built on the
same pinned Debian bookworm + `gnucobol3=3.1.2-5+b1` as `docker/gnucobol`, with
the Node runtime interface client (`aws-lambda-ric`) instead of an AWS base
image. Response streaming is officially supported on the Node managed runtimes.
It was not known whether it works through the RIC on a non-AWS base.

## Decision
Use **NDJSON over Lambda response streaming** (`awslambda.streamifyResponse` and
`HttpResponseStream.from`, Function URL invoke mode `RESPONSE_STREAM`).
Keep the buffered fallback from the design's risk table in reserve. Switch to it
only if task 22 finds that a real Function URL buffers the response.

## Evidence (local only, no AWS resources created)
Spike code: `spikes/lambda-streaming/`. Image: Debian bookworm (pinned digest),
`gnucobol3` 3.1.2, Node 24.11.1 copied from `node:24.11.1-bookworm`, `aws-lambda-ric`
4.0.2 built against bookworm glibc, INTCALC compiled with the image's `cobc`. Run
under Lambda Runtime Interface Emulator v1.38 (arm64, sha256 `65ade4687c22c308ff7acac6974d088d8aafaadea59e61985a083bad86f921d2`)
with `--read-only --tmpfs /tmp --user 993:990 --memory 1024m` to match Lambda's
read-only root, non-root user and memory size.

| Check | Result |
|---|---|
| Image builds; RIC native addon loads on bookworm-slim | Yes. Init 47 ms |
| `cobc --version` in the spike image vs `lazarus-gnucobol:3.1.2` | Both `cobc (GnuCOBOL) 3.1.2.0` |
| INTCALC proof, seed 123, 2,000 cases, native binary | `equivalent`, 2,000 cases, 139 ms |
| Same seed and count through the Docker reference (`LAZARUS_SEED=123 LAZARUS_RUNS=2000 npx vitest --run src/ports/intcalc.equivalence.test.ts`) | Passed |
| RIC to Runtime API, 60,000-case run (a tap proxy between RIC and the emulator, now `scripts/lambda/runtime-api-tap.ts`) | `Lambda-Runtime-Function-Response-Mode: streaming`, `Transfer-Encoding: chunked`, 18 chunks: prelude JSON, the 8-byte NUL delimiter, `started` at +1 ms, then one `progress` chunk every 250 ms (+245 … +3,245 ms), final `result` at +3,395 ms |
| Emulator to HTTP client | **Buffered.** One chunk at the end, `Content-Length` set, `Content-Type: application/octet-stream`, prelude bytes passed through raw. The emulator does not reproduce Function URL streaming. |

So the image and RIC do their part: chunks leave the function in real time at
4 Hz. The emulator's own HTTP front end is the only thing that buffered.

## Not verified locally (checked on AWS in task 22, results below)
1. A Function URL with `RESPONSE_STREAM` delivers the chunks incrementally to a
   client (first `progress` line well before the `result` line).
2. The same through CloudFront with OAC on `/api/*`, with caching disabled.
   CloudFront or compression must not buffer `application/x-ndjson`.
3. The prelude sets status and `content-type: application/x-ndjson` on the
   viewer response (locally it only appeared as raw bytes).
4. Client disconnect reaches the handler, so cancel (Requirement 3.5) can abort the run.
5. Cold start and image pull time on arm64 Lambda (spike image 455 MB; the task 20 image is 264 MB).

Pass criterion for task 22: with a long run, the client logs at least 4
`progress` lines per second, starting within 1 s of the request.
If it fails: buffered fallback (one response with progress snapshots that the UI replays, labelled as such).

## Real-AWS results (task 22, 2026-11-17)
Both stacks deployed in us-east-1: site on the owner's custom domain (`https://lab.example.com`
here; CloudFront `<distribution>.cloudfront.net`), API on `POST /api/prove` through CloudFront to the
Function URL. Account, domain and resource identifiers are left out of this record. All checks used plain HTTPS from a laptop (curl and a Node
`fetch` client that timestamps each NDJSON line as it arrives). No AWS API calls.
Times are from sending the request.

**1. Function URL streams, and 2. CloudFront does not buffer it: yes.** Every
`progress` line arrived in its own chunk, about 250 ms after the one before it.
The response had `transfer-encoding: chunked`, no `content-length`, no
`content-encoding`, and `x-cache: Miss from cloudfront`.

| Run (seed) | Headers and `started` | `progress` lines (arrival, cases) | `result` | Rate |
|---|---|---|---|---|
| PAYROLL (123), first request, cold | +2,403 ms | +2,404 (0), +2,690 (0), +3,087 (0), +3,247 (0), +3,392 (150), +3,739 (575), +3,922 (1,012), +4,182 (1,636), +4,284 (2,000) | +4,284 ms, equivalent, 2,000 cases, run 2,142 ms | 4.26/s |
| PAYROLL (123), warm | +422 ms | +585 (577), +846 (1,241), +1,068 (2,000) | +1,068 ms, equivalent, 2,000 cases, run 738 ms | 4.14/s |
| INTCALC (123), warm | +314 ms | +564 (633), +824 (1,337), +1,032 (2,000) | +1,032 ms, equivalent, 2,000 cases, run 724 ms | 4.27/s |
| INTCALC (20261204), warm | +355 ms | +597 (781), +852 (1,455), +1,038 (2,000) | +1,038 ms, equivalent, 2,000 cases, run 691 ms | 4.54/s |
| INVOICE `half-up-vat` (20261204) | +329 ms | +473 (636, shrinking) | +473 ms, diverged at case 86, 16 shrinks, run 152 ms | one snapshot |
| INTCALC `truncate-interest` (20261204) | +317 ms | +424 (490, shrinking) | +424 ms, diverged at case 1, 244 shrinks, run 113 ms | one snapshot |
| PAYROLL `half-up-tax` (123) | +313 ms | +331 (73, shrinking) | +331 ms, diverged, 12 shrinks, `shrinkPath` with 13 steps | one snapshot |

Against the pass criterion: warm runs give 4.1 to 4.5 `progress` lines per second,
with the first at 0.56 to 0.60 s. That passes. The cold first request also streamed
at 4.26/s, but its first line arrived at 2.4 s, so it misses the 1 s part. The
`started` line and the first `progress` line arrived together in that case, and
the run itself took 2.1 s (warm runs take about 0.7 s).

No run is "long" any more. With 2,000 cases fixed by the server, the slowest warm
run is a real port at about 0.7 s, which gives three live `progress` lines. Every
mutant finishes inside the first 250 ms tick, so the client sees one final
snapshot and then the result. Lambda at 1,024 MB is about 5 times slower than the
local spike (0.7 s against 140 ms), which helps here: real-port runs show live counters.

**3. Status and content type on the viewer response: correct.**
- A valid request gets `200 application/x-ndjson`, `started`, then `progress` lines
  (with `cases` and `phase`), then `result`.
- Unknown program, non-integer seed and invalid JSON each get `400 application/json`,
  for example `{"error":"Unknown program"}`.
- `content-type: text/plain` gets `415`, and GET gets `405` with `allow: POST`.
- Without `x-amz-content-sha256`, or with a wrong hash, the response is `403` with
  `x-cache: Error from cloudfront` and Lambda's "request signature we calculated
  does not match" message. The web client always sends the header.
- The Function URL called directly without a signature gets `403 {"Message":"Forbidden"}`.

**Concurrency 1.** Three proofs sent at once: one `200`, and two
`429 {"Reason":"ReservedFunctionConcurrentInvocationLimitExceeded","Type":"User","message":"Rate Exceeded."}`
passed through CloudFront in about 0.3 s. In the browser, a Prove that got the 429 showed
"Proof failed" with "The proof service answered HTTP 429", plus the offer to replay the
recorded proof. The replay ended Alive, labelled "Recorded" with its date.

**4. Cancel: not verified on AWS.** Clients closed the connection mid-stream
(after `started`, or after the first `progress` line) seven times between 21:30:56Z
and 21:32:33Z (request IDs `<request-id-1>` to `<request-id-6>`, plus one whose ID
was not captured). A proof sent straight after each abort got `200` six times out
of seven and `429` once. That does not settle it, because the abandoned run had at
most about 0.4 s left and the new request spends about 0.3 s getting through
CloudFront. The handler logs `proof cancelled` with the request ID when the abort
reaches it. The owner's CloudWatch Logs `filter-log-events` search of the function's
log group for "proof cancelled" over that window returned
`{"events": [], "searchedLogStreams": []}`, so no log event shows an abort reaching
the handler. Cancel propagation through CloudFront to the function stays unverified.
The cost of an abandoned run is bounded either way: the 25 s run cap ends it, and
reserved concurrency 1 means at most one such run at a time.

**5. Cold start.** First request of the session: response headers at 2.40 s, against
0.31 to 0.42 s warm, and the 2,000-case run took 2.1 s instead of 0.7 s. The `Init
Duration` in the Lambda `REPORT` log line for that request
(`<request-id-cold>`, 21:27:48Z) would split this into image start
and slow first COBOL runs. It was not read, because reading it needs AWS credentials.

**Decision.** Keep NDJSON over Lambda response streaming. The buffered fallback is not
needed. The cold-start delay is accepted. It only affects the first visitor after a
quiet spell, and that visitor still sees counters move at 4 Hz once the run starts.

## Consequences
- A native 2,000-case INTCALC proof takes about 140 ms, so most live runs finish
  in under a second. Streaming matters most for the slower programs and mutant
  shrinking. The UI still needs a sensible display when the run finishes before the first 250 ms tick.
- The local dev server (task 7) should stream over plain `node:http`, because the
  emulator cannot be used to test the UI's streaming behaviour.
- Task 20 can reuse the spike's three-stage Dockerfile layout (bundle, RIC build, bookworm runtime).

## Follow-up: task 20 (2026-11-09)
The real image is `docker/lambda/Dockerfile` (`npm run lambda:image`), with the
handler in `src/api/lambda.ts`. It compiles all three programs with the
reference `cobc` in a build stage and ships only `libcob4=3.1.2-5+b1` at
runtime (no compiler), which takes the image from 455 MB to 264 MB.
`scripts/lambda-dockerfile.test.ts` fails if its base digest or GnuCOBOL version
drift from `docker/gnucobol/Dockerfile`. `npm run lambda:smoke` repeats the
checks above against the real image (streaming mode through the tap, emulator
buffering) and checks the API contract.

Found on the way: `aws-lambda-ric` 4.0.2 writes the `HttpResponseStream.from`
prelude on the first `write()` call only. `end(chunk)` skips it, so the status
code and headers are lost. The handler always uses `write()` then `end()`.
The spike in `spikes/lambda-streaming/` is kept so the 60,000-case timing above
stays reproducible (the real API fixes 2,000 cases, which finish before the
first 250 ms tick).

## Reproduce
```sh
docker build --platform linux/arm64 -f spikes/lambda-streaming/Dockerfile -t lazarus-lambda-spike .
mkdir -p ~/.aws-lambda-rie && curl -fsSL -o ~/.aws-lambda-rie/aws-lambda-rie \
  https://github.com/aws/aws-lambda-runtime-interface-emulator/releases/download/v1.38/aws-lambda-rie-arm64 \
  && chmod +x ~/.aws-lambda-rie/aws-lambda-rie
docker run -d --name lazarus-spike -p 127.0.0.1:9000:8080 --read-only --tmpfs /tmp --user 993:990 --memory 1024m \
  -v ~/.aws-lambda-rie:/aws-lambda:ro -v "$PWD/scripts/lambda/runtime-api-tap.ts:/spike/runtime-api-tap.ts:ro" \
  --entrypoint /aws-lambda/aws-lambda-rie lazarus-lambda-spike /bin/sh -c \
  'node /spike/runtime-api-tap.ts & sleep 0.5; export _HANDLER=handler.handler AWS_LAMBDA_RUNTIME_API=127.0.0.1:9002; exec node /var/task/node_modules/aws-lambda-ric/index.mjs handler.handler'
node spikes/lambda-streaming/client.ts http://localhost:9000/2015-03-31/functions/function/invocations 123 60000
docker logs lazarus-spike 2>&1 | grep '\[tap\]'
docker rm -f lazarus-spike
```
