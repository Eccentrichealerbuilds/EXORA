from pydantic import BaseModel


class MarketResponse(BaseModel):
    market_id: int

    symbol: str | None = None

    oracle_price: int | None
    mark_price: int | None
    last_price: int | None
    mid_price: int | None

    bid_price: int | None
    ask_price: int | None

    previous_price: int | None

    daily_volume: int | None
    daily_volume_value: str | None

    open_interest: int | None
    total_value_locked: str | None

    block_number: int | None
    timestamp: int | None   


class MarketsResponse(BaseModel):
    markets: list[MarketResponse]