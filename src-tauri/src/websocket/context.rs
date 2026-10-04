use std::{collections::HashMap, sync::LazyLock, time::{Duration, Instant}};

use serde::{Deserialize, Serialize};

use crate::{format_price, AppError};

const URL: &str = "https://testnet.perpl.xyz/api/v1/pub/context";

#[derive(Clone, Deserialize)]
struct Context {
    chain: Chain,
    markets: Vec<Market>,
}

#[derive(Clone, Deserialize)]
struct Chain {
    chain_id: u64,
    gas: Gas,
}

#[derive(Clone, Deserialize)]
struct Gas {
    h: u64,
}

#[derive(Clone, Deserialize)]
struct Market {
    id: u32,
    symbol: String,
    name: String,
    order_ttl_blocks: u64,
    config: MarketConfig,
    state: Option<MarketState>,
    funding: Option<Funding>,
}

#[derive(Clone, Deserialize)]
struct MarketConfig {
    is_open: bool,
    price_decimals: u32,
    size_decimals: u32,
    initial_margin: u32,
    maintenance_margin: u32,
    maker_fee: u32,
    taker_fee: u32,
    #[serde(default)]
    min_settle_amount: String,
}

#[derive(Clone, Deserialize)]
struct MarketState {
    at: MarketAt,
    orl: u64,
    mrk: u64,
    lst: u64,
    bid: u64,
    ask: u64,
    prv: u64,
    dva: String,
    oi: u64,
}

#[derive(Clone, Deserialize)]
struct MarketAt { t: u64 }

#[derive(Clone, Deserialize)]
struct Funding {
    rate: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketInfo {
    pub id: u32,
    pub symbol: String,
    pub name: String,
    pub price_decimals: u32,
    pub size_decimals: u32,
    pub is_open: bool,
    pub initial_margin: u32,
    pub maintenance_margin: u32,
    pub max_leverage_hundredths: u32,
    pub maker_fee_micros: u32,
    pub taker_fee_micros: u32,
    pub minimum_settle_amount: String,
    pub order_ttl_blocks: u64,
    pub price: Option<String>,
    pub mark_price: Option<String>,
    pub oracle_price: Option<String>,
    pub previous_price: Option<String>,
    pub bid: Option<String>,
    pub ask: Option<String>,
    pub volume_usd: Option<String>,
    pub open_interest: Option<String>,
    pub funding_rate: Option<i64>,
    pub updated_at_ms: Option<u64>,
}

impl From<Market> for MarketInfo {
    fn from(market: Market) -> Self {
        let d = market.config.price_decimals;
        let state = market.state;
        Self {
            id: market.id,
            symbol: market.symbol,
            name: market.name,
            price_decimals: d,
            size_decimals: market.config.size_decimals,
            is_open: market.config.is_open,
            initial_margin: market.config.initial_margin,
            maintenance_margin: market.config.maintenance_margin,
            max_leverage_hundredths: market.config.initial_margin,
            maker_fee_micros: market.config.maker_fee,
            taker_fee_micros: market.config.taker_fee,
            minimum_settle_amount: market.config.min_settle_amount,
            order_ttl_blocks: market.order_ttl_blocks,
            price: state.as_ref().map(|s| format_price::format_price(s.lst, d)),
            mark_price: state.as_ref().map(|s| format_price::format_price(s.mrk, d)),
            oracle_price: state.as_ref().map(|s| format_price::format_price(s.orl, d)),
            previous_price: state.as_ref().map(|s| format_price::format_price(s.prv, d)),
            bid: state.as_ref().map(|s| format_price::format_price(s.bid, d)),
            ask: state.as_ref().map(|s| format_price::format_price(s.ask, d)),
            volume_usd: state.as_ref().map(|s| format_price::format_decimal_string(&s.dva, 6)),
            open_interest: state.as_ref().map(|s| format_price::format_price(s.oi, market.config.size_decimals)),
            funding_rate: market.funding.map(|f| f.rate),
            updated_at_ms: state.as_ref().map(|s| s.at.t),
        }
    }
}

#[derive(Clone)]
pub struct MarketContext {
    pub chain_id: u64,
    pub head: u64,
    pub markets: HashMap<u32, MarketInfo>,
}

static CACHED_METADATA: LazyLock<tokio::sync::Mutex<Option<(Instant, MarketContext)>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(None));

/// Symbol and decimal metadata for account/history rendering. Trading quotes
/// still use `markets()` so they always check current prices and limits.
pub async fn market_metadata() -> Result<MarketContext, AppError> {
    let mut cache = CACHED_METADATA.lock().await;
    if let Some((updated, context)) = cache.as_ref() {
        if updated.elapsed() < Duration::from_secs(300) { return Ok(context.clone()); }
    }
    let context = markets().await?;
    *cache = Some((Instant::now(), context.clone()));
    Ok(context)
}

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(||
    reqwest::Client::builder().timeout(Duration::from_secs(12)).build()
        .expect("valid Perpl HTTP client configuration"));

pub async fn markets() -> Result<MarketContext, AppError> {
    let response = CLIENT.get(URL).send().await?.error_for_status()?;
    let context: Context = response.json().await?;
    if context.chain.chain_id != 10143 {
        return Err("Perpl context returned the wrong chain".into());
    }
    Ok(MarketContext {
        chain_id: context.chain.chain_id,
        head: context.chain.gas.h,
        markets: context.markets.into_iter().map(|market| (market.id, market.into())).collect(),
    })
}
