"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import Callable

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


def lazy_client(settings_source: Callable[[], Settings]) -> Callable[[], anthropic.Anthropic | None]:
    """A factory that reads the settings on each call, so a key added to `.env` later works without a restart.

    The SDK client is rebuilt only when the key changes; no key means no client (the agent answers with an error event)."""
    cached: dict[str, anthropic.Anthropic] = {}

    def factory() -> anthropic.Anthropic | None:
        key = settings_source().anthropic_api_key
        if not key:
            return None
        if key not in cached:
            cached.clear()
            cached[key] = anthropic.Anthropic(api_key=key)
        return cached[key]

    return factory


def build_agent(settings: Settings | None = None) -> ClientAgent:
    """The one client agent of the app. Explicit settings are fixed; none means `get_settings()` on each use."""
    source = (lambda: settings) if settings is not None else get_settings
    initial = source()
    server = build_server(lambda: connect(source().db_path))
    return ClientAgent(None, server, initial.model, client_factory=lazy_client(source))


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="billing-sim")
    app.state.agent = build_agent(settings)
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
