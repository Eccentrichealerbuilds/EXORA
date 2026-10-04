// take Eip1559 and update it to state, then return the review struct back to state

// I might forget this, so putting it here
// transaction => pending_to_state(called inside transaction) => review_back_to_ts(called inside transaction too)
use std::sync::Mutex;
use std::time::Instant;
use tauri::State;
#[derive(Default)]
pub struct TransactionState(pub(crate) Mutex<Store>);

#[derive(Default)]
pub struct Store {
	next_id: u64,
	pub(crate) pending: Option<Pending>,
}

use alloy::{
	consensus::{TxEip1559, TxEnvelope},
	primitives::Address,
};

#[derive(Clone)]
pub struct Pending {
	pub(crate) id: String,
	pub(crate) from: Address,
	pub(crate) tx: TxEip1559,
	pub(crate) created: Instant,
	pub(crate) signed: Option<TxEnvelope>,
}

pub fn eip1559_and_pending_to_state(
	state: State<'_, TransactionState>,
	tx: TxEip1559,
	from: Address,
) -> Pending {
	let state_update = {
		// robost error handling later, This shit should work first
		let mut state = state.0.lock().expect("Transaction State unavailable");
		state.next_id = state.next_id + 1;
		let pending = Pending {
			id: state.next_id.to_string(),
			from,
			tx,
			created: Instant::now(),
			signed: None,
		};
		state.pending = Some(pending.clone());
		pending
	};
	state_update
}
