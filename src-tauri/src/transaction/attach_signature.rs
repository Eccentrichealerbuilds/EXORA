use crate::pending_to_state::Pending;
use alloy::consensus::{SignableTransaction, TxEnvelope};
use alloy::signers::Signature;

pub(crate) fn attach_signature(
	pending: &Pending,
	compact: &[u8],
	recovery: u8,
) -> Result<TxEnvelope, String> {
	if compact.len() != 64 || recovery > 1 {
		return Err("Invalid signature".into());
	}

	let signature = Signature::from_bytes_and_parity(compact, recovery == 1);

	let digest = pending.tx.signature_hash();

	let signer = signature
		.recover_address_from_prehash(&digest)
		.map_err(|_| "Invalid signature")?;

	// return Err(format!("From: {}\nSigner: {}", &pending.from, &signer));
	if signer != pending.from {
		return Err("Signature does not belong to sender".into());
	}

	let signed = pending.tx.clone().into_signed(signature);

	Ok(signed.into())
}
