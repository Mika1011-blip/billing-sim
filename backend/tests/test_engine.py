import json
import subprocess
import sys

from billing_sim.engine.clock import get_day, last_day, set_day, step


def test_set_day_clamps_low(conn):
    assert set_day(conn, -5) == 0
    assert get_day(conn) == 0


def test_set_day_clamps_high(conn):
    assert set_day(conn, 10**6) == last_day(conn)
    assert get_day(conn) == last_day(conn)


def test_set_day_in_range(conn):
    assert set_day(conn, 12) == 12
    assert get_day(conn) == 12


def test_step_from_zero(conn):
    assert get_day(conn) == 0
    assert step(conn, 3) == 3
    assert step(conn, -10) == 0


def test_last_day_matches_timeline(conn, timeline):
    assert last_day(conn) == timeline.last_day


def _cli(*args):
    return subprocess.run(
        [sys.executable, "-m", "billing_sim.cli", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )


def test_cli_load_day_summary(tmp_path):
    db = str(tmp_path / "sim.sqlite")
    _cli("load", "--db", db)

    out = json.loads(_cli("summary", "--day", "40", "--db", db).stdout)
    assert "contracte" in out
    assert out["facture"] > 0

    assert json.loads(_cli("day", "12", "--db", db).stdout)["jour"] == 12
    assert json.loads(_cli("summary", "--db", db).stdout) == json.loads(_cli("summary", "--day", "12", "--db", db).stdout)


def test_cli_load_is_reproducible_and_resets_clock(tmp_path):
    db = str(tmp_path / "sim.sqlite")
    _cli("load", "--seed", "7", "--db", db)
    _cli("day", "20", "--db", db)
    first = json.loads(_cli("summary", "--day", "60", "--db", db).stdout)
    _cli("load", "--seed", "7", "--db", db)
    assert json.loads(_cli("summary", "--db", db).stdout)["facture"] == 0  # clock back to day 0
    assert json.loads(_cli("summary", "--day", "60", "--db", db).stdout) == first
