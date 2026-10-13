//! Price and opted-in read-only account monitoring. No wallet signing keys or order submission.
mod accounts;
mod api;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
	collections::{HashMap, HashSet},
	env, fs,
	path::Path,
	time::{Duration, SystemTime, UNIX_EPOCH},
};
type Error = Box<dyn std::error::Error + Send + Sync>;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Alert {
	id: String,
	installation_id: String,
	market_id: u32,
	watch: String,
	direction: String,
	target_price: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Delivery {
	created: u64,
	body: String,
	state: String,
}
fn now() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_secs()
}
fn amount(text: &str, decimals: u32) -> Option<u128> {
	if decimals > 18 {
		return None;
	}
	let mut parts = text.split('.');
	let whole = parts.next()?;
	let fraction = parts.next().unwrap_or("");
	if parts.next().is_some()
		|| whole.is_empty()
		|| fraction.len() > decimals as usize
		|| !whole
			.bytes()
			.chain(fraction.bytes())
			.all(|b| b.is_ascii_digit())
	{
		return None;
	}
	whole.parse::<u128>()
		.ok()?
		.checked_mul(10u128.pow(decimals))?
		.checked_add(if fraction.is_empty() {
			0
		} else {
			fraction.parse::<u128>()
				.ok()?
				.checked_mul(10u128.pow(decimals - fraction.len() as u32))?
		})
}
fn validate(alerts: &[Alert]) -> Result<(), Error> {
	if alerts.len() > 5000 {
		return Err("At most 5000 provisioned price alerts per worker".into());
	}
	let mut ids = HashSet::new();
	for a in alerts {
		if a.id.is_empty()
			|| a.id.len() > 100 || !a
			.id
			.bytes()
			.all(|b| b.is_ascii_alphanumeric() || b == b'-')
			|| !ids.insert(&a.id) || a.installation_id.is_empty()
			|| a.installation_id.len() > 4096
			|| !["mark", "last"].contains(&a.watch.as_str())
			|| !["above", "below"].contains(&a.direction.as_str())
			|| amount(&a.target_price, 18).is_none_or(|v| v == 0)
		{
			return Err("Invalid alert configuration (tokens are not logged)".into());
		}
	}
	Ok(())
}
fn triggered(alert: &Alert, market: &Value, epoch: u64) -> bool {
	let Some(at) = market["state"]["at"]["t"].as_u64() else {
		return false;
	};
	if epoch.saturating_sub(at / 1000) > 30 || at / 1000 > epoch + 5 {
		return false;
	}
	let Some(decimals) = market["config"]["price_decimals"]
		.as_u64()
		.and_then(|v| u32::try_from(v).ok())
	else {
		return false;
	};
	let Some(target) = amount(&alert.target_price, decimals) else {
		return false;
	};
	let field = if alert.watch == "mark" { "mrk" } else { "lst" };
	let Some(price) = market["state"][field].as_u64().filter(|v| *v > 0) else {
		return false;
	};
	if alert.direction == "above" {
		u128::from(price) >= target
	} else {
		u128::from(price) <= target
	}
}
fn persist(path: &Path, deliveries: &HashMap<String, Delivery>) -> Result<(), Error> {
	use std::io::Write;
	let tmp = path.with_extension("tmp");
	let mut options = fs::OpenOptions::new();
	options.write(true).create(true).truncate(true);
	#[cfg(unix)]
	{
		use std::os::unix::fs::OpenOptionsExt;
		options.mode(0o600);
	}
	let mut file = options.open(&tmp)?;
	file.write_all(&serde_json::to_vec(deliveries)?)?;
	file.sync_all()?;
	fs::rename(tmp, path)?;
	Ok(())
}
#[tokio::main]
async fn main() -> Result<(), Error> {
	let config = env::var("EXORA_ALERTS_FILE").unwrap_or_else(|_| "alerts.json".into());
	let mut alerts: Vec<Alert> = serde_json::from_slice(&fs::read(&config)?)?;
	validate(&alerts)?;
	if env::args().any(|a| a == "--check") {
		println!("Alert configuration valid; no requests or notifications sent.");
		return Ok(());
	}
	let project = env::var("FIREBASE_PROJECT_ID")
		.map_err(|_| "Set FIREBASE_PROJECT_ID before running")?;
	if !project
		.bytes()
		.all(|c| c.is_ascii_alphanumeric() || c == b'-')
	{
		return Err("Invalid Firebase project ID".into());
	}
	let state = env::var("EXORA_DELIVERY_STATE").unwrap_or_else(|_| "deliveries.json".into());
	let path = Path::new(&state);
	let mut deliveries: HashMap<String, Delivery> = match fs::read(path) {
		Ok(bytes) => serde_json::from_slice(&bytes)?,
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
		Err(e) => return Err(e.into()),
	};
	let provider = gcp_auth::provider().await?;
	if env::args().any(|a| a == "--check-auth") {
		provider.token(&["https://www.googleapis.com/auth/firebase.messaging"])
			.await
			.map_err(|_| {
				"Firebase sender authorization failed; check the server credential and clock"
			})?;
		println!("Firebase sender authorization verified; no notifications sent.");
		return Ok(());
	}
	let client = reqwest::Client::builder()
		.timeout(Duration::from_secs(12))
		.build()?;
	let api = api::start(&config, &state, client.clone(), provider.clone(), &project).await?;
	let mut interval = tokio::time::interval(Duration::from_secs(5));
	interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
	let mut next_attempt = HashMap::<String, u64>::new();
	loop {
		tokio::select! {_=tokio::signal::ctrl_c()=>break,_=interval.tick()=>{}}
		if api.is_some() {
			match fs::read(&config)
				.ok()
				.and_then(|bytes| serde_json::from_slice::<Vec<Alert>>(&bytes).ok())
				.filter(|items| validate(items).is_ok())
			{
				Some(current) => alerts = current,
				None => {
					eprintln!("Subscription snapshot unavailable; delivery paused.");
					continue;
				}
			}
		}
		if api.is_some() || alerts.iter().any(|a| !deliveries.contains_key(&a.id)) {
			let response = client
				.get("https://testnet.perpl.xyz/api/v1/pub/context")
				.send()
				.await;
			if let Ok(response) = response {
				if response.status().is_success() {
					if let Ok(context) = response.json::<Value>().await {
						if let Some(api) = &api {
							api.update_catalog(&context);
						}
						if let Some(markets) = context["markets"].as_array()
						{
							for a in &alerts {
								if deliveries.contains_key(&a.id) {
									continue;
								}
								if let Some(m) =
									markets.iter().find(|m| {
										m["id"].as_u64()==Some(u64::from(a.market_id))
									}) {
									if triggered(a, m, now()) {
										deliveries.insert(a.id.clone(),Delivery{created:now(),body:format!("{} {} price reached your {} {} USD threshold",m["symbol"].as_str().unwrap_or("Market"),a.watch,a.direction,a.target_price),state:"queued".into()});
										persist(
											path,
											&deliveries,
										)?;
									}
								}
							}
						}
					}
				}
			} else {
				eprintln!("Perpl prices unavailable; no alerts evaluated from stale data.");
			}
		}
		for a in &alerts {
			let Some(delivery) = deliveries.get(&a.id).cloned() else {
				continue;
			};
			if delivery.state != "queued" {
				continue;
			}
			if now().saturating_sub(delivery.created) > 300 {
				deliveries.get_mut(&a.id).unwrap().state = "expired".into();
				persist(path, &deliveries)?;
				continue;
			}
			if next_attempt.get(&a.id).is_some_and(|t| *t > now()) {
				continue;
			}
			next_attempt.insert(a.id.clone(), now() + 60);
			let Ok(token) = provider
				.token(&["https://www.googleapis.com/auth/firebase.messaging"])
				.await
			else {
				eprintln!(
					"Push authorization unavailable; queued alerts will retry."
				);
				continue;
			};
			// Re-check cancellation after token refresh, immediately before delivery.
			if api.is_some()
				&& !fs::read(&config)
					.ok()
					.and_then(|b| serde_json::from_slice::<Vec<Alert>>(&b).ok())
					.is_some_and(|current| {
						current.iter().any(|item| item.id == a.id)
					}) {
				continue;
			}
			let response=client.post(format!("https://fcm.googleapis.com/v1/projects/{project}/messages:send"))
    .bearer_auth(token.as_str()).json(&json!({"message":{"fid":a.installation_id,
      "data":{"title":"EXORA price alert","body":delivery.body,"alertId":a.id,"marketId":a.market_id.to_string(),"screen":"trade","observedAt":delivery.created.to_string()},
      "android":{"priority":"high","ttl":"60s","restricted_package_name":"com.exora.perp"}}})).send().await;
			match response {
				Ok(response) if response.status().is_success() => {
					deliveries.get_mut(&a.id).unwrap().state = "sent".into();
					persist(path, &deliveries)?;
				}
				Ok(response) => {
					let status = response.status();
					let value =
						response.json::<Value>().await.unwrap_or_default();
					let unregistered = value["error"]["details"]
						.as_array()
						.is_some_and(|items| {
							items.iter().any(|v| {
								v["errorCode"] == "UNREGISTERED"
							})
						});
					if unregistered {
						deliveries.get_mut(&a.id).unwrap().state =
							"unregistered".into();
						persist(path, &deliveries)?;
					} else {
						eprintln!("Push not accepted ({status}); retry is bounded. No tokens logged.");
					}
				}
				Err(_) => eprintln!(
					"Push transport unavailable; queued alerts will retry."
				),
			}
		}
	}
	Ok(())
}
#[cfg(test)]
mod tests {
	use super::*;
	fn alert() -> Alert {
		Alert {
			id: "alert-1".into(),
			installation_id: "test-token".into(),
			market_id: 16,
			watch: "mark".into(),
			direction: "above".into(),
			target_price: "100.25".into(),
		}
	}
	#[test]
	fn decimal_prices_are_exact() {
		assert_eq!(amount("100.25", 2), Some(10025));
		assert_eq!(amount("0.0001", 4), Some(1));
		assert_eq!(amount("1.001", 2), None);
		assert_eq!(amount("-1", 2), None);
	}
	#[test]
	fn stale_data_never_triggers() {
		let m = json!({"config":{"price_decimals":2},"state":{"at":{"t":1000000},"mrk":10025}});
		assert!(triggered(&alert(), &m, 1000));
		assert!(!triggered(&alert(), &m, 1031));
	}
	#[test]
	fn below_is_inclusive() {
		let mut a = alert();
		a.direction = "below".into();
		let m = json!({"config":{"price_decimals":2},"state":{"at":{"t":1000000},"mrk":10025}});
		assert!(triggered(&a, &m, 1000));
	}
}
