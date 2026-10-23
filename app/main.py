from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app import __version__
from app.api.routes import registry, router
from app.exceptions import ModelNotReadyError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(
    title="EnergyIQ ML Service",
    version=__version__,
    description="Household consumption forecasting and analytics. Naive timestamps are interpreted as UTC.",
)
app.include_router(router)


@app.exception_handler(ModelNotReadyError)
async def model_not_ready_handler(request: Request, exc: ModelNotReadyError):
    return JSONResponse(status_code=503, content={"detail": str(exc)})
