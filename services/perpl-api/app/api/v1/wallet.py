from fastapi import APIRouter, HTTPException

from app.schema.wallet import AUSDWalletBalance
from app.service.wallet import get_wallet_ausd_balance


router = APIRouter(
    prefix="/wallet",
    tags=["wallet"],
)


@router.get(
    "/{address}/balance",
    response_model=AUSDWalletBalance,
)
async def get_ausd_wallet_balance(address: str):

    try:
        return get_wallet_ausd_balance(address)

    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid wallet address",
        )