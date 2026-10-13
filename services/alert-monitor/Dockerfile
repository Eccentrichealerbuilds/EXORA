FROM rust:1.95-bookworm AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --locked --release
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd -u 10001 -m exora
COPY --from=build /build/target/release/exora-alert-monitor /usr/local/bin/
USER exora
WORKDIR /data
ENTRYPOINT ["exora-alert-monitor"]
