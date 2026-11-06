"""The clock: the one day index every as-of query is read at. Scrubbing only moves this number."""

from __future__ import annotations

import sqlite3


def get_day(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT current_day FROM clock WHERE id = 1").fetchone()[0]


def last_day(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT last_day FROM scenario").fetchone()
    return row[0] if row else 0


def set_day(conn: sqlite3.Connection, d: int) -> int:
    """Move the clock to `d`, clamped to [0, last_day]; returns the day actually set."""
    day = max(0, min(int(d), last_day(conn)))
    with conn:
        conn.execute("UPDATE clock SET current_day = ? WHERE id = 1", (day,))
    return day


def step(conn: sqlite3.Connection, n: int) -> int:
    return set_day(conn, get_day(conn) + n)
