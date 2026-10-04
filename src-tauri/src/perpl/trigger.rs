use std::{fs, io::Write, sync::{atomic::{AtomicU64, Ordering}, Mutex}, time::{SystemTime, UNIX_EPOCH}};

use alloy::primitives::{utils::format_units, Address, U256};
use perpl_sdk::abi::dex::Exchange;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::{perpl::{exchange_address, trade_key}, utils::parse_amount::parse_amount};

static NEXT_REQUEST: AtomicU64 = AtomicU64::new(0);
static PENDING_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
struct PendingTrigger {
    address: String,
    market_id: u32,
    request_id: u64,
    body: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingTriggerSummary { market_id: u32, request_id: u64 }

fn pending_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|_| "Protected order storage is unavailable".to_string())?;
    fs::create_dir_all(&dir).map_err(|_| "Protected order storage is unavailable".to_string())?;
    Ok(dir.join("pending-perpl-triggers.json"))
}

fn pending_read(app: &AppHandle) -> Result<Vec<PendingTrigger>, String> {
    match fs::read(pending_path(app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Saved protected orders are damaged".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(_) => Err("Could not load pending protected orders".into()),
    }
}

fn pending_write(app: &AppHandle, entries: &[PendingTrigger]) -> Result<(), String> {
    let target = pending_path(app)?;
    let temporary = target.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|_| "Could not save pending protected order".to_string())?;
    file.write_all(&serde_json::to_vec(entries).map_err(|_| "Could not save pending protected order".to_string())?)
        .map_err(|_| "Could not save pending protected order".to_string())?;
    file.sync_all().map_err(|_| "Could not save pending protected order".to_string())?;
    fs::rename(temporary, target).map_err(|_| "Could not save pending protected order".into())
}

fn pending_for(app: &AppHandle, address: &str, market_id: u32) -> Result<Option<PendingTrigger>, String> {
    let _guard = PENDING_LOCK.lock().map_err(|_| "Protected order storage is unavailable")?;
    Ok(pending_read(app)?.into_iter().find(|entry| entry.address == address && entry.market_id == market_id))
}

fn pending_record(app: &AppHandle, entry: PendingTrigger) -> Result<(), String> {
    let _guard = PENDING_LOCK.lock().map_err(|_| "Protected order storage is unavailable")?;
    let mut entries = pending_read(app)?;
    if entries.iter().any(|item| item.address == entry.address && item.market_id == entry.market_id) {
        return Err("A previous protected order for this market is still being checked".into());
    }
    entries.push(entry);
    pending_write(app, &entries)
}

fn pending_clear(app: &AppHandle, address: &str, market_id: u32, request_id: u64) -> Result<(), String> {
    let _guard = PENDING_LOCK.lock().map_err(|_| "Protected order storage is unavailable")?;
    let mut entries = pending_read(app)?;
    entries.retain(|entry| entry.address != address || entry.market_id != market_id || entry.request_id != request_id);
    pending_write(app, &entries)
}

#[tauri::command]
pub fn pending_perpl_triggers(app: AppHandle, address: String) -> Result<Vec<PendingTriggerSummary>, String> {
    let address: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    let _guard = PENDING_LOCK.lock().map_err(|_| "Protected order storage is unavailable")?;
    Ok(pending_read(&app)?.into_iter().filter(|entry| entry.address == address.to_string().to_lowercase())
        .map(|entry| PendingTriggerSummary { market_id: entry.market_id, request_id: entry.request_id }).collect())
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TriggerKind { StopLoss, TakeProfit }

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerInput {
    pub address: String,
    pub market_id: u32,
    pub kind: TriggerKind,
    pub trigger_price: String,
    pub quantity: String,
    pub limit_price: Option<String>,
    pub slippage_bps: u16,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerPreview {
    pub symbol: String,
    pub side: String,
    pub kind: TriggerKind,
    pub quantity: String,
    pub trigger_price: String,
    pub limit_price: Option<String>,
    pub mark_price: String,
    pub slippage_bps: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerResult {
    pub request_id: u64,
    pub order_id: Option<u64>,
    pub state: String,
}

struct PreparedTrigger {
    account_id: u64,
    side: u8,
    condition: u8,
    trigger_raw: U256,
    quantity_raw: U256,
    limit_raw: Option<U256>,
    preview: TriggerPreview,
}

fn number(value: &Value) -> Option<u64> { value.as_u64().or_else(|| value.as_str()?.parse().ok()) }

async fn prepare(input: &TriggerInput) -> Result<PreparedTrigger, String> {
    let address: Address = input.address.parse().map_err(|_| "Invalid wallet address")?;
    let context = crate::context::markets().await.map_err(|_| "Could not load current Perpl markets".to_string())?;
    let market = context.markets.get(&input.market_id).ok_or("This Perpl market is unavailable")?.clone();
    if !market.is_open { return Err("Trading is paused for this market".into()); }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Device time is unavailable".to_string())?.as_millis() as u64;
    if market.updated_at_ms.is_none_or(|timestamp| now.saturating_sub(timestamp) > 90_000) {
        return Err("Market price is stale. Wait for a fresh update before setting protection.".into());
    }
    let mark = parse_amount(market.mark_price.clone(), market.price_decimals as u8)?;
    let trigger = parse_amount(Some(input.trigger_price.clone()), market.price_decimals as u8)?;
    let quantity = parse_amount(Some(input.quantity.clone()), market.size_decimals as u8)?;
    if mark.is_zero() || trigger.is_zero() || quantity.is_zero() { return Err("Enter a trigger price and close size greater than zero".into()); }
    if input.limit_price.is_none() && (input.slippage_bps == 0 || input.slippage_bps >= 10_000) {
        return Err("Slippage must be between 0.01% and 99.99%".into());
    }
    let limit_raw = input.limit_price.as_ref().map(|price| parse_amount(Some(price.clone()), market.price_decimals as u8))
        .transpose()?;
    if limit_raw.is_some_and(|price| price.is_zero()) { return Err("The triggered limit price must be greater than zero".into()); }
    let provider = crate::provider::provider();
    let exchange = Exchange::new(exchange_address(), provider);
    let account = exchange.getAccountByAddr(address).call().await.map_err(|error| {
        if crate::perpl::account_missing(&error) { "Create a Perpl account before setting protection".into() }
        else { crate::user_error::contract(error, "load your Perpl account") }
    })?;
    if account.frozen != 0 { return Err("This Perpl account is frozen".into()); }
    let position = exchange.getPositionV2(U256::from(market.id), account.accountId).call().await
        .map_err(|error| crate::user_error::contract(error, "load your position"))?.positionInfo;
    if position.lotLNS.is_zero() { return Err("There is no open position to protect".into()); }
    if quantity > position.lotLNS { return Err("Protected size exceeds your current position".into()); }
    let is_long = position.positionType == 0;
    let triggers_above = (is_long && input.kind == TriggerKind::TakeProfit)
        || (!is_long && input.kind == TriggerKind::StopLoss);
    if triggers_above && trigger <= mark { return Err("Set this trigger above the current mark price".into()); }
    if !triggers_above && trigger >= mark { return Err("Set this trigger below the current mark price".into()); }
    Ok(PreparedTrigger {
        preview: TriggerPreview {
            symbol: market.symbol.clone(), side: if is_long { "long" } else { "short" }.into(), kind: input.kind,
            quantity: format_units(quantity, market.size_decimals as u8).map_err(|_| "Could not format protected size".to_string())?,
            trigger_price: format_units(trigger, market.price_decimals as u8).map_err(|_| "Could not format trigger price".to_string())?,
            limit_price: limit_raw.map(|price| format_units(price, market.price_decimals as u8).unwrap_or_default()),
            mark_price: market.mark_price.clone().unwrap_or_default(),
            slippage_bps: input.slippage_bps,
        },
        account_id: account.accountId.to(), side: if is_long { 3 } else { 4 },
        condition: if triggers_above { 3 } else { 4 }, trigger_raw: trigger, quantity_raw: quantity,
        limit_raw,
    })
}

#[tauri::command]
pub async fn preview_perpl_trigger(input: TriggerInput) -> Result<TriggerPreview, String> {
    Ok(prepare(&input).await?.preview)
}

fn request_id(last_forwarded: u64) -> Result<u64, String> {
    let clock = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_| "Device time is unavailable".to_string())?.as_millis() as u64;
    NEXT_REQUEST.try_update(Ordering::SeqCst, Ordering::SeqCst, |previous| {
        Some(previous.max(last_forwarded).max(clock).saturating_add(1))
    }).map(|previous| previous.max(last_forwarded).max(clock).saturating_add(1))
        .map_err(|_| "Could not allocate a protected order ID".to_string())
}

fn account_from_wallet(wallet: &Value, id: u64) -> Result<&Value, String> {
    wallet["as"].as_array().and_then(|items| items.iter().find(|item| number(&item["id"]) == Some(id)))
        .ok_or("Perpl could not find this wallet's trading account".into())
}

async fn find_request(token: &str, key: &ed25519_dalek::SigningKey, request_id: u64) -> Result<Option<TriggerResult>, String> {
    for target in ["/v1/trading/orders", "/v1/trading/order-history?count=100"] {
        let response = trade_key::signed_request(token, key, "GET", target, None).await?;
        if let Some(order) = response["d"].as_array().and_then(|items| items.iter().find(|item| number(&item["rq"]) == Some(request_id))) {
            let state = match number(&order["st"]) {
                Some(8) => "armed", Some(2 | 3 | 4 | 9 | 10) => "triggered",
                Some(7 | 5 | 6) => "failed", _ => "pending",
            };
            return Ok(Some(TriggerResult { request_id, order_id: number(&order["oid"]), state: state.into() }));
        }
    }
    Ok(None)
}

async fn reconcile_request(app: &AppHandle, token: &str, key: &ed25519_dalek::SigningKey,
    pending: &PendingTrigger) -> Result<Option<TriggerResult>, String> {
    let found = find_request(token, key, pending.request_id).await?;
    if let Some(result) = &found {
        if result.state != "pending" {
            pending_clear(app, &pending.address, pending.market_id, pending.request_id)?;
        }
    }
    Ok(found)
}

async fn retry_pending(app: &AppHandle, pending: &PendingTrigger, token: &str,
    key: &ed25519_dalek::SigningKey) -> Result<TriggerResult, String> {
    if let Ok(Some(result)) = reconcile_request(app, token, key, pending).await {
        if result.state == "failed" { return Err("This protected order failed. Review the current position before trying again.".into()); }
        return Ok(result);
    }
    // The same request ID is safe to resend if the first HTTP response was lost.
    let _ = trade_key::signed_request(token, key, "POST", "/v1/trading/orders", Some(&pending.body)).await;
    for attempt in 0..6 {
        if attempt > 0 { tokio::time::sleep(std::time::Duration::from_millis(600)).await; }
        if let Ok(Some(result)) = reconcile_request(app, token, key, pending).await {
            if result.state == "failed" { return Err("This protected order failed. Review the current position before trying again.".into()); }
            return Ok(result);
        }
    }
    Ok(TriggerResult { request_id: pending.request_id, order_id: None, state: "pending".into() })
}

#[tauri::command]
pub async fn reconcile_perpl_trigger(app: AppHandle, address: String, market_id: u32,
    wrapping_key_hex: String) -> Result<TriggerResult, String> {
    let address: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    let address = address.to_string().to_lowercase();
    let pending = pending_for(&app, &address, market_id)?.ok_or("No protected order is awaiting Perpl confirmation")?;
    let (token, key) = trade_key::unlock(&app, &address, &wrapping_key_hex)?;
    retry_pending(&app, &pending, &token, &key).await
}

async fn submit(app: &AppHandle, input: &TriggerInput, reviewed: &TriggerPreview, wrapping_key_hex: &str) -> Result<TriggerResult, String> {
    let address: Address = input.address.parse().map_err(|_| "Invalid wallet address")?;
    let canonical_address = address.to_string().to_lowercase();
    let (token, key) = trade_key::unlock(app, &canonical_address, wrapping_key_hex)?;
    if pending_for(app, &canonical_address, input.market_id)?.is_some() {
        return Err("An earlier protected order for this market is still being checked. Use Check status before placing another.".into());
    }
    let prepared = prepare(input).await?;
    if prepared.preview.symbol != reviewed.symbol || prepared.preview.side != reviewed.side ||
        prepared.preview.kind != reviewed.kind || prepared.preview.quantity != reviewed.quantity ||
        prepared.preview.trigger_price != reviewed.trigger_price ||
        prepared.preview.limit_price != reviewed.limit_price || prepared.preview.slippage_bps != reviewed.slippage_bps {
        return Err("Position or protected-order terms changed. Review them again before signing.".into());
    }
    // The first-use permission may be mined before Perpl's indexer sees it.
    let wallet = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        loop {
            let wallet = trade_key::signed_request(&token, &key, "GET", "/v1/trading/wallet", None).await?;
            if account_from_wallet(&wallet, prepared.account_id)?["fw"] == true {
                return Ok::<_, String>(wallet);
            }
            tokio::time::sleep(std::time::Duration::from_millis(750)).await;
        }
    }).await.map_err(|_| "Your stop permission is still syncing. Try confirming again shortly; no stop has been placed".to_string())??;
    let account = account_from_wallet(&wallet, prepared.account_id)?;
    let lfr = number(&account["lfr"]).ok_or("Perpl did not report the last protected-order ID")?;
    let positions = trade_key::signed_request(&token, &key, "GET", "/v1/trading/positions", None).await?;
    let position = positions["d"].as_array().and_then(|items| items.iter().find(|item| {
        number(&item["mkt"]) == Some(input.market_id as u64)
            && number(&item["acc"]) == Some(prepared.account_id)
            && number(&item["st"]) == Some(1)
    })).ok_or("Perpl has not synced this open position yet. Refresh and try again")?;
    let position_id = number(&position["pid"]).filter(|id| *id > 0)
        .ok_or("Perpl did not report this position's protection link")?;
    if number(&position["s"]).is_none_or(|size| U256::from(size) < prepared.quantity_raw) {
        return Err("Protected size exceeds the current Perpl position".into());
    }
    let request_id = request_id(lfr)?;
    let price = prepared.limit_raw.unwrap_or(U256::ZERO);
    let leverage = number(&position["lv"]).filter(|value| *value >= 100)
        .ok_or("Perpl did not report this position's leverage")?;
    let body = json!({"d":[{
        "rq":request_id,"mkt":input.market_id,"acc":prepared.account_id,
        "t":prepared.side,"p":u64::try_from(price).map_err(|_| "Trigger limit price is too large")?,
        "s":u64::try_from(prepared.quantity_raw).map_err(|_| "Protected size is too large")?,
        "ms":if prepared.limit_raw.is_none() { input.slippage_bps } else { 0 },
        "mnp":1000,"fl":if prepared.limit_raw.is_none() { 4 } else { 0 },
        "tp":u64::try_from(prepared.trigger_raw).map_err(|_| "Trigger price is too large")?,
        "tpc":prepared.condition,"lp":position_id,"lv":leverage,"lb":0
    }]});
    let pending = PendingTrigger { address: canonical_address.clone(), market_id: input.market_id, request_id, body: body.clone() };
    pending_record(app, pending.clone())?;
    let response = match trade_key::signed_request(&token, &key, "POST", "/v1/trading/orders", Some(&body)).await {
        Ok(value) => value,
        Err(message) if message.starts_with("Perpl rejected this protected-order request")
            || message.starts_with("Perpl protected order access expired")
            || message.starts_with("Perpl protected order access was denied") => {
            pending_clear(app, &canonical_address, input.market_id, request_id)?;
            return Err(message);
        }
        Err(_) => return Ok(TriggerResult { request_id, order_id: None, state: "pending".into() }),
    };
    if number(&response["status"]["code"]).is_some_and(|code| code != 0) {
        pending_clear(app, &canonical_address, input.market_id, request_id)?;
        return Err("Perpl rejected the protected-order request".into());
    }
    let status = &response["statuses"][0];
    if number(&status["code"]).is_some_and(|code| code != 0) {
        pending_clear(app, &canonical_address, input.market_id, request_id)?;
        let message = status["error"].as_str().unwrap_or("Perpl rejected this protected order");
        return Err(crate::user_error::safe_message(message, "Perpl rejected this protected order"));
    }
    for attempt in 0..6 {
        if attempt > 0 { tokio::time::sleep(std::time::Duration::from_millis(600)).await; }
        if let Ok(Some(result)) = reconcile_request(app, &token, &key, &pending).await {
            if result.state == "failed" { return Err("Perpl could not arm this protected order. Check Activity for the reason.".into()); }
            return Ok(result);
        }
    }
    Ok(TriggerResult { request_id, order_id: None, state: "pending".into() })
}

#[tauri::command]
pub async fn place_perpl_trigger(app: AppHandle, input: TriggerInput, reviewed_preview: TriggerPreview,
    wrapping_key_hex: String) -> Result<TriggerResult, String> {
    tokio::time::timeout(std::time::Duration::from_secs(30),
        submit(&app, &input, &reviewed_preview, &wrapping_key_hex)).await
        .map_err(|_| "Stop confirmation is taking longer. Check Open orders and pending protection before retrying".to_string())?

}

#[tauri::command]
pub async fn cancel_perpl_trigger(app: AppHandle, address: String, market_id: u32,
    order_id: u64, wrapping_key_hex: String) -> Result<TriggerResult, String> {
    if order_id == 0 { return Err("Invalid protected order ID".into()); }
    let address: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    let (token, key) = trade_key::unlock(&app, &address.to_string(), &wrapping_key_hex)?;
    let wallet = trade_key::signed_request(&token, &key, "GET", "/v1/trading/wallet", None).await?;
    let account_id = Exchange::new(exchange_address(), crate::provider::provider())
        .getAccountByAddr(address).call().await
        .map_err(|error| crate::user_error::contract(error, "load your Perpl account"))?.accountId.to::<u64>();
    let account = account_from_wallet(&wallet, account_id)?;
    if account["fw"] != true { return Err("Perpl protected-order forwarding is disabled".into()); }
    let orders = trade_key::signed_request(&token, &key, "GET", "/v1/trading/orders", None).await?;
    if !orders["d"].as_array().is_some_and(|items| items.iter().any(|item| {
        number(&item["oid"]) == Some(order_id) && number(&item["mkt"]) == Some(market_id as u64)
            && number(&item["acc"]) == Some(account_id) && number(&item["st"]) == Some(8)
    })) { return Err("This protected order is no longer waiting to trigger".into()); }
    let request_id = request_id(number(&account["lfr"]).unwrap_or_default())?;
    let body = json!({"d":[{"rq":request_id,"mkt":market_id,"acc":account_id,
        "oid":order_id,"t":5,"s":0,"fl":0,"lv":0,"lb":0}]});
    let response = trade_key::signed_request(&token, &key, "POST", "/v1/trading/orders", Some(&body)).await?;
    if number(&response["status"]["code"]) != Some(0) || number(&response["statuses"][0]["code"]) != Some(0) {
        return Err("Perpl did not accept the protected-order cancellation".into());
    }
    for attempt in 0..6 {
        if attempt > 0 { tokio::time::sleep(std::time::Duration::from_millis(600)).await; }
        if let Ok(history) = trade_key::signed_request(&token, &key, "GET", "/v1/trading/order-history?count=100", None).await {
            if history["d"].as_array().is_some_and(|items| items.iter().any(|item| {
                number(&item["oid"]) == Some(order_id) && number(&item["mkt"]) == Some(market_id as u64)
                    && number(&item["st"]) == Some(5)
            })) {
                return Ok(TriggerResult { request_id, order_id: Some(order_id), state: "canceled".into() });
            }
        }
    }
    Ok(TriggerResult { request_id, order_id: Some(order_id), state: "pending".into() })
}
