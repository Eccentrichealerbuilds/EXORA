use alloy::{
    network::TransactionBuilder,
    primitives::{utils::format_units, Address, U256},
    providers::Provider,
    rpc::types::TransactionRequest,
    sol_types::SolCall,
};
use perpl_sdk::abi::dex::Exchange;
use serde::Serialize;
use std::{collections::{HashMap, HashSet}, sync::{atomic::{AtomicU64, Ordering}, LazyLock, Mutex}, time::Duration};
use tauri::{async_runtime::JoinHandle, ipc::Channel, AppHandle, Emitter, State};

use crate::{
    perpl::exchange_address,
    transaction::{calldatas::{allowanceCall, agora_testnet_address}, wallet_balances::ausd_balance},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionView {
    pub market_id: u32,
    pub symbol: String,
    pub side: String,
    pub size: String,
    pub entry_price: String,
    pub mark_price: String,
    pub deposit: String,
    pub pnl: String,
    pub premium_pnl: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub address: String,
    pub exists: bool,
    pub account_id: Option<u32>,
    pub frozen: bool,
    pub balance: String,
    pub locked_balance: String,
    pub committed_margin: String,
    pub available_balance: String,
    pub wallet_ausd: String,
    pub allowance: String,
    pub minimum_open: String,
    pub positions: Vec<PositionView>,
}

fn amount(value: U256) -> Result<String, String> {
    format_units(value, 6).map_err(|_| "Could not format the AUSD balance".to_string())
}

fn signed_amount(raw: &str) -> String {
    let negative = raw.starts_with('-');
    let digits = if negative { &raw[1..] } else { raw };
    let result = crate::format_price::format_decimal_string(digits, 6);
    if negative { format!("-{result}") } else { result }
}

static KNOWN_POSITION_MARKETS: LazyLock<Mutex<HashMap<Address, HashSet<u32>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn has_position(bitmap: &Exchange::PositionBitMap, id: u32) -> bool {
    match id {
        0..=252 => bitmap.bank1.bit(id as usize),
        253..=508 => bitmap.bank2.bit((id - 253) as usize),
        509..=764 => bitmap.bank3.bit((id - 509) as usize),
        765..=1020 => bitmap.bank4.bit((id - 765) as usize),
        _ => false,
    }
}

pub async fn read(address: Address, full_scan: bool) -> Result<AccountView, String> {
    let provider = crate::provider::provider();
    let exchange = Exchange::new(exchange_address(), provider.clone());
    let token = agora_testnet_address();
    let wallet_balance = ausd_balance(&provider, address).await?;
    let allowance_result = provider.call(TransactionRequest::default()
        .with_to(token).with_input(allowanceCall { owner: address, spender: exchange_address() }.abi_encode()))
        .await.map_err(|error| crate::user_error::rpc(error, "check AUSD approval"))?;
    let allowance = allowanceCall::abi_decode_returns(&allowance_result).map_err(|_| "AUSD returned an invalid approval amount".to_string())?;
    let minimum = exchange.getMinAccountOpenCNS().call().await.map_err(|error| crate::user_error::contract(error, "check the account minimum"))?;
    let info = match exchange.getAccountByAddr(address).call().await {
        Ok(info) => Some(info),
        Err(error) if crate::perpl::account_missing(&error) => None,
        Err(error) => return Err(crate::user_error::contract(error, "load your Perpl account")),
    };
    let exists = info.is_some();
    let mut positions = Vec::new();
    let mut position_margin = U256::ZERO;
    if let Some(ref info) = info {
        let context = crate::context::market_metadata().await.map_err(|_| "Could not load Perpl markets. Refresh and try again".to_string())?;
        let known = KNOWN_POSITION_MARKETS.lock().map_err(|_| "Position cache unavailable")?
            .get(&address).cloned().unwrap_or_default();
        for market in context.markets.values() {
            if !full_scan && !has_position(&info.positions, market.id) && !known.contains(&market.id) {
                continue;
            }
            // Periodic full scans reconcile an omitted bitmap entry; routine
            // refreshes only query markets with a known or bitmap position.
            let (side, size, entry, mark, deposit, pnl, premium_pnl) =
                match exchange.getPositionV2(U256::from(market.id), info.accountId).call().await {
                    Ok(result) => {
                        let position = result.positionInfo;
                        (position.positionType, position.lotLNS, position.pricePNS,
                            result.markPricePNS, position.depositCNS,
                            position.pnlCNS.to_string(), position.premiumPnlCNS.to_string())
                    }
                    Err(_) => {
                        let result = exchange.getPosition(U256::from(market.id), info.accountId)
                            .call().await.map_err(|error| crate::user_error::contract(error, "load your positions"))?;
                        let position = result.positionInfo;
                        (position.positionType, position.lotLNS, position.pricePNS,
                            result.markPricePNS, position.depositCNS,
                            position.pnlCNS.to_string(), position.premiumPnlCNS.to_string())
                    }
                };
            if size.is_zero() { continue; }
            position_margin = position_margin.saturating_add(deposit);
            let decimals = market.price_decimals;
            positions.push(PositionView {
                market_id: market.id,
                symbol: market.symbol.clone(),
                side: if side == 0 { "long" } else { "short" }.into(),
                size: format_units(size, market.size_decimals as u8).map_err(|_| "Could not format the position size".to_string())?,
                entry_price: format_units(entry, decimals as u8).map_err(|_| "Could not format the entry price".to_string())?,
                mark_price: format_units(mark, decimals as u8).map_err(|_| "Could not format the mark price".to_string())?,
                deposit: amount(deposit)?,
                pnl: signed_amount(&pnl),
                premium_pnl: signed_amount(&premium_pnl),
            });
        }
        positions.sort_by_key(|position| position.market_id);
        if full_scan {
            KNOWN_POSITION_MARKETS.lock().map_err(|_| "Position cache unavailable")?
                .insert(address, positions.iter().map(|position| position.market_id).collect());
        }
    }
    let balance = info.as_ref().map_or(U256::ZERO, |info| info.balanceCNS);
    let locked = info.as_ref().map_or(U256::ZERO, |info| info.lockedBalanceCNS);
    Ok(AccountView {
        address: address.to_checksum(None),
        exists,
        account_id: info.as_ref().map(|info| info.accountId.to()),
        frozen: info.as_ref().is_some_and(|info| info.frozen != 0),
        balance: amount(balance)?,
        locked_balance: amount(locked)?,
        committed_margin: amount(locked.saturating_add(position_margin))?,
        available_balance: amount(balance.saturating_sub(locked))?,
        wallet_ausd: amount(wallet_balance)?,
        allowance: amount(allowance)?,
        minimum_open: amount(minimum)?,
        positions,
    })
}

#[tauri::command]
pub async fn get_perpl_account(address: String) -> Result<AccountView, String> {
    let address: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    read(address, true).await
}

static NEXT_ACCOUNT_FEED_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct AccountFeedTask(Mutex<Option<(u64, JoinHandle<()>)>>);

#[tauri::command]
pub fn start_account_feed(app: AppHandle, task: State<'_, AccountFeedTask>, address: String,
    on_account: Channel<AccountView>) -> Result<u64, String> {
    let address: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    let mut current = task.0.lock().map_err(|_| "Account feed unavailable")?;
    if let Some((_, previous)) = current.take() { previous.abort(); }
    let id = NEXT_ACCOUNT_FEED_ID.fetch_add(1, Ordering::Relaxed);
    *current = Some((id, tauri::async_runtime::spawn(async move {
        let mut successful_reads = 0u64;
        loop {
            match read(address, successful_reads % 10 == 0).await {
                Ok(account) => {
                    successful_reads += 1;
                    if on_account.send(account).is_err() { break; }
                    let _ = app.emit("perpl-account-status", serde_json::json!({"state":"connected"}));
                }
                Err(error) => {
                    let safe = crate::user_error::safe_message(&error, "Could not refresh your Perpl account");
                    let _ = app.emit("perpl-account-status", serde_json::json!({"state":"error","message":safe}));
                }
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    })));
    Ok(id)
}

#[tauri::command]
pub fn stop_account_feed(task: State<'_, AccountFeedTask>, id: u64) {
    if let Ok(mut current) = task.0.lock() {
        if current.as_ref().is_some_and(|(current_id, _)| *current_id == id) {
            if let Some((_, previous)) = current.take() { previous.abort(); }
        }
    }
}
