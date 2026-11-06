"""Settings and per-request dependencies shared by every router."""

from __future__ import annotations

import os
import sqlite3
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from dotenv import dotenv_values
from fastapi import Depends

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


def env_file() -> Path:
    """The `.env` to read: `BILLING_SIM_ENV_FILE` if set (tests, deployments), else the repo-root one."""
    return Path(os.environ.get("BILLING_SIM_ENV_FILE") or REPO_ROOT / ".env")


def settings_from(env: Mapping[str, str]) -> Settings:
    """Build settings from an explicit mapping: the seam tests use. The API key is `ANTHROPIC_API_KEY`, else `CLAUDE_API_KEY`."""
    contract_path = env.get("CONTRACT_TEMPLATE_PATH")
    return Settings(
        db_path=Path(env.get("SIM_DB_PATH") or "./sim.sqlite"),
        contract_path=Path(contract_path) if contract_path else None,
        model=env.get("BILLING_SIM_MODEL") or DEFAULT_MODEL,
        anthropic_api_key=env.get("ANTHROPIC_API_KEY") or env.get("CLAUDE_API_KEY") or None,
        start_date=date.fromisoformat(env.get("SIM_START_DATE") or DEFAULT_START_DATE.isoformat()),
    )


def get_settings() -> Settings:
    """Settings from the `.env` file merged under the real environment; `os.environ` is never written to."""
    return settings_from({**dotenv_values(env_file()), **os.environ})


async def get_conn(settings: Settings = Depends(get_settings)) -> AsyncIterator[sqlite3.Connection]:
    """One connection per request. `async` on purpose: it then opens on the event-loop thread, where
    `async def` routes also run, so sqlite's same-thread check holds. Routes using it must be `async def`."""
    conn = connect(settings.db_path)
    try:
        yield conn
    finally:
        conn.close()
