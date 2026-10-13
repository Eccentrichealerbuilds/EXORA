import asyncio
import time

from dataclasses import dataclass, field

from enum import Enum


class EnqueueMarketResult(Enum):
    ENQUEUED = "enqueued"
    DEFERRED = "deferred"
    QUEUE_FULL = "queue_full"


@dataclass
class MarketSubscriber:

    queue: asyncio.Queue
    subscriber_id: int

    connected_at: float = field(
        default_factory=time.monotonic
    )

    subscriptions : set[int] = field(
        default_factory=set
    )

    last_delivery_at: float | None = None

    slow_since: float | None = None

    dropped_updates: int = 0

    delivered_updates: int = 0

    pending_markets: set[int] = field(
        default_factory=set
    )

    delivered_versions: dict[int, int] = field(
        default_factory=dict
    )

    snapshot_versions: dict[int, int] = field(
    default_factory=dict
    )

    snapshot_pending: set[int] = field(
    default_factory=set
    )
    

    dirty_markets: set[int] = field(
    default_factory=set
    )

    outbound_queue: asyncio.Queue = field(
    default_factory=lambda: asyncio.Queue(maxsize=100)
    )

    def mark_delivered(self):
        self.delivered_updates += 1
        self.last_delivery_at = time.monotonic()

    def mark_slow(self):
        if self.slow_since is None:
            self.slow_since = time.monotonic()

    def mark_healthy(self):
        self.slow_since = None
    def mark_dropped(self):
        self.dropped_updates += 1

    @property
    def queue_size(self) -> int:
        return self.queue.qsize()

    @property
    def queue_capacity(self) -> int:
        return self.queue.maxsize

    @property
    def queue_utilization(self) -> float:

        if self.queue.maxsize == 0:
            return 0.0

        return self.queue.qsize() / self.queue.maxsize

    @property
    def is_slow(self) -> bool:
        return self.queue_utilization >= 0.80

    @property
    def slow_duration(self) -> float | None:
        if self.slow_since is None:
            return None

        return time.monotonic() - self.slow_since

    def enqueue_market(self, market) -> EnqueueMarketResult:

        return self.enqueue_market_id(
            market.market_id
        )

        
    def enqueue_market_id(
        self,
        market_id: int,
    ) -> EnqueueMarketResult:

        if market_id in self.dirty_markets:
            self.dirty_markets.discard(market_id)
            return EnqueueMarketResult.DEFERRED

        try:
            self.queue.put_nowait(market_id)
        except asyncio.QueueFull:
            self.mark_dropped()
            return EnqueueMarketResult.QUEUE_FULL

        self.pending_markets.add(market_id)
        return EnqueueMarketResult.ENQUEUED
    
    def acknowledge_market(
    self,
    market_id: int,
    ):

        if market_id in self.dirty_markets:

            self.dirty_markets.discard(
            market_id
            )

            return False

        self.pending_markets.discard(
        market_id
        )

        return True

    def mark_version_delivered(
        self,
        market_id: int,
        version: int,
    ):
        self.delivered_versions[
            market_id
        ] = version

    def get_delivered_version(
        self,
        market_id: int,
    ) -> int:

        return self.delivered_versions.get(
            market_id,
            0,
        )

    def mark_snapshot_version(
    self,
    market_id: int,
    version: int,
):
        self.snapshot_versions[
        market_id
        ] = version

    def get_snapshot_version(
    self,
    market_id: int,
) -> int:

        return self.snapshot_versions.get(
        market_id,
        0,
        )


    def mark_snapshot_pending(
        self,
        market_ids: set[int],
    ):
        self.snapshot_pending.update(
            market_ids
        )


    def clear_snapshot_pending(
        self,
        market_ids: set[int],
    ):
        self.snapshot_pending.difference_update(
            market_ids
        )


    def is_snapshot_pending(
    self,
    market_id: int,
) -> bool:

        return market_id in self.snapshot_pending

    def requeue_dirty_market(
    self,
    market_id: int,
) -> bool:

        if market_id not in self.dirty_markets:
           return False

        try:

            self.queue.put_nowait(
            market_id
            )

        except asyncio.QueueFull:

            self.mark_dropped()

            return False

        self.dirty_markets.discard(
        market_id
        )

        return True

    def requeue_market(
        self,
        market_id: int,
    ) -> bool:

        try:
            self.queue.put_nowait(
                market_id
            )
        except asyncio.QueueFull:
            self.mark_dropped()
            return False

        self.pending_markets.add(
            market_id
        )

        return True

    def enqueue_control(self, message: dict) -> bool:

        try:
            self.outbound_queue.put_nowait(("control", message))
        except asyncio.QueueFull:
            return False

        return True


    def enqueue_required_control(self, message: dict) -> bool:
        return self.enqueue_control(message)


    def enqueue_snapshot(
    self,
    markets: list[tuple],
) -> bool:

        try:
            self.outbound_queue.put_nowait(
            ("snapshot", markets)
            )
        except asyncio.QueueFull:
            return False

        return True


    def defer_market(
        self,
        market_id: int,
    ):
        self.dirty_markets.add(
            market_id
        )


    

    def health_snapshot(self) -> dict:

        return {
            "subscriber_id": self.subscriber_id,
            "queue_size": self.queue_size,
            "queue_capacity": self.queue_capacity,
            "queue_utilization": self.queue_utilization,
            "pending_markets": len(
                self.pending_markets
            ),
            "delivered_updates": self.delivered_updates,
            "dropped_updates": self.dropped_updates,
            "tracked_versions": len(
                self.delivered_versions
            ),
            "dirty_markets": len(
            self.dirty_markets
            ),
            "is_slow": self.is_slow,
            "slow_since": self.slow_since,
            "slow_duration": self.slow_duration,
            "connected_at": self.connected_at,
            "last_delivery_at": self.last_delivery_at
        }

    def clear_market_state(
        self,
        market_ids: set[int],
    ):
        self.pending_markets.difference_update(
            market_ids
        )

        self.snapshot_pending.difference_update(
            market_ids
        )

        self.dirty_markets.difference_update(
            market_ids
        )

        for market_id in market_ids:
            self.snapshot_versions.pop(
                market_id,
                None,
            )

            self.delivered_versions.pop(
                market_id,
                None,
            )

