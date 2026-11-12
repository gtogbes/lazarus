# ADR 0001: Proof API uses Lambda response streaming (provisional)

- Status: Accepted, provisional until the real-AWS check in reanimation-lab task 22
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

## Not verified locally (task 22 must check on real AWS)
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
