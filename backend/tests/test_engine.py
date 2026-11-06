import json
import subprocess
import sys

import pytest

from billing_sim.engine.clock import get_day, last_day, set_day, step
from billing_sim.engine.payments import AlreadyPaid, pay_invoice
from billing_sim.expander.calendar import date_for_day
from billing_sim.store.db import NotFound, start_date


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


@pytest.fixture
def unpaid(conn):
    """The store as a run starts: no payment rows (the participant is the only one who writes them)."""
    with conn:
        conn.execute("DELETE FROM payment")
    return conn


def _iso(conn, day):
    return date_for_day(start_date(conn), day).isoformat()


def _payment_days(conn, number):
    rows = conn.execute(
        "SELECT day FROM payment WHERE invoice_id = (SELECT id FROM invoice WHERE number = ?)", (number,)
    ).fetchall()
    return [r[0] for r in rows]


def test_pay_records_full_amount_today(unpaid):
    set_day(unpaid, 20)  # F-2026-001 is issued on day 6 in the fixture, TTC 3600
    r = pay_invoice(unpaid, "F-2026-001")
    assert r == {"facture": "F-2026-001", "date": _iso(unpaid, 20), "reference": "VIR-F-2026-001-1", "montant": 3600}
    row = unpaid.execute("SELECT day, amount, reference FROM payment").fetchone()
    assert tuple(row) == (20, 3600, "VIR-F-2026-001-1")


def test_pay_future_invoice_is_not_found(unpaid):
    set_day(unpaid, 0)
    with pytest.raises(NotFound, match="^Enregistrement introuvable : F-2026-001$"):
        pay_invoice(unpaid, "F-2026-001")
    assert _payment_days(unpaid, "F-2026-001") == []


def test_pay_unknown_invoice_is_not_found(unpaid):
    set_day(unpaid, 20)
    with pytest.raises(NotFound, match="^Enregistrement introuvable : F-9999-999$"):
        pay_invoice(unpaid, "F-9999-999")


def test_pay_twice_is_already_paid(unpaid):
    set_day(unpaid, 20)
    pay_invoice(unpaid, "F-2026-001")
    set_day(unpaid, 25)
    with pytest.raises(AlreadyPaid) as caught:
        pay_invoice(unpaid, "F-2026-001")
    assert str(caught.value) == f"Facture déjà payée le {_iso(unpaid, 20)}"
    assert _payment_days(unpaid, "F-2026-001") == [20]


def test_pay_after_rewind_rewrites_future_payment(unpaid):
    set_day(unpaid, 40)
    pay_invoice(unpaid, "F-2026-001")
    set_day(unpaid, 20)
    pay_invoice(unpaid, "F-2026-001")
    assert _payment_days(unpaid, "F-2026-001") == [20]


def test_pay_leaves_other_invoices_payments_alone(unpaid):
    set_day(unpaid, 40)
    pay_invoice(unpaid, "F-2026-002")
    set_day(unpaid, 20)
    pay_invoice(unpaid, "F-2026-001")
    assert _payment_days(unpaid, "F-2026-002") == [40]
