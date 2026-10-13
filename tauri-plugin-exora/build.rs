const COMMANDS: &[&str] = &["create_passkey", "get_credential", "set_chart_fullscreen", "get_push_status", "configure_push", "set_live_session", "watch_push", "unwatch_push"];

fn main() {
	tauri_plugin::Builder::new(COMMANDS)
		.android_path("android")
		.ios_path("ios")
		.build();
}
