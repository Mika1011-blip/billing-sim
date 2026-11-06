"""FastAPI application factory."""

from __future__ import annotations

import anthropic
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from billing_sim.agent.loop import ClientAgent
from billing_sim.api import (
    routes_chat,
    routes_client,
    routes_dev,
    routes_setup,
    routes_sim,
)
from billing_sim.api.deps import Settings, get_settings
from billing_sim.mcp_client.server import build_server
from billing_sim.store.db import NotFound, connect

FRONTEND_ORIGIN = "http://localhost:5173"


def build_agent(settings: Settings) -> ClientAgent:
    """The one client agent of the app; without an API key it still answers, with an error event."""
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key) if settings.anthropic_api_key else None
    server = build_server(lambda: connect(settings.db_path))
    return ClientAgent(client, server, settings.model)


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="billing-sim")
    app.state.agent = build_agent(settings or get_settings())
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
    app.include_router(routes_client.router)
    app.include_router(routes_chat.router)
    return app
