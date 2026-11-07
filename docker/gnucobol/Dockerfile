# GnuCOBOL 3.1.2 runtime used as the reference implementation for equivalence tests.
# Base image pinned by digest so the reference behaviour cannot drift.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc

RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol3=3.1.2-5+b1 coreutils \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1001 cobol

USER cobol
WORKDIR /work
