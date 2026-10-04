use serde::Serialize;

use crate::{context::MarketInfo, format_price};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceUpdate {
    pub market_id: u32,
    pub symbol: String,
    pub raw_price: String,
    pub price_decimals: u32,
    pub price: String,
}

impl PriceUpdate {
    pub fn new(market: &MarketInfo, raw: u64) -> Self {
        Self {
            market_id: market.id,
            symbol: market.symbol.clone(),
            raw_price: raw.to_string(),
            price_decimals: market.price_decimals,
            price: format_price::format_price(raw, market.price_decimals),
        }
    }
}
