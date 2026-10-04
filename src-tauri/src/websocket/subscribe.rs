pub fn request(candle_market: Option<u32>, resolution: Option<u32>) -> String {
    let mut subs = vec![
        serde_json::json!({"stream": "heartbeat@10143", "subscribe": true}),
        serde_json::json!({"stream": "market-config@10143", "subscribe": true}),
        serde_json::json!({"stream": "market-state@10143", "subscribe": true}),
        serde_json::json!({"stream": "funding@10143", "subscribe": true}),
    ];
    if let (Some(market), Some(resolution)) = (candle_market, resolution) {
        subs.push(serde_json::json!({"stream": format!("candles@{market}*{resolution}"), "subscribe": true}));
        subs.push(serde_json::json!({"stream": format!("order-book@{market}"), "subscribe": true}));
    }
    serde_json::json!({"mt": 5, "subs": subs}).to_string()
}
