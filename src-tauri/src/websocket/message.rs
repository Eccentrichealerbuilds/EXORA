use std::collections::HashMap;

use serde_json::Value;
use tauri::{ipc::Channel, AppHandle};

use crate::{
    context::MarketInfo,
    format_price,
    market_event::MarketEvent,
    price::PriceUpdate,
    status,
    AppError,
};

fn number(value: &Value, key: &str) -> Option<u64> { value.get(key)?.as_u64() }
fn signed(value: &Value, key: &str) -> Option<i64> { value.get(key)?.as_i64() }
fn send_market(channel: Option<&Channel<MarketEvent>>, event: MarketEvent) -> Result<(), AppError> {
    if let Some(channel) = channel { channel.send(event)?; }
    Ok(())
}

pub fn read(
    text: &str,
    markets: &mut HashMap<u32, MarketInfo>,
    on_price: &Channel<PriceUpdate>,
    on_market: Option<&Channel<MarketEvent>>,
    candle_market: Option<u32>,
    resolution: Option<u32>,
    app: &AppHandle,
    connected: &mut bool,
    last_heartbeat: &mut Option<u64>,
) -> Result<(), AppError> {
    let frame: Value = serde_json::from_str(text)?;
    let mt = number(&frame, "mt").ok_or("Perpl frame has no message type")?;
    match mt {
        6 => {
            let subs = frame["subs"].as_array().ok_or("Invalid Perpl subscription response")?;
            for sub in subs {
                if number(&sub["status"], "code") != Some(0) {
                    return Err(format!("Perpl rejected {}: {}", sub["stream"], sub["status"]["error"]).into());
                }
            }
            if !*connected {
                *connected = true;
                status::send(app, "connected", "Perpl market stream subscribed");
            }
        }
        100 => {
            if let Some(sn) = number(&frame, "sn") {
                if let Some(previous) = *last_heartbeat {
                    if sn != previous + 1 {
                        return Err(format!("Perpl heartbeat gap: {previous} to {sn}").into());
                    }
                }
                *last_heartbeat = Some(sn);
            }
            if let Some(block) = number(&frame, "h") {
                send_market(on_market, MarketEvent::Head { block })?;
            }
        }
        8 => {
            if let Some(updates) = frame["d"].as_object() {
                for (id, config) in updates {
                    let Ok(id) = id.parse::<u32>() else { continue };
                    let Some(market) = markets.get_mut(&id) else { continue };
                    if let Some(value) = config["is_open"].as_bool() { market.is_open = value; }
                    if let Some(value) = number(config, "initial_margin") {
                        market.initial_margin = value as u32;
                        market.max_leverage_hundredths = value as u32;
                    }
                    if let Some(value) = number(config, "maintenance_margin") { market.maintenance_margin = value as u32; }
                    if let Some(value) = number(config, "maker_fee") { market.maker_fee_micros = value as u32; }
                    if let Some(value) = number(config, "taker_fee") { market.taker_fee_micros = value as u32; }
                    if let Some(value) = config["min_settle_amount"].as_str() { market.minimum_settle_amount = value.to_string(); }
                    send_market(on_market, MarketEvent::Config { market: market.clone() })?;
                }
            }
        }
        9 => {
            if let Some(updates) = frame["d"].as_object() {
                for (id, state) in updates {
                    let Ok(id) = id.parse::<u32>() else { continue };
                    let Some(market) = markets.get_mut(&id) else { continue };
                    let d = market.price_decimals;
                    let Some(last) = number(state, "lst") else { continue };
                    let mark = number(state, "mrk").unwrap_or(last);
                    let oracle = number(state, "orl").unwrap_or(mark);
                    let previous = number(state, "prv").unwrap_or(last);
                    let bid = number(state, "bid").unwrap_or(last);
                    let ask = number(state, "ask").unwrap_or(last);
                    let volume = state["dva"].as_str().unwrap_or("0");
                    let oi = number(state, "oi").unwrap_or(0);
                    market.price = Some(format_price::format_price(last, d));
                    market.mark_price = Some(format_price::format_price(mark, d));
                    market.oracle_price = Some(format_price::format_price(oracle, d));
                    market.previous_price = Some(format_price::format_price(previous, d));
                    market.bid = Some(format_price::format_price(bid, d));
                    market.ask = Some(format_price::format_price(ask, d));
                    market.volume_usd = Some(format_price::format_decimal_string(volume, 6));
                    market.open_interest = Some(format_price::format_price(oi, market.size_decimals));
                    market.updated_at_ms = number(&state["at"], "t");
                    on_price.send(PriceUpdate::new(market, mark))?;
                    send_market(on_market, MarketEvent::State {
                        market_id: id,
                        price: market.price.clone().unwrap_or_default(),
                        mark_price: market.mark_price.clone().unwrap_or_default(),
                        oracle_price: market.oracle_price.clone().unwrap_or_default(),
                        previous_price: market.previous_price.clone().unwrap_or_default(),
                        bid: market.bid.clone().unwrap_or_default(),
                        ask: market.ask.clone().unwrap_or_default(),
                        volume_usd: market.volume_usd.clone().unwrap_or_default(),
                        open_interest: market.open_interest.clone().unwrap_or_default(),
                        head: number(&state["at"], "b"),
                    })?;
                }
            }
        }
        10 => {
            if let Some(updates) = frame["d"].as_object() {
                for (id, funding) in updates {
                    let Ok(id) = id.parse::<u32>() else { continue };
                    let Some(market) = markets.get_mut(&id) else { continue };
                    if let Some(rate) = signed(funding, "rate") {
                        market.funding_rate = Some(rate);
                        send_market(on_market, MarketEvent::Funding { market_id: id, rate })?;
                    }
                }
            }
        }
        11 | 12 => {
            if let (Some(market_id), Some(resolution), Some(items)) = (candle_market, resolution, frame["d"].as_array()) {
                if let Some(market) = markets.get(&market_id) {
                    if frame["r"].as_u64().is_some_and(|r| r != u64::from(resolution)) { return Ok(()); }
                    let candles = crate::candles::decode(items, market.price_decimals);
                    crate::candles::live(market_id, resolution, &candles);
                    send_market(on_market, MarketEvent::Candles { market_id, resolution, snapshot: mt == 11, candles })?;
                }
            }
        }
        15 | 16 => {
            if let Some(market_id) = candle_market {
                crate::book::update(market_id, &frame, mt == 15);
            }
        }
        _ => {}
    }
    Ok(())
}
