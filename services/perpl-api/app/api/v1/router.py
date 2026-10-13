from fastapi import APIRouter
from fastapi_cloud_cli.cli import app
from app.api.v1.wallet import router as wallet_router
from app.api.v1.health import router as health_router
from app.api.v1.markets import router as markets_router

router = APIRouter(prefix="/api/v1")

router.include_router(wallet_router)
router.include_router(markets_router)
router.include_router(health_router)