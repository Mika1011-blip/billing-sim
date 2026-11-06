"""Settings and per-request dependencies shared by every router."""

from __future__ import annotations

import os
import sqlite3
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends

from billing_sim.scenario.haiku import api_key_from_env
from billing_sim.store.db import connect

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_START_DATE = date(2026, 3, 2)  # a Monday: day 0
DEFAULT_MODEL = "claude-haiku-5-5"


@dataclass(frozen=True)
class Settings:
    db_path: Path = Path("./sim.sqlite")
    contract_path: Path | None = None
    model: str = DEFAULT_MODEL
    anthropic_api_key: str | None = None
    start_date: date = DEFAULT_START_DATE


def get_settings() -> Settings:
    """Read the environment (and the repo-root `.env`, which never overrides real variables)."""
    load_dotenv(REPO_ROOT / ".env")
    contract_path = os.environ.get("CONTRACT_TEMPLATE_PATH")
    return Settings(
        db_path=Path(os.environ.get("SIM_DB_PATH", "./sim.sqlite")),
        contract_path=Path(contract_path) if contract_path else None,
        model=os.environ.get("BILLING_SIM_MODEL", DEFAULT_MODEL),
        anthropic_api_key=api_key_from_env(),
        start_date=date.fromisoformat(os.environ.get("SIM_START_DATE", DEFAULT_START_DATE.isoformat())),
    )


async def get_conn(settings: Settings = Depends(get_settings)) -> AsyncIterator[sqlite3.Connection]:
    """One connection per request. `async` on purpose: it then opens on the event-loop thread, where
    `async def` routes also run, so sqlite's same-thread check holds. Routes using it must be `async def`."""
    conn = connect(settings.db_path)
    try:
        yield conn
    finally:
        conn.close()
