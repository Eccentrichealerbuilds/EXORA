//! Device-local, bounded UI preferences and cached read-only data. Never stores signing keys.
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
	fs,
	io::Write,
	path::PathBuf,
	sync::{LazyLock, Mutex},
};
use tauri::{AppHandle, Manager};
static LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
	pub data_saver: bool,
	pub keep_recent_charts: bool,
	pub lock_on_return: bool,
	pub hide_wallet_in_shares: bool,
	pub haptic_feedback: bool,
	pub notification_sounds: bool,
}
impl Default for Preferences {
	fn default() -> Self {
		Self {
			data_saver: true,
			keep_recent_charts: true,
			lock_on_return: false,
			hide_wallet_in_shares: true,
			haptic_feedback: true,
			notification_sounds: true,
		}
	}
}
fn directory(app: &AppHandle) -> Result<PathBuf, String> {
	let path = app
		.path()
		.app_local_data_dir()
		.map_err(|_| "Device storage is unavailable")?
		.join("read-cache");
	fs::create_dir_all(&path).map_err(|_| "Device storage is unavailable")?;
	Ok(path)
}
pub fn read<T: DeserializeOwned>(app: &AppHandle, key: &str) -> Option<T> {
	let _guard = LOCK.lock().ok()?;
	let bytes = fs::read(directory(app).ok()?.join(format!("{key}.json"))).ok()?;
	serde_json::from_slice(&bytes).ok()
}
pub fn write<T: Serialize>(app: &AppHandle, key: &str, value: &T) -> Result<(), String> {
	let _guard = LOCK.lock().map_err(|_| "Device storage is busy")?;
	let dir = directory(app)?;
	let bytes = serde_json::to_vec(value).map_err(|_| "Could not save this data")?;
	if bytes.len() > 4_000_000 {
		return Err("This saved data is too large".into());
	}
	let path = dir.join(format!("{key}.json"));
	let tmp = path.with_extension("tmp");
	let mut options = fs::OpenOptions::new();
	options.create(true).truncate(true).write(true);
	#[cfg(unix)]
	{
		use std::os::unix::fs::OpenOptionsExt;
		options.mode(0o600);
	}
	let mut file = options
		.open(&tmp)
		.map_err(|_| "Could not save device data")?;
	file.write_all(&bytes)
		.and_then(|_| file.sync_all())
		.map_err(|_| "Could not save device data")?;
	fs::rename(tmp, path).map_err(|_| "Could not save device data")?;
	// Chart/history caches may be evicted; preferences and personal notes never are.
	let mut entries: Vec<_> = fs::read_dir(dir)
		.map_err(|_| "Could not read device data")?
		.filter_map(Result::ok)
		.filter(|entry| entry.file_name().to_string_lossy().starts_with("cache-"))
		.filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
		.collect();
	entries.sort_by_key(|(time, _)| *time);
	let remove = entries.len().saturating_sub(24);
	for (_, path) in entries.into_iter().take(remove) {
		let _ = fs::remove_file(path);
	}
	Ok(())
}
pub fn wallet_key(address: &str) -> Result<String, String> {
	let address: alloy::primitives::Address =
		address.parse().map_err(|_| "Invalid wallet address")?;
	Ok(address.to_string().to_lowercase())
}
#[tauri::command]
pub fn get_preferences(app: AppHandle) -> Preferences {
	read(&app, "preferences").unwrap_or_default()
}
#[tauri::command]
pub fn save_preferences(app: AppHandle, preferences: Preferences) -> Result<(), String> {
	write(&app, "preferences", &preferences)
}
#[tauri::command]
pub fn clear_read_cache(app: AppHandle) -> Result<(), String> {
	let _guard = LOCK.lock().map_err(|_| "Device storage is busy")?;
	for entry in fs::read_dir(directory(&app)?)
		.map_err(|_| "Could not read saved data")?
		.filter_map(Result::ok)
	{
		if entry.file_name().to_string_lossy().starts_with("cache-") {
			fs::remove_file(entry.path()).map_err(|_| "Could not clear saved data")?;
		}
	}
	crate::candles::clear_cache();
	Ok(())
}
#[tauri::command]
pub fn get_journal_note(app: AppHandle, address: String, id: String) -> Result<String, String> {
	Ok(read::<std::collections::BTreeMap<String, String>>(
		&app,
		&format!("notes-{}", wallet_key(&address)?),
	)
	.unwrap_or_default()
	.get(&id)
	.cloned()
	.unwrap_or_default())
}
#[tauri::command]
pub fn save_journal_note(
	app: AppHandle,
	address: String,
	id: String,
	note: String,
) -> Result<(), String> {
	if id.len() > 256 || note.len() > 8000 {
		return Err("Keep your note under 8,000 characters".into());
	}
	let key = format!("notes-{}", wallet_key(&address)?);
	let mut notes: std::collections::BTreeMap<String, String> =
		read(&app, &key).unwrap_or_default();
	if note.is_empty() {
		notes.remove(&id);
	} else {
		notes.insert(id, note);
	}
	write(&app, &key, &notes)
}
