# Exora native bridge

Local Tauri plugin used by Exora for Android passkey creation, passkey authentication, and chart fullscreen/orientation control.

- `android/src/main/java/` contains the Android implementation.
- `src/` exposes the Tauri commands and shared request/response types.
- `build.rs` generates command permissions; `permissions/default.toml` selects the app's defaults.

Desktop builds return an unsupported-platform error for these native features. The frontend can still be previewed in a browser.
