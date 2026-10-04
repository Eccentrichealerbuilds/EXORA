use crate::pending_to_state::{eip1559_and_pending_to_state, TransactionState};
use crate::review_back_to_ts::{review, Review};
use crate::transaction::calldatas::{agora_testnet_address, agora_testnet_transfer};
use alloy::{
	consensus::TypedTransaction,
	network::{NetworkTransactionBuilder, TransactionBuilder},
	primitives::{utils::format_ether, Address, Bytes, U256},
	providers::Provider,
	rpc::types::TransactionRequest,
};
use serde::Deserialize;
use tauri::State;

pub const CHAIN_ID: u64 = 10143;
pub const RPC: &str = "https://rpc-testnet.monadinfra.com";

#[derive(Clone, Copy, Debug, Deserialize)]
pub enum Asset {
	MON,
	AUSD,
}

#[tauri::command]
pub async fn build_transaction(
	state: State<'_, TransactionState>,
	from: String,
	to: String,
	amount: String,
	asset: Asset,
) -> Result<Review, String> {
	let provider = crate::provider::provider();
	let from: Address = from.parse().map_err(|_| "Invalid sender address")?;
	let recipient: Address = to.parse().map_err(|_| "Invalid recipient address")?;
	if recipient.is_zero() {
		return Err("The zero address cannot receive this transfer".into());
	}
	if from == recipient {
		return Err("Enter a recipient other than your own address".into());
	}
	let decimals = match asset {
		Asset::MON => 18,
		Asset::AUSD => 6,
	};
	let amount_value =
		crate::utils::parse_amount::parse_amount(Some(amount.clone()), decimals)?;
	if amount_value.is_zero() {
		return Err("Enter an amount greater than zero".into());
	}
	let mon_balance = provider
		.get_balance(from)
		.await
		.map_err(|error| crate::user_error::rpc(error, "check your MON balance"))?;
	let (transaction_to, native_value, calldata) = match asset {
		Asset::MON => {
			if amount_value > mon_balance {
				return Err("Not enough MON. Get testnet MON for this wallet before sending".into());
			}
			(recipient, amount_value, Bytes::new())
		}
		Asset::AUSD => {
			let token_balance =
				crate::transaction::wallet_balances::ausd_balance(&provider, from)
					.await?;
			if amount_value > token_balance {
				return Err("Insufficient AUSD balance".into());
			}
			(
				agora_testnet_address(),
				U256::ZERO,
				agora_testnet_transfer(recipient, amount_value),
			)
		}
	};
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
		.with_to(transaction_to)
		.with_value(native_value)
		.with_input(calldata)
		.with_chain_id(CHAIN_ID)
		.with_nonce(nonce)
		.with_max_fee_per_gas(fees.max_fee_per_gas)
		.with_max_priority_fee_per_gas(fees.max_priority_fee_per_gas);
	let gas = provider
		.estimate_gas(request.clone())
		.await
		.map_err(|error| crate::user_error::rpc(error, "prepare the transfer"))?;
	let gas_limit = gas.saturating_add(gas / 4);
	let max_cost = U256::from(gas_limit) * U256::from(fees.max_fee_per_gas);
	if mon_balance < native_value + max_cost {
		return Err(format!(
			"Not enough MON for the transfer and network fee (up to {} MON). Reduce the amount or get more testnet MON",
			format_ether(max_cost)
		));
	}
	let typed = request
		.with_gas_limit(gas_limit)
		.build_unsigned()
		.map_err(|_| "Could not prepare the transfer for signing".to_string())?;
	let TypedTransaction::Eip1559(tx) = typed else {
		return Err("Expected EIP-1559 transaction".into());
	};
	let pending = eip1559_and_pending_to_state(state, tx, from);
	Ok(review(&pending, recipient, &amount, asset))
}
