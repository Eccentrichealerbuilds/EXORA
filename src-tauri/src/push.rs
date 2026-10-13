//! Push is informational: it may select a screen but never confirm or submit a trade.
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_exora::{ExoraExt, PushMessage};
static SEEN: LazyLock<Mutex<VecDeque<String>>> = LazyLock::new(|| Mutex::new(VecDeque::new()));
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Notice {
	title: String,
	body: String,
	screen: String,
	market_id: Option<u32>,
	tapped: bool,
}
fn notice(message: PushMessage, now: u64) -> Option<Notice> {
	if message.id.is_empty()
		|| message.id.len() > 200
		|| message.title.len() > 400
		|| message.body.len() > 2000
	{
		return None;
	}
	let fresh = message
		.observed_at
		.as_deref()
		.and_then(|s| s.parse::<u64>().ok())
		.is_some_and(|t| t <= now.saturating_add(60) && now.saturating_sub(t) <= 300);
	if !fresh && !message.tapped {
		return None;
	}
	let screen = match message.screen.as_str() {
		"trade" | "portfolio" | "activity" => message.screen,
		_ => "alerts".into(),
	};
	Some(Notice {
		title: if fresh {
			message.title
		} else {
			"EXORA notification".into()
		},
		body: if fresh {
			message.body
		} else {
			"This notification is older. Refresh your data for the current state."
				.into()
		},
		screen,
		market_id: message.market_id.and_then(|s| s.parse().ok()),
		tapped: message.tapped,
	})
}
#[tauri::command]
pub async fn drain_push_inbox(app: AppHandle) -> Result<(), String> {
	let inbox = app
		.exora()
		.take_push_inbox()
		.await
		.map_err(|_| "Could not read device notifications")?;
	let now = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_secs();
	for message in inbox.events.into_iter().take(20) {
		if !message.tapped
			&& message.id.len() == 32
			&& message.id.bytes().all(|c| c.is_ascii_hexdigit())
			&& !crate::alerts::accept_remote_alert(&app, &message.id)
		{
			continue;
		}
		let key = format!("{}:{}", message.id, message.tapped);
		let Some(notice) = notice(message, now) else {
			continue;
		};
		let mut seen = SEEN
			.lock()
			.map_err(|_| "Notifications are temporarily busy")?;
		if seen.contains(&key) {
			continue;
		}
		seen.push_back(key);
		if seen.len() > 100 {
			seen.pop_front();
		}
		drop(seen);
		let _ = app.emit("exora-push", notice);
	}
	Ok(())
}
#[cfg(test)]
mod tests {
	use super::*;
	fn message() -> PushMessage {
		PushMessage {
			id: "message-1".into(),
			tapped: false,
			title: "Price alert".into(),
			body: "Refresh prices".into(),
			screen: "https://untrusted.example".into(),
			market_id: Some("16".into()),
			observed_at: Some("1000".into()),
		}
	}
	#[test]
	fn routes_are_allowlisted_and_stale_notifications_do_not_reappear() {
		assert_eq!(notice(message(), 1000).unwrap().screen, "alerts");
		assert!(notice(message(), 1301).is_none());
		let mut tapped = message();
		tapped.tapped = true;
		assert_eq!(notice(tapped, 1301).unwrap().title, "EXORA notification");
	}
}
