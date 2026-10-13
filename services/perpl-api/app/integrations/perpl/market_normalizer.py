from app.integrations.perpl.models import MarketResponse


MARKET_SYMBOLS = {
    16: "BTC-USD",
    32: "ETH-USD",
    48: "SOL-USD",
    64: "MON-USD",
    256: "ZEC-USD",
    272: "LIT-USD",
    320: "PUMP-USD",
}


def normalize_market(
    market_id: str,
    data: dict,
) -> MarketResponse:

    at = data.get("at", {})

    return MarketResponse(
        market_id=int(market_id),
        symbol = MARKET_SYMBOLS.get(int(market_id)),

        oracle_price=data.get("orl"),
        mark_price=data.get("mrk"),
        last_price=data.get("lst"),
        mid_price=data.get("mid"),

        bid_price=data.get("bid"),
        ask_price=data.get("ask"),

        previous_price=data.get("prv"),

        daily_volume=data.get("dv"),
        daily_volume_value=data.get("dva"),

        open_interest=data.get("oi"),
        total_value_locked=data.get("tvl"),

        block_number=at.get("b"),
        timestamp=at.get("t"),
    )