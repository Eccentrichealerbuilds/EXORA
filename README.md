# Exora

An Android perpetual trading app for Perpl on Monad testnet, built with React, TypeScript, Tauri, Rust, and Kotlin, using Mera by Category Labs for passkey signing.

## Core technologies

- **React + TypeScript** — app screens, state, and interactive charts.
- **Rust + Alloy** — Monad contract interaction, account balances, and Perpl data streams.
- **Tauri** — the app shell and channels/events between the interface and Rust.
- **Kotlin** — Android Credential Manager integration, passkey request/result handling, WebView customization, and native chart orientation.
- **[Mera by Category Labs](https://github.com/category-labs/mera)** (`@category-labs/mera`) — WebAuthn integration, EVM address utilities, and secp256k1 signing sessions used by the passkey wallet.

## Project layout

- `src/` — screens, chart rendering, notifications, and Tauri bindings.
- `src-tauri/src/` — market streams, candle history/cache, account data, signing payloads, and contract transactions.
- `tauri-plugin-exora/` — Rust plugin bindings and the Kotlin Android passkey/fullscreen implementation in `android/src/main/java/`.
- `src-tauri/gen/android/` — Android project, including the Kotlin `MainActivity`, manifest, resources, and Gradle wrapper.
- `src/assets/` — images used by the app.
- `design/blender/` — original Blender scenes for the app's artwork.
- `tests/` — existing regression checks.

## Development

Install Node.js, pnpm, Rust, and the Android SDK/NDK required by Tauri. Then:

```sh
pnpm install --frozen-lockfile
pnpm tauri android dev
```

Use `pnpm dev` for a browser UI preview. Native passkey and trading operations require the Tauri app.

```sh
pnpm build                 # TypeScript check and frontend bundle
pnpm tauri android build   # Android build
```

Tauri regenerates machine-specific Android bindings and settings. Local SDK paths, build outputs, signing keys, environment overrides, and dependency directories are excluded from Git. Keep `pnpm-lock.yaml` and `src-tauri/Cargo.lock` in version control. Do not commit wallet data or private credentials.

## Chart attribution

TradingView Lightweight Charts™

Copyright (с) 2025 TradingView, Inc. <https://www.tradingview.com/>
