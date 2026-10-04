use serde::Serialize;

use crate::context::MarketInfo;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum MarketEvent {
    Context { head: u64, markets: Vec<MarketInfo> },
    Config { market: MarketInfo },
    State { market_id: u32, price: String, mark_price: String, oracle_price: String,
        previous_price: String, bid: String, ask: String, volume_usd: String,
        open_interest: String, head: Option<u64> },
    Funding { market_id: u32, rate: i64 },
    Candles { market_id: u32, resolution: u32, snapshot: bool, candles: Vec<Candle> },
    Head { block: u64 },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candle {
    pub time: u64,
    pub open: String,
    pub close: String,
    pub high: String,
    pub low: String,
    pub volume: String,
    pub trades: u64,
}
