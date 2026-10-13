from fastapi import FastAPI

from app.api.v1.router import router as api_router

from app.integrations.perpl.perpl_ws import run
import asyncio
from contextlib import asynccontextmanager
from app.api.v1.market_websocket import router as market_ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):

    perpl_task = asyncio.create_task(
        run()
    )

    app.state.perpl_task = perpl_task

    try:
        yield

    finally:
        perpl_task.cancel()

        try:
            await perpl_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Monad Mobile Trading API",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(api_router)
app.include_router(market_ws_router)

app.get("/")
async def root():
    return {"message": "Welcome to the Monad Mobile Trading API!"}