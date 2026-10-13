from dataclasses import dataclass


@dataclass(frozen=True)
class SubscriptionCommand:

    type: str
    markets: set[int]


SUPPORTED_COMMANDS = {
    "subscribe",
    "unsubscribe",
}


def parse_subscription_command(
    data: dict,
) -> SubscriptionCommand:

    command_type = data.get("type")

    if command_type not in SUPPORTED_COMMANDS:
        raise ValueError(
            f"Unsupported command type: {command_type}"
        )

    markets = data.get("markets")

    if not isinstance(markets, list):
        raise ValueError(
            "`markets` must be a list"
        )

    if not markets:
        raise ValueError(
            "`markets` cannot be empty"
        )

    try:
        market_ids = {
            int(market_id)
            for market_id in markets
        }
    except (TypeError, ValueError):
        raise ValueError(
            "`markets` must contain integers"
        )

    if any(
        market_id <= 0
        for market_id in market_ids
    ):
        raise ValueError(
            "market IDs must be positive"
        )

    return SubscriptionCommand(
        type=command_type,
        markets=market_ids,
    )