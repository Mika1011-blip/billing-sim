"""FastAPI application factory."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from billing_sim.api import routes_dev, routes_setup, routes_sim
from billing_sim.api.deps import Settings, get_settings
from billing_sim.store.db import NotFound

FRONTEND_ORIGIN = "http://localhost:5173"


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="billing-sim")
    if settings is not None:
        app.dependency_overrides[get_settings] = lambda: settings
    app.add_middleware(
        CORSMiddleware, allow_origins=[FRONTEND_ORIGIN], allow_methods=["*"], allow_headers=["*"]
    )  # fmt: skip

    @app.exception_handler(NotFound)
    async def not_found(_: Request, error: NotFound):
        return JSONResponse({"detail": str(error)}, status_code=404)

    app.include_router(routes_setup.router)
    app.include_router(routes_sim.router)
    app.include_router(routes_dev.router)
    # Task 7 adds the /client router here.
    return app
