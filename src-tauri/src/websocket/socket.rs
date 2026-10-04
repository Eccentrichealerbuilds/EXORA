use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use tauri::{ipc::Channel, AppHandle};
use tokio_tungstenite::tungstenite::Message;
use crate::transport::connect as connect_async;

use crate::{
    close,
    context::MarketContext,
    market_event::MarketEvent,
    message,
    price::PriceUpdate,
    subscribe,
    AppError,
};

const URL: &str = "wss://testnet.perpl.xyz/ws/v1/market-data";

pub async fn read(
    context: &mut MarketContext,
    on_price: &Channel<PriceUpdate>,
    on_market: Option<&Channel<MarketEvent>>,
    candle_market: Option<u32>,
    resolution: Option<u32>,
    app: &AppHandle,
) -> Result<(), AppError> {
    if let Some(id) = candle_market {
        if !context.markets.contains_key(&id) { return Err("Selected Perpl market is unavailable".into()); }
        crate::book::clear(id);
    }
    let (socket, _) = tokio::time::timeout(Duration::from_secs(12), connect_async(URL)).await??;
    let (mut sender, mut receiver) = socket.split();
    sender.send(Message::Text(subscribe::request(candle_market, resolution).into())).await?;

    let mut app_ping = tokio::time::interval(Duration::from_secs(15));
    app_ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    app_ping.tick().await;
    // Perpl's testnet proxy currently closes idle connections with 1008
    // "ping timeout" even when the client's reply to its control Ping is sent.
    // A short unsolicited control Pong keeps the proxy's liveness timer fresh.
    let mut proxy_pong = tokio::time::interval(Duration::from_secs(2));
    proxy_pong.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    proxy_pong.tick().await;
    let mut last_message = Instant::now();
    let mut connected = false;
    let mut last_heartbeat = None;

    loop {
        tokio::select! {
            next = receiver.next() => match next {
                Some(Ok(Message::Text(text))) => {
                    last_message = Instant::now();
                    message::read(&text, &mut context.markets, on_price, on_market,
                        candle_market, resolution, app, &mut connected, &mut last_heartbeat)?;
                }
                Some(Ok(Message::Ping(payload))) => {
                    last_message = Instant::now();
                    sender.send(Message::Pong(payload)).await?;
                }
                Some(Ok(Message::Close(frame))) => return Err(close::describe(frame).into()),
                None => return Err("Perpl WebSocket ended without a close frame".into()),
                Some(Ok(_)) => last_message = Instant::now(),
                Some(Err(error)) => return Err(error.into()),
            },
            _ = proxy_pong.tick() => {
                sender.send(Message::Pong(Vec::new().into())).await?;
            }
            _ = app_ping.tick() => {
                if last_message.elapsed() >= Duration::from_secs(60) {
                    return Err("No Perpl WebSocket messages for 60 seconds".into());
                }
                sender.send(Message::Text(serde_json::json!({"mt": 1, "t":
                    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis()}).to_string().into())).await?;
            }
        }
    }
}
