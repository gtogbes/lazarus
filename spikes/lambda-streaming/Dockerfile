# Spike (reanimation-lab task 1). Build from the repo root:
#   docker build --platform linux/arm64 -f spikes/lambda-streaming/Dockerfile -t lazarus-lambda-spike .
# Runtime base is the exact reference image base from docker/gnucobol/Dockerfile.

ARG NODE_IMAGE=node:24.11.1-bookworm

# 1. Bundle the handler (harness + INTCALC port + fast-check) into one ESM file.
FROM ${NODE_IMAGE} AS bundle
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY spikes/lambda-streaming/handler.ts ./spikes/lambda-streaming/
RUN npx rolldown spikes/lambda-streaming/handler.ts --format esm --platform node -o /out/handler.mjs

# 2. Build aws-lambda-ric (native addon) against bookworm glibc.
FROM ${NODE_IMAGE} AS ric
RUN apt-get update \
 && apt-get install -y --no-install-recommends autoconf automake cmake libtool g++ make python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /function
RUN npm init -y >/dev/null && npm install --no-audit --no-fund aws-lambda-ric@4.0.2

# 3. Runtime: same pinned Debian + gnucobol3 as the local reference.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol3=3.1.2-5+b1 coreutils \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ric /usr/local/bin/node /usr/local/bin/node
COPY cobol/programs/INTCALC.cbl /tmp/build/
RUN mkdir -p /opt/lazarus/bin \
 && cobc -x -o /opt/lazarus/bin/INTCALC /tmp/build/INTCALC.cbl \
 && rm -rf /tmp/build
ENV LAMBDA_TASK_ROOT=/var/task AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
WORKDIR /var/task
COPY --from=ric /function/node_modules ./node_modules
COPY --from=bundle /out/handler.mjs ./
ENTRYPOINT ["/usr/local/bin/node", "/var/task/node_modules/aws-lambda-ric/index.mjs"]
CMD ["handler.handler"]
