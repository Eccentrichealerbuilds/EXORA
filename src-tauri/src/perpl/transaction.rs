use std::{sync::atomic::{AtomicU64, Ordering}, time::{SystemTime, UNIX_EPOCH}};

use alloy::{
    consensus::{SignableTransaction, TypedTransaction},
    network::{NetworkTransactionBuilder, TransactionBuilder},
    primitives::{utils::format_ether, Address, Bytes, U256},
    providers::Provider,
    rpc::types::TransactionRequest,
    sol_types::SolCall,
};
use perpl_sdk::abi::dex::Exchange;
use perpl_sdk::types::DEFAULT_MAX_NEG_PNL_COLLAT_BPS;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    pending_to_state::{eip1559_and_pending_to_state, TransactionState},
    perpl::{exchange_address, order::{self, CloseInput, OrderInput, OrderQuote}},
    transaction::{
        build_transaction::CHAIN_ID,
        calldatas::{agora_testnet_address, allowanceCall, approveCall},
        wallet_balances::ausd_balance,
    },
    utils::parse_amount::parse_amount,
};

static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FundingAction { Approve, CreateAccount, Deposit, Withdraw }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerplTxReview {
    pub id: String,
    pub digest: String,
    pub from: String,
    pub to: String,
    pub action: String,
    pub amount: Option<String>,
    pub quote: Option<OrderQuote>,
    pub chain_id: u64,
    pub nonce: u64,
    pub gas_limit: u64,
    pub max_network_fee: String,
}

async fn prepare_call(
    state: State<'_, TransactionState>,
    from: Address,
    to: Address,
    input: Bytes,
    action: String,
    amount: Option<String>,
    quote: Option<OrderQuote>,
) -> Result<PerplTxReview, String> {
    let provider = crate::provider::provider();
    let (chain_id, mon_balance, nonce, fees) = tokio::join!(
        provider.get_chain_id(),
        provider.get_balance(from),
        provider.get_transaction_count(from).pending(),
        provider.estimate_eip1559_fees(),
    );
    let chain_id = chain_id.map_err(|error| crate::user_error::rpc(error, "check the network"))?;
    if chain_id != CHAIN_ID { return Err("RPC is connected to the wrong chain".into()); }
    let mon_balance = mon_balance.map_err(|error| crate::user_error::rpc(error, "check your MON balance"))?;
    let nonce = nonce.map_err(|error| crate::user_error::rpc(error, "check pending transactions"))?;
    let fees = fees.map_err(|error| crate::user_error::rpc(error, "check network fees"))?;
    let request = TransactionRequest::default()
        .with_from(from).with_to(to).with_value(U256::ZERO).with_input(input)
        .with_chain_id(CHAIN_ID).with_nonce(nonce)
        .with_max_fee_per_gas(fees.max_fee_per_gas)
        .with_max_priority_fee_per_gas(fees.max_priority_fee_per_gas);
    let operation = match action.as_str() {
        "order" => "place the order",
        "close" => "close the position",
        "cancel" => "cancel the order",
        "change" => "update the order",
        "forwarding" => "enable Perpl protected orders",
        "approve" => "approve AUSD",
        "createAccount" => "create the Perpl account",
        "deposit" => "deposit AUSD",
        "withdraw" => "withdraw AUSD",
        _ => "prepare the transaction",
    };
    let estimated = match provider.estimate_gas(request.clone()).await {
        Ok(gas) => gas,
        Err(error) => {
            // Some Monad RPC errors omit revert bytes during gas estimation.
            // A read-only call with the same sender and calldata can expose the
            // contract's custom error without submitting anything.
            if error.as_error_resp().and_then(|payload| payload.as_revert_data()).is_none() {
                if let Err(call_error) = provider.call(request.clone()).await {
                    if call_error.as_error_resp().and_then(|payload| payload.as_revert_data()).is_some() {
                        return Err(crate::user_error::rpc(call_error, operation));
                    }
                    eprintln!("{operation} call diagnostic: {call_error}");
                }
            }
            return Err(crate::user_error::rpc(error, operation));
        }
    };
    let gas_limit = estimated.saturating_add(estimated / 4);
    let max_cost = U256::from(gas_limit) * U256::from(fees.max_fee_per_gas);
    if mon_balance < max_cost { return Err(format!("Insufficient MON for network fee (up to {} MON)", format_ether(max_cost))); }
    let typed = request.with_gas_limit(gas_limit).build_unsigned().map_err(|_| "Could not prepare the transaction for signing".to_string())?;
    let TypedTransaction::Eip1559(tx) = typed else { return Err("Expected EIP-1559 transaction".into()); };
    let pending = eip1559_and_pending_to_state(state, tx, from);
    Ok(PerplTxReview {
        id: pending.id,
        digest: pending.tx.signature_hash().to_string(),
        from: from.to_checksum(None),
        to: to.to_checksum(None),
        action,
        amount,
        quote,
        chain_id: CHAIN_ID,
        nonce,
        gas_limit,
        max_network_fee: format_ether(max_cost),
    })
}

#[tauri::command]
pub async fn build_perpl_order(
    state: State<'_, TransactionState>,
    input: OrderInput,
    reviewed_quote: OrderQuote,
) -> Result<PerplTxReview, String> {
    let from: Address = input.address.parse().map_err(|_| "Invalid wallet address")?;
    let prepared = order::prepare(&input, Some(&reviewed_quote)).await?;
    let market = &prepared.market;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Device time is unavailable".to_string())?.as_millis() as u64;
    let request_id = now.saturating_mul(1000).saturating_add(REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed) % 1000);
    let order_type = match input.side { order::Side::Long => 0, order::Side::Short => 1 };
    let desc = Exchange::OrderDesc {
        orderDescId: U256::from(request_id),
        perpId: U256::from(input.market_id),
        orderType: order_type,
        orderId: U256::ZERO,
        pricePNS: prepared.price_raw,
        lotLNS: prepared.quantity_raw,
        expiryBlock: U256::ZERO,
        postOnly: prepared.quote.time_in_force == order::TimeInForce::PostOnly,
        fillOrKill: prepared.quote.time_in_force == order::TimeInForce::Fok,
        immediateOrCancel: prepared.quote.time_in_force == order::TimeInForce::Ioc,
        maxMatches: U256::ZERO,
        leverageHdths: U256::from(input.leverage_hundredths),
        lastExecutionBlock: U256::from(prepared.quote.head_block + market.order_ttl_blocks.min(20)),
        amountCNS: U256::ZERO,
        maxNegPnlCollatBPS: U256::from(DEFAULT_MAX_NEG_PNL_COLLAT_BPS),
    };
    let calldata = Exchange::execOrdersCall { orderDescs: vec![desc], revertOnFail: true }.abi_encode();
    prepare_call(state, from, exchange_address(), calldata.into(), "order".into(), None, Some(prepared.quote)).await
}

#[tauri::command]
pub async fn build_perpl_close(
    state: State<'_, TransactionState>, input: CloseInput,
    reviewed_quote: OrderQuote,
) -> Result<PerplTxReview, String> {
    let from: Address = input.address.parse().map_err(|_| "Invalid wallet address")?;
    let prepared = order::prepare_reviewed_close(&input, &reviewed_quote).await?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Device time is unavailable".to_string())?.as_millis() as u64;
    let request_id = now.saturating_mul(1000).saturating_add(REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed) % 1000);
    let desc = Exchange::OrderDesc {
        orderDescId: U256::from(request_id), perpId: U256::from(input.market_id),
        orderType: prepared.order_type, orderId: U256::ZERO,
        pricePNS: prepared.price_raw, lotLNS: prepared.quantity_raw,
        expiryBlock: U256::ZERO, postOnly: false, fillOrKill: false,
        immediateOrCancel: prepared.quote.order_type == order::OrderKind::Market, maxMatches: U256::ZERO,
        leverageHdths: U256::from(prepared.market.max_leverage_hundredths),
        lastExecutionBlock: U256::from(prepared.quote.head_block + prepared.market.order_ttl_blocks.min(20)),
        amountCNS: U256::ZERO,
        maxNegPnlCollatBPS: U256::from(DEFAULT_MAX_NEG_PNL_COLLAT_BPS),
    };
    let calldata = Exchange::execOrdersCall { orderDescs: vec![desc], revertOnFail: true }.abi_encode();
    prepare_call(state, from, exchange_address(), calldata.into(), "close".into(), None, Some(prepared.quote)).await
}

#[tauri::command]
pub async fn build_perpl_cancel(
    state: State<'_, TransactionState>, address: String, market_id: u32, order_id: u64,
) -> Result<PerplTxReview, String> {
    let from: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    if order_id == 0 || order_id > u16::MAX as u64 { return Err("Invalid Perpl order ID".into()); }
    let context = crate::context::markets().await.map_err(|_| "Could not load Perpl markets. Refresh and try again".to_string())?;
    let market = context.markets.get(&market_id).ok_or("This market is unavailable")?;
    let provider = crate::provider::provider();
    let exchange = Exchange::new(exchange_address(), provider.clone());
    let account = exchange.getAccountByAddr(from).call().await
        .map_err(|error| crate::user_error::contract(error, "load your Perpl account"))?;
    let (account_id, price_offset, size, expiry, leverage, actual_order_id) =
        match exchange.getOrderV2(U256::from(market_id), U256::from(order_id)).call().await {
            Ok(order) => {
                (order.accountId, order.priceONS, order.lotLNS, order.expiryBlock,
                    order.leverageHdths, order.orderId)
            }
            Err(_) => {
                let order = exchange.getOrder(U256::from(market_id), U256::from(order_id))
                    .call().await.map_err(|_| "This order is no longer open".to_string())?;
                (order.accountId, order.priceONS, order.lotLNS, order.expiryBlock,
                    order.leverageHdths, order.orderId)
            }
        };
    if actual_order_id as u64 != order_id || size == 0 { return Err("This order is no longer open".into()); }
    if U256::from(account_id) != account.accountId { return Err("This order belongs to another account".into()); }
    let base_price = match exchange.getPerpetualInfoV2(U256::from(market_id)).call().await {
        Ok(result) => result.basePricePNS,
        Err(_) => exchange.getPerpetualInfo(U256::from(market_id)).call().await
            .map_err(|error| crate::user_error::contract(error, "load the order price"))?.basePricePNS,
    };
    let head = provider.get_block_number().await.map_err(|error| crate::user_error::rpc(error, "check the current block"))?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Device time is unavailable".to_string())?.as_millis() as u64;
    let request_id = now.saturating_mul(1000).saturating_add(REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed) % 1000);
    let desc = Exchange::OrderDesc {
        orderDescId: U256::from(request_id), perpId: U256::from(market_id),
        orderType: 4, orderId: U256::from(order_id),
        pricePNS: base_price + U256::from(price_offset), lotLNS: U256::from(size),
        expiryBlock: U256::from(expiry), postOnly: false, fillOrKill: false,
        immediateOrCancel: false, maxMatches: U256::ZERO,
        leverageHdths: U256::from(leverage),
        lastExecutionBlock: U256::from(head + market.order_ttl_blocks.min(20)),
        amountCNS: U256::ZERO, maxNegPnlCollatBPS: U256::ZERO,
    };
    let calldata = Exchange::execOrdersCall { orderDescs: vec![desc], revertOnFail: true }.abi_encode();
    prepare_call(state, from, exchange_address(), calldata.into(), "cancel".into(), None, None).await
}

#[tauri::command]
pub async fn build_perpl_change(
    state: State<'_, TransactionState>, address: String, market_id: u32, order_id: u64,
    price: String, size: String,
) -> Result<PerplTxReview, String> {
    let from: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    if order_id == 0 || order_id > u16::MAX as u64 { return Err("Invalid Perpl order ID".into()); }
    let context = crate::context::markets().await.map_err(|_| "Could not load Perpl markets. Refresh and try again".to_string())?;
    let market = context.markets.get(&market_id).ok_or("This market is unavailable")?;
    if !market.is_open { return Err("Trading is paused for this market".into()); }
    let price_raw = parse_amount(Some(price.clone()), market.price_decimals as u8)?;
    let size_raw = parse_amount(Some(size.clone()), market.size_decimals as u8)?;
    if price_raw.is_zero() || size_raw.is_zero() { return Err("Enter a price and remaining size greater than zero".into()); }
    let provider = crate::provider::provider();
    let exchange = Exchange::new(exchange_address(), provider.clone());
    let account = exchange.getAccountByAddr(from).call().await
        .map_err(|error| crate::user_error::contract(error, "load your Perpl account"))?;
    let (account_id, expiry, leverage, actual_order_id, remaining) =
        match exchange.getOrderV2(U256::from(market_id), U256::from(order_id)).call().await {
            Ok(order) => (order.accountId, order.expiryBlock, order.leverageHdths, order.orderId, order.lotLNS),
            Err(_) => {
                let order = exchange.getOrder(U256::from(market_id), U256::from(order_id)).call().await
                    .map_err(|_| "This order is no longer open".to_string())?;
                (order.accountId, order.expiryBlock, order.leverageHdths, order.orderId, order.lotLNS)
            }
        };
    if actual_order_id as u64 != order_id || remaining == 0 { return Err("This order is no longer open".into()); }
    if U256::from(account_id) != account.accountId { return Err("This order belongs to another account".into()); }
    let head = provider.get_block_number().await.map_err(|error| crate::user_error::rpc(error, "check the current block"))?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Device time is unavailable".to_string())?.as_millis() as u64;
    let request_id = now.saturating_mul(1000).saturating_add(REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed) % 1000);
    let desc = Exchange::OrderDesc {
        orderDescId: U256::from(request_id), perpId: U256::from(market_id),
        orderType: 6, orderId: U256::from(order_id),
        pricePNS: price_raw, lotLNS: size_raw,
        expiryBlock: U256::from(expiry), postOnly: false, fillOrKill: false,
        immediateOrCancel: false, maxMatches: U256::ZERO,
        leverageHdths: U256::from(leverage),
        lastExecutionBlock: U256::from(head + market.order_ttl_blocks.min(20)),
        amountCNS: U256::ZERO, maxNegPnlCollatBPS: U256::ZERO,
    };
    let calldata = Exchange::execOrdersCall { orderDescs: vec![desc], revertOnFail: true }.abi_encode();
    prepare_call(state, from, exchange_address(), calldata.into(), "change".into(),
        Some(format!("Order #{order_id}: {size} units at {price} USD")), None).await
}

#[tauri::command]
pub async fn build_perpl_funding(
    state: State<'_, TransactionState>,
    address: String,
    action: FundingAction,
    amount: String,
) -> Result<PerplTxReview, String> {
    let from: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    let amount_raw = parse_amount(Some(amount.clone()), 6)?;
    if amount_raw.is_zero() { return Err("Enter an AUSD amount greater than zero".into()); }
    let provider = crate::provider::provider();
    let exchange = Exchange::new(exchange_address(), provider.clone());
    let info = match exchange.getAccountByAddr(from).call().await {
        Ok(info) => Some(info),
        Err(error) if crate::perpl::account_missing(&error) => None,
        Err(error) => return Err(crate::user_error::contract(error, "load your Perpl account")),
    };
    let exists = info.is_some();
    let (to, calldata, label) = match action {
        FundingAction::Approve => {
            let wallet = ausd_balance(&provider, from).await?;
            if wallet < amount_raw { return Err("Insufficient AUSD in your wallet".into()); }
            (agora_testnet_address(), approveCall { spender: exchange_address(), amount: amount_raw }.abi_encode(), "approve")
        }
        FundingAction::CreateAccount | FundingAction::Deposit => {
            if matches!(action, FundingAction::CreateAccount) == exists {
                return Err(if exists { "Perpl account already exists" } else { "Create your Perpl account first" }.into());
            }
            let wallet = ausd_balance(&provider, from).await?;
            if wallet < amount_raw { return Err("Insufficient AUSD in your wallet".into()); }
            let allowance_result = provider.call(TransactionRequest::default()
                .with_to(agora_testnet_address())
                .with_input(allowanceCall { owner: from, spender: exchange_address() }.abi_encode()))
                .await.map_err(|error| crate::user_error::rpc(error, "check AUSD approval"))?;
            let allowance = allowanceCall::abi_decode_returns(&allowance_result).map_err(|_| "AUSD returned an invalid approval amount".to_string())?;
            if allowance < amount_raw { return Err("Approve this AUSD amount before depositing".into()); }
            if matches!(action, FundingAction::CreateAccount) {
                let minimum = exchange.getMinAccountOpenCNS().call().await.map_err(|error| crate::user_error::contract(error, "check the account minimum"))?;
                if amount_raw < minimum { return Err("Initial deposit is below Perpl's current minimum".into()); }
                (exchange_address(), Exchange::createAccountCall { amountCNS: amount_raw }.abi_encode(), "createAccount")
            } else {
                (exchange_address(), Exchange::depositCollateralCall { amountCNS: amount_raw }.abi_encode(), "deposit")
            }
        }
        FundingAction::Withdraw => {
            if !exists { return Err("No Perpl account to withdraw from".into()); }
            let info = info.as_ref().ok_or("No Perpl account to withdraw from")?;
            let available = info.balanceCNS.saturating_sub(info.lockedBalanceCNS);
            if amount_raw > available { return Err("Amount exceeds available Perpl balance".into()); }
            (exchange_address(), Exchange::withdrawCollateralCall { amountCNS: amount_raw }.abi_encode(), "withdraw")
        }
    };
    prepare_call(state, from, to, calldata.into(), label.into(), Some(amount), None).await
}

#[tauri::command]
pub async fn build_perpl_forwarding(
    state: State<'_, TransactionState>, address: String,
) -> Result<PerplTxReview, String> {
    let from: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    let provider = crate::provider::provider();
    let exchange = Exchange::new(exchange_address(), provider.clone());
    exchange.getAccountByAddr(from).call().await
        .map_err(|error| crate::user_error::contract(error, "load your Perpl account"))?;
    let calldata = Exchange::allowOrderForwardingCall { allow: true }.abi_encode();
    prepare_call(state, from, exchange_address(), calldata.into(), "forwarding".into(), None, None).await
}
