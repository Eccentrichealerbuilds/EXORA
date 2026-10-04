use std::time::Duration;

use crate::transaction::attach_signature::attach_signature;
use crate::transaction::pending_to_state::TransactionState;
use tauri::State;
#[tauri::command]
pub fn finalize_transfer(
	state: State<'_, TransactionState>,
	id: String,
	compact: Vec<u8>,
	recovery: u8,
) -> Result<String, String> {
	let mut store =
		state.0.lock()
			.map_err(|_| "Transaction state unavailable")?;

	let pending = store
		.pending
		.as_mut()
		.filter(|pending| pending.id == id)
		.ok_or("Transaction not found")?;

	if pending.created.elapsed() > Duration::from_secs(300) {
		return Err("This signing request expired. Review the transaction again".to_string());
	}

	let envelope = attach_signature(pending, &compact, recovery)?;

	let hash = envelope.tx_hash().to_string();

	pending.signed = Some(envelope);

	Ok(hash)
}
