use std::{collections::{BTreeMap, HashMap}, sync::{LazyLock, RwLock}, time::{Duration, Instant}};

use alloy::primitives::U256;
use serde_json::Value;

struct Book {
    bids: BTreeMap<u64, u64>,
    asks: BTreeMap<u64, u64>,
    updated: Instant,
    timestamp_ms: Option<u64>,
}

static BOOKS: LazyLock<RwLock<HashMap<u32, Book>>> = LazyLock::new(|| RwLock::new(HashMap::new()));

pub struct Estimate {
    pub filled_raw: U256,
    pub average_price_raw: Option<U256>,
    pub timestamp_ms: Option<u64>,
}

pub fn clear(market_id: u32) {
    if let Ok(mut books) = BOOKS.write() { books.remove(&market_id); }
}

fn apply(levels: &mut BTreeMap<u64, u64>, value: &Value) {
    let Some(items) = value.as_array() else { return; };
    for item in items {
        let (Some(price), Some(size), Some(orders)) =
            (item["p"].as_u64(), item["s"].as_u64(), item["o"].as_u64()) else { continue; };
        if orders == 0 || size == 0 { levels.remove(&price); }
        else { levels.insert(price, size); }
    }
}

pub fn update(market_id: u32, frame: &Value, snapshot: bool) {
    let Ok(mut books) = BOOKS.write() else { return; };
    if snapshot {
        let mut book = Book { bids: BTreeMap::new(), asks: BTreeMap::new(), updated: Instant::now(),
            timestamp_ms: frame["at"]["t"].as_u64() };
        apply(&mut book.bids, &frame["bid"]);
        apply(&mut book.asks, &frame["ask"]);
        books.insert(market_id, book);
    } else if let Some(book) = books.get_mut(&market_id) {
        apply(&mut book.bids, &frame["bid"]);
        apply(&mut book.asks, &frame["ask"]);
        book.updated = Instant::now();
        book.timestamp_ms = frame["at"]["t"].as_u64().or(book.timestamp_ms);
    }
}

pub fn estimate(market_id: u32, buy: bool, worst_price: U256, quantity: U256) -> Option<Estimate> {
    let books = BOOKS.read().ok()?;
    let book = books.get(&market_id)?;
    if book.updated.elapsed() > Duration::from_secs(30) { return None; }
    let mut filled = U256::ZERO;
    let mut weighted = U256::ZERO;
    let levels: Box<dyn Iterator<Item = (&u64, &u64)> + '_> = if buy {
        Box::new(book.asks.iter())
    } else { Box::new(book.bids.iter().rev()) };
    for (&price, &size) in levels {
        let price = U256::from(price);
        if (buy && price > worst_price) || (!buy && price < worst_price) { break; }
        let take = U256::from(size).min(quantity.saturating_sub(filled));
        if take.is_zero() { break; }
        filled += take;
        weighted += take * price;
        if filled >= quantity { break; }
    }
    Some(Estimate { filled_raw: filled,
        average_price_raw: if filled.is_zero() { None } else { Some(weighted / filled) },
        timestamp_ms: book.timestamp_ms })
}
