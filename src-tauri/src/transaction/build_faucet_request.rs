use crate::pending_to_state::{eip1559_and_pending_to_state, TransactionState};
use crate::review_back_to_ts::{review, Review};
use crate::transaction::build_transaction::{Asset, CHAIN_ID};
use crate::transaction::calldatas::{
	agora_testnet_address, agora_testnet_faucet_address, agora_testnet_faucet_request,
	faucetDripAmountCall, maxAmountToOwnCall, tokenCall,
};
use crate::transaction::wallet_balances::ausd_balance;
use alloy::{
	consensus::TypedTransaction,
	network::{NetworkTransactionBuilder, TransactionBuilder},
	primitives::{
		utils::{format_ether, format_units},
		Address, U256,
	},
	providers::Provider,
	rpc::types::TransactionRequest,
	sol_types::SolCall,
};
use tauri::State;

#[tauri::command]
pub async fn build_faucet_request(
	state: State<'_, TransactionState>,
	address: String,
) -> Result<Review, String> {
	let from: Address = address.parse().map_err(|_| "Invalid wallet address")?;
	if from.is_zero() {
		return Err("The zero address cannot request AUSD".into());
	}
	let faucet = agora_testnet_faucet_address();
	let provider = crate::provider::provider();

	let token_result = provider
		.call(TransactionRequest::default()
			.with_to(faucet)
			.with_input(tokenCall {}.abi_encode()))
		.await
		.map_err(|error| crate::user_error::rpc(error, "check the AUSD faucet"))?;
	let distributed_token =
		tokenCall::abi_decode_returns(&token_result).map_err(|_| "The AUSD faucet returned invalid token information".to_string())?;
	if distributed_token != agora_testnet_address() {
		return Err("The Agora faucet is not configured for AUSD".into());
	}

	let amount_result = provider
		.call(TransactionRequest::default()
			.with_to(faucet)
			.with_input(faucetDripAmountCall {}.abi_encode()))
		.await
		.map_err(|error| crate::user_error::rpc(error, "check the AUSD faucet"))?;
	let amount = faucetDripAmountCall::abi_decode_returns(&amount_result)
		.map_err(|_| "The AUSD faucet returned an invalid amount".to_string())?;
	if amount.is_zero() {
		return Err("The AUSD faucet is not currently dispensing tokens".into());
	}

	let max_result = provider
		.call(TransactionRequest::default()
			.with_to(faucet)
			.with_input(maxAmountToOwnCall {}.abi_encode()))
		.await
		.map_err(|error| crate::user_error::rpc(error, "check the AUSD faucet"))?;
	let max_to_own = maxAmountToOwnCall::abi_decode_returns(&max_result)
		.map_err(|_| "The AUSD faucet returned an invalid wallet limit".to_string())?;
	let receiver_balance = ausd_balance(&provider, from).await?;
	if receiver_balance >= max_to_own {
		return Err("This wallet already holds the faucet's maximum AUSD balance".into());
	}
	let faucet_balance = ausd_balance(&provider, faucet).await?;
	if faucet_balance <= amount {
		return Err("The AUSD faucet does not have enough tokens right now".into());
	}

	let mon_balance = provider
		.get_balance(from)
		.await
		.map_err(|error| crate::user_error::rpc(error, "check your MON balance"))?;
	if mon_balance.is_zero() {
		return Err("This wallet needs MON to pay the faucet request's network fee".into());
	}
	let nonce = provider
		.get_transaction_count(from)
		.pending()
		.await
		.map_err(|error| crate::user_error::rpc(error, "check pending transactions"))?;
	let fees = provider
		.estimate_eip1559_fees()
		.await
		.map_err(|error| crate::user_error::rpc(error, "check network fees"))?;
	let request = TransactionRequest::default()
		.with_from(from)
		.with_to(faucet)
		.with_value(U256::ZERO)
		.with_input(agora_testnet_faucet_request(from))
		.with_chain_id(CHAIN_ID)
		.with_nonce(nonce)
		.with_max_fee_per_gas(fees.max_fee_per_gas)
		.with_max_priority_fee_per_gas(fees.max_priority_fee_per_gas);
	let gas = provider.estimate_gas(request.clone()).await.map_err(|error| {
		let message = crate::user_error::rpc(error, "request AUSD from the faucet");
		if message.contains("contract rejected") {
			"The AUSD faucet is unavailable right now. Its cooldown may still be active".to_string()
		} else { message }
	})?;
	let gas_limit = gas.saturating_add(gas / 4);
	let max_cost = U256::from(gas_limit) * U256::from(fees.max_fee_per_gas);
	if mon_balance < max_cost {
		return Err(format!(
			"Insufficient MON for the network fee (up to {} MON)",
			format_ether(max_cost)
		));
	}
	let typed = request
		.with_gas_limit(gas_limit)
		.build_unsigned()
		.map_err(|_| "Could not prepare the faucet request for signing".to_string())?;
	let TypedTransaction::Eip1559(tx) = typed else {
		return Err("Expected EIP-1559 transaction".into());
	};
	let pending = eip1559_and_pending_to_state(state, tx, from);
	let formatted_amount = format_units(amount, 6).map_err(|_| "Could not format the faucet amount".to_string())?;
	Ok(review(&pending, from, &formatted_amount, Asset::AUSD))
}
