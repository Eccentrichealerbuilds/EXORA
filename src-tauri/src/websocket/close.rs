use tokio_tungstenite::tungstenite::protocol::CloseFrame;

pub fn describe(frame: Option<CloseFrame>) -> String {
	match frame {
		Some(frame) => format!("Server closed (code {}): {}", frame.code, frame.reason),
		None => "Server closed without a close frame".to_string(),
	}
}
