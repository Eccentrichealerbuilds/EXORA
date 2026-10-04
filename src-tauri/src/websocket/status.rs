use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct ConnectionState<'a> {
	state: &'a str,
	message: &'a str,
}

pub fn send(app: &AppHandle, state: &str, message: &str) {
	let payload = ConnectionState { state, message };
	let _ = app.emit("connection-state", payload);
}
