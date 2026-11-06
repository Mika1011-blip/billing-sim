"""SQLite connection, schema, wipe, and the two lookups every query module needs."""

from __future__ import annotations

import json
import sqlite3
from datetime import date
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# Child tables first, so foreign keys never block the deletes.
_TABLES = (
    "payment",
    "approval",
    "invoice",
    "ticket_event",
    "ticket_dependency",
    "ticket",
    "lot",
    "sprint",
    "team_member",
    "contract",
    "scenario",
)


class NotFound(KeyError):
    """A ticket, lot or invoice key that does not exist (or does not exist yet as of the asked day)."""

    def __str__(self) -> str:  # KeyError would repr() the message
        return str(self.args[0]) if self.args else ""


def connect(path: str | Path = ":memory:") -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    return conn


def clear_rows(conn: sqlite3.Connection) -> None:
    """Delete every row and put the clock back at 0, without committing (callers own the transaction)."""
    for table in _TABLES:
        conn.execute(f"DELETE FROM {table}")
    conn.execute("INSERT OR IGNORE INTO clock (id, current_day) VALUES (1, 0)")
    conn.execute("UPDATE clock SET current_day = 0")


def wipe(conn: sqlite3.Connection) -> None:
    with conn:
        clear_rows(conn)


def start_date(conn: sqlite3.Connection) -> date:
    row = conn.execute("SELECT start_date FROM scenario").fetchone()
    if row is None:
        raise NotFound("no scenario loaded")
    return date.fromisoformat(row["start_date"])


def contract_data(conn: sqlite3.Connection) -> dict:
    """The contract snapshot exactly as loaded (`Contract.to_dict()`)."""
    row = conn.execute("SELECT data FROM contract").fetchone()
    if row is None:
        raise NotFound("no scenario loaded")
    return json.loads(row["data"])
