use crate::provider::provider;
use crate::transaction::pending_to_state::TransactionState;
use alloy::eips::Encodable2718;
use alloy::providers::Provider;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn broadcast_transfer(
	app: AppHandle,
	state: State<'_, TransactionState>,
	id: String,
	action: Option<String>,
) -> Result<String, String> {
	let (envelope, from) = {
		let mut store =
			state.0.lock()
				.map_err(|_| "Transaction state unavailable")?;

		let pending = store
			.pending
			.as_mut()
			.filter(|pending| pending.id == id)
			.ok_or("Transaction not found")?;

		let from = pending.from;
		let signed = pending.signed
			.take()
			.ok_or("Transaction has not been signed")?;
		(signed, from)
	};

	let raw_transaction = envelope.encoded_2718();

	let provider = provider();

    let tx_hash = *envelope.tx_hash();
    let hash = tx_hash.to_string();
    if let Some(action) = action.as_deref() {
        crate::transaction::pending_receipts::record(&app, from, tx_hash, action)?;
    }
    let pending_message = "Transaction submitted or awaiting network acknowledgement. Its status will be checked automatically; do not submit it again yet";
    let sent = match tokio::time::timeout(Duration::from_secs(12), provider.send_raw_transaction(&raw_transaction)).await {
        Ok(Ok(sent)) => sent,
        Ok(Err(error)) if error.as_error_resp().is_some() => {
            // A definite RPC rejection is safe to retry; a lost response is not.
            let _ = crate::transaction::pending_receipts::acknowledge_perpl_transaction(app.clone(), from.to_string(), hash.clone());
            return Err(crate::user_error::rpc(error, "submit the transaction"));
        }
        _ => return Err(pending_message.into()),
    };
	let _ = app.emit("transaction-status", serde_json::json!({"state":"submitted"}));
	let receipt = tokio::time::timeout(Duration::from_secs(20), sent.get_receipt()).await
		.map_err(|_| "Transaction submitted. Confirmation is taking longer; its status will be checked automatically".to_string())?
		.map_err(|error| {
			eprintln!("Transaction {hash} receipt error: {error}");
			"Transaction submitted. Confirmation could not be checked yet; its status will be checked automatically".to_string()
		})?;
	if !receipt.status() {
		let _ = app.emit("transaction-status", serde_json::json!({"state":"failed"}));
		return Err("Transaction failed on Monad".into());
	}
	crate::perpl::outcome::remember_receipt(tx_hash, receipt);
	let _ = app.emit("transaction-status", serde_json::json!({"state":"confirmed"}));
	Ok(hash)
}
