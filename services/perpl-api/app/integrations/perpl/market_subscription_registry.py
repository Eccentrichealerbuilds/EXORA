import asyncio


class MarketSubscriptionRegistry:

    def __init__(self):

        self._market_subscribers: dict[
            int,
            set[int],
        ] = {}

        self._subscriber_markets: dict[
            int,
            set[int],
        ] = {}

        self._lock = asyncio.Lock()

    async def subscribe(
        self,
        subscriber_id: int,
        market_ids: set[int],
    ):

        async with self._lock:

            subscriber_markets = (
                self._subscriber_markets.setdefault(
                    subscriber_id,
                    set(),
                )
            )

            for market_id in market_ids:

                self._market_subscribers.setdefault(
                    market_id,
                    set(),
                ).add(subscriber_id)

                subscriber_markets.add(
                    market_id
                )

    async def unsubscribe(
        self,
        subscriber_id: int,
        market_ids: set[int],
    ):

        async with self._lock:

            subscriber_markets = (
                self._subscriber_markets.get(
                    subscriber_id
                )
            )

            if subscriber_markets is None:
                return

            for market_id in market_ids:

                subscriber_markets.discard(
                    market_id
                )

                subscribers = (
                    self._market_subscribers.get(
                        market_id
                    )
                )

                if subscribers is None:
                    continue

                subscribers.discard(
                    subscriber_id
                )

                if not subscribers:
                    self._market_subscribers.pop(
                        market_id,
                        None,
                    )

            if not subscriber_markets:
                self._subscriber_markets.pop(
                    subscriber_id,
                    None,
                )

    async def remove_subscriber(
        self,
        subscriber_id: int,
    ):

        async with self._lock:

            markets = (
                self._subscriber_markets.pop(
                    subscriber_id,
                    set(),
                )
            )

            for market_id in markets:

                subscribers = (
                    self._market_subscribers.get(
                        market_id
                    )
                )

                if subscribers is None:
                    continue

                subscribers.discard(
                    subscriber_id
                )

                if not subscribers:
                    self._market_subscribers.pop(
                        market_id,
                        None,
                    )

    async def get_subscribers(
        self,
        market_id: int,
    ) -> set[int]:

        async with self._lock:

            return set(
                self._market_subscribers.get(
                    market_id,
                    set(),
                )
            )

    async def get_markets(
        self,
        subscriber_id: int,
    ) -> set[int]:

        async with self._lock:

            return set(
                self._subscriber_markets.get(
                    subscriber_id,
                    set(),
                )
            )


subscription_registry = (
    MarketSubscriptionRegistry()
)