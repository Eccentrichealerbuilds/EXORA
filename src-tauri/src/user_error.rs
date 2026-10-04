use alloy::{
    contract,
    sol_types::{Revert, SolError, SolInterface},
    transports::TransportError,
};
use perpl_sdk::abi::errors::Exchange::ExchangeErrors;

// The SDK keeps the Exchange's custom errors in a separate ABI. Decode the
// revert bytes before giving a message to the webview; RPC error strings often
// contain provider internals and do not explain which order check failed.
fn contract_revert(data: &[u8], action: &str) -> Option<String> {
    use ExchangeErrors as Error;
    let decoded = Error::abi_decode(data).ok();
    if let Some(ref error) = decoded { eprintln!("Decoded Perpl {action} revert: {error:?}"); }
    let message = match decoded {
        Some(Error::AccountDoesNotExist(_)) => "Create and fund a Perpl account before trading".into(),
        Some(Error::AccountFrozen(_)) => "This Perpl account is frozen".into(),
        Some(Error::ExchangeHalted(_)) => "Perpl trading is temporarily halted".into(),
        Some(Error::ContractNotOperational(_)) | Some(Error::PerpetualNotActivated(_)) =>
            "Trading is paused for this market".into(),
        Some(Error::ExceedsLastExecutionBlock(_)) =>
            "The order quote expired. Refresh it and try again".into(),
        Some(Error::InvalidExpiryBlock(_)) => "The order expiry is no longer valid".into(),
        Some(Error::CantPostOrder(_)) | Some(Error::OrderPostFailed(_)) =>
            "Perpl could not post this order at the chosen price and size. Refresh the market and review the order".into(),
        Some(Error::CrossesBook(_)) => "This post-only price would immediately trade. Choose another limit price".into(),
        Some(Error::ImmediateOrderUnderMinimum(_)) | Some(Error::PostOrderUnderMinimum(_)) =>
            "The order is below this market's minimum size".into(),
        Some(Error::PriceOutOfRange(_)) | Some(Error::OrderBookPriceOutOfRange(_)) =>
            "The order price is outside this market's allowed range".into(),
        Some(Error::LotOutOfRange(_)) => "The order size is outside this market's allowed range".into(),
        Some(Error::AmountExceedsAvailableBalance(_)) | Some(Error::InsufficientFunds(_)) =>
            "Insufficient available AUSD in your Perpl account".into(),
        Some(Error::CloseOrderExceedsPosition(_)) | Some(Error::OrderSizeExceedsAvailableSize(_)) =>
            "The position is smaller than the requested close size. Refresh your portfolio".into(),
        Some(Error::CloseOrderPositionMismatch(_)) | Some(Error::PositionTypeMismatch(_)) =>
            "The position changed. Refresh your portfolio before closing it".into(),
        Some(Error::OrderDoesNotExist(_)) | Some(Error::WrongAccountForOrder(_)) =>
            "This order is no longer available to cancel. Refresh your open orders".into(),
        Some(Error::MaximumAccountOrders(_)) | Some(Error::OrderBookFull(_)) =>
            "This market cannot accept another open order right now".into(),
        Some(Error::MarkPriceAgeExceedsMax(_)) | Some(Error::OracleAgeExceedsMax(_)) | Some(Error::MarkPriceUninitialized(_)) =>
            "This market's price feed is stale. Wait for a fresh price before trading".into(),
        Some(Error::WithdrawRateLimitExceeded(_)) =>
            "Perpl's withdrawal limit is active. Try a smaller amount or wait".into(),
        Some(Error::InsufficentAmountToOpenAccount(_)) =>
            "The initial AUSD deposit is below Perpl's minimum".into(),
        Some(_) => format!("Perpl rejected the request to {action}. Refresh account and market data, then try again"),
        None => {
            if let Ok(revert) = Revert::abi_decode(data) {
                let reason = revert.reason.trim();
                if !reason.is_empty() && reason.len() <= 160 && !looks_like_raw_error(reason) {
                    return Some(format!("The request to {action} was rejected: {reason}"));
                }
            }
            return None;
        }
    };
    Some(message)
}

fn looks_like_raw_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    ["rpc", "json", "0x", "execution reverted", "error code", "http", "provider", "transport"]
        .iter().any(|part| lower.contains(part))
}

fn transport_message(error: &TransportError, action: &str) -> String {
    eprintln!("{action} RPC error: {error}");
    if let Some(payload) = error.as_error_resp() {
        if let Some(data) = payload.as_revert_data() {
            if let Some(message) = contract_revert(&data, action) { return message; }
        }
        let message = payload.message.to_ascii_lowercase();
        if message.contains("insufficient funds") { return "Insufficient MON for the network fee".into(); }
        if message.contains("nonce too low") || message.contains("replacement transaction") {
            return "Another transaction is pending. Wait for it to confirm, then try again".into();
        }
        if message.contains("rate limit") || message.contains("too many requests") || payload.code == -32614 {
            return "Monad is limiting requests right now. Please retry shortly".into();
        }
        if message.contains("revert") { return format!("The contract rejected the request to {action}. Refresh and try again"); }
    }
    format!("Could not reach Monad to {action}. Check your connection and try again")
}

pub fn rpc(error: TransportError, action: &str) -> String { transport_message(&error, action) }

pub fn contract(error: contract::Error, action: &str) -> String {
    eprintln!("{action} contract error: {error}");
    if let Some(data) = error.as_revert_data() {
        if let Some(message) = contract_revert(&data, action) { return message; }
    }
    if let contract::Error::TransportError(transport) = error {
        return transport_message(&transport, action);
    }
    format!("Could not {action} right now. Refresh and try again")
}

pub fn safe_message(message: &str, fallback: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("expired") || lower.contains("unauthorized") || lower.contains("401") {
        return "Perpl wallet data access expired. Reconnect it to continue".into();
    }
    if lower.contains("rate limit") || lower.contains("too many requests") || lower.contains("-32614") {
        return "The network is busy. Please wait a moment and try again".into();
    }
    if lower.contains("execution reverted") || lower.contains("rpc") || lower.contains("transport")
        || lower.contains("server returned") || lower.contains("http ") || lower.contains("0x")
        || lower.contains("error code") || lower.contains("://") || lower.contains("deserialize") {
        return fallback.into();
    }
    message.into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::sol_types::SolError;
    use perpl_sdk::abi::errors::Exchange;

    #[test]
    fn decodes_perpl_custom_error() {
        let data = Exchange::ExceedsLastExecutionBlock { lastExecutionBlock: alloy::primitives::U256::from(1_u64) }.abi_encode();
        assert_eq!(contract_revert(&data, "place order").as_deref(), Some("The order quote expired. Refresh it and try again"));
    }

    #[test]
    fn unknown_bytes_never_escape_to_webview() {
        assert!(contract_revert(&[1, 2, 3, 4], "place order").is_none());
    }
}
