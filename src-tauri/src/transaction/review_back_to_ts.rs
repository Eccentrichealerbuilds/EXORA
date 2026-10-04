use crate::pending_to_state::Pending;
use crate::transaction::build_transaction::Asset;
use alloy::primitives::utils::format_ether;
use alloy::{
	consensus::SignableTransaction,
	primitives::{Address, U256},
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
	id: String,
	digest: String,

	from: String,
	to: String,
	amount: String,
	asset: String,

	chain_id: u64,
	nonce: u64,
	gas_limit: u64,

	max_fee_per_gas: String,
	max_priority_fee_per_gas: String,
	max_network_fee: String,
}
pub fn review(pending: &Pending, recipient: Address, amount: &str, asset: Asset) -> Review {
	Review {
		id: pending.id.clone(),
		digest: pending.tx.signature_hash().to_string(),
		from: pending.from.to_checksum(None),
		to: recipient.to_checksum(None),
		amount: amount.to_string(),
		asset: match asset {
			Asset::MON => "MON",
			Asset::AUSD => "AUSD",
		}
		.to_string(),
		chain_id: pending.tx.chain_id,
		nonce: pending.tx.nonce,
		gas_limit: pending.tx.gas_limit,
		max_fee_per_gas: pending.tx.max_fee_per_gas.to_string(),
		max_priority_fee_per_gas: pending.tx.max_priority_fee_per_gas.to_string(),
		max_network_fee: format_ether(
			U256::from(pending.tx.gas_limit) * U256::from(pending.tx.max_fee_per_gas),
		),
	}
}
