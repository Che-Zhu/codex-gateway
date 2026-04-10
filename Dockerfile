FROM rust:1-bookworm AS builder

WORKDIR /build

COPY Cargo.toml Cargo.lock ./
COPY rust-src ./rust-src

RUN cargo build --release --bin codex-gateway --bin codex-gateway-cli

FROM node:22-bookworm-slim

ARG CODEX_VERSION=latest

ENV HOST=0.0.0.0 \
    PORT=1317 \
    CODEX_HOME=/codex-home \
    MAX_SESSIONS=8 \
    SESSION_TTL_MS=1800000 \
    SESSION_SWEEP_INTERVAL_MS=60000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bubblewrap \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@${CODEX_VERSION} \
    && mkdir -p /codex-home \
    && codex --version \
    && apt-get clean

COPY public ./public
COPY --from=builder /build/target/release/codex-gateway /usr/local/bin/codex-gateway
COPY --from=builder /build/target/release/codex-gateway-cli /usr/local/bin/codex-gateway-cli

EXPOSE 1317

CMD ["codex-gateway"]
