//! Device ownership is proven by a short-lived FCM challenge plus a client-generated secret.
//! Account monitoring accepts only the app’s read-only Perpl credential after explicit opt-in.
use super::{amount, now, Alert, Delivery, Error};
use axum::{
	extract::{DefaultBodyLimit, State},
	http::{HeaderMap, StatusCode},
	routing::{get, post},
	Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
	collections::HashMap,
	fs,
	io::Write,
	net::SocketAddr,
	path::{Path, PathBuf},
	sync::{Arc, Mutex},
};

type Response = Result<Json<Value>, (StatusCode, Json<Value>)>;
fn failure(code: StatusCode, message: &str) -> (StatusCode, Json<Value>) {
	(code, Json(json!({"message":message})))
}
fn unavailable() -> (StatusCode, Json<Value>) {
	failure(
		StatusCode::SERVICE_UNAVAILABLE,
		"Alert service is temporarily unavailable. Please retry.",
	)
}
fn random_secret() -> String {
	hex::encode(rand::random::<[u8; 32]>())
}
fn hash(value: &str) -> String {
	hex::encode(Sha256::digest(value.as_bytes()))
}
fn hex_string(value: &str, len: usize) -> bool {
	value.len() == len && value.bytes().all(|c| c.is_ascii_hexdigit())
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Rule {
	id: String,
	market_id: u32,
	watch: String,
	direction: String,
	target_price: String,
}
#[derive(Clone, Deserialize, Serialize)]
struct Device {
	installation_id: String,
	token_hash: String,
	rules: Vec<Rule>,
	#[serde(default)]
	account: Option<crate::accounts::Account>,
}
#[derive(Clone)]
struct Pending {
	installation_id: String,
	claim_hash: String,
	challenge_hash: String,
	expires: u64,
}
#[derive(Clone, Default, Deserialize, Serialize)]
struct Database {
	devices: HashMap<String, Device>,
	#[serde(skip)]
	pending: HashMap<String, Pending>,
	#[serde(skip)]
	attempts: HashMap<String, (u64, u8)>,
}
#[derive(Clone)]
pub struct Api {
	db: Arc<Mutex<Database>>,
	path: PathBuf,
	alerts_path: PathBuf,
	deliveries_path: PathBuf,
	catalog: Arc<Mutex<(u64, HashMap<u32, u32>)>>,
	context: Arc<Mutex<Value>>,
	client: reqwest::Client,
	provider: Arc<dyn gcp_auth::TokenProvider>,
	project: String,
}
pub(crate) fn write_private(path: &Path, value: &impl Serialize) -> Result<(), Error> {
	let temporary = path.with_extension("tmp");
	let mut options = fs::OpenOptions::new();
	options.write(true).create(true).truncate(true);
	#[cfg(unix)]
	{
		use std::os::unix::fs::OpenOptionsExt;
		options.mode(0o600);
	}
	let mut file = options.open(&temporary)?;
	file.write_all(&serde_json::to_vec(value)?)?;
	file.sync_all()?;
	fs::rename(temporary, path)?;
	Ok(())
}
impl Api {
	fn commit(&self, db: &mut Database, next: Database) -> Result<(), Error> {
		let alerts: Vec<Alert> = next
			.devices
			.values()
			.flat_map(|d| {
				d.rules.iter().map(|r| Alert {
					id: r.id.clone(),
					installation_id: d.installation_id.clone(),
					market_id: r.market_id,
					watch: r.watch.clone(),
					direction: r.direction.clone(),
					target_price: r.target_price.clone(),
				})
			})
			.collect();
		super::validate(&alerts)?;
		write_private(&self.path, &next)?;
		write_private(&self.alerts_path, &alerts)?;
		*db = next;
		Ok(())
	}
	pub fn update_catalog(&self, context: &Value) {
		if let Ok(mut saved) = self.context.lock() {
			*saved = context.clone();
		}
		let Some(markets) = context["markets"].as_array() else {
			return;
		};
		let values = markets
			.iter()
			.filter_map(|m| {
				Some((
					u32::try_from(m["id"].as_u64()?).ok()?,
					u32::try_from(m["config"]["price_decimals"].as_u64()?)
						.ok()?,
				))
			})
			.collect();
		if let Ok(mut catalog) = self.catalog.lock() {
			*catalog = (now(), values);
		}
	}
	fn owner(db: &Database, headers: &HeaderMap) -> Option<String> {
		let token = headers
			.get("authorization")?
			.to_str()
			.ok()?
			.strip_prefix("Bearer ")?;
		if !hex_string(token, 64) {
			return None;
		}
		let token_hash = hash(token);
		db.devices
			.iter()
			.find(|(_, d)| d.token_hash == token_hash)
			.map(|(id, _)| id.clone())
	}
	async fn challenge(
		&self,
		fid: &str,
		registration: &str,
		claim: &str,
		secret: &str,
	) -> Result<(), Error> {
		let token = self
			.provider
			.token(&["https://www.googleapis.com/auth/firebase.messaging"])
			.await?;
		let response=self.client.post(format!("https://fcm.googleapis.com/v1/projects/{}/messages:send",self.project)).bearer_auth(token.as_str())
   .json(&json!({"message":{"fid":fid,"data":{"kind":"exora-enrollment","registrationId":registration,"claimHash":claim,"challenge":secret,"observedAt":now().to_string()},"android":{"priority":"normal","ttl":"120s","restricted_package_name":"com.exora.perp"}}})).send().await?;
		if !response.status().is_success() {
			return Err("Device verification delivery failed".into());
		}
		Ok(())
	}
}
impl Api {
	pub fn accounts(&self) -> Vec<(String, String, crate::accounts::Account)> {
		self.db.lock()
			.map(|db| {
				db.devices
					.iter()
					.filter_map(|(id, d)| {
						d.account.clone().map(|a| {
							(id.clone(), d.installation_id.clone(), a)
						})
					})
					.collect()
			})
			.unwrap_or_default()
	}
	pub fn context(&self) -> Value {
		self.context.lock().map(|v| v.clone()).unwrap_or_default()
	}
	pub fn account_current(&self, id: &str, account: &crate::accounts::Account) -> bool {
		self.db.lock().is_ok_and(|db| {
			db.devices
				.get(id)
				.and_then(|d| d.account.as_ref())
				.is_some_and(|a| a == account)
		})
	}
	pub async fn account_push(
		&self,
		id: &str,
		account: &crate::accounts::Account,
		fid: &str,
		event: &str,
		body: &str,
		created: u64,
	) -> Result<(), Error> {
		let token = self
			.provider
			.token(&["https://www.googleapis.com/auth/firebase.messaging"])
			.await?;
		if !self.account_current(id, account) {
			return Ok(());
		}
		let response=self.client.post(format!("https://fcm.googleapis.com/v1/projects/{}/messages:send",self.project)).bearer_auth(token.as_str())
          .json(&json!({"message":{"fid":fid,"data":{"title":"EXORA account alert","accountAddress":account.address,"body":body,"alertId":format!("account-{event}"),"screen":"portfolio","observedAt":created.to_string()},"android":{"priority":"high","ttl":"60s","restricted_package_name":"com.exora.perp"}}})).send().await?;
		if !response.status().is_success() {
			return Err("Account notification was not accepted".into());
		}
		Ok(())
	}
}
async fn get_account(State(api): State<Api>, headers: HeaderMap) -> Response {
	let db = api.db.lock().map_err(|_| unavailable())?;
	let owner = Api::owner(&db, &headers)
		.ok_or_else(|| failure(StatusCode::UNAUTHORIZED, "Reconnect notifications."))?;
	let connected = db.devices[&owner].account.is_some();
	let state: Value = fs::read(api.path.with_file_name("account-state.json"))
		.ok()
		.and_then(|b| serde_json::from_slice(&b).ok())
		.unwrap_or_default();
	let last = state[&owner]["last_check"].as_u64().unwrap_or(0);
	Ok(Json(
		json!({"connected":connected,"lastChecked":last,"healthy":connected && last>0 && now().saturating_sub(last)<120}),
	))
}
fn account_read_failure(status: Option<u16>) -> (StatusCode, &'static str) {
    match status {
        Some(451) => (StatusCode::UNAVAILABLE_FOR_LEGAL_REASONS, "Perpl restricts access from this alert server's location."),
        Some(401 | 403) => (StatusCode::FAILED_DEPENDENCY, "Perpl read access needs renewal."),
        Some(404) => (StatusCode::CONFLICT, "Perpl is still indexing this account. Monitoring will retry."),
        Some(429) => (StatusCode::TOO_MANY_REQUESTS, "Perpl monitoring is busy. Monitoring will retry."),
        _ => (StatusCode::BAD_GATEWAY, "Perpl account monitoring is temporarily unavailable."),
    }
}

#[cfg(test)]
mod account_error_tests {
    use super::*;
    #[test]
    fn upstream_errors_do_not_claim_the_wallet_has_no_account() {
        assert_eq!(account_read_failure(Some(451)).0, StatusCode::UNAVAILABLE_FOR_LEGAL_REASONS);
        assert_eq!(account_read_failure(Some(401)).0, StatusCode::FAILED_DEPENDENCY);
        assert_eq!(account_read_failure(Some(404)).0, StatusCode::CONFLICT);
        assert_eq!(account_read_failure(Some(429)).0, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(account_read_failure(None).0, StatusCode::BAD_GATEWAY);
    }
}

async fn set_account(
	State(api): State<Api>,
	headers: HeaderMap,
	Json(mut account): Json<crate::accounts::Account>,
) -> Response {
	let owner = {
		let db = api.db.lock().map_err(|_| unavailable())?;
		Api::owner(&db, &headers).ok_or_else(|| {
			failure(StatusCode::UNAUTHORIZED, "Reconnect notifications.")
		})?
	};
	account.validate().map_err(|_| {
		failure(StatusCode::BAD_REQUEST, "Reconnect read-only wallet data.")
	})?;
	{
		let db = api.db.lock().map_err(|_| unavailable())?;
		if let Some(old) = db.devices.get(&owner).and_then(|d| d.account.as_ref()) {
			account.since = old.since;
			if old == &account {
				return Ok(Json(json!({"connected":true})));
			}
		}
	}
	// Verify the signed credential resolves to the requested wallet, without submitting orders.
	let wallet =
		crate::accounts::signed_get(&api.client, &account, "/v1/trading/wallet")
			.await
			.map_err(|error| {
                let status = error.downcast_ref::<crate::accounts::PerplReadError>().map(|e| e.0);
                let (code, message) = account_read_failure(status);
                failure(code, message)
            })?;
	if !wallet["addr"]
		.as_str()
		.is_some_and(|a| a.eq_ignore_ascii_case(&account.address))
	{
		return Err(failure(
			StatusCode::BAD_REQUEST,
			"Wallet data does not match this account.",
		));
	}
	account.since = now();
	let mut db = api.db.lock().map_err(|_| unavailable())?;
	if Api::owner(&db, &headers).as_deref() != Some(owner.as_str()) {
		return Err(failure(StatusCode::UNAUTHORIZED, "Device disconnected."));
	}
	let mut next = db.clone();
	if let Some(old) = next.devices[&owner]
		.account
		.as_ref()
		.filter(|old| old.address == account.address)
	{
		account.since = old.since;
	}
	next.devices.get_mut(&owner).unwrap().account = Some(account);
	api.commit(&mut db, next).map_err(|_| unavailable())?;
	Ok(Json(json!({"connected":true})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Enrollment {
	installation_id: String,
	claim_hash: String,
}
async fn enroll(State(api): State<Api>, Json(input): Json<Enrollment>) -> Response {
	if !hex_string(&input.claim_hash, 64)
		|| !(16..=128).contains(&input.installation_id.len())
		|| !input
			.installation_id
			.bytes()
			.all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
	{
		return Err(failure(
			StatusCode::BAD_REQUEST,
			"Invalid device registration.",
		));
	}
	let id = random_secret();
	let challenge = random_secret();
	{
		let mut db = api.db.lock().map_err(|_| unavailable())?;
		let time = now();
		db.pending.retain(|_, p| p.expires > time);
		db.attempts
			.retain(|_, (at, _)| time.saturating_sub(*at) < 300);
		if db.pending.len() >= 100 || db.devices.len() >= 1000 || db.attempts.len() >= 2000
		{
			return Err(failure(
				StatusCode::TOO_MANY_REQUESTS,
				"Notification setup is busy. Please retry later.",
			));
		}
		let attempt = db
			.attempts
			.entry(input.installation_id.clone())
			.or_insert((time, 0));
		if attempt.1 >= 5 {
			return Err(failure(
				StatusCode::TOO_MANY_REQUESTS,
				"Please wait five minutes before connecting this device again.",
			));
		}
		attempt.1 += 1;
		db.pending.insert(
			id.clone(),
			Pending {
				installation_id: input.installation_id.clone(),
				claim_hash: input.claim_hash.clone(),
				challenge_hash: hash(&challenge),
				expires: time + 120,
			},
		);
	}
	if api.challenge(&input.installation_id, &id, &input.claim_hash, &challenge)
		.await
		.is_err()
	{
		api.db.lock()
			.map_err(|_| unavailable())?
			.pending
			.remove(&id);
		return Err(failure(
			StatusCode::SERVICE_UNAVAILABLE,
			"Could not reach this device through Firebase. Please retry.",
		));
	}
	Ok(Json(json!({"registrationId":id})))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Confirmation {
	registration_id: String,
	claim_secret: String,
	challenge: String,
}
fn verifies(p: &Pending, input: &Confirmation, time: u64) -> bool {
	p.expires > time
		&& hex_string(&input.claim_secret, 64)
		&& hex_string(&input.challenge, 64)
		&& p.claim_hash == hash(&input.claim_secret)
		&& p.challenge_hash == hash(&input.challenge)
}
async fn confirm(State(api): State<Api>, Json(input): Json<Confirmation>) -> Response {
	let mut db = api.db.lock().map_err(|_| unavailable())?;
	let pending = db
		.pending
		.get(&input.registration_id)
		.filter(|p| verifies(p, &input, now()))
		.cloned()
		.ok_or_else(|| {
			failure(
				StatusCode::UNAUTHORIZED,
				"Device verification expired or failed. Reconnect this device.",
			)
		})?;
	let token = random_secret();
	let device_id = random_secret();
	let mut next = db.clone();
	next.pending.remove(&input.registration_id);
	// Re-enrollment of the same verified installation invalidates its previous subscription/token.
	next.devices
		.retain(|_, d| d.installation_id != pending.installation_id);
	next.devices.insert(
		device_id,
		Device {
			installation_id: pending.installation_id,
			token_hash: hash(&token),
			rules: vec![],
			account: None,
		},
	);
	api.commit(&mut db, next).map_err(|_| unavailable())?;
	Ok(Json(json!({"token":token})))
}
fn valid_rules(rules: &[Rule], catalog: &HashMap<u32, u32>) -> bool {
	let mut ids = std::collections::HashSet::new();
	rules.len() <= 50
		&& rules.iter().all(|r| {
			hex_string(&r.id, 32)
				&& ids.insert(&r.id) && ["mark", "last"].contains(&r.watch.as_str())
				&& ["above", "below"].contains(&r.direction.as_str())
				&& r.target_price.len() <= 64
				&& catalog
					.get(&r.market_id)
					.and_then(|d| amount(&r.target_price, *d))
					.is_some_and(|a| a > 0)
		})
}
async fn set_alerts(
	State(api): State<Api>,
	headers: HeaderMap,
	Json(rules): Json<Vec<Rule>>,
) -> Response {
	let mut db = api.db.lock().map_err(|_| unavailable())?;
	let owner = Api::owner(&db, &headers).ok_or_else(|| {
		failure(
			StatusCode::UNAUTHORIZED,
			"Reconnect this device to manage remote alerts.",
		)
	})?;
	let catalog = api.catalog.lock().map_err(|_| unavailable())?;
	if now().saturating_sub(catalog.0) > 60 {
		return Err(failure(
			StatusCode::SERVICE_UNAVAILABLE,
			"Market data is reconnecting. Please retry.",
		));
	}
	if !valid_rules(&rules, &catalog.1) {
		return Err(failure(
			StatusCode::BAD_REQUEST,
			"Check the alert market, condition and price. Maximum 50 alerts.",
		));
	}
	drop(catalog);
	for (id, device) in &db.devices {
		for rule in &rules {
			if let Some(existing) = device.rules.iter().find(|r| r.id == rule.id) {
				if id != &owner || existing != rule {
					return Err(failure(StatusCode::CONFLICT,"An existing alert cannot be overwritten. Create a new alert."));
				}
			}
		}
	}
	if db.devices
		.iter()
		.filter(|(id, _)| *id != &owner)
		.map(|(_, d)| d.rules.len())
		.sum::<usize>()
		+ rules.len() > 5000
	{
		return Err(failure(
			StatusCode::TOO_MANY_REQUESTS,
			"The alert service is at capacity. Please retry later.",
		));
	}
	let mut next = db.clone();
	next.devices.get_mut(&owner).unwrap().rules = rules;
	api.commit(&mut db, next).map_err(|_| unavailable())?;
	Ok(Json(json!({"synced":true})))
}
async fn get_alerts(State(api): State<Api>, headers: HeaderMap) -> Response {
	let db = api.db.lock().map_err(|_| unavailable())?;
	let owner = Api::owner(&db, &headers).ok_or_else(|| {
		failure(
			StatusCode::UNAUTHORIZED,
			"Reconnect this device to view remote alerts.",
		)
	})?;
	let deliveries: HashMap<String, Delivery> = match fs::read(&api.deliveries_path) {
		Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| unavailable())?,
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
		Err(_) => return Err(unavailable()),
	};
	Ok(Json(
		json!({"alerts":db.devices[&owner].rules.iter().map(|r|json!({"id":r.id,"triggered":deliveries.contains_key(&r.id),"delivery":deliveries.get(&r.id).map(|d|d.state.as_str())})).collect::<Vec<_>>()}),
	))
}
async fn disconnect(State(api): State<Api>, headers: HeaderMap) -> Response {
	let mut db = api.db.lock().map_err(|_| unavailable())?;
	let owner = Api::owner(&db, &headers).ok_or_else(|| {
		failure(StatusCode::UNAUTHORIZED, "Device is already disconnected.")
	})?;
	let mut next = db.clone();
	next.devices.remove(&owner);
	api.commit(&mut db, next).map_err(|_| unavailable())?;
	Ok(Json(json!({"disconnected":true})))
}
async fn health(State(api): State<Api>) -> Json<Value> {
	let ready = api
		.catalog
		.lock()
		.is_ok_and(|c| now().saturating_sub(c.0) <= 60);
	Json(json!({"status":"ok","pricesAvailable":ready}))
}
pub async fn start(
	alerts_path: &str,
	deliveries_path: &str,
	client: reqwest::Client,
	provider: Arc<dyn gcp_auth::TokenProvider>,
	project: &str,
) -> Result<Option<Api>, Error> {
	let Ok(listen) = std::env::var("EXORA_API_LISTEN") else {
		return Ok(None);
	};
	let listen: SocketAddr = listen.parse()?;
	if !listen.ip().is_loopback() {
		return Err("The subscription API must bind to loopback behind HTTPS".into());
	}
	let path = PathBuf::from(
		std::env::var("EXORA_API_STATE").unwrap_or_else(|_| "devices.json".into()),
	);
	let db = match fs::read(&path) {
		Ok(bytes) => serde_json::from_slice(&bytes)?,
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => Database::default(),
		Err(e) => return Err(e.into()),
	};
	let api = Api {
		db: Arc::new(Mutex::new(db)),
		path,
		alerts_path: alerts_path.into(),
		deliveries_path: deliveries_path.into(),
		catalog: Arc::new(Mutex::new((0, HashMap::new()))),
		context: Arc::new(Mutex::new(Value::Null)),
		client,
		provider,
		project: project.into(),
	};
	{
		let mut db = api.db.lock().map_err(|_| "Device store is unavailable")?;
		let next = db.clone();
		api.commit(&mut db, next)?;
	}
	let listener = tokio::net::TcpListener::bind(listen).await?;
	let router = Router::new()
		.route("/healthz", get(health))
		.route("/v1/enroll", post(enroll))
		.route("/v1/confirm", post(confirm))
		.route("/v1/alerts", get(get_alerts).put(set_alerts))
		.route("/v1/account", get(get_account).put(set_account))
		.route("/v1/device", axum::routing::delete(disconnect))
		.layer(DefaultBodyLimit::max(32768))
		.with_state(api.clone());
	tokio::spawn(async move {
		if axum::serve(listener, router).await.is_err() {
			eprintln!("Subscription API stopped unexpectedly");
			std::process::exit(1);
		}
	});
	crate::accounts::start(
		api.clone(),
		api.path.with_file_name("account-state.json"),
		api.client.clone(),
	)?;
	Ok(Some(api))
}
#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn challenge_needs_both_secrets_and_expires() {
		let c = random_secret();
		let s = random_secret();
		let p = Pending {
			installation_id: "device".into(),
			claim_hash: hash(&c),
			challenge_hash: hash(&s),
			expires: 120,
		};
		let mut r = Confirmation {
			registration_id: "id".into(),
			claim_secret: c,
			challenge: s,
		};
		assert!(verifies(&p, &r, 119));
		assert!(!verifies(&p, &r, 120));
		r.claim_secret = random_secret();
		assert!(!verifies(&p, &r, 119));
	}
	#[test]
	fn bearer_is_scoped_to_one_device() {
		let a = random_secret();
		let b = random_secret();
		let mut db = Database::default();
		for (id, t) in [("a", &a), ("b", &b)] {
			db.devices.insert(
				id.into(),
				Device {
					installation_id: id.into(),
					token_hash: hash(t),
					rules: vec![],
					account: None,
				},
			);
		}
		let mut h = HeaderMap::new();
		h.insert("authorization", format!("Bearer {a}").parse().unwrap());
		assert_eq!(Api::owner(&db, &h), Some("a".into()));
		h.insert(
			"authorization",
			format!("Bearer {}", random_secret()).parse().unwrap(),
		);
		assert!(Api::owner(&db, &h).is_none());
	}
	#[test]
	fn duplicate_ids_and_excess_precision_are_rejected() {
		let r = Rule {
			id: "a".repeat(32),
			market_id: 16,
			watch: "mark".into(),
			direction: "above".into(),
			target_price: "1.25".into(),
		};
		let c = HashMap::from([(16, 2)]);
		assert!(valid_rules(&[r.clone()], &c));
		assert!(!valid_rules(&[r.clone(), r.clone()], &c));
		let mut r = r;
		r.target_price = "1.251".into();
		assert!(!valid_rules(&[r], &c));
	}
}
