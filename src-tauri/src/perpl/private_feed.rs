use std::{collections::HashMap, sync::{atomic::{AtomicU64, Ordering}, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::Signer;
use futures_util::{SinkExt, StreamExt};
use rand::{rngs::OsRng, RngCore};
use perpl_sdk::abi::dex::Exchange;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{async_runtime::JoinHandle, ipc::Channel, AppHandle, Emitter, State};
use tokio_tungstenite::tungstenite::Message;
use crate::transport::connect as connect_async;

use crate::perpl::{exchange_address, read_key};

const URL: &str = "wss://testnet.perpl.xyz/ws/v1/trading";
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct PrivateFeedTask(Mutex<Option<(u64, JoinHandle<()>)>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOrder {
    pub market_id: u32,
    pub order_id: u64,
    pub contract_order_id: Option<u16>,
    pub order_type: u64,
    pub status: u64,
    pub price_raw: Option<String>,
    pub size_raw: Option<String>,
    pub trigger_price_raw: Option<String>,
    pub trigger_condition: Option<u8>,
    pub position_id: Option<u64>,
    pub request_id: Option<u64>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PrivateEvent {
    Status { state: String, message: Option<String> },
    Orders { orders: Vec<OpenOrder> },
    AccountChanged,
    Forwarding { allowed: bool },
}

fn unsigned(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

fn raw(value: &Value) -> Option<String> {
    value.as_str().map(str::to_owned).or_else(|| value.as_u64().map(|v| v.to_string()))
}

fn parse_order(value: &Value) -> Option<OpenOrder> {
    let market_id = unsigned(&value["mkt"]).or_else(|| unsigned(&value["m"]))? as u32;
    let order_id = unsigned(&value["oid"]).or_else(|| unsigned(&value["id"]))?;
    if order_id == 0 { return None; }
    Some(OpenOrder {
        market_id, order_id,
        contract_order_id: unsigned(&value["scid"]).and_then(|id| u16::try_from(id).ok()).filter(|id| *id != 0),
        order_type: unsigned(&value["t"]).unwrap_or_default(),
        status: unsigned(&value["st"]).unwrap_or_default(),
        price_raw: raw(&value["p"]),
        size_raw: match (unsigned(&value["os"]), unsigned(&value["fs"])) {
            (Some(original), Some(filled)) => Some(original.saturating_sub(filled).to_string()),
            (Some(original), None) => Some(original.to_string()),
            _ => raw(&value["s"]),
        },
        trigger_price_raw: raw(&value["tp"]),
        trigger_condition: unsigned(&value["tpc"]).and_then(|v| u8::try_from(v).ok()),
        position_id: unsigned(&value["lp"]),
        request_id: unsigned(&value["rq"]),
    })
}

fn publish_orders(orders: &HashMap<(u32, u64), OpenOrder>, channel: &Channel<PrivateEvent>) -> Result<(), String> {
    let mut values: Vec<_> = orders.values().cloned().collect();
    values.sort_by_key(|order| (order.market_id, order.order_id));
    channel.send(PrivateEvent::Orders { orders: values }).map_err(|e| e.to_string())
}

async fn connect(app: &AppHandle, address: &str, channel: &Channel<PrivateEvent>) -> Result<(), String> {
    let (token, key) = read_key::stored_key(app, address)?.ok_or("Connect Perpl wallet data first")?;
    let wallet_address: alloy::primitives::Address = address.parse().map_err(|_| "Invalid wallet address")?;
    let exchange = Exchange::new(exchange_address(), crate::provider::provider());
    let mut account_id = exchange.getAccountByAddr(wallet_address).call().await.ok().map(|account| account.accountId.to::<u64>());
    let (socket, _) = tokio::time::timeout(Duration::from_secs(12), connect_async(URL))
        .await.map_err(|_| "Perpl wallet connection timed out")?.map_err(|e| e.to_string())?;
    let (mut sender, mut receiver) = socket.split();
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis().to_string();
    let mut nonce_bytes = [0u8; 16];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = URL_SAFE_NO_PAD.encode(nonce_bytes);
    let canonical = format!("10143\ntrading-ws-signin\n{timestamp}\n{nonce}");
    let signature = URL_SAFE_NO_PAD.encode(key.sign(canonical.as_bytes()).to_bytes());
    sender.send(Message::Text(json!({"mt":29,"chain_id":10143,"api_key":token,
        "timestamp":timestamp,"nonce":nonce,"signature":signature}).to_string().into()))
        .await.map_err(|e| e.to_string())?;

    let mut orders = HashMap::new();
    let mut last_message = Instant::now();
    let mut sequence: Option<u64> = None;
    let mut app_ping = tokio::time::interval(Duration::from_secs(15));
    app_ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    app_ping.tick().await;
    let mut proxy_pong = tokio::time::interval(Duration::from_secs(2));
    proxy_pong.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    proxy_pong.tick().await;
    loop {
        tokio::select! {
            next = receiver.next() => match next {
                Some(Ok(Message::Text(text))) => {
                    last_message = Instant::now();
                    let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                    match unsigned(&value["mt"]) {
                        Some(19) => {
                            sequence = unsigned(&value["sn"]);
                            if account_id.is_none() {
                                account_id = exchange.getAccountByAddr(wallet_address).call().await.ok()
                                    .map(|account| account.accountId.to::<u64>());
                            }
                            if let Some(accounts) = value["as"].as_array() {
                                for account in accounts {
                                    if account_id.is_some() && unsigned(&account["id"]) == account_id {
                                      if let Some(allowed) = account["fw"].as_bool() {
                                        channel.send(PrivateEvent::Forwarding { allowed }).map_err(|e| e.to_string())?;
                                      }
                                    }
                                }
                            }
                            channel.send(PrivateEvent::Status { state: "connected".into(), message: None }).map_err(|e| e.to_string())?;
                            channel.send(PrivateEvent::AccountChanged).map_err(|e| e.to_string())?;
                        }
                        Some(23) => {
                            orders.clear();
                            if let Some(items) = value["d"].as_array() {
                                for item in items {
                                    if let Some(order) = parse_order(item) {
                                        if matches!(order.status, 2 | 3 | 8) { orders.insert((order.market_id, order.order_id), order); }
                                    }
                                }
                            }
                            publish_orders(&orders, channel)?;
                        }
                        Some(24) => {
                            if let Some(items) = value["d"].as_array() {
                                for item in items {
                                    if item["r"] == true {
                                        if let Some(order) = parse_order(item) {
                                            orders.remove(&(order.market_id, order.order_id));
                                        } else if let Some(order_id) = unsigned(&item["oid"]).or_else(|| unsigned(&item["id"])) {
                                            orders.retain(|(_, id), _| *id != order_id);
                                        }
                                        continue;
                                    }
                                    if let Some(mut order) = parse_order(item) {
                                        let id = (order.market_id, order.order_id);
                                        let status = if item["st"].is_null() {
                                            orders.get(&id).map(|previous| previous.status).unwrap_or_default()
                                        } else { order.status };
                                        if !matches!(status, 2 | 3 | 8) { orders.remove(&id); }
                                        else {
                                            if order.contract_order_id.is_none() {
                                                order.contract_order_id = orders.get(&id).and_then(|previous| previous.contract_order_id);
                                            }
                                            if let Some(previous) = orders.get(&id) {
                                                if item["t"].is_null() { order.order_type = previous.order_type; }
                                                if item["st"].is_null() { order.status = previous.status; }
                                                if order.price_raw.is_none() { order.price_raw = previous.price_raw.clone(); }
                                                if order.size_raw.is_none() { order.size_raw = previous.size_raw.clone(); }
                                                if order.trigger_price_raw.is_none() { order.trigger_price_raw = previous.trigger_price_raw.clone(); }
                                                if order.trigger_condition.is_none() { order.trigger_condition = previous.trigger_condition; }
                                                if order.position_id.is_none() { order.position_id = previous.position_id; }
                                                if order.request_id.is_none() { order.request_id = previous.request_id; }
                                            }
                                            orders.insert(id, order);
                                        }
                                    }
                                }
                                publish_orders(&orders, channel)?;
                            }
                        }
                        Some(21 | 25 | 26 | 27) => {
                            if value["mt"] == 21 {
                                if account_id.is_none() {
                                    account_id = exchange.getAccountByAddr(wallet_address).call().await.ok()
                                        .map(|account| account.accountId.to::<u64>());
                                }
                                if account_id.is_some() && unsigned(&value["id"]) == account_id {
                                  if let Some(allowed) = value["fw"].as_bool() {
                                    channel.send(PrivateEvent::Forwarding { allowed }).map_err(|e| e.to_string())?;
                                  }
                                }
                            }
                            channel.send(PrivateEvent::AccountChanged).map_err(|e| e.to_string())?;
                            if value["mt"] == 25 {
                                let _ = app.emit("perpl-trade-notification", json!({"message":"A trade fill was recorded for your wallet."}));
                            }
                        }
                        Some(100) => {
                            if let (Some(last), Some(next)) = (sequence, unsigned(&value["sn"])) {
                                if next != last + 1 { return Err("Perpl wallet feed missed an update".into()); }
                                sequence = Some(next);
                            }
                        }
                        Some(3) if value["status"]["code"] != 0 => {
                            return Err(value["status"]["error"].as_str().unwrap_or("Perpl wallet feed rejected access").into());
                        }
                        _ => {}
                    }
                }
                Some(Ok(Message::Ping(payload))) => { last_message = Instant::now(); sender.send(Message::Pong(payload)).await.map_err(|e| e.to_string())?; }
                Some(Ok(Message::Close(frame))) => return Err(format!("Perpl wallet feed closed: {frame:?}")),
                Some(Ok(_)) => last_message = Instant::now(),
                Some(Err(error)) => return Err(error.to_string()),
                None => return Err("Perpl wallet feed ended".into()),
            },
            _ = proxy_pong.tick() => { sender.send(Message::Pong(Vec::new().into())).await.map_err(|e| e.to_string())?; }
            _ = app_ping.tick() => {
                if last_message.elapsed() >= Duration::from_secs(60) { return Err("Perpl wallet feed timed out".into()); }
                sender.send(Message::Text(json!({"mt":1,"t":SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis()}).to_string().into())).await.map_err(|e| e.to_string())?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_order;
    use serde_json::json;

    #[test]
    fn uses_smart_contract_id_for_cancellation() {
        let order = parse_order(&json!({"mkt":16,"oid":891234,"scid":"241","t":0,"st":1})).unwrap();
        assert_eq!(order.order_id, 891234);
        assert_eq!(order.contract_order_id, Some(241));
    }

    #[test]
    fn missing_smart_contract_id_is_not_replaced_with_api_id() {
        let order = parse_order(&json!({"mkt":16,"oid":891234,"t":0,"st":1})).unwrap();
        assert_eq!(order.contract_order_id, None);
    }

    #[test]
    fn open_order_uses_remaining_size_from_snapshot() {
        let order = parse_order(&json!({"mkt":16,"oid":42,"scid":7,"t":3,"st":8,
            "p":0,"os":125_000,"fs":25_000,"tp":930_000,"tpc":4,"lp":12,"rq":88})).unwrap();
        assert_eq!(order.size_raw.as_deref(), Some("100000"));
        assert_eq!(order.trigger_price_raw.as_deref(), Some("930000"));
        assert_eq!(order.position_id, Some(12));
        assert_eq!(order.contract_order_id, Some(7));
    }
}

#[tauri::command]
pub fn start_private_feed(app: AppHandle, task: State<'_, PrivateFeedTask>, address: String,
    on_private: Channel<PrivateEvent>) -> Result<u64, String> {
    let address: alloy::primitives::Address = address.parse().map_err(|_| "Invalid wallet address")?;
    let address = address.to_string();
    if read_key::stored_key(&app, &address)?.is_none() { return Err("Connect Perpl wallet data first".into()); }
    let mut current = task.0.lock().map_err(|_| "Wallet feed unavailable")?;
    if let Some((_, previous)) = current.take() { previous.abort(); }
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    *current = Some((id, tauri::async_runtime::spawn(async move {
        let mut attempt = 0u32;
        loop {
            let _ = on_private.send(PrivateEvent::Status { state: "connecting".into(), message: None });
            match connect(&app, &address, &on_private).await {
                Ok(()) => break,
                Err(message) => {
                    eprintln!("Perpl wallet stream error: {message}");
                    let safe = crate::user_error::safe_message(&message, "Perpl wallet stream disconnected");
                    if on_private.send(PrivateEvent::Status { state: "reconnecting".into(), message: Some(safe) }).is_err() { break; }
                }
            }
            tokio::time::sleep(Duration::from_secs((1u64 << attempt.min(6)).min(60))).await;
            attempt = (attempt + 1).min(6);
        }
    })));
    Ok(id)
}

#[tauri::command]
pub fn stop_private_feed(task: State<'_, PrivateFeedTask>, id: u64) {
    if let Ok(mut current) = task.0.lock() {
        if current.as_ref().is_some_and(|(current_id, _)| *current_id == id) {
            if let Some((_, handle)) = current.take() { handle.abort(); }
        }
    }
}
