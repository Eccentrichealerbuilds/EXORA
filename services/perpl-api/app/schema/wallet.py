from decimal import Decimal

from pydantic import BaseModel


class AUSDWalletBalance(BaseModel):
    address: str
    token: str
    balance: Decimal
    raw_balance: int
    decimals: int