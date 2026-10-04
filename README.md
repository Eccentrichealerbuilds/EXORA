# Exora

An Android perpetual trading app for Perpl on Monad testnet, built with React, TypeScript, Tauri, and Rust.

## Project layout

- `src/` — screens, chart rendering, notifications, and Tauri bindings.
- `src-tauri/src/` — market streams, candle history/cache, account data, signing payloads, and contract transactions.
- `tauri-plugin-exora/` — Android passkey and landscape/fullscreen bridge.
- `src-tauri/gen/android/` — Android project, including the customized activity, manifest, resources, and Gradle wrapper.
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
