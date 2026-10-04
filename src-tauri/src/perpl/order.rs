use std::time::{SystemTime, UNIX_EPOCH};

use alloy::{primitives::{utils::format_units, Address, U256}, providers::Provider};
use perpl_sdk::abi::dex::Exchange;
use serde::{Deserialize, Serialize};

use crate::{context::{self, MarketInfo}, perpl::exchange_address, utils::parse_amount::parse_amount};

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side { Long, Short }

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OrderKind { Market, Limit }

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TimeInForce { Gtc, Ioc, Fok, PostOnly }

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderInput {
    pub address: String,
    pub market_id: u32,
    pub side: Side,
    pub order_type: OrderKind,
    pub size_usd: String,
    pub leverage_hundredths: u32,
    pub limit_price: Option<String>,
    pub slippage_bps: Option<u16>,
    pub time_in_force: Option<TimeInForce>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderQuote {
    pub market_id: u32,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderKind,
    pub size_usd: String,
    pub quantity: String,
    pub reference_price: String,
    pub worst_price: String,
    pub estimated_margin: String,
    pub estimated_fee: String,
    pub available_balance: String,
    pub leverage_hundredths: u32,
    pub max_leverage_hundredths: u32,
    pub slippage_bps: u16,
    pub time_in_force: TimeInForce,
    pub head_block: u64,
    pub indicative_fill_quantity: Option<String>,
    pub indicative_average_price: Option<String>,
    pub book_timestamp_ms: Option<u64>,
}

pub struct PreparedOrder {
    pub quote: OrderQuote,
    pub market: MarketInfo,
    pub price_raw: U256,
    pub quantity_raw: U256,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseInput {
    pub address: String,
    pub market_id: u32,
    pub slippage_bps: u16,
    pub quantity: Option<String>,
    pub limit_price: Option<String>,
}

pub struct PreparedClose {
    pub quote: OrderQuote,
    pub market: MarketInfo,
    pub price_raw: U256,
    pub quantity_raw: U256,
    pub order_type: u8,
}

fn scale(decimals: u32) -> U256 {
    (0..decimals).fold(U256::from(1), |value, _| value * U256::from(10))
}

fn ceil_div(numerator: U256, denominator: U256) -> U256 {
    (numerator + denominator - U256::from(1)) / denominator
}

fn within_price_bound(side: Side, current: U256, bound: U256, closing: bool) -> bool {
    match (side, closing) {
        (Side::Long, false) | (Side::Short, true) => current <= bound,
        (Side::Short, false) | (Side::Long, true) => current >= bound,
    }
}

fn format(raw: U256, decimals: u32) -> Result<String, String> {
    format_units(raw, decimals as u8).map_err(|_| "Could not format the market amount".to_string())
}

pub async fn prepare(input: &OrderInput, reviewed: Option<&OrderQuote>) -> Result<PreparedOrder, String> {
    let address: Address = input.address.parse().map_err(|_| "Invalid wallet address")?;
    let context = context::markets().await.map_err(|_| "Could not load Perpl markets. Refresh and try again".to_string())?;
    let market = context.markets.get(&input.market_id)
        .ok_or("This market is unavailable on Monad testnet")?.clone();
    if !market.is_open { return Err("Trading is paused for this market".into()); }
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Device time is unavailable".to_string())?.as_millis() as u64;
    if market.updated_at_ms.is_none_or(|updated| now_ms.saturating_sub(updated) > 90_000) {
        return Err("Market prices are stale. Wait for a fresh update before trading.".into());
    }
    if input.leverage_hundredths < 100 || input.leverage_hundredths > market.max_leverage_hundredths {
        return Err(format!("Leverage must be between 1× and {:.2}× for {}", market.max_leverage_hundredths as f64 / 100.0, market.symbol));
    }
    let reference = match input.side { Side::Long => market.ask.as_deref(), Side::Short => market.bid.as_deref() }
        .ok_or("This market has no live bid/ask price")?;
    let reference_raw = parse_amount(Some(reference.into()), market.price_decimals as u8)?;
    if reference_raw.is_zero() { return Err("This market has no executable price".into()); }
    let slippage = input.slippage_bps.unwrap_or(1000);
    let time_in_force = if input.order_type == OrderKind::Market { TimeInForce::Ioc }
        else { input.time_in_force.unwrap_or(TimeInForce::Gtc) };
    if matches!(input.order_type, OrderKind::Market) && (slippage == 0 || slippage >= 10_000) {
        return Err("Slippage must be between 0.01% and 99.99%".into());
    }
    let fresh_price_raw = match input.order_type {
        OrderKind::Limit => {
            let value = input.limit_price.clone().ok_or("Enter a limit price")?;
            parse_amount(Some(value), market.price_decimals as u8)?
        }
        OrderKind::Market => {
            let base = U256::from(10_000);
            match input.side {
                Side::Long => ceil_div(reference_raw * U256::from(10_000 + slippage as u32), base),
                Side::Short => reference_raw * U256::from(10_000 - slippage as u32) / base,
            }
        }
    };
    if fresh_price_raw.is_zero() { return Err("The order price must be greater than zero".into()); }
    let notional = parse_amount(Some(input.size_usd.replace(',', "")), 6)?;
    if notional.is_zero() || notional > U256::from(1_000_000_000_000_000_000_u128) {
        return Err("Enter a valid USD size".into());
    }
    let (price_raw, quantity_raw) = if let Some(quote) = reviewed {
        if quote.market_id != market.id || quote.side != input.side || quote.order_type != input.order_type
            || quote.leverage_hundredths != input.leverage_hundredths || quote.symbol != market.symbol
            || quote.slippage_bps != if matches!(input.order_type, OrderKind::Market) { slippage } else { 0 }
            || quote.time_in_force != time_in_force
        { return Err("The reviewed order no longer matches the selected trade. Refresh the quote.".into()); }
        let original_reference = parse_amount(Some(quote.reference_price.clone()), market.price_decimals as u8)?;
        let original_price = parse_amount(Some(quote.worst_price.clone()), market.price_decimals as u8)?;
        let original_quantity = parse_amount(Some(quote.quantity.clone()), market.size_decimals as u8)?;
        if original_reference.is_zero() || original_price.is_zero() || original_quantity.is_zero() {
            return Err("The reviewed quote is invalid. Refresh the quote.".into());
        }
        let expected_price = match input.order_type {
            OrderKind::Limit => fresh_price_raw,
            OrderKind::Market => match input.side {
                Side::Long => ceil_div(original_reference * U256::from(10_000 + slippage as u32), U256::from(10_000)),
                Side::Short => original_reference * U256::from(10_000 - slippage as u32) / U256::from(10_000),
            },
        };
        let sizing_price = if input.order_type == OrderKind::Limit { original_price } else { original_reference };
        let expected_quantity = notional * scale(market.size_decimals) * scale(market.price_decimals)
            / (sizing_price * scale(6));
        if original_price != expected_price || original_quantity != expected_quantity {
            return Err("The reviewed quote no longer matches the selected size or price. Refresh the quote.".into());
        }
        if matches!(input.order_type, OrderKind::Market)
            && !within_price_bound(input.side, reference_raw, original_price, false) {
            return Err("The market moved beyond your reviewed price limit. Refresh the quote to continue.".into());
        }
        if input.order_type == OrderKind::Market && input.side == Side::Short
            && reference_raw > ceil_div(original_reference * U256::from(10_000 + slippage as u32), U256::from(10_000)) {
            return Err("The market moved enough to increase your reviewed USD size. Refresh the quote to continue.".into());
        }
        (original_price, original_quantity)
    } else {
        let sizing_price = if input.order_type == OrderKind::Limit { fresh_price_raw } else { reference_raw };
        let quantity = notional * scale(market.size_decimals) * scale(market.price_decimals)
            / (sizing_price * scale(6));
        (fresh_price_raw, quantity)
    };
    if quantity_raw.is_zero() { return Err(format!("Minimum size is one {} unit", market.symbol)); }
    let execution_price = if input.order_type == OrderKind::Limit { price_raw } else { reference_raw };
    let actual_notional = quantity_raw * execution_price * scale(6)
        / (scale(market.size_decimals) * scale(market.price_decimals));
    let risk_price = if input.order_type == OrderKind::Limit { price_raw } else { reference_raw.max(price_raw) };
    let risk_notional = quantity_raw * risk_price * scale(6)
        / (scale(market.size_decimals) * scale(market.price_decimals));
    let margin = ceil_div(risk_notional * U256::from(100), U256::from(input.leverage_hundredths));
    let fee_micros = market.taker_fee_micros;
    let fee = ceil_div(risk_notional * U256::from(fee_micros), U256::from(1_000_000));

    let provider = crate::provider::provider();
    let exchange = Exchange::new(exchange_address(), provider.clone());
    let account_call = exchange.getAccountByAddr(address);
    let minimum_call = exchange.getMinimumSettleCNS();
    let (account, global_minimum, head) = tokio::join!(
        account_call.call(), minimum_call.call(), provider.get_block_number(),
    );
    let account = account.map_err(|error| {
        if crate::perpl::account_missing(&error) { "Set up trading from Home: get testnet MON for fees, claim AUSD, then create and fund your Perpl account".into() }
        else { crate::user_error::contract(error, "load your Perpl account") }
    })?;
    if account.frozen != 0 { return Err("This Perpl account is frozen".into()); }
    let available = account.balanceCNS.saturating_sub(account.lockedBalanceCNS);
    if margin + fee > available { return Err("Insufficient available AUSD in your Perpl account".into()); }
    let global_minimum = global_minimum.map_err(|error| crate::user_error::contract(error, "check the order minimum"))?;
    let market_minimum: U256 = if market.minimum_settle_amount.is_empty() { U256::ZERO } else {
        market.minimum_settle_amount.parse().map_err(|_| "Invalid market minimum from Perpl")?
    };
    let minimum = global_minimum.max(market_minimum);
    if actual_notional < minimum { return Err(format!("Minimum order value is {} AUSD", format(minimum, 6)?)); }
    let head = head.map_err(|error| crate::user_error::rpc(error, "check the current block"))?;
    let book = if input.order_type == OrderKind::Market {
        crate::book::estimate(market.id, input.side == Side::Long, price_raw, quantity_raw)
    } else { None };
    Ok(PreparedOrder {
        quote: OrderQuote {
            market_id: market.id,
            symbol: market.symbol.clone(),
            side: input.side,
            order_type: input.order_type,
            size_usd: format(actual_notional, 6)?,
            quantity: format(quantity_raw, market.size_decimals)?,
            reference_price: format(reference_raw, market.price_decimals)?,
            worst_price: format(price_raw, market.price_decimals)?,
            estimated_margin: format(margin, 6)?,
            estimated_fee: format(fee, 6)?,
            available_balance: format(available, 6)?,
            leverage_hundredths: input.leverage_hundredths,
            max_leverage_hundredths: market.max_leverage_hundredths,
            slippage_bps: if matches!(input.order_type, OrderKind::Market) { slippage } else { 0 },
            time_in_force,
            head_block: head,
            indicative_fill_quantity: book.as_ref().and_then(|value| format(value.filled_raw, market.size_decimals).ok()),
            indicative_average_price: book.as_ref().and_then(|value| value.average_price_raw.and_then(|price| format(price, market.price_decimals).ok())),
            book_timestamp_ms: book.as_ref().and_then(|value| value.timestamp_ms),
        },
        market,
        price_raw,
        quantity_raw,
    })
}

#[tauri::command]
pub async fn preview_perpl_order(input: OrderInput) -> Result<OrderQuote, String> {
    Ok(prepare(&input, None).await?.quote)
}

pub async fn prepare_close(input: &CloseInput) -> Result<PreparedClose, String> {
    let address: Address = input.address.parse().map_err(|_| "Invalid wallet address")?;
    let context = context::markets().await.map_err(|_| "Could not load Perpl markets. Refresh and try again".to_string())?;
    let market = context.markets.get(&input.market_id)
        .ok_or("This market is unavailable")?.clone();
    if !market.is_open { return Err("Trading is paused for this market".into()); }
    if input.limit_price.is_none() && (input.slippage_bps == 0 || input.slippage_bps >= 10_000) {
        return Err("Slippage must be between 0.01% and 99.99%".into());
    }
    let provider = crate::provider::provider();
    let exchange = Exchange::new(exchange_address(), provider.clone());
    let account = exchange.getAccountByAddr(address).call().await.map_err(|error| {
        if crate::perpl::account_missing(&error) { "No Perpl account exists for this wallet".into() }
        else { crate::user_error::contract(error, "load your Perpl account") }
    })?;
    if account.frozen != 0 { return Err("This Perpl account is frozen".into()); }
    let (quantity, position_type) = match exchange.getPositionV2(U256::from(market.id), account.accountId).call().await {
        Ok(result) => (result.positionInfo.lotLNS, result.positionInfo.positionType),
        Err(_) => {
            let result = exchange.getPosition(U256::from(market.id), account.accountId)
                .call().await.map_err(|error| crate::user_error::contract(error, "load your position"))?;
            (result.positionInfo.lotLNS, result.positionInfo.positionType)
        }
    };
    if quantity.is_zero() { return Err("This position is already closed".into()); }
    let quantity = if let Some(value) = input.quantity.as_ref() {
        let selected = parse_amount(Some(value.clone()), market.size_decimals as u8)?;
        if selected.is_zero() || selected > quantity { return Err("Close size must be greater than zero and no larger than the current position".into()); }
        selected
    } else { quantity };
    let side = if position_type == 0 { Side::Long } else { Side::Short };
    let reference = if matches!(side, Side::Long) { market.bid.as_deref() } else { market.ask.as_deref() }
        .ok_or("This market has no live bid/ask price")?;
    let reference_raw = parse_amount(Some(reference.into()), market.price_decimals as u8)?;
    if reference_raw.is_zero() { return Err("This market has no executable price".into()); }
    let price_raw = if let Some(value) = input.limit_price.as_ref() {
        let price = parse_amount(Some(value.clone()), market.price_decimals as u8)?;
        if price.is_zero() { return Err("Close limit price must be greater than zero".into()); }
        price
    } else if matches!(side, Side::Long) {
        reference_raw * U256::from(10_000 - input.slippage_bps as u32) / U256::from(10_000)
    } else {
        ceil_div(reference_raw * U256::from(10_000 + input.slippage_bps as u32), U256::from(10_000))
    };
    let notional = quantity * reference_raw * scale(6)
        / (scale(market.size_decimals) * scale(market.price_decimals));
    let fee = ceil_div(notional * U256::from(market.taker_fee_micros), U256::from(1_000_000));
    let head = provider.get_block_number().await.map_err(|error| crate::user_error::rpc(error, "check the current block"))?;
    let book = if input.limit_price.is_none() { crate::book::estimate(market.id, side == Side::Short, price_raw, quantity) } else { None };
    Ok(PreparedClose {
        quote: OrderQuote {
            market_id: market.id, symbol: market.symbol.clone(), side,
            order_type: if input.limit_price.is_some() { OrderKind::Limit } else { OrderKind::Market }, size_usd: format(notional, 6)?,
            quantity: format(quantity, market.size_decimals)?,
            reference_price: format(reference_raw, market.price_decimals)?,
            worst_price: format(price_raw, market.price_decimals)?,
            estimated_margin: "0".into(), estimated_fee: format(fee, 6)?,
            available_balance: format(account.balanceCNS.saturating_sub(account.lockedBalanceCNS), 6)?,
            leverage_hundredths: 0, max_leverage_hundredths: market.max_leverage_hundredths,
            slippage_bps: if input.limit_price.is_some() { 0 } else { input.slippage_bps }, head_block: head,
            time_in_force: if input.limit_price.is_some() { TimeInForce::Gtc } else { TimeInForce::Ioc },
            indicative_fill_quantity: book.as_ref().and_then(|value| format(value.filled_raw, market.size_decimals).ok()),
            indicative_average_price: book.as_ref().and_then(|value| value.average_price_raw.and_then(|price| format(price, market.price_decimals).ok())),
            book_timestamp_ms: book.as_ref().and_then(|value| value.timestamp_ms),
        }, market, price_raw, quantity_raw: quantity,
        order_type: if matches!(side, Side::Long) { 2 } else { 3 },
    })
}

pub async fn prepare_reviewed_close(input: &CloseInput, reviewed: &OrderQuote) -> Result<PreparedClose, String> {
    let mut prepared = prepare_close(input).await?;
    let market = &prepared.market;
    if reviewed.market_id != market.id || reviewed.symbol != market.symbol
        || reviewed.side != prepared.quote.side || reviewed.order_type != prepared.quote.order_type
        || reviewed.slippage_bps != prepared.quote.slippage_bps || reviewed.quantity != prepared.quote.quantity {
        return Err("The position changed since review. Refresh the close quote.".into());
    }
    let original_reference = parse_amount(Some(reviewed.reference_price.clone()), market.price_decimals as u8)?;
    let original_price = parse_amount(Some(reviewed.worst_price.clone()), market.price_decimals as u8)?;
    let current_reference = parse_amount(Some(prepared.quote.reference_price.clone()), market.price_decimals as u8)?;
    if original_reference.is_zero() || original_price.is_zero() {
        return Err("The reviewed close quote is invalid. Refresh it.".into());
    }
    let expected_price = if input.limit_price.is_some() { prepared.price_raw }
    else if prepared.quote.side == Side::Long {
        original_reference * U256::from(10_000 - input.slippage_bps as u32) / U256::from(10_000)
    } else {
        ceil_div(original_reference * U256::from(10_000 + input.slippage_bps as u32), U256::from(10_000))
    };
    if original_price != expected_price {
        return Err("The reviewed close price is invalid. Refresh the quote.".into());
    }
    if input.limit_price.is_none() && !within_price_bound(prepared.quote.side, current_reference, original_price, true) {
        return Err("The market moved beyond your reviewed close price. Refresh the quote to continue.".into());
    }
    prepared.price_raw = original_price;
    prepared.quote.worst_price = reviewed.worst_price.clone();
    Ok(prepared)
}

#[tauri::command]
pub async fn preview_perpl_close(input: CloseInput) -> Result<OrderQuote, String> {
    Ok(prepare_close(&input).await?.quote)
}

#[cfg(test)]
mod tests {
    use super::{within_price_bound, Side};
    use alloy::primitives::U256;

    #[test]
    fn reviewed_market_prices_allow_movement_only_within_execution_bound() {
        let at = U256::from(100);
        assert!(within_price_bound(Side::Long, at, at, false));
        assert!(within_price_bound(Side::Long, U256::from(99), at, false));
        assert!(!within_price_bound(Side::Long, U256::from(101), at, false));
        assert!(within_price_bound(Side::Short, U256::from(101), at, false));
        assert!(!within_price_bound(Side::Short, U256::from(99), at, false));
    }

    #[test]
    fn reviewed_close_prices_use_opposite_side_of_bound() {
        let at = U256::from(100);
        assert!(within_price_bound(Side::Long, U256::from(101), at, true));
        assert!(!within_price_bound(Side::Long, U256::from(99), at, true));
        assert!(within_price_bound(Side::Short, U256::from(99), at, true));
        assert!(!within_price_bound(Side::Short, U256::from(101), at, true));
    }
}
