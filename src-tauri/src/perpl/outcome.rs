use std::{collections::VecDeque, sync::{LazyLock, Mutex}};
use alloy::{primitives::{utils::format_units, B256, U256}, providers::Provider, rpc::types::TransactionReceipt, sol_types::SolEventInterface};
use perpl_sdk::abi::dex::Exchange::ExchangeEvents;
use serde::Serialize;

use crate::perpl::exchange_address;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderOutcome {
    pub status: String,
    pub market_id: Option<u32>,
    pub requested: Option<String>,
    pub filled: Option<String>,
    pub remaining: Option<String>,
    pub average_price: Option<String>,
    pub fee: Option<String>,
    pub resting_order_id: Option<u64>,
}

// Keep recent confirmed receipts so displaying a fill does not fetch them twice.
static RECEIPTS: LazyLock<Mutex<VecDeque<(B256, TransactionReceipt)>>> =
    LazyLock::new(|| Mutex::new(VecDeque::new()));

pub fn remember_receipt(hash: B256, receipt: TransactionReceipt) {
    if let Ok(mut receipts) = RECEIPTS.lock() {
        if receipts.len() >= 32 { receipts.pop_front(); }
        receipts.push_back((hash, receipt));
    }
}

fn cached_receipt(hash: B256) -> Option<TransactionReceipt> {
    RECEIPTS.lock().ok()?.iter().rev()
        .find(|(key, _)| *key == hash).map(|(_, receipt)| receipt.clone())
}

pub fn from_receipt(receipt: &TransactionReceipt, size_decimals: u32, price_decimals: u32) -> Option<OrderOutcome> {
    let mut market_id = None;
    let mut requested = None;
    let mut taker_filled = U256::ZERO;
    let mut fee = U256::ZERO;
    let mut weighted_price = U256::ZERO;
    let mut maker_filled = U256::ZERO;
    let mut ioc_remaining = None;
    let mut resting_order_id = None;
    let mut resting_quantity = None;
    for log in receipt.inner.logs().iter().filter(|log| log.address() == exchange_address()) {
        let Ok(decoded) = ExchangeEvents::decode_log(&log.inner) else { continue; };
        match decoded.data {
            ExchangeEvents::OrderRequestV2(event) => {
                market_id = u32::try_from(event.perpId).ok();
                requested = Some(event.lotLNS);
            }
            ExchangeEvents::OrderRequest(event) => {
                market_id = u32::try_from(event.perpId).ok();
                requested = Some(event.lotLNS);
            }
            ExchangeEvents::TakerOrderFilledV2(event) => {
                taker_filled += event.lotLNS;
                fee += event.feeCNS;
            }
            ExchangeEvents::TakerOrderFilled(event) => {
                taker_filled += event.lotLNS;
                fee += event.feeCNS;
            }
            ExchangeEvents::MakerOrderFilledV2(event) => {
                weighted_price += event.pricePNS * event.lotLNS;
                maker_filled += event.lotLNS;
            }
            ExchangeEvents::MakerOrderFilled(event) => {
                weighted_price += event.pricePNS * event.lotLNS;
                maker_filled += event.lotLNS;
            }
            ExchangeEvents::ImmediateOrCancelExecuted(event) => {
                ioc_remaining = Some(event.unmatchedLotLNS);
                requested = Some(event.totalLotLNS);
            }
            ExchangeEvents::OrderPlaced(event) => {
                resting_order_id = u64::try_from(event.orderId).ok();
                resting_quantity = Some(event.lotLNS);
            }
            _ => {}
        }
    }
    let requested = requested?;
    let filled = ioc_remaining.map(|remaining| requested.saturating_sub(remaining))
        .unwrap_or(taker_filled);
    let remaining = ioc_remaining.or(resting_quantity).unwrap_or(U256::ZERO);
    let status = if filled.is_zero() && ioc_remaining.is_some() { "unfilled" }
        else if remaining > U256::ZERO && filled > U256::ZERO { "partiallyFilled" }
        else if resting_order_id.is_some() { "resting" }
        else if filled > U256::ZERO { "filled" }
        else { "unknown" };
    Some(OrderOutcome {
        status: status.into(), market_id,
        requested: format_units(requested, size_decimals as u8).ok(),
        filled: format_units(filled, size_decimals as u8).ok(),
        remaining: format_units(remaining, size_decimals as u8).ok(),
        average_price: if maker_filled.is_zero() { None } else { format_units(weighted_price / maker_filled, price_decimals as u8).ok() },
        fee: format_units(fee, 6).ok(), resting_order_id,
    })
}

#[tauri::command]
pub async fn inspect_perpl_order_result(hash: String) -> Result<Option<OrderOutcome>, String> {
    let hash: B256 = hash.parse().map_err(|_| "Invalid transaction hash")?;
    let receipt = if let Some(receipt) = cached_receipt(hash) { receipt } else {
        crate::provider::provider().get_transaction_receipt(hash).await
        .map_err(|error| crate::user_error::rpc(error, "check the trade result"))?
        .ok_or("The transaction is still awaiting confirmation")?
    };
    if !receipt.status() { return Err("The transaction failed on Monad".into()); }
    let market_id = receipt.inner.logs().iter().filter(|log| log.address() == exchange_address())
        .filter_map(|log| ExchangeEvents::decode_log(&log.inner).ok())
        .find_map(|event| match event.data {
            ExchangeEvents::OrderRequestV2(event) => u32::try_from(event.perpId).ok(),
            ExchangeEvents::OrderRequest(event) => u32::try_from(event.perpId).ok(),
            _ => None,
        });
    let Some(market_id) = market_id else { return Ok(None); };
    let context = crate::context::market_metadata().await
        .map_err(|_| "Could not load market details for the trade result".to_string())?;
    let market = context.markets.get(&market_id).ok_or("Trade market is no longer available")?;
    Ok(from_receipt(&receipt, market.size_decimals, market.price_decimals))
}
