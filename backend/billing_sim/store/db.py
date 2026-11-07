"""SQLite connection, schema, wipe, and the two lookups every query module needs."""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import date
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
# Bump whenever schema.sql changes shape (a new column, a dropped table). An older database is rebuilt on connect.
SCHEMA_VERSION = 2

_log = logging.getLogger("billing_sim.store")

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
    _apply_schema(conn)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _apply_schema(conn: sqlite3.Connection) -> None:
    """Create the tables, or rebuild them when the file was written by another schema version.

    Everything runs in one transaction (SQLite DDL and `user_version` are transactional), so a failure leaves the
    file as it was. Foreign keys stay off while tables are dropped; `connect` turns them on afterwards.
    """
    old_version = conn.execute("PRAGMA user_version").fetchone()[0]
    existing = [
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    ]
    rebuild = bool(existing) and old_version != SCHEMA_VERSION
    statements = ["BEGIN"]
    if rebuild:
        known = set(_TABLES)
        for table in [*_TABLES, *(name for name in existing if name not in known)]:
            statements.append(f'DROP TABLE IF EXISTS "{table}"')
    statements.append(SCHEMA_PATH.read_text(encoding="utf-8"))
    statements.append(f"PRAGMA user_version = {SCHEMA_VERSION}")
    statements.append("COMMIT")
    script = ";\n".join(statements) + ";"
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.executescript(script)
    except BaseException:
        conn.rollback()
        raise
    if rebuild:
        _log.warning("schema version %s → %s: database rebuilt, scenario discarded", old_version, SCHEMA_VERSION)


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
