use std::{collections::HashMap, fs, io::Write, sync::{LazyLock, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};

use alloy::{dyn_abi::eip712::TypedData, primitives::{hex, Address, B256, Signature}};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

const API: &str = "https://testnet.perpl.xyz/api";
const CHAIN_ID: u64 = 10_143;

struct PendingEnrollment {
    key: SigningKey,
    typed_data: Value,
    mac: String,
    digest: B256,
    created: Instant,
}

#[derive(Default)]
pub struct ReadKeyState(Mutex<HashMap<String, PendingEnrollment>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentChallenge {
    pub digest: String,
    pub address: String,
}

#[derive(Serialize, Deserialize)]
struct StoredKey {
    address: String,
    api_key: String,
    secret: [u8; 32],
}

fn canonical_address(address: &str) -> Result<String, String> {
    let address: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    Ok(address.to_string().to_lowercase())
}

fn key_path(app: &AppHandle, address: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|_| "Wallet data storage is unavailable".to_string())?;
    fs::create_dir_all(&dir).map_err(|_| "Wallet data storage is unavailable".to_string())?;
    Ok(dir.join(format!("perpl-read-{}.json", address.trim_start_matches("0x"))))
}

fn load(app: &AppHandle, address: &str) -> Result<Option<StoredKey>, String> {
    let address = canonical_address(address)?;
    let contents = match fs::read(key_path(app, &address)?) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Stored wallet data could not be read".into()),
    };
    let key: StoredKey = serde_json::from_slice(&contents).map_err(|_| "Stored Perpl read key is damaged")?;
    if key.address != address { return Err("Stored Perpl read key belongs to another wallet".into()); }
    Ok(Some(key))
}

fn save(app: &AppHandle, key: &StoredKey) -> Result<(), String> {
    let path = key_path(app, &key.address)?;
    let temporary = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|_| "Wallet data could not be saved".to_string())?;
    file.write_all(&serde_json::to_vec(key).map_err(|_| "Wallet data could not be saved".to_string())?).map_err(|_| "Wallet data could not be saved".to_string())?;
    file.sync_all().map_err(|_| "Wallet data could not be saved".to_string())?;
    fs::rename(temporary, path).map_err(|_| "Wallet data could not be saved".to_string())
}

static CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder().timeout(Duration::from_secs(15)).build().map_err(|_| "Perpl wallet data connection is unavailable".to_string())
});

fn client() -> Result<&'static reqwest::Client, String> {
    CLIENT.as_ref().map_err(Clone::clone)
}

fn now_ms() -> Result<u128, String> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Device time is unavailable".to_string())?.as_millis())
}

#[tauri::command]
pub fn has_perpl_read_key(app: AppHandle, address: String) -> Result<bool, String> {
    Ok(load(&app, &address)?.is_some())
}

#[tauri::command]
pub fn forget_perpl_read_key(app: AppHandle, address: String) -> Result<(), String> {
    let address = canonical_address(&address)?;
    match fs::remove_file(key_path(&app, &address)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Stored wallet data could not be removed".into()),
    }
}

#[tauri::command]
pub async fn begin_perpl_read_key(app: AppHandle, state: State<'_, ReadKeyState>, address: String) -> Result<EnrollmentChallenge, String> {
    let address = canonical_address(&address)?;
    if load(&app, &address)?.is_some() { return Err("Perpl wallet data is already connected".into()); }
    let key = SigningKey::generate(&mut OsRng);
    let request = json!({
        "chain_id": CHAIN_ID,
        "address": address,
        "public_key": format!("0x{}", hex::encode(key.verifying_key().to_bytes())),
        "scope_mask": 1,
        "label": "Exora read-only",
    });
    let response = client()?.post(format!("{API}/v1/api-key/payload")).json(&request).send().await.map_err(|_| "Could not connect to Perpl for wallet data setup".to_string())?;
    if !response.status().is_success() { return Err("Perpl wallet data setup is unavailable right now".into()); }
    let payload: Value = response.json().await.map_err(|_| "Perpl returned an invalid wallet data setup response".to_string())?;
    let typed_data = payload.get("typed_data").cloned().ok_or("Perpl did not return a signing request")?;
    let mac = payload.get("mac").and_then(Value::as_str).ok_or("Perpl did not return an enrollment code")?.to_owned();
    if typed_data["primaryType"] != "PerplRegisterApiKey" ||
        typed_data["message"]["signer"].as_str().is_none_or(|v| v.to_lowercase() != address) ||
        typed_data["message"]["scope"] != "1" ||
        typed_data["domain"]["chainId"] != "0x279f" {
        return Err("Perpl returned unexpected key permissions or wallet".into());
    }
    let parsed: TypedData = serde_json::from_value(typed_data.clone()).map_err(|_| "Perpl returned an invalid signing request".to_string())?;
    let digest = parsed.eip712_signing_hash().map_err(|_| "Perpl signing request could not be verified".to_string())?;
    state.0.lock().map_err(|_| "Perpl key setup unavailable")?.insert(address.clone(), PendingEnrollment {
        key, typed_data, mac, digest, created: Instant::now(),
    });
    Ok(EnrollmentChallenge { digest: digest.to_string(), address })
}

#[tauri::command]
pub async fn complete_perpl_read_key(app: AppHandle, state: State<'_, ReadKeyState>, address: String, signature: String) -> Result<(), String> {
    let address = canonical_address(&address)?;
    let pending = state.0.lock().map_err(|_| "Perpl key setup unavailable")?
        .remove(&address).ok_or("Perpl key setup expired; start again")?;
    if pending.created.elapsed() > Duration::from_secs(300) { return Err("Perpl key setup expired; start again".into()); }
    let bytes = hex::decode(signature.trim_start_matches("0x")).map_err(|_| "Invalid wallet signature")?;
    let wallet_signature = Signature::from_raw(&bytes).map_err(|_| "Invalid wallet signature")?;
    let recovered = wallet_signature.recover_address_from_prehash(&pending.digest).map_err(|_| "Wallet signature could not be verified")?;
    if recovered.to_string().to_lowercase() != address { return Err("The selected passkey belongs to another wallet".into()); }
    let body = json!({
        "chain_id": CHAIN_ID,
        "address": address,
        "typed_data": pending.typed_data,
        "mac": pending.mac,
        "signature": format!("0x{}", hex::encode(bytes)),
        "pop_signature": format!("0x{}", hex::encode(pending.key.sign(pending.digest.as_slice()).to_bytes())),
    });
    let response = client()?.post(format!("{API}/v1/api-key/enroll")).json(&body).send().await.map_err(|_| "Could not connect to Perpl to finish wallet data setup".to_string())?;
    if !response.status().is_success() { return Err("Perpl could not finish wallet data setup. Please try again".into()); }
    let result: Value = response.json().await.map_err(|_| "Perpl returned an invalid wallet data response".to_string())?;
    if result.pointer("/api_key/scope_mask").or_else(|| result.get("scope_mask"))
        .and_then(Value::as_u64) != Some(1) {
        return Err("Perpl returned unexpected key permissions".into());
    }
    let token = result.pointer("/api_key/api_key").or_else(|| result.get("api_key"))
        .and_then(Value::as_str).filter(|v| !v.is_empty()).ok_or("Perpl did not return a read key")?;
    save(&app, &StoredKey { address, api_key: token.to_owned(), secret: pending.key.to_bytes() })
}

pub async fn signed_get(app: &AppHandle, address: &str, target: &str) -> Result<Value, String> {
    if !target.starts_with("/v1/trading/") { return Err("Unsupported Perpl data request".into()); }
    let key = load(app, address)?.ok_or("Connect wallet data to Perpl first")?;
    for attempt in 0..3 {
        let timestamp = now_ms()?.to_string();
        let mut nonce_bytes = [0u8; 16];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = URL_SAFE_NO_PAD.encode(nonce_bytes);
        let body_hash = hex::encode(Sha256::digest(b""));
        let canonical = format!("{CHAIN_ID}\nGET\n{target}\n{timestamp}\n{nonce}\n{body_hash}");
        let signature = SigningKey::from_bytes(&key.secret).sign(canonical.as_bytes());
        let response = client()?.get(format!("{API}{target}"))
            .header("X-API-Key", key.api_key.as_str())
            .header("X-API-Timestamp", timestamp)
            .header("X-API-Nonce", nonce)
            .header("X-API-Signature", URL_SAFE_NO_PAD.encode(signature.to_bytes()))
            .send().await;
        let response = match response {
            Ok(response) => response,
            Err(error) if attempt < 2 => { tokio::time::sleep(Duration::from_millis(400 * (attempt + 1))).await; let _ = error; continue; }
            Err(_) => return Err("Could not load Perpl wallet activity. Check your connection".into()),
        };
        if response.status() == reqwest::StatusCode::UNAUTHORIZED { return Err("Perpl read access expired. Reconnect wallet data.".into()); }
        if response.status() == reqwest::StatusCode::NOT_FOUND { return Ok(json!({"d":[],"np":""})); }
        if (response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS || response.status().is_server_error()) && attempt < 2 {
            tokio::time::sleep(Duration::from_millis(400 * (attempt + 1))).await;
            continue;
        }
        if !response.status().is_success() { return Err("Perpl wallet data is unavailable right now. Please try again".into()); }
        return response.json().await.map_err(|_| "Perpl returned invalid wallet activity data".to_string());
    }
    Err("Perpl wallet data is temporarily unavailable".into())
}

pub fn stored_key(app: &AppHandle, address: &str) -> Result<Option<(String, SigningKey)>, String> {
    Ok(load(app, address)?.map(|key| (key.api_key, SigningKey::from_bytes(&key.secret))))
}
