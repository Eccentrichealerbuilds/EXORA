//! Public chart history and bounded cache. HTTP responses may never overwrite a
//! candle updated by the socket while that HTTP request was in flight.
use std::{collections::{BTreeMap, HashMap}, sync::{LazyLock, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};
use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use crate::{context, format_price, market_event::Candle, AppError};

const RESOLUTIONS: &[u32] = &[60, 300, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400];
const MAX_BARS: usize = 12_000;
#[derive(Default)]
struct Series {
    bars: BTreeMap<u64, (Candle, u64)>, version: u64, epoch: u64,
    covered_until: u64, continuous: bool, ranges: Vec<(u64, u64)>, touched: u64,
}
static CACHE: LazyLock<Mutex<HashMap<(u32, u32), Series>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| reqwest::Client::builder()
    .timeout(Duration::from_secs(12)).build().expect("chart HTTP client"));
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn with_series<T>(key: (u32, u32), run: impl FnOnce(&mut Series) -> T) -> T {
    let mut cache = CACHE.lock().unwrap_or_else(|error| error.into_inner());
    if !cache.contains_key(&key) && cache.len() >= 12 {
        if let Some(oldest) = cache.iter().min_by_key(|(_, series)| series.touched).map(|(key, _)| *key) { cache.remove(&oldest); }
    }
    let series = cache.entry(key).or_default(); series.touched = now();
    run(series)
}
fn trim(series: &mut Series) {
    while series.bars.len() > MAX_BARS { series.bars.pop_first(); }
    if let Some(first) = series.bars.keys().next().copied() {
        series.ranges.retain(|(_, to)| *to >= first);
        for (from, _) in &mut series.ranges { *from = (*from).max(first); }
    }
}
pub fn decode(items: &[Value], decimals: u32) -> Vec<Candle> {
    items.iter().filter_map(|item| {
        let number = |key: &str| item[key].as_u64().or_else(|| item[key].as_str()?.parse().ok());
        let (open, close, high, low) = (number("o")?, number("c")?, number("h")?, number("l")?);
        if low > high || open < low || open > high || close < low || close > high { return None; }
        Some(Candle { time: number("t")?, open: format_price::format_price(open, decimals),
            close: format_price::format_price(close, decimals), high: format_price::format_price(high, decimals),
            low: format_price::format_price(low, decimals),
            volume: format_price::format_decimal_string(&item["v"].as_str().map(str::to_owned)
                .unwrap_or_else(|| item["v"].as_u64().unwrap_or(0).to_string()), 6), trades: number("n").unwrap_or(0) })
    }).collect()
}
pub fn live(market: u32, resolution: u32, bars: &[Candle]) {
    with_series((market, resolution), |series| {
        series.version += 1;
        for bar in bars {
            series.bars.insert(bar.time, (bar.clone(), series.version));
            if series.continuous { series.covered_until = series.covered_until.max(bar.time); }
        }
        trim(series);
    });
}
pub fn disconnected(market: Option<u32>, resolution: Option<u32>) {
    if let (Some(market), Some(resolution)) = (market, resolution) {
        with_series((market, resolution), |series| { series.continuous = false; series.epoch += 1; });
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    candles: Vec<Candle>, from: u64, to: u64, cached: bool,
}
fn snapshot(key: (u32, u32), from: u64, to: u64, cached: bool) -> History {
    with_series(key, |series| History { candles: series.bars.range(from..=to).map(|(_, (bar, _))| bar.clone()).collect(), from, to, cached })
}
fn merge_http(series: &mut Series, bars: Vec<Candle>, version: u64) {
    for bar in bars {
        if series.bars.get(&bar.time).is_none_or(|(_, updated)| *updated <= version) {
            series.bars.insert(bar.time, (bar, version));
        }
    }
    trim(series);
}
async fn history(market_id: u32, resolution: u32, before: Option<u64>, channel: Channel<History>) -> Result<(), AppError> {
    if !RESOLUTIONS.contains(&resolution) { return Err("Unsupported chart interval".into()); }
    let key = (market_id, resolution);
    let step = u64::from(resolution) * 1000;
    let to = before.unwrap_or_else(now).min(now());
    let from = to.saturating_sub(300 * step);
    let (version, epoch, covered, already_cached) = with_series(key, |series| (
        series.version, series.epoch, series.covered_until,
        before.is_some() && series.ranges.iter().any(|&(a, b)| a <= from && b >= to)));
    let initial = snapshot(key, from, to, true);
    if !initial.candles.is_empty() { channel.send(initial)?; }
    if already_cached { channel.send(snapshot(key, from, to, false))?; return Ok(()); }
    let metadata = context::market_metadata().await?;
    let market = metadata.markets.get(&market_id).ok_or("This market is unavailable")?;
    // Recover gaps within the bounded retained window. A fresh chart starts with 300 bars.
    let mut cursor = if before.is_none() && covered > 0 { covered.saturating_sub(step * 2).max(to.saturating_sub(MAX_BARS as u64 * step)) } else { from };
    let request_from = cursor;
    while cursor < to {
        let end = (cursor + step * 1000).min(to);
        let value: Value = CLIENT.get(format!("https://testnet.perpl.xyz/api/v1/market-data/{market_id}/candles/{resolution}/{cursor}-{end}"))
            .send().await?.error_for_status()?.json().await?;
        let items = value["d"].as_array().ok_or("Invalid chart history response")?;
        let bars = decode(items, market.price_decimals);
        if !items.is_empty() && bars.len() != items.len() { return Err("Invalid chart candle data".into()); }
        with_series(key, |series| merge_http(series, bars, version));
        cursor = end;
    }
    with_series(key, |series| {
        series.ranges.push((request_from, to));
        if series.ranges.len() > 64 { series.ranges.remove(0); }
        if before.is_none() && series.epoch == epoch {
            series.covered_until = to;
            series.continuous = true;
        }
    });
    channel.send(snapshot(key, request_from.min(from), to, false))?;
    Ok(())
}
#[tauri::command]
pub async fn get_chart_history(market_id: u32, resolution: u32, before: Option<u64>, on_candles: Channel<History>) -> Result<(), String> {
    history(market_id, resolution, before, on_candles).await.map_err(|error| {
        eprintln!("Chart history: {error}");
        "Chart history couldn't load. Check your connection and retry.".to_string()
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn bar(time: u64, close: &str) -> Candle { Candle { time, open: "1".into(), close: close.into(), high: "3".into(), low: "1".into(), volume: "0".into(), trades: 1 } }
    #[test] fn historical_reply_cannot_replace_newer_live_candle() {
        let mut series = Series::default();
        series.bars.insert(10, (bar(10, "3"), 2));
        merge_http(&mut series, vec![bar(10, "2"), bar(1, "2")], 1);
        assert_eq!(series.bars[&10].0.close, "3"); assert_eq!(series.bars.len(), 2);
    }
    #[test] fn scaling_and_invalid_ohlc() {
        let values = vec![serde_json::json!({"t":1000,"o":100,"c":125,"h":130,"l":90,"v":"2500000"}), serde_json::json!({"t":2000,"o":200,"c":100,"h":150,"l":90})];
        let bars = decode(&values, 2); assert_eq!(bars.len(), 1); assert_eq!(bars[0].close, "1.25"); assert_eq!(bars[0].volume, "2.500000");
    }
}
