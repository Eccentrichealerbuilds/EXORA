from app.blockchain.ausd import get_ausd_balance
from app.schema.wallet import AUSDWalletBalance
from decimal import Decimal


def get_wallet_ausd_balance(address: str) -> AUSDWalletBalance:
    raw_balance = get_ausd_balance(address)

    balance = Decimal(raw_balance) / Decimal(10**6)

    return AUSDWalletBalance(
        address=address,
        token="AUSD",
        balance=balance,
        raw_balance=raw_balance,
        decimals=6
    )