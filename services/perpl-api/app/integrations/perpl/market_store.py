import asyncio

from app.integrations.perpl.market_normalizer import normalize_market
from app.integrations.perpl.market_subscriber import MarketSubscriber,EnqueueMarketResult
from app.integrations.perpl.market_subscription_registry import subscription_registry


class MarketStore:

    def __init__(self):
        self._markets = {}
        self._versions = {}
        self._lock = asyncio.Lock()
        self._subscribers = {}
        self._next_subscriber_id = 1
        self._feed_healthy = False


    
    async def subscribe(self):

        queue = asyncio.Queue(maxsize=100)

        subscriber = MarketSubscriber(
        queue=queue,
        subscriber_id=self._next_subscriber_id,
        )

        self._next_subscriber_id += 1

        self._subscribers[subscriber.subscriber_id] = subscriber

        print(
        f"WebSocket subscriber added: "
        f"id={subscriber.subscriber_id}, "
        f"subscribers={len(self._subscribers)}"
        )

        return subscriber

    async def unsubscribe(self, subscriber):

        await subscription_registry.remove_subscriber(
        subscriber.subscriber_id
        )

        self._subscribers.pop(subscriber.subscriber_id, None)

        print(
        f"WebSocket subscriber removed: "
        f"id={subscriber.subscriber_id}, "
        f"subscribers={len(self._subscribers)}"
        )

    async def update_markets(self, markets: dict):

        async with self._lock:

            updated_markets = []

            for market_id, state in markets.items():

                market = normalize_market(
                market_id,
                state,
                )

                old_market = self._markets.get(
                market.market_id
               )

                if old_market == market:
                    continue

                self._markets[market.market_id] = market
                self._versions[market.market_id] = (
                self._versions.get(market.market_id, 0) + 1
                )
                updated_markets.append(market)


        print(
        f"Broadcasting "
        f"{len(updated_markets)} markets to "
        f"{len(self._subscribers)} subscriber"

        )

        for market in updated_markets:

            subscriber_ids = await subscription_registry.get_subscribers(
            market.market_id
            )

            for subscriber_id in subscriber_ids:

                async with self._lock:
                    subscriber = self._subscribers.get(subscriber_id)
                if not subscriber:
                    continue

                result = subscriber.enqueue_market(market)

                if result is EnqueueMarketResult.QUEUE_FULL:
                    print(
                        f"Subscriber queue full; "
                        f"subscriber={subscriber.subscriber_id}; "
                        f"market={market.market_id}; "
                        f"dropped={subscriber.dropped_updates}"
                    )

                elif result is EnqueueMarketResult.DEFERRED:
                    print(
                        f"Market update deferred; "
                        f"subscriber={subscriber.subscriber_id}; "
                        f"market={market.market_id}"
                    )

    async def get_markets(self):

        async with self._lock:
            return list(self._markets.values())

    async def get_market(self, market_id: int):

        async with self._lock:
            return self._markets.get(market_id)


    async def get_market_with_version(self, market_id: int):

        async with self._lock:

            market = self._markets.get(market_id)

            version = self._versions.get(
            market_id,
            0,
            )

            return market, version

    async def set_feed_health(self, healthy: bool):

        async with self._lock:
            self._feed_healthy = healthy


    async def is_feed_healthy(self):

        async with self._lock:
            return self._feed_healthy



    async def subscribe_markets(
    self,
    subscriber,
    market_ids: set[int],
):

        await subscription_registry.subscribe(
        subscriber.subscriber_id,
        market_ids,
        )

        subscriber.subscriptions.update(
        market_ids
        )

    async def unsubscribe_markets(
        self,
        subscriber,
        market_ids: set[int],
    ):
        await subscription_registry.unsubscribe(
            subscriber.subscriber_id,
            market_ids,
        )

        subscriber.subscriptions.difference_update(
            market_ids
        )

        subscriber.clear_market_state(
            market_ids
        )


    async def validate_market_ids(
    self,
    market_ids: set[int],
) -> set[int]:

        async with self._lock:

            known_market_ids = set(
            self._markets.keys()
            )

        return market_ids & known_market_ids


    async def get_markets_with_versions(
    self,
    market_ids: set[int],
) -> list[tuple]:

        async with self._lock:

            results = []

            for market_id in market_ids:

                market = self._markets.get(
                market_id
                )

                if market is None:
                    continue

                version = self._versions.get(
                market_id,
                0,
                )

                results.append(
                   (
                    market,
                    version,
                   )
                )

            return results


market_store = MarketStore()