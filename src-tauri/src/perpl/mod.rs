pub mod account;
pub mod setup;
pub mod activity;
pub mod read_key;
pub mod private_feed;

pub fn account_missing(error: &alloy::contract::Error) -> bool {
    error.as_revert_data().is_some_and(|data| data.starts_with(&[0x03, 0xa0, 0xe2, 0x77]))
}
pub mod order;
pub mod transaction;
pub mod outcome;
pub mod trade_key;
pub mod trigger;

pub const EXCHANGE: &str = "0x1964C32f0bE608E7D29302AFF5E61268E72080cc";

pub fn exchange_address() -> alloy::primitives::Address {
    EXCHANGE.parse().expect("fixed Perpl testnet exchange address")
}
