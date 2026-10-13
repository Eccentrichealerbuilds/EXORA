from pydantic import BaseModel


class Market(BaseModel):
    symbol: str
    perpetual_id: int
    price: float
    bid: float
    ask: float
    initial_margin: float
    maintenance_margin: float