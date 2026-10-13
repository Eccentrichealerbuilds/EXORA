//! Price and read-only account subscriptions. Device secrets stay in private storage and never enter the WebView.
use crate::alerts::PriceAlert;
use alloy::primitives::hex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
	fs,
	io::Write,
	path::PathBuf,
	sync::{
		atomic::{AtomicU64, Ordering},
		LazyLock, Mutex,
	},
	time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_exora::ExoraExt;
const URL: &str = "https://exora-alerts.eccentrichealer.xyz";
static FILE_LOCK: Mutex<()> = Mutex::new(());
static SYNC: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));
static GENERATION: AtomicU64 = AtomicU64::new(0);
#[derive(Clone, Serialize, Deserialize)]
struct Credential {
	address: String,
	installation_id: String,
	token: String,
	#[serde(default)]
	account_consent: bool,
}
#[derive(Default, Serialize, Deserialize)]
struct Saved {
	credential: Option<Credential>,
	#[serde(default)]
	revocations: Vec<Credential>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
	connected: bool,
	pending_removal: bool,
	account_connected: bool,
	account_healthy: bool,
}
fn file(app: &AppHandle) -> Result<PathBuf, String> {
	let dir = app
		.path()
		.app_local_data_dir()
		.map_err(|_| "Device storage is unavailable")?
		.join("remote-alerts");
	fs::create_dir_all(&dir).map_err(|_| "Device storage is unavailable")?;
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
			.map_err(|_| "Could not protect notification settings")?;
	}
	Ok(dir.join("device.json"))
}
fn read(app: &AppHandle) -> Result<Saved, String> {
	match fs::read(file(app)?) {
		Ok(bytes) => serde_json::from_slice(&bytes)
			.map_err(|_| "Could not read notification settings".into()),
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Saved::default()),
		Err(_) => Err("Could not read notification settings".into()),
	}
}
fn write(app: &AppHandle, saved: &Saved) -> Result<(), String> {
	let path = file(app)?;
	let tmp = path.with_extension("tmp");
	let mut options = fs::OpenOptions::new();
	options.write(true).create(true).truncate(true);
	#[cfg(unix)]
	{
		use std::os::unix::fs::OpenOptionsExt;
		options.mode(0o600);
	}
	let mut f = options
		.open(&tmp)
		.map_err(|_| "Could not save notification settings")?;
	f.write_all(
		&serde_json::to_vec(saved).map_err(|_| "Could not save notification settings")?,
	)
	.and_then(|_| f.sync_all())
	.map_err(|_| "Could not save notification settings")?;
	fs::rename(tmp, path).map_err(|_| "Could not save notification settings".into())
}
fn client() -> Result<reqwest::Client, String> {
	reqwest::Client::builder()
		.timeout(Duration::from_secs(12))
		.redirect(reqwest::redirect::Policy::none())
		.build()
		.map_err(|_| "Notification connection is unavailable".into())
}
async fn response(request: reqwest::RequestBuilder) -> Result<Value, String> {
	let response = request.send().await.map_err(|_| {
		"Could not reach the alert service. Check your connection and retry."
	})?;
	let status = response.status();
	if !status.is_success() {
		return Err(match status.as_u16() {
			401 => "Reconnect this device to manage remote alerts.",
			409 => "This alert changed. Remove it and create a new alert.",
			429 => "Alert setup is busy. Wait a few minutes and retry.",
			400 => "Check the market, price and condition for your alerts.",
			_ => "The alert service is temporarily unavailable. Please retry.",
		}
		.into());
	}
	response.json().await.map_err(|_| {
		"The alert service returned an unreadable response. Please retry.".into()
	})
}
pub fn connected_for(app: &AppHandle, address: &str) -> bool {
	let Ok(_guard) = FILE_LOCK.lock() else {
		return false;
	};
	read(app)
		.ok()
		.and_then(|s| s.credential)
		.is_some_and(|c| c.address.eq_ignore_ascii_case(address))
}

async fn revoke_pending(app: &AppHandle) {
	let pending = {
		let Ok(_guard) = FILE_LOCK.lock() else { return };
		read(app).ok().map(|s| s.revocations).unwrap_or_default()
	};
	let Ok(client) = client() else { return };
	for old in pending.into_iter().take(4) {
		let Ok(result) = client
			.delete(format!("{URL}/v1/device"))
			.bearer_auth(&old.token)
			.timeout(Duration::from_secs(4))
			.send()
			.await
		else {
			continue;
		};
		if result.status().is_success()
			|| result.status() == reqwest::StatusCode::UNAUTHORIZED
		{
			if let Ok(_guard) = FILE_LOCK.lock() {
				if let Ok(mut saved) = read(app) {
					saved.revocations.retain(|c| c.token != old.token);
					let _ = write(app, &saved);
				}
			}
		}
	}
}
#[tauri::command]
pub async fn remote_alert_status(app: AppHandle, address: String) -> Result<Status, String> {
	let native = app
		.exora()
		.get_push_status()
		.await
		.map_err(|_| "Could not read device notification settings")?;

	let saved = {
		let _guard = FILE_LOCK
			.lock()
			.map_err(|_| "Notification settings are busy")?;
		read(&app)?
	};
	let connected = native.enabled
		&& saved.credential.as_ref().is_some_and(|c| {
			c.address.eq_ignore_ascii_case(&address)
				&& Some(&c.installation_id) == native.installation_id.as_ref()
		});
	let account_connected =
		connected && saved.credential.as_ref().is_some_and(|c| c.account_consent);
	let mut account_healthy = false;
	if account_connected {
		let c = saved.credential.as_ref().unwrap();
		if let Ok(value) = response(
			client()?
				.get(format!("{URL}/v1/account"))
				.bearer_auth(&c.token)
				.timeout(Duration::from_secs(4)),
		)
		.await
		{
			account_healthy = value["healthy"] == true;
		}
	}
	Ok(Status {
		connected,
		pending_removal: !saved.revocations.is_empty(),
		account_connected,
		account_healthy,
	})
}
#[tauri::command]
pub async fn connect_remote_alerts(
	app: AppHandle,
	address: String,
) -> Result<Vec<PriceAlert>, String> {
	let address = crate::local_data::wallet_key(&address)?;
	let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
	let native = app
		.exora()
		.get_push_status()
		.await
		.map_err(|_| "Could not read device notification settings")?;
	let fid = native
		.installation_id
		.filter(|_| native.enabled)
		.ok_or("Connect this device to Firebase first")?;
	let claim = hex::encode(rand::random::<[u8; 32]>());
	let claim_hash = hex::encode(Sha256::digest(claim.as_bytes()));
	let client = client()?;
	// Remove any stale verification from an earlier interrupted setup.
	let _ = app.exora().take_push_verification().await;
	let registration = response(
		client.post(format!("{URL}/v1/enroll"))
			.json(&json!({"installationId":fid,"claimHash":claim_hash})),
	)
	.await?;
	let id = registration["registrationId"]
		.as_str()
		.filter(|s| s.len() == 64)
		.ok_or("Could not start device verification")?
		.to_string();
	let deadline = Instant::now() + Duration::from_secs(30);
	let verification = loop {
		if GENERATION.load(Ordering::SeqCst) != generation {
			return Err("Notification setup was canceled".into());
		}
		if Instant::now() > deadline {
			return Err("Device verification timed out. Keep EXORA open, check your connection and retry.".into());
		}
		let inbox = app
			.exora()
			.take_push_verification()
			.await
			.map_err(|_| "Could not verify this device")?;
		if let Some(value) = inbox.verification {
			if value.registration_id == id && value.claim_hash == claim_hash {
				break value;
			}
		}
		tokio::time::sleep(Duration::from_millis(500)).await;
	};
	let confirmed = response(client.post(format!("{URL}/v1/confirm")).json(
		&json!({"registrationId":id,"claimSecret":claim,"challenge":verification.challenge}),
	))
	.await?;
	let token = confirmed["token"]
		.as_str()
		.filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
		.ok_or("Could not finish device verification")?
		.to_string();
	let credential = Credential {
		address: address.clone(),
		installation_id: fid,
		token,
		account_consent: false,
	};
	let canceled = {
		let _guard = FILE_LOCK
			.lock()
			.map_err(|_| "Notification settings are busy")?;
		let mut saved = read(&app)?;
		let canceled = GENERATION.load(Ordering::SeqCst) != generation;
		if canceled {
			saved.revocations.push(credential);
		} else {
			if let Some(previous) = saved.credential.replace(credential) {
				saved.revocations.push(previous);
			}
		}
		write(&app, &saved)?;
		canceled
	};
	let cleanup = app.clone();
	tauri::async_runtime::spawn(async move {
		revoke_pending(&cleanup).await;
	});
	if canceled {
		return Err("Notification setup was canceled".into());
	}
	sync_remote_alerts(app, address).await
}
#[tauri::command]
pub async fn disconnect_remote_alerts(app: AppHandle) -> Result<(), String> {
	GENERATION.fetch_add(1, Ordering::SeqCst);
	let address = {
		let _guard = FILE_LOCK
			.lock()
			.map_err(|_| "Notification settings are busy")?;
		let mut saved = read(&app)?;
		let old = saved.credential.take();
		let address = old.as_ref().map(|c| c.address.clone());
		if let Some(old) = old {
			saved.revocations.push(old);
		}
		write(&app, &saved)?;
		address
	};
	if let Some(address) = address {
		crate::alerts::set_remote_state(&app, &address, &[], &[])?;
	}
	revoke_pending(&app).await;
	let _guard = FILE_LOCK
		.lock()
		.map_err(|_| "Notification settings are busy")?;
	if !read(&app)?.revocations.is_empty() {
		return Err("Remote removal is waiting for a connection. Device notifications are disabled here.".into());
	}
	Ok(())
}
#[tauri::command]
pub async fn sync_remote_alerts(
	app: AppHandle,
	address: String,
) -> Result<Vec<PriceAlert>, String> {
	let cleanup = app.clone();
	tauri::async_runtime::spawn(async move {
		revoke_pending(&cleanup).await;
	});
	let _sync = SYNC.lock().await;
	let address = crate::local_data::wallet_key(&address)?;
	let credential = {
		let _guard = FILE_LOCK
			.lock()
			.map_err(|_| "Notification settings are busy")?;
		read(&app)?.credential.filter(|c| c.address == address)
	};
	let Some(credential) = credential else {
		return crate::alerts::saved_alerts(&app, &address);
	};
	let generation = GENERATION.load(Ordering::SeqCst);
	let client = client()?;
	let native = app
		.exora()
		.get_push_status()
		.await
		.map_err(|_| "Could not read notification settings")?;
	if !native.enabled || native.installation_id.as_ref() != Some(&credential.installation_id) {
		return Err("Reconnect this device to resume remote alerts.".into());
	}
	let remote = response(
		client.get(format!("{URL}/v1/alerts"))
			.bearer_auth(&credential.token),
	)
	.await?;
	let triggered: Vec<String> = remote["alerts"]
		.as_array()
		.ok_or("Could not read remote alert status")?
		.iter()
		.filter(|v| v["triggered"] == true)
		.filter_map(|v| v["id"].as_str().map(String::from))
		.collect();
	let current = crate::alerts::saved_alerts(&app, &address)?;
	let rules:Vec<Value>=current.iter().filter(|a|!a.triggered&&!triggered.contains(&a.id)).map(|a|json!({"id":a.id,"marketId":a.market_id,"watch":a.watch,"direction":a.direction,"targetPrice":a.target_price})).collect();
	response(
		client.put(format!("{URL}/v1/alerts"))
			.bearer_auth(&credential.token)
			.json(&rules),
	)
	.await?;
	if GENERATION.load(Ordering::SeqCst) != generation {
		return Err("The notification session changed".into());
	}
	let remote_ids: Vec<String> = rules
		.iter()
		.filter_map(|v| v["id"].as_str().map(String::from))
		.collect();
	let items = crate::alerts::set_remote_state(&app, &address, &remote_ids, &triggered)?;
	if credential.account_consent {
		sync_account(&app, &credential).await?;
	}
	Ok(items)
}

async fn sync_account(app: &AppHandle, credential: &Credential) -> Result<(), String> {
	let (token, key) = crate::perpl::read_key::stored_key(app, &credential.address)?
		.ok_or("Reconnect read-only Perpl wallet data to resume account alerts.")?;
	let prefs = crate::alerts::get_alert_preferences(app.clone(), credential.address.clone())?;
	let request=client()?.put(format!("{URL}/v1/account")).bearer_auth(&credential.token).json(&json!({
        "address":credential.address,"apiKey":token,"secret":key.to_bytes(),"scopeMask":1,
        "orderFills":prefs.order_fills,"slTpUpdates":prefs.sl_tp_updates,"liquidationThreshold":prefs.liquidation_threshold
    }));
	let result = request
		.send()
		.await
		.map_err(|_| "Account alert sync is waiting for a connection. Please retry.")?;
    if !result.status().is_success() {
        eprintln!("Account alert sync failed: HTTP {}", result.status().as_u16());
        return Err(match result.status().as_u16() {
            451 => "Account alerts are currently unavailable.",
            424 => "Perpl read access needs renewal. Sign in again to restore account monitoring.",
            409 => "Perpl is still indexing your account. Monitoring will retry automatically.",
            429 => "Account monitoring is busy. EXORA will retry automatically.",
            400 => "Account monitoring settings could not be verified. Please retry.",
            _ => "Account monitoring is temporarily unavailable. EXORA will retry automatically.",
        }.into());
    }
	Ok(())
}
#[tauri::command]
pub async fn enable_remote_account_alerts(app: AppHandle, address: String) -> Result<(), String> {
	let _sync = SYNC.lock().await;
	let generation = GENERATION.load(Ordering::SeqCst);
	let credential = {
		let _guard = FILE_LOCK
			.lock()
			.map_err(|_| "Notification settings are busy")?;
		read(&app)?
			.credential
			.filter(|c| c.address.eq_ignore_ascii_case(&address))
			.ok_or("Enable closed-app notifications first")?
	};
	sync_account(&app, &credential).await?;
	let _guard = FILE_LOCK
		.lock()
		.map_err(|_| "Notification settings are busy")?;
	let mut saved = read(&app)?;
	if generation != GENERATION.load(Ordering::SeqCst) {
		return Err("Notification session changed".into());
	}
	let current = saved
		.credential
		.as_mut()
		.filter(|c| c.token == credential.token)
		.ok_or("Notification session changed")?;
	current.account_consent = true;
	write(&app, &saved)
}
pub fn account_connected(app: &AppHandle, address: &str) -> bool {
	let Ok(_guard) = FILE_LOCK.lock() else {
		return false;
	};
	read(app)
		.ok()
		.and_then(|s| s.credential)
		.is_some_and(|c| c.account_consent && c.address.eq_ignore_ascii_case(address))
}
