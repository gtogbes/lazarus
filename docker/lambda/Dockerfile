# Proof API Lambda image (reanimation-lab task 20, ADR 0001). Build from the repo root:
#   npm run lambda:image
# The COBOL reference must be identical to docker/gnucobol/Dockerfile: same Debian
# digest, same gnucobol3/libcob4 build. scripts/lambda-dockerfile.test.ts fails if
# DEBIAN_IMAGE or GNUCOBOL_VERSION drift from that file.
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
ARG GNUCOBOL_VERSION=3.1.2-5+b1
# Node 26 is the active LTS line (24 moved to maintenance on 2026-10-20). Bookworm, to match DEBIAN_IMAGE glibc.
ARG NODE_IMAGE=node:26.13.1-bookworm@sha256:b7087bc4d973034b30854b378ba107f9fab622b47514cb7e2592e41b8bab8d49

# 1. Bundle the handler (src/api/lambda.ts, harness, ports, fast-check) into one ESM file.
FROM ${NODE_IMAGE} AS bundle
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json ./web/
RUN npm ci --workspaces=false --ignore-scripts --no-audit --no-fund
COPY src ./src
RUN npx rolldown src/api/lambda.ts --format esm --platform node -o /out/index.mjs

# 2. Build aws-lambda-ric (native addon) against bookworm glibc. Keep only what runs.
FROM ${NODE_IMAGE} AS ric
RUN apt-get update \
 && apt-get install -y --no-install-recommends autoconf automake cmake libtool g++ make python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /function
COPY docker/lambda/ric/package.json docker/lambda/ric/package-lock.json ./
# Install scripts are run explicitly for this one package rather than for every dependency.
RUN npm ci --ignore-scripts --no-audit --no-fund \
 && cd node_modules/aws-lambda-ric \
 && sh scripts/preinstall.sh && sh scripts/postinstall.sh \
 && mkdir -p /ric/node_modules/@aws /ric/node_modules/aws-lambda-ric \
 && cp package.json index.mjs rapid-client.node LICENSE NOTICE THIRD-PARTY-LICENSES /ric/node_modules/aws-lambda-ric/ \
 && cp -r ../@aws/lambda-invoke-store /ric/node_modules/@aws/

# 3. Compile the COBOL programs with the reference cobc.
FROM ${DEBIAN_IMAGE} AS cobol
ARG GNUCOBOL_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol3=${GNUCOBOL_VERSION} \
 && rm -rf /var/lib/apt/lists/*
COPY cobol/programs/INTCALC.cbl cobol/programs/PAYROLL.cbl cobol/programs/INVOICE.cbl /build/
RUN cobc --version | head -1 | grep -qx 'cobc (GnuCOBOL) 3.1.2.0' \
 && mkdir -p /opt/lazarus/bin \
 && for p in INTCALC PAYROLL INVOICE; do cobc -x -o /opt/lazarus/bin/$p /build/$p.cbl; done

# 4. Runtime: same base, and only the GnuCOBOL runtime library from the same build
#    (libcob4 is what the binaries link; cobc and gcc are not needed to run them).
#    libatomic1: the Node 26 binary links libatomic.so.1, which bookworm-slim lacks.
FROM ${DEBIAN_IMAGE}
ARG GNUCOBOL_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends libcob4=${GNUCOBOL_VERSION} libatomic1 coreutils \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --no-create-home --uid 1001 --shell /usr/sbin/nologin lazarus
COPY --from=ric /usr/local/bin/node /usr/local/bin/node
COPY --from=cobol /opt/lazarus/bin /opt/lazarus/bin
WORKDIR /var/task
COPY --from=ric /ric/node_modules ./node_modules
COPY --from=bundle /out/index.mjs ./
# Root-owned and read-only for the runtime user; Lambda only allows writes to /tmp.
RUN chmod -R a+rX,go-w /var/task /opt/lazarus \
 && /opt/lazarus/bin/INTCALC </dev/null \
 && /usr/local/bin/node --version
ENV LAMBDA_TASK_ROOT=/var/task
# Lambda runs the function as its own non-root user; this applies when run elsewhere.
USER 1001:1001
# No HEALTHCHECK: Lambda ignores it, and the process only serves invocations
# pulled from the Runtime API, so there is nothing to probe between them.
ENTRYPOINT ["/usr/local/bin/node", "/var/task/node_modules/aws-lambda-ric/index.mjs"]
CMD ["index.handler"]
