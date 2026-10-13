import asyncio
import json
import os
import time

import websockets
from dotenv import load_dotenv

from app.integrations.perpl.market_store import market_store


load_dotenv()

PERPL_WS_URL = os.getenv("PERPL_WS_URL")
PERPL_CHAIN_ID = int(os.getenv("PERPL_CHAIN_ID", "10143"))


async def connect_to_perpl():
    url = f"{PERPL_WS_URL}/ws/v1/market-data"

    async with websockets.connect(
        url,
        ping_interval=20,
        ping_timeout=20,
        ) as websocket:
        print("Connected to Perpl market WebSocket")
        

        last_heartbeat_sn = None

        subscription = {
            "mt": 5,
            "subs": [
                {
                    "stream": f"market-state@{PERPL_CHAIN_ID}",
                    "subscribe": True,
                },
                {
                    "stream": f"heartbeat@{PERPL_CHAIN_ID}",
                    "subscribe": True,
                },
                {
                    "stream": "order-book@16",
                    "subscribe": True,
                },
            ],
        }

        await websocket.send(json.dumps(subscription))

        print("Subscription request sent")
        await market_store.set_feed_health(True)


        try:
            while True:
                message = await websocket.recv()
                data = json.loads(message)

                last_heartbeat_sn = await handle_message(
                    data,
                    last_heartbeat_sn,
                )

        finally:
            await market_store.set_feed_health(False)
            print("Perpl WebSocket connection closed")


def handle_ping_response(data: dict):
    sequence = data.get("sn")
    timestamp = data.get("t")

    print(
        f"Perpl heartbeat response: "
        f"sn={sequence}, "
        f"t={timestamp}"
    )


async def handle_message(
    data: dict,
    last_heartbeat_sn: int | None,
):
    message_type = data.get("mt")

    if message_type == 6:
        handle_subscription_response(data)

    elif message_type == 9:
        await handle_market_state(data)

    elif message_type == 15:
        handle_order_book_snapshot(data)

    elif message_type == 16:
        handle_order_book_update(data)

    elif message_type == 100:
        last_heartbeat_sn = handle_heartbeat(
            data,
            last_heartbeat_sn,
        )

    elif message_type == 2:
        handle_ping_response(data)

    else:
        print("Unknown message:", data)

    return last_heartbeat_sn


def handle_subscription_response(data: dict):
    for subscription in data.get("subs", []):
        stream = subscription.get("stream")
        sid = subscription.get("sid")
        status = subscription.get("status", {})

        code = status.get("code")
        error = status.get("error")

        if code == 0:
            print(
                f"Subscribed: "
                f"{stream} "
                f"(sid={sid})"
            )
        else:
            print(
                f"Subscription failed: "
                f"{stream} "
                f"code={code} "
                f"error={error}"
            )

async def handle_market_state(data: dict):
    markets = data.get("d", {})

    await market_store.update_markets(markets)

def handle_order_book_snapshot(data: dict):
    bids = data.get("bid", [])
    asks = data.get("ask", [])

    print(
        f"Order book snapshot: "
        f"bids={len(bids)}, "
        f"asks={len(asks)}, "
        f"sequence={data.get('sn')}"
    )

def handle_order_book_update(data: dict):
    bids = data.get("bid", [])
    asks = data.get("ask", [])

    print(
        f"Order book update: "
        f"bids={len(bids)}, "
        f"asks={len(asks)}, "
        f"sequence={data.get('sn')}"
    )


def handle_heartbeat(
    data: dict,
    last_heartbeat_sn: int | None,
):
    sequence = data.get("sn")
    head_block = data.get("h")

    if sequence is None:
        print("Heartbeat missing sequence number")
        return last_heartbeat_sn

    if last_heartbeat_sn is not None:
        expected = last_heartbeat_sn + 1

        if sequence != expected:
            raise RuntimeError(
                "Heartbeat sequence gap: "
                f"expected={expected}, "
                f"received={sequence}"
            )

    return sequence


import random


async def run():
    retry_delay = 1

    while True:

        print("Starting Perpl connection...")

        try:
            await connect_to_perpl()

        except Exception as exc:
            import traceback

            print(
                f"Perpl connection error: {exc}"
            )

            traceback.print_exc()

            retry_delay = min(
                retry_delay * 2,
                8,
            )

            jitter = random.uniform(
                0,
                retry_delay * 0.2,
            )

            delay = min(
                retry_delay + jitter,
                8,
            )

            print(
                f"Reconnecting in "
                f"{delay:.2f} seconds..."
            )

            await asyncio.sleep(delay)

if __name__ == "__main__":
    asyncio.run(run())