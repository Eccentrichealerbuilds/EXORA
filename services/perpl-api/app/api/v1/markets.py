from fastapi import APIRouter, HTTPException

from app.integrations.perpl.market_store import market_store

from app.integrations.perpl.models import MarketsResponse, MarketResponse

router = APIRouter(prefix="/markets", tags=["markets"])


@router.get("", response_model=MarketsResponse)
async def get_markets():
    markets = await market_store.get_markets()

    return {
        "markets": [
            market.model_dump()
            for market in markets
        ],
    }


@router.get("/{market_id}",response_model=MarketResponse)
async def get_market(market_id: int):

    market = await market_store.get_market(
        market_id
    )

    if market is None:
        raise HTTPException(
            status_code=404,
            detail="Market not found",
        )

    return market