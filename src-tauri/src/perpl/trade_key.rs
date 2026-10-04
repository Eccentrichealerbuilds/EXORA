use std::{collections::HashMap, fs, io::Write, sync::{LazyLock, Mutex}, time::{Duration, Instant}};

use aes_gcm::{aead::{Aead, KeyInit, Payload}, Aes256Gcm, Nonce};
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
static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| reqwest::Client::builder()
    .timeout(Duration::from_secs(15)).build().expect("valid Perpl client"));

struct PendingEnrollment {
    key: SigningKey,
    typed_data: Value,
    mac: String,
    digest: B256,
    created: Instant,
}

#[derive(Default)]
pub struct TradeKeyState(Mutex<HashMap<String, PendingEnrollment>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Challenge { pub digest: String, pub address: String }

#[derive(Serialize, Deserialize)]
struct StoredKey { address: String, api_key: String, nonce: [u8; 12], ciphertext: Vec<u8> }

fn canonical_address(address: &str) -> Result<String, String> {
    let address: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    Ok(address.to_string().to_lowercase())
}

fn path(app: &AppHandle, address: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|_| "Protected order storage is unavailable".to_string())?;
    fs::create_dir_all(&dir).map_err(|_| "Protected order storage is unavailable".to_string())?;
    Ok(dir.join(format!("perpl-trade-{}.json", address.trim_start_matches("0x"))))
}

fn load(app: &AppHandle, address: &str) -> Result<Option<StoredKey>, String> {
    let address = canonical_address(address)?;
    match fs::read(path(app, &address)?) {
        Ok(bytes) => {
            let key: StoredKey = serde_json::from_slice(&bytes).map_err(|_| "Stored Perpl trading access is damaged")?;
            if key.address != address { return Err("Stored trading access belongs to another wallet".into()); }
            Ok(Some(key))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Could not read protected order access".into()),
    }
}

fn save(app: &AppHandle, key: &StoredKey) -> Result<(), String> {
    let target = path(app, &key.address)?;
    let temporary = target.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|_| "Could not save protected order access".to_string())?;
    file.write_all(&serde_json::to_vec(key).map_err(|_| "Could not save protected order access".to_string())?)
        .map_err(|_| "Could not save protected order access".to_string())?;
    file.sync_all().map_err(|_| "Could not save protected order access".to_string())?;
    fs::rename(temporary, target).map_err(|_| "Could not save protected order access".to_string())
}

fn wrapping_key(value: &str) -> Result<[u8; 32], String> {
    let bytes = hex::decode(value.trim_start_matches("0x")).map_err(|_| "Invalid passkey protection")?;
    bytes.try_into().map_err(|_| "Invalid passkey protection".into())
}

#[tauri::command]
pub fn has_perpl_trade_key(app: AppHandle, address: String) -> Result<bool, String> {
    Ok(load(&app, &address)?.is_some())
}

#[tauri::command]
pub async fn begin_perpl_trade_key(state: State<'_, TradeKeyState>, app: AppHandle, address: String) -> Result<Challenge, String> {
    let address = canonical_address(&address)?;
    if load(&app, &address)?.is_some() { return Err("Perpl protected order access is already connected".into()); }
    let key = SigningKey::generate(&mut OsRng);
    let body = json!({"chain_id":CHAIN_ID,"address":address,
        "public_key":format!("0x{}", hex::encode(key.verifying_key().to_bytes())),
        "scope_mask":3,"label":"Exora protected orders"});
    let response = CLIENT.post(format!("{API}/v1/api-key/payload"))
        .json(&body).send().await.map_err(|_| "Could not connect to Perpl protected orders".to_string())?;
    if !response.status().is_success() { return Err("Perpl protected order setup is unavailable".into()); }
    let payload: Value = response.json().await.map_err(|_| "Perpl returned an invalid setup response".to_string())?;
    let typed_data = payload.get("typed_data").cloned().ok_or("Perpl did not return a signing request")?;
    let mac = payload.get("mac").and_then(Value::as_str).ok_or("Perpl did not return an enrollment code")?.to_owned();
    if typed_data["primaryType"] != "PerplRegisterApiKey" ||
        typed_data["message"]["signer"].as_str().is_none_or(|v| v.to_lowercase() != address) ||
        typed_data["message"]["scope"] != "3" ||
        typed_data["message"]["publicKey"] != URL_SAFE_NO_PAD.encode(key.verifying_key().to_bytes()) ||
        typed_data["message"]["builderId"] != "0" || typed_data["message"]["maxBuilderFeePer100K"] != "0" || typed_data["domain"]["chainId"] != "0x279f" {
        return Err("Perpl returned unexpected trading permissions or wallet".into());
    }
    let parsed: TypedData = serde_json::from_value(typed_data.clone()).map_err(|_| "Perpl returned an invalid signing request".to_string())?;
    let digest = parsed.eip712_signing_hash().map_err(|_| "Perpl signing request could not be verified".to_string())?;
    state.0.lock().map_err(|_| "Perpl protected order setup is unavailable")?.insert(address.clone(),
        PendingEnrollment { key, typed_data, mac, digest, created: Instant::now() });
    Ok(Challenge { digest: digest.to_string(), address })
}

#[tauri::command]
pub async fn complete_perpl_trade_key(state: State<'_, TradeKeyState>, app: AppHandle,
    address: String, signature: String, wrapping_key_hex: String) -> Result<(), String> {
    let address = canonical_address(&address)?;
    let pending = state.0.lock().map_err(|_| "Perpl protected order setup is unavailable")?
        .remove(&address).ok_or("Perpl protected order setup expired; start again")?;
    if pending.created.elapsed() > Duration::from_secs(300) { return Err("Perpl protected order setup expired; start again".into()); }
    let bytes = hex::decode(signature.trim_start_matches("0x")).map_err(|_| "Invalid wallet signature")?;
    let wallet_signature = Signature::from_raw(&bytes).map_err(|_| "Invalid wallet signature")?;
    let recovered = wallet_signature.recover_address_from_prehash(&pending.digest).map_err(|_| "Wallet signature could not be verified")?;
    if recovered.to_string().to_lowercase() != address { return Err("The selected passkey belongs to another wallet".into()); }
    let body = json!({"chain_id":CHAIN_ID,"address":address,"typed_data":pending.typed_data,
        "mac":pending.mac,"signature":format!("0x{}",hex::encode(bytes)),
        "pop_signature":format!("0x{}",hex::encode(pending.key.sign(pending.digest.as_slice()).to_bytes()))});
    let response = CLIENT.post(format!("{API}/v1/api-key/enroll"))
        .json(&body).send().await.map_err(|_| "Could not finish Perpl protected order setup".to_string())?;
    if !response.status().is_success() { return Err("Perpl could not finish protected order setup".into()); }
    let result: Value = response.json().await.map_err(|_| "Perpl returned invalid protected order access".to_string())?;
    if result.pointer("/api_key/scope_mask").or_else(|| result.get("scope_mask")).and_then(Value::as_u64) != Some(3) {
        return Err("Perpl returned unexpected trading permissions".into());
    }
    let token = result.pointer("/api_key/api_key").or_else(|| result.get("api_key"))
        .and_then(Value::as_str).filter(|v| !v.is_empty()).ok_or("Perpl did not return protected order access")?;
    let key_bytes = wrapping_key(&wrapping_key_hex)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes).map_err(|_| "Could not protect Perpl trading access")?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher.encrypt(Nonce::from_slice(&nonce), Payload {
        msg: &pending.key.to_bytes(), aad: address.as_bytes(),
    }).map_err(|_| "Could not protect Perpl trading access")?;
    save(&app, &StoredKey { address, api_key: token.to_owned(), nonce, ciphertext })
}

pub fn unlock(app: &AppHandle, address: &str, wrapping_key_hex: &str) -> Result<(String, SigningKey), String> {
    let key = load(app, address)?.ok_or("Connect Perpl protected orders first")?;
    let bytes = wrapping_key(wrapping_key_hex)?;
    let cipher = Aes256Gcm::new_from_slice(&bytes).map_err(|_| "Could not unlock Perpl trading access")?;
    let plaintext = cipher.decrypt(Nonce::from_slice(&key.nonce), Payload {
        msg: &key.ciphertext, aad: key.address.as_bytes(),
    }).map_err(|_| "Passkey could not unlock Perpl protected orders")?;
    let secret: [u8; 32] = plaintext.try_into().map_err(|_| "Protected order access is damaged")?;
    Ok((key.api_key, SigningKey::from_bytes(&secret)))
}

pub async fn signed_request(token: &str, key: &SigningKey, method: &str, target: &str,
    body: Option<&Value>) -> Result<Value, String> {
    if !target.starts_with("/v1/trading/") { return Err("Unsupported Perpl protected order request".into()); }
    let body = body.map(serde_json::to_string).transpose()
        .map_err(|_| "Could not prepare protected order request".to_string())?.unwrap_or_default();
    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Device time is unavailable".to_string())?.as_millis().to_string();
    let mut nonce_bytes = [0u8; 16];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = URL_SAFE_NO_PAD.encode(nonce_bytes);
    let body_hash = hex::encode(Sha256::digest(body.as_bytes()));
    let canonical = format!("{CHAIN_ID}\n{method}\n{target}\n{timestamp}\n{nonce}\n{body_hash}");
    let signature = URL_SAFE_NO_PAD.encode(key.sign(canonical.as_bytes()).to_bytes());
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build()
        .map_err(|_| "Perpl protected order connection is unavailable".to_string())?;
    let request = match method {
        "GET" => client.get(format!("{API}{target}")),
        "POST" => client.post(format!("{API}{target}")).header("Content-Type", "application/json").body(body),
        _ => return Err("Unsupported protected order operation".into()),
    };
    let response = request.header("X-API-Key", token)
        .header("X-API-Timestamp", timestamp)
        .header("X-API-Nonce", nonce)
        .header("X-API-Signature", signature)
        .send().await.map_err(|_| "Could not reach Perpl protected orders".to_string())?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED { return Err("Perpl protected order access expired. Reconnect it.".into()); }
    if response.status() == reqwest::StatusCode::FORBIDDEN { return Err("Perpl protected order access was denied".into()); }
    if response.status().is_client_error() { return Err("Perpl rejected this protected-order request. Review its terms before trying again".into()); }
    if !response.status().is_success() { return Err("Perpl protected order response is unavailable; its status needs checking".into()); }
    response.json().await.map_err(|_| "Perpl returned an invalid protected order response".to_string())
}
