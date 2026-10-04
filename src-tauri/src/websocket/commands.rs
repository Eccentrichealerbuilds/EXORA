use std::sync::{atomic::{AtomicU64, Ordering}, Mutex};

use tauri::{async_runtime::JoinHandle, ipc::Channel, AppHandle, State};

use crate::{feed, market_event::MarketEvent, price::PriceUpdate, status};

static NEXT_FEED_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct FeedTask(Mutex<Option<(u64, JoinHandle<()>)>>);

#[tauri::command]
pub fn start_feed(app: AppHandle, task: State<FeedTask>, on_price: Channel<PriceUpdate>,
    on_market: Channel<MarketEvent>, candle_market: Option<u32>, resolution: Option<u32>) -> u64 {
	let mut current = task.0.lock().expect("Feed task lock failed");
	if let Some((_, old_task)) = current.take() {
		old_task.abort();
	}
	let id = NEXT_FEED_ID.fetch_add(1, Ordering::Relaxed);
	*current = Some((id, tauri::async_runtime::spawn(feed::run(app, on_price, Some(on_market), candle_market, resolution))));
	id
}

#[tauri::command]
pub fn stop_feed(app: AppHandle, task: State<FeedTask>, id: u64) {
	let mut current = task.0.lock().expect("Feed task lock failed");
	if current.as_ref().is_some_and(|(current_id, _)| *current_id == id) {
		if let Some((_, running_task)) = current.take() { running_task.abort(); }
		status::send(&app, "disconnected", "Feed stopped");
	}
}
