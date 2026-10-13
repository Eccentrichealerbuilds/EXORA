//! Closed-app account monitoring. Only authenticated GETs and contract reads are possible here.
//! Perpl's signed REST snapshots avoid its five-WebSocket-connections-per-IP ceiling.
use crate::{
	api::{write_private, Api},
	now, Error,
};
use alloy::{
	primitives::{utils::format_units, Address, U256},
	providers::ProviderBuilder,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use perpl_sdk::abi::dex::Exchange;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
	collections::{HashMap, HashSet},
	path::PathBuf,
	sync::LazyLock,
	time::{Duration, Instant},
};

#[derive(Debug)]
pub struct PerplReadError(pub u16);
impl std::fmt::Display for PerplReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "Perpl monitoring HTTP {}", self.0) }
}
impl std::error::Error for PerplReadError {}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
	pub address: String,
	pub api_key: String,
	pub secret: [u8; 32],
	pub scope_mask: u8,
	pub order_fills: bool,
	pub sl_tp_updates: bool,
	pub liquidation_threshold: String,
	#[serde(default)]
	pub since: u64,
}
impl Account {
	pub fn validate(&mut self) -> Result<(), Error> {
		self.address = self.address.parse::<Address>()?.to_string().to_lowercase();
		if self.scope_mask != 1
			|| self.api_key.is_empty()
			|| self.api_key.len() > 1024
			|| !["off", "2", "5", "10"].contains(&self.liquidation_threshold.as_str())
		{
			return Err("Invalid read-only monitoring configuration".into());
		}
		Ok(())
	}
}
// Across enrollment and all wallets, stay below the documented ~60 authenticated requests/minute.
static REQUEST_GATE: LazyLock<tokio::sync::Mutex<Instant>> =
	LazyLock::new(|| tokio::sync::Mutex::new(Instant::now()));
pub async fn signed_get(
	client: &reqwest::Client,
	account: &Account,
	target: &str,
) -> Result<Value, Error> {
	if !target.starts_with("/v1/trading/") {
		return Err("Unsupported monitoring read".into());
	}
	{
		let mut next = REQUEST_GATE.lock().await;
		tokio::time::sleep_until((*next).into()).await;
		*next = Instant::now() + Duration::from_millis(1250);
	}
	let timestamp = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)?
		.as_millis()
		.to_string();
	let nonce = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 16]>());
	let canonical = format!(
		"10143\nGET\n{target}\n{timestamp}\n{nonce}\n{}",
		hex::encode(Sha256::digest(b""))
	);
	let signature = URL_SAFE_NO_PAD.encode(SigningKey::from_bytes(&account.secret)
		.sign(canonical.as_bytes())
		.to_bytes());
	let response = client
		.get(format!("https://testnet.perpl.xyz/api{target}"))
		.header("X-API-Key", &account.api_key)
		.header("X-API-Timestamp", timestamp)
		.header("X-API-Nonce", nonce)
		.header("X-API-Signature", signature)
		.send()
		.await?;
	if response.status().as_u16() == 429 {
		*REQUEST_GATE.lock().await = Instant::now() + Duration::from_secs(60);
	}
	if !response.status().is_success() {
		return Err(Box::new(PerplReadError(response.status().as_u16())));
	}
	if response.content_length().is_some_and(|n| n > 2_000_000) {
		return Err("Account snapshot exceeds limit".into());
	}
	Ok(response.json().await?)
}
#[derive(Clone, Serialize, Deserialize)]
struct Notice {
	body: String,
	created: u64,
	#[serde(default)]
	sent: bool,
	#[serde(default)]
	next_attempt: u64,
}
#[derive(Default, Serialize, Deserialize)]
struct Seen {
	#[serde(default)]
	events: HashMap<String, u64>,
	#[serde(default)]
	notices: HashMap<String, Notice>,
	#[serde(default)]
	warned: HashSet<u32>,
	#[serde(default)]
	last_check: u64,
}
fn number(v: &Value) -> Option<u64> {
	v.as_u64().or_else(|| v.as_str()?.parse().ok())
}
fn event_id(kind: &str, item: &Value) -> String {
	// The on-chain location distinguishes separate partial fills of one order.
	hex::encode(Sha256::digest(
		format!(
			"{kind}:{}:{}:{}:{}:{}",
			item["at"], item["mkt"], item["acc"], item["oid"], item["st"]
		)
		.as_bytes(),
	))
}
fn collect(seen: &mut Seen, account: &Account, kind: &str, items: &[Value], time: u64) {
	for item in items {
		let Some(at) = number(&item["at"]["t"]).map(|ms| ms / 1000) else {
			continue;
		};
		if at < account.since || time.saturating_sub(at) > 300 || at > time + 5 {
			continue;
		}
		let id = event_id(kind, item);
		if seen.events.insert(id.clone(), at).is_some() {
			continue;
		}
		let message = if kind == "fill" && account.order_fills {
			Some("A trade fill was confirmed for your wallet. Open Portfolio to review it.")
		} else if kind == "order"
			&& account.sl_tp_updates
			&& number(&item["tp"]).is_some_and(|p| p > 0)
		{
			match number(&item["st"]){
                Some(9)=>Some("A stop-loss or take-profit order triggered. Review its execution in Portfolio."),
                Some(4|10)=>Some("A stop-loss or take-profit order executed. Review the result in Portfolio."),
                Some(5)=>Some("A stop-loss or take-profit order was canceled. Review your position protection."),
                Some(6)=>Some("A stop-loss or take-profit order expired. Review your position protection."),
                Some(7)=>Some("A stop-loss or take-profit order failed. Review your position protection."),
                _=>None,
            }
		} else {
			None
		};
		if let Some(body) = message {
			seen.notices.insert(
				id,
				Notice {
					body: body.into(),
					created: at,
					sent: false,
					next_attempt: 0,
				},
			);
		}
	}
}
async fn history(
	client: &reqwest::Client,
	a: &Account,
	kind: &str,
	seen: &mut Seen,
) -> Result<(), Error> {
	let endpoint = if kind == "fill" {
		"fills"
	} else {
		"order-history"
	};
	let mut page = String::new();
	// Only recent wallet events, never a scan of chain history. Bound catch-up traffic.
	for _ in 0..3 {
		let mut target = format!("/v1/trading/{endpoint}?count=100");
		if !page.is_empty() {
			let query = reqwest::Url::parse_with_params(
				"https://testnet.perpl.xyz",
				&[("page", page.as_str())],
			)?;
			target.push('&');
			target.push_str(query.query().ok_or("Invalid history cursor")?);
		}
		let result = signed_get(client, a, &target).await?;
		let items = result["d"].as_array().ok_or("Invalid account history")?;
		collect(seen, a, kind, items, now());
		let cutoff = now().saturating_sub(300).max(a.since);
		if items.is_empty()
			|| items.iter()
				.any(|i| number(&i["at"]["t"]).is_some_and(|t| t / 1000 < cutoff))
		{
			break;
		}
		page = result["np"].as_str().unwrap_or("").to_owned();
		if page.is_empty() {
			break;
		}
	}
	Ok(())
}
fn distance(
	long: bool,
	entry: f64,
	mark: f64,
	size: f64,
	deposit: f64,
	funding: f64,
	mmf: f64,
) -> Option<f64> {
	if ![entry, mark, size, deposit, funding, mmf]
		.iter()
		.all(|x| x.is_finite())
		|| entry <= 0.0
		|| mark <= 0.0 || size <= 0.0
		|| mmf <= 0.0
	{
		return None;
	}
	let side = if long { 1.0 } else { -1.0 };
	let liquidation = entry + side * (entry * size * 100.0 / mmf - deposit - funding) / size;
	if liquidation <= 0.0 {
		return None;
	}
	Some(side * (mark - liquidation) / mark * 100.0)
}
async fn health(a: &Account, context: &Value, seen: &mut Seen) -> Result<(), Error> {
	let Ok(threshold) = a.liquidation_threshold.parse::<f64>() else {
		seen.warned.clear();
		return Ok(());
	};
	let provider =
		ProviderBuilder::new().connect_http("https://rpc-testnet.monadinfra.com".parse()?);
	let exchange = Exchange::new(
		"0x1964C32f0bE608E7D29302AFF5E61268E72080cc".parse::<Address>()?,
		provider,
	);
	let info = exchange.getAccountByAddr(a.address.parse()?).call().await?;
	let mut open = HashSet::new();
	for m in context["markets"].as_array().ok_or("Markets unavailable")? {
		let Some(id) = number(&m["id"]).and_then(|n| u32::try_from(n).ok()) else {
			continue;
		};
		let present = match id {
			0..=252 => info.positions.bank1.bit(id as usize),
			253..=508 => info.positions.bank2.bit((id - 253) as usize),
			509..=764 => info.positions.bank3.bit((id - 509) as usize),
			765..=1020 => info.positions.bank4.bit((id - 765) as usize),
			_ => false,
		};
		if !present {
			continue;
		}
		let result = exchange
			.getPositionV2(U256::from(id), info.accountId)
			.call()
			.await?;
		let p = result.positionInfo;
		if p.lotLNS.is_zero() {
			continue;
		}
		open.insert(id);
		let pd = number(&m["config"]["price_decimals"])
			.filter(|d| *d <= 18)
			.ok_or("Invalid price scale")? as u8;
		let sd = number(&m["config"]["size_decimals"])
			.filter(|d| *d <= 18)
			.ok_or("Invalid size scale")? as u8;
		let numeric = |n: U256, d: u8| {
			format_units(n, d)
				.ok()
				.and_then(|s| s.parse::<f64>().ok())
				.unwrap_or(f64::NAN)
		};
		let funding = p
			.premiumPnlCNS
			.to_string()
			.parse::<f64>()
			.unwrap_or(f64::NAN) / 1e6;
		let Some(d) = distance(
			p.positionType == 0,
			numeric(p.pricePNS, pd),
			numeric(result.markPricePNS, pd),
			numeric(p.lotLNS, sd),
			numeric(p.depositCNS, 6),
			funding,
			number(&m["config"]["maintenance_margin"]).unwrap_or(0) as f64,
		) else {
			continue;
		};
		if d > threshold + 1.0 {
			seen.warned.remove(&id);
		}
		if d <= threshold && seen.warned.insert(id) {
			let event = hex::encode(rand::random::<[u8; 16]>());
			seen.notices.insert(event,Notice{body:format!("{} is within your estimated {}% liquidation-distance threshold. Review the position.",m["symbol"].as_str().unwrap_or("A position"),a.liquidation_threshold),created:now(),sent:false,next_attempt:0});
		}
	}
	seen.warned.retain(|id| open.contains(id));
	Ok(())
}
pub fn start(api: Api, path: PathBuf, client: reqwest::Client) -> Result<(), Error> {
	let mut states: HashMap<String, Seen> = match std::fs::read(&path) {
		Ok(b) => serde_json::from_slice(&b)?,
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
		Err(e) => return Err(e.into()),
	};
	tokio::spawn(async move {
		loop {
			let cycle = Instant::now();
			let accounts = api.accounts();
			states.retain(|id, _| accounts.iter().any(|(current, _, _)| id == current));
			for (id, fid, a) in accounts {
				if !api.account_current(&id, &a) {
					continue;
				}
				let seen = states.entry(id.clone()).or_default();
				let mut ok = true;
				if a.order_fills
					&& history(&client, &a, "fill", seen).await.is_err()
				{
					ok = false;
				}
				if a.sl_tp_updates
					&& history(&client, &a, "order", seen).await.is_err()
				{
					ok = false;
				}
				if tokio::time::timeout(
					Duration::from_secs(20),
					health(&a, &api.context(), seen),
				)
				.await
				.map_or(true, |r| r.is_err())
				{
					ok = false;
				}
				if ok {
					seen.last_check = now();
				}
				seen.events.retain(|_, t| now().saturating_sub(*t) <= 600);
				seen.notices
					.retain(|_, n| now().saturating_sub(n.created) <= 600);
				if write_private(&path, &states).is_err() {
					eprintln!(
						"Account alert state unavailable; delivery paused"
					);
					continue;
				}
				let pending: Vec<_> = states[&id]
					.notices
					.iter()
					.filter(|(_, n)| {
						!n.sent && n.next_attempt <= now()
							&& now().saturating_sub(n.created) <= 300
					})
					.map(|(e, n)| (e.clone(), n.clone()))
					.collect();
				for (event, n) in pending {
					if !api.account_current(&id, &a) {
						break;
					}
					let sent = api
						.account_push(
							&id, &a, &fid, &event, &n.body, n.created,
						)
						.await
						.is_ok();
					if let Some(n) = states
						.get_mut(&id)
						.and_then(|s| s.notices.get_mut(&event))
					{
						n.sent = sent;
						n.next_attempt = now() + 60;
					}
					if write_private(&path, &states).is_err() {
						break;
					}
				}
			}
			let _ = write_private(&path, &states);
			tokio::time::sleep(Duration::from_secs(15).saturating_sub(cycle.elapsed()))
				.await;
		}
	});
	Ok(())
}
#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;
	fn account() -> Account {
		Account {
			address: "0x0000000000000000000000000000000000000001".into(),
			api_key: "read".into(),
			secret: [0; 32],
			scope_mask: 1,
			order_fills: true,
			sl_tp_updates: true,
			liquidation_threshold: "5".into(),
			since: 100,
		}
	}
	#[test]
	fn rejects_trade_scope() {
		let mut a = account();
		assert!(a.validate().is_ok());
		a.scope_mask = 3;
		assert!(a.validate().is_err());
	}
	#[test]
	fn recent_fills_deduplicate_but_partial_fills_are_distinct() {
		let a = account();
		let mut s = Seen::default();
		let f = json!({"at":{"t":110000,"b":20,"tx":1,"l":1},"oid":2,"mkt":16,"acc":1});
		collect(&mut s, &a, "fill", &[f.clone(), f.clone()], 120);
		assert_eq!(s.notices.len(), 1);
		let mut f = f;
		f["at"]["l"] = json!(2);
		collect(&mut s, &a, "fill", &[f], 120);
		assert_eq!(s.notices.len(), 2);
	}
	#[test]
	fn historical_events_do_not_notify() {
		let mut s = Seen::default();
		collect(
			&mut s,
			&account(),
			"fill",
			&[json!({"at":{"t":99000}})],
			120,
		);
		assert!(s.notices.is_empty());
	}
	#[test]
	fn health_uses_funding_and_direction() {
		assert_eq!(
			distance(true, 100000., 100000., 1., 10000., 0., 2500.),
			Some(6.)
		);
		assert!(
			(distance(false, 100000., 100000., 1., 10000., 1000., 2500.).unwrap() - 7.)
				.abs() < 1e-10
		);
	}
}
