import asyncio


class OrderBookStore:

    def __init__(self):
        self._books = {}
        self._lock = asyncio.Lock()

    async def apply_snapshot(self, market_id: int, data: dict):
        async with self._lock:
            self._books[market_id] = {
                "bids": {
                    level["p"]: level
                    for level in data.get("bid", [])
                },
                "asks": {
                    level["p"]: level
                    for level in data.get("ask", [])
                },
                "sequence": data.get("sn"),
                "timestamp": data.get("at"),
            }

    async def apply_update(self, market_id: int, data: dict):
        async with self._lock:
            book = self._books.get(market_id)

            if book is None:
                return

            for level in data.get("bid", []):
                price = level["p"]

                if level["o"] == 0:
                    book["bids"].pop(price, None)
                else:
                    book["bids"][price] = level

            for level in data.get("ask", []):
                price = level["p"]

                if level["o"] == 0:
                    book["asks"].pop(price, None)
                else:
                    book["asks"][price] = level

            book["sequence"] = data.get("sn")
            book["timestamp"] = data.get("at")


order_book_store = OrderBookStore()