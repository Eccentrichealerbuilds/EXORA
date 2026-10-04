use crate::transaction::calldatas::{agora_testnet_address, balanceOfCall};
use alloy::{
	network::TransactionBuilder,
	primitives::{
		utils::{format_ether, format_units},
		Address, U256,
	},
	providers::Provider,
	rpc::types::TransactionRequest,
	sol_types::SolCall,
};
use serde::Serialize;

#[derive(Serialize)]
pub struct WalletBalances {
	mon: String,
	ausd: String,
}

pub async fn ausd_balance(provider: &impl Provider, owner: Address) -> Result<U256, String> {
	let input = balanceOfCall { owner }.abi_encode();
	let result = provider
		.call(TransactionRequest::default()
			.with_to(agora_testnet_address())
			.with_input(input))
		.await
		.map_err(|error| crate::user_error::rpc(error, "check your AUSD balance"))?;
	balanceOfCall::abi_decode_returns(&result).map_err(|_| "AUSD returned an invalid balance. Try refreshing".to_string())
}

#[tauri::command]
pub async fn get_wallet_balances(address: String) -> Result<WalletBalances, String> {
	let owner: Address = address.parse().map_err(|_| "Invalid wallet address")?;
	let provider = crate::provider::provider();
	let mon = provider
		.get_balance(owner)
		.await
		.map_err(|error| crate::user_error::rpc(error, "check your MON balance"))?;
	let ausd = ausd_balance(&provider, owner).await?;
	Ok(WalletBalances {
		mon: format_ether(mon),
		ausd: format_units(ausd, 6).map_err(|_| "Could not format the AUSD balance".to_string())?,
	})
}
