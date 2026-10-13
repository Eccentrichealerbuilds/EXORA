from dataclasses import dataclass
from typing import Optional


@dataclass
class MarketState:
    market_id: int
    oracle_price: Optional[float] = None
    mark_price: Optional[float] = None
    last_price: Optional[float] = None
    mid_price: Optional[float] = None
    bid: Optional[float] = None
    ask: Optional[float] = None
    previous_price: Optional[float] = None
    daily_volume: Optional[float] = None
    daily_volume_amount: Optional[str] = None
    open_interest: Optional[float] = None
    tvl: Optional[str] = None


class MarketDataService:

    def __init__(self):
        self.markets: dict[int, MarketState] = {}

    def update_market(self, market_id: int, state: dict):
        market = MarketState(
            market_id=market_id,
            oracle_price=state.get("orl"),
            mark_price=state.get("mrk"),
            last_price=state.get("lst"),
            mid_price=state.get("mid"),
            bid=state.get("bid"),
            ask=state.get("ask"),
            previous_price=state.get("prv"),
            daily_volume=state.get("dv"),
            daily_volume_amount=state.get("dva"),
            open_interest=state.get("oi"),
            tvl=state.get("tvl"),
        )

        self.markets[market_id] = market

    def get_market(self, market_id: int) -> MarketState | None:
        return self.markets.get(market_id)

    def get_all_markets(self) -> list[MarketState]:
        return list(self.markets.values())


market_data_service = MarketDataService()