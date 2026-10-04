const COMMANDS: &[&str] = &["create_passkey", "get_credential", "set_chart_fullscreen"];

fn main() {
	tauri_plugin::Builder::new(COMMANDS)
		.android_path("android")
		.ios_path("ios")
		.build();
}
