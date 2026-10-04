pub use crate::transaction::pending_to_state;
pub use crate::transaction::provider;
pub use crate::transaction::review_back_to_ts;
mod transaction;
mod perpl;
mod utils;
mod user_error;
mod websocket;
pub use crate::websocket::*;

pub type AppError = Box<dyn std::error::Error + Send + Sync>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_exora::init())
		.manage(pending_to_state::TransactionState::default())
		.manage(commands::FeedTask::default())
		.manage(perpl::account::AccountFeedTask::default())
		.manage(perpl::read_key::ReadKeyState::default())
		.manage(perpl::trade_key::TradeKeyState::default())
		.manage(perpl::private_feed::PrivateFeedTask::default())
		.invoke_handler(tauri::generate_handler![
			commands::start_feed,
			commands::stop_feed,
            candles::get_chart_history,
			transaction::build_transaction::build_transaction,
			transaction::build_faucet_request::build_faucet_request,
			transaction::finalize_transfer::finalize_transfer,
			transaction::broadcast_transfer::broadcast_transfer,
			transaction::pending_receipts::recover_pending_perpl_transactions,
			transaction::pending_receipts::acknowledge_perpl_transaction,
			transaction::wallet_balances::get_wallet_balances,
			perpl::account::get_perpl_account,
			perpl::setup::get_perpl_setup,
			perpl::activity::get_perpl_activity,
			perpl::read_key::has_perpl_read_key,
			perpl::read_key::forget_perpl_read_key,
			perpl::read_key::begin_perpl_read_key,
			perpl::read_key::complete_perpl_read_key,
			perpl::trade_key::has_perpl_trade_key,
			perpl::trade_key::begin_perpl_trade_key,
			perpl::trade_key::complete_perpl_trade_key,
			perpl::trigger::preview_perpl_trigger,
			perpl::trigger::place_perpl_trigger,
			perpl::trigger::pending_perpl_triggers,
			perpl::trigger::reconcile_perpl_trigger,
			perpl::trigger::cancel_perpl_trigger,
			perpl::private_feed::start_private_feed,
			perpl::private_feed::stop_private_feed,
			perpl::account::start_account_feed,
			perpl::account::stop_account_feed,
			perpl::order::preview_perpl_order,
			perpl::order::preview_perpl_close,
			perpl::outcome::inspect_perpl_order_result,
			perpl::transaction::build_perpl_order,
			perpl::transaction::build_perpl_close,
			perpl::transaction::build_perpl_cancel,
			perpl::transaction::build_perpl_change,
			perpl::transaction::build_perpl_funding,
			perpl::transaction::build_perpl_forwarding
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
