import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.integrations.perpl.market_store import market_store
from app.integrations.perpl.market_ws_protocol import (
    parse_subscription_command,
)

import json

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/markets")
async def websocket_endpoint(websocket: WebSocket):

    await websocket.accept()

    subscriber = await market_store.subscribe()


    def enqueue_required_control(message: dict):
        if not subscriber.enqueue_required_control(message):
            raise WebSocketDisconnect(
                code=1013,
                reason="Outbound control queue full",
            )

    async def reader():

        while True:

            try:

                data = await websocket.receive_json()

            except json.JSONDecodeError:

                enqueue_required_control({
                    "type": "error",
                    "code": "INVALID_JSON",
                    "message": "Message must contain valid JSON",
                })

                continue


            try:

                command = parse_subscription_command(
                data
                )
            except ValueError as exc:
                enqueue_required_control({
                    "type": "error",
                    "code": "INVALID_COMMAND",
                    "message": str(exc),
                })
                continue

            valid_market_ids = (
                await market_store.validate_market_ids(
                    command.markets
                )
            )

            invalid_market_ids = (
                command.markets - valid_market_ids
            )

            if command.type == "subscribe":

                new_market_ids = (
                    valid_market_ids
                    - subscriber.subscriptions
                )

                if valid_market_ids:
                    enqueue_required_control({
                        "type": "subscribed",
                        "markets": sorted(valid_market_ids),
                    })

                if new_market_ids:

                    await market_store.subscribe_markets(
                        subscriber,
                        new_market_ids,
                    )

                    subscriber.mark_snapshot_pending(
                        new_market_ids
                    )

                    snapshot = await market_store.get_markets_with_versions(
                        new_market_ids
                    )

                    current_subscriptions = (
                        subscriber.subscriptions
                    )

                    snapshot = [
                        (market, version)
                        for market, version in snapshot
                        if market.market_id in current_subscriptions
                    ]

                    if snapshot:
                        enqueued = subscriber.enqueue_snapshot(
                            snapshot
                        )

                        if not enqueued:
                            snapshot_market_ids = {
                                market.market_id
                                for market, version in snapshot
                            }

                            subscriber.clear_snapshot_pending(
                                snapshot_market_ids
                            )

                            for market_id in snapshot_market_ids:
                                subscriber.defer_market(
                                    market_id
                                )
                            print(
                                "Snapshot queue full; "
                                f"subscriber={subscriber.subscriber_id}; "
                                f"markets={sorted(snapshot_market_ids)}"
                            )
                if invalid_market_ids:

                    enqueue_required_control({
                        "type": "error",
                        "code": "INVALID_MARKET",
                        "message": (
                            "One or more market IDs are invalid"
                        ),
                        "markets": sorted(
                            invalid_market_ids
                        ),
                    })

            elif command.type == "unsubscribe":

                if valid_market_ids:

                    await market_store.unsubscribe_markets(
                        subscriber,
                        valid_market_ids,
                    )

                    enqueue_required_control({
                        "type": "unsubscribed",
                        "markets": sorted(
                            valid_market_ids
                        ),
                    })

                if invalid_market_ids:

                    enqueue_required_control({
                        "type": "error",
                        "code": "INVALID_MARKET",
                        "message": (
                            "One or more market IDs are invalid"
                        ),
                        "markets": sorted(
                            invalid_market_ids
                        ),
                    })

    async def writer():
        outbound_task = None
        market_task = None

        try:
            while True:
                outbound_task = asyncio.create_task(
                    subscriber.outbound_queue.get()
                )
                market_task = asyncio.create_task(
                    subscriber.queue.get()
                )

                done, pending = await asyncio.wait(
                    {
                        outbound_task,
                        market_task,
                    },
                    return_when=asyncio.FIRST_COMPLETED,
                )

                for task in pending:
                    task.cancel()


                await asyncio.gather(
                    *pending,
                    return_exceptions=True,
                )

                completed_task = done.pop()
                message = completed_task.result()

                if completed_task is outbound_task:
                    message_type, payload = message

                    if message_type == "control":
                        await websocket.send_json(payload)
                        continue

                    if message_type == "snapshot":
                        await websocket.send_json({
                            "type": "SNAPSHOT",
                            "markets": [
                                market.model_dump()
                                for market, version in payload
                            ]
                        })

                        for market, version in payload:
                            subscriber.mark_snapshot_version(
                                market.market_id,
                                version,
                            )

                            subscriber.mark_version_delivered(
                                market.market_id,
                                version,
                            )

                        snapshot_market_ids = {
                            market.market_id
                            for market, version in payload
                        }

                        subscriber.clear_snapshot_pending(
                            snapshot_market_ids
                        )

                        for market_id in snapshot_market_ids:
                            if market_id in subscriber.dirty_markets:
                                subscriber.requeue_dirty_market(
                                    market_id
                                )

                        continue

                    raise RuntimeError(
                        f"Unknown message type: {message_type}"
                    )

                market_id = message

                try:
                    if market_id not in subscriber.subscriptions:
                        print(
                            f"Skipping unsubscribed market update: "
                            f"subscriber={subscriber.subscriber_id} "
                            f"market={market_id}"
                        )

                        subscriber.acknowledge_market(
                            market_id
                        )

                        continue

                    if subscriber.is_snapshot_pending(
                        market_id
                    ):
                        print(
                            f"Snapshot pending; "
                            f"deferring live update: "
                            f"subscriber={subscriber.subscriber_id} "
                            f"market={market_id}"
                        )

                        subscriber.defer_market(
                            market_id
                        )

                        continue

                    market, version = (
                        await market_store.get_market_with_version(
                            market_id
                        )
                    )

                    if market is None:
                        subscriber.acknowledge_market(
                            market_id
                        )
                        continue

                    delivered_version = (
                        subscriber.get_delivered_version(
                            market_id
                        )
                    )

                    if version <= delivered_version:
                        print(
                            f"Skipping stale market update: "
                            f"subscriber={subscriber.subscriber_id} "
                            f"market={market_id} "
                            f"version={version} "
                            f"delivered_version={delivered_version}"
                        )

                        subscriber.acknowledge_market(
                            market_id
                        )

                        continue

                    print(
                        f"Delivering "
                        f"subscriber={subscriber.subscriber_id} "
                        f"market={market_id} "
                        f"version={version} "
                        f"timestamp={market.timestamp}"
                    )

                    await websocket.send_json({
                        "type": "MarketUpdate",
                        "markets": [
                                market.model_dump()
                            ]
                    })

                    subscriber.mark_version_delivered(
                        market_id,
                        version,
                    )

                    subscriber.mark_delivered()

                    _, latest_version = (
                        await market_store.get_market_with_version(
                            market_id
                        )
                    )

                    if latest_version > version:
                        print(
                            f"Market changed during delivery: "
                            f"subscriber={subscriber.subscriber_id} "
                            f"market={market_id} "
                            f"sent_version={version} "
                            f"latest_version={latest_version}"
                        )

                        requeued = subscriber.requeue_market(
                            market_id
                        )

                        if not requeued:
                            print(
                                f"Unable to requeue market: "
                                f"subscriber={subscriber.subscriber_id} "
                                f"market={market_id} "
                                f"queue_full="
                                f"{subscriber.queue_size >= subscriber.queue_capacity}"
                            )

                        continue

                    subscriber.acknowledge_market(
                        market_id
                    )

                except WebSocketDisconnect:
                    raise

        finally:
            # The writer itself can be cancelled when the WebSocket closes.
            # Make sure its outstanding Queue.get() tasks don't survive it.
            tasks = []

            if outbound_task is not None:
                tasks.append(outbound_task)

            if market_task is not None:
                tasks.append(market_task)

            for task in tasks:
                if not task.done():
                    task.cancel()

            await asyncio.gather(
                *tasks,
                return_exceptions=True,
            )

    reader_task = asyncio.create_task(
        reader()
    )

    writer_task = asyncio.create_task(
        writer()
    )

    try:

        done, pending = await asyncio.wait(
            {
                reader_task,
                writer_task,
            },
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()

        await asyncio.gather(
            *pending,
            return_exceptions=True,
        )

        for task in done:

            try:
                task.result()

            except WebSocketDisconnect:

                print(
                    f"WebSocket client disconnected: "
                    f"subscriber={subscriber.subscriber_id}"
                )

            except asyncio.CancelledError:
                pass

            except Exception:
                raise

    finally:

        # Retrieve any exception from the task that completed
        # after the first task finished.
        for task in done:
            if not task.cancelled():
                try:
                    task.exception()
                except asyncio.CancelledError:
                    pass

        await market_store.unsubscribe(subscriber)