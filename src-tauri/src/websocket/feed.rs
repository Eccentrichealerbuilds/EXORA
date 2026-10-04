use std::time::{Duration, Instant};

use tauri::{ipc::Channel, AppHandle};

use crate::{context, market_event::MarketEvent, price::PriceUpdate, socket, status, AppError};

async fn connect_once(
    app: &AppHandle,
    on_price: &Channel<PriceUpdate>,
    on_market: Option<&Channel<MarketEvent>>,
    candle_market: Option<u32>,
    resolution: Option<u32>,
) -> Result<(), AppError> {
    let mut context = context::markets().await?;
    if let Some(channel) = on_market {
        let mut markets: Vec<_> = context.markets.values().cloned().collect();
        markets.sort_by_key(|m| m.id);
        channel.send(MarketEvent::Context { head: context.head, markets })?;
    }
    for market in context.markets.values() {
        if let Some(raw) = market.mark_price.as_deref() {
            // Context prices are already scaled; the live stream replaces these immediately.
            if let Ok(value) = crate::utils::parse_amount::parse_amount(Some(raw.to_string()), market.price_decimals as u8) {
                if let Ok(raw_value) = u64::try_from(value) {
                    on_price.send(PriceUpdate::new(market, raw_value))?;
                }
            }
        }
    }
    socket::read(&mut context, on_price, on_market, candle_market, resolution, app).await
}

pub async fn run(
    app: AppHandle,
    on_price: Channel<PriceUpdate>,
    on_market: Option<Channel<MarketEvent>>,
    candle_market: Option<u32>,
    resolution: Option<u32>,
) {
    crate::candles::disconnected(candle_market, resolution);
    let mut delay = 1_u64;
    status::send(&app, "connecting", "Opening Perpl market stream");
    loop {
        let started = Instant::now();
        let result = connect_once(&app, &on_price, on_market.as_ref(), candle_market, resolution).await;
        crate::candles::disconnected(candle_market, resolution);
        let reason = match result {
            Ok(()) => "Perpl WebSocket closed".to_string(),
            Err(error) => {
                eprintln!("Perpl market stream error: {error}");
                crate::user_error::safe_message(&error.to_string(), "Perpl market stream disconnected")
            },
        };
        status::send(&app, "disconnected", &reason);
        if started.elapsed() >= Duration::from_secs(30) { delay = 1; }
        status::send(&app, "reconnecting", &format!("{reason}. Retrying in {delay} seconds"));
        tokio::time::sleep(Duration::from_secs(delay)).await;
        delay = (delay * 2).min(60);
    }
}
