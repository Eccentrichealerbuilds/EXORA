use alloy::primitives::{utils::format_units, U256};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::future::try_join_all;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::{context::MarketInfo, perpl::read_key};

const SOURCES: [&str; 4] = ["order-history", "fills", "position-history", "account-history"];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub id: String,
    pub kind: String,
    pub market_id: Option<u32>,
    pub symbol: Option<String>,
    pub side: Option<String>,
    pub amount: Option<String>,
    pub price: Option<String>,
    pub realized_pnl: Option<String>,
    pub fees: Option<String>,
    pub funding: Option<String>,
    pub position_reason: Option<u64>,
    pub transaction_hash: String,
    pub block_number: u64,
    pub timestamp_ms: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPage {
    pub items: Vec<ActivityItem>,
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub cached: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct Cursors([Option<String>; 4]);

fn unsigned(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

pub(crate) fn scaled(value: &Value, decimals: u32) -> Option<String> {
    let raw = value.as_str().map(str::to_owned).or_else(|| value.as_u64().map(|v| v.to_string()))?;
    let negative = raw.starts_with('-');
    let digits = raw.trim_start_matches('-').parse::<U256>().ok()?;
    let formatted = format_units(digits, decimals as u8).ok()?;
    Some(if negative { format!("-{formatted}") } else { formatted })
}

fn order_kind(order_type: u64, status: Option<u64>) -> String {
    let action = match order_type { 1 => "open long", 2 => "open short", 3 => "close long", 4 => "close short", 5 => "cancel order", _ => "order" };
    let state = match status { Some(1) => "pending", Some(2) => "open", Some(3) => "partially filled", Some(4) => "filled", Some(5) => "canceled", Some(6) => "expired", Some(7) => "failed", Some(8) => "untriggered", Some(9) => "triggered", Some(10) => "executed", _ => "" };
    if state.is_empty() { action.into() } else { format!("{action} · {state}") }
}

fn item(source: usize, _index: usize, value: &Value, markets: &std::collections::HashMap<u32, MarketInfo>) -> ActivityItem {
    let at = &value["at"];
    let market_id = unsigned(&value["mkt"]).or_else(|| unsigned(&value["m"])).map(|v| v as u32);
    let market = market_id.and_then(|id| markets.get(&id));
    let order_type = unsigned(&value["t"]).unwrap_or(0);
    let side = match if source == 2 { unsigned(&value["sd"]).unwrap_or(0) } else { order_type } { 1 | 3 => Some("long".into()), 2 | 4 => Some("short".into()), _ => None };
    let kind = match source {
        0 => order_kind(order_type, unsigned(&value["st"])),
        1 => format!("{} fill", if order_type == 3 || order_type == 4 { "close" } else { "trade" }),
        2 => "position update".into(),
        _ => match unsigned(&value["et"]).unwrap_or(0) {
            1 => "deposit", 2 => "withdrawal", 3 => "add position margin", 4 => "settlement",
            5 => "liquidation", 8 => "funding", 9 => "deleveraging", 10 => "unwinding",
            11 => "reduce position margin", _ => "account update",
        }.into(),
    };
    let amount = if source == 3 { scaled(&value["a"], 6) }
        else { market.and_then(|m| scaled(&value["s"], m.size_decimals)) };
    let price = if source <= 1 { market.and_then(|m| scaled(&value["p"], m.price_decimals)) } else if source == 2 { market.and_then(|m| scaled(&value["ep"], m.price_decimals)) } else { None };
    let raw_hash = at["txid"].as_str().unwrap_or_default().trim();
    let hash_digits = raw_hash.strip_prefix("0x").or_else(|| raw_hash.strip_prefix("0X")).unwrap_or(raw_hash);
    let transaction_hash = if hash_digits.is_empty() { String::new() }
        else { format!("0x{hash_digits}") };
    let block_number = unsigned(&at["b"]).unwrap_or_default();
    let timestamp_ms = unsigned(&at["t"]).unwrap_or_default();
    let event_id = unsigned(&value["r"]).or_else(|| unsigned(&value["oid"]))
        .or_else(|| unsigned(&value["o"])).or_else(|| unsigned(&value["pid"])).unwrap_or(0);
    ActivityItem {
        // Page offsets change when new records arrive. Keep note IDs tied to the event.
        // Inversions can produce a close and an open at the same block/log index.
        id: format!("{}:{source}:{block_number}:{}:{event_id}:{}:{}:{}:{timestamp_ms}", transaction_hash,
            unsigned(&at["l"]).unwrap_or_default(), market_id.unwrap_or(0),
            unsigned(&value["sd"]).unwrap_or(order_type), unsigned(&value["sr"]).unwrap_or_default()),
        realized_pnl: if source == 2 { scaled(&value["dpnl"], 6) } else { None },
        fees: if source == 2 { scaled(&value["fee"], 6) } else { None },
        funding: if source == 2 { scaled(&value["fnd"], 6) } else { None },
        position_reason: if source == 2 { unsigned(&value["sr"]) } else { None },
        kind, market_id, symbol: market.map(|m| m.symbol.clone()), side, amount, price,
        transaction_hash, block_number, timestamp_ms,
    }
}

async fn fetch(app: &AppHandle, address: &str, source: &str, cursor: Option<&str>) -> Result<Value, String> {
    // The signer adds the /api base path when sending; its canonical target starts at /v1.
    let mut url = reqwest::Url::parse(&format!("https://testnet.perpl.xyz/v1/trading/{source}"))
        .map_err(|_| "Could not prepare the activity request".to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("count", "25");
        if let Some(cursor) = cursor { query.append_pair("page", cursor); }
    }
    let target = format!("{}?{}", url.path(), url.query().unwrap_or_default());
    read_key::signed_get(app, address, &target).await
}

/// Reads only this wallet's indexed Perpl history. No exchange-wide block scans.
#[tauri::command]
pub async fn get_perpl_activity(app: AppHandle, address: String, cursor: Option<String>) -> Result<ActivityPage, String> {
    let cursors = match cursor.as_ref() {
        Some(cursor) => serde_json::from_slice::<Cursors>(&URL_SAFE_NO_PAD.decode(cursor).map_err(|_| "Invalid activity page")?)
            .map_err(|_| "Invalid activity page")?,
        None => Cursors::default(),
    };
    let cache_key = format!("cache-activity-{}", crate::local_data::wallet_key(&address)?);
    let saved_page = || {
        if cursor.is_some() { return None; }
        crate::local_data::read::<ActivityPage>(&app, &cache_key).map(|mut saved| {
            saved.cached = true; saved.next_cursor = None; saved
        })
    };
    let markets = match crate::context::market_metadata().await {
        Ok(context) => context.markets,
        Err(_) => return saved_page().ok_or_else(|| "Could not load market details for activity".to_string()),
    };
    let mut items = Vec::new();
    let mut next: [Option<String>; 4] = Default::default();
    let requested: Vec<_> = (0..SOURCES.len())
        .filter(|&index| cursor.is_none() || cursors.0[index].is_some()).collect();
    let pages = try_join_all(requested.iter().map(|&index| {
        fetch(&app, &address, SOURCES[index], cursors.0[index].as_deref())
    })).await;
    let pages = match pages {
        Ok(pages) => pages,
        Err(error) => {
            if let Some(saved) = saved_page() { return Ok(saved); }
            return Err(error);
        }
    };
    for (index, page) in requested.into_iter().zip(pages) {
        let data = page["d"].as_array().ok_or("Perpl returned invalid activity data")?;
        items.extend(data.iter().enumerate().map(|(i, value)| item(index, i, value, &markets)));
        next[index] = page["np"].as_str().filter(|v| !v.is_empty()).map(str::to_owned);
    }
    items.sort_by(|left, right| right.timestamp_ms.cmp(&left.timestamp_ms)
        .then_with(|| right.block_number.cmp(&left.block_number)));
    let next_cursor = if next.iter().any(Option::is_some) {
        Some(URL_SAFE_NO_PAD.encode(serde_json::to_vec(&Cursors(next)).map_err(|_| "Could not load the next activity page".to_string())?))
    } else { None };
    let page = ActivityPage { items, next_cursor, cached: false };
    if cursor.is_none() { let _ = crate::local_data::write(&app, &cache_key, &page); }
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn journal_identity_survives_newer_history_and_distinguishes_inversions() {
        let markets = std::collections::HashMap::new();
        let close = serde_json::json!({"at":{"b":20,"l":3,"t":1000,"txid":"abc"},"mkt":16,"pid":42,"sd":1,"sr":13});
        assert_eq!(item(2,0,&close,&markets).id,item(2,24,&close,&markets).id);
        let mut open=close.clone(); open["sd"]=2.into();open["sr"]=18.into();
        assert_ne!(item(2,0,&close,&markets).id,item(2,0,&open,&markets).id);
    }
}
