"""The frontend contracts: the dev and client pages render from `frontend/src/test-fixtures/dev-snapshot.json` and
`client-snapshot.json`, which are the backend's own output for the fallback scenario. If a route's shape changes these
fail until the files are regenerated: run pytest with `--update-snapshot` (rewrites both), or for the dev snapshot
alone `python -m billing_sim.cli snapshot ../frontend/src/test-fixtures/dev-snapshot.json` (from backend/)."""

import json
from datetime import date
from pathlib import Path

from billing_sim.billing.policy import load_contract
from billing_sim.cli import (
    DEFAULT_START,
    FIXTURE_REQUEST,
    snapshot_data,
    write_snapshot,
)
from billing_sim.engine.clock import last_day, set_day
from billing_sim.engine.payments import pay_invoice
from billing_sim.expander.expand import expand
from billing_sim.scenario.fixture import load_fixture
from billing_sim.store.db import connect
from billing_sim.store.load import load_scenario
from billing_sim.store.queries import (
    list_invoices,
    list_lots,
    list_tickets,
    summary,
    ticket_history,
    today,
)

SNAPSHOT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "test-fixtures" / "dev-snapshot.json"
CLIENT_SNAPSHOT = SNAPSHOT.with_name("client-snapshot.json")


def client_snapshot_data() -> dict:
    """The client page at the end of the fallback run (seed 42), after the participant paid the first invoice on day
    20 and the second on the last day; the others stay unpaid."""
    plan, contract = load_fixture(), load_contract()
    start = date.fromisoformat(DEFAULT_START)
    conn = connect(":memory:")
    try:
        load_scenario(
            conn, plan=plan, contract=contract, timeline=expand(plan, contract, seed=42, start_date=start),
            request_text=FIXTURE_REQUEST, seed=42, start_date=start,
        )  # fmt: skip
        end = last_day(conn)
        first, second = (i["numero"] for i in list_invoices(conn, end)[:2])
        for day, number in ((20, first), (end, second)):
            set_day(conn, day)
            pay_invoice(conn, number)
        day = set_day(conn, end)
        return {
            "day": day,
            "today": today(conn, day),
            "summary": summary(conn, day),
            "invoices": list_invoices(conn, day),
            "tickets": list_tickets(conn, day),
            "lots": list_lots(conn, day),
            "history": {"BANK-5": ticket_history(conn, day, "BANK-5")},
        }
    finally:
        conn.close()


def test_frontend_snapshot_matches_the_backend(request):
    if request.config.getoption("--update-snapshot", default=False):
        write_snapshot(SNAPSHOT)
    assert SNAPSHOT.exists(), "run: python -m billing_sim.cli snapshot " + str(SNAPSHOT)
    on_disk = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert on_disk == snapshot_data(), "dev-snapshot.json is stale: re-run pytest with --update-snapshot"


def test_client_snapshot_matches(request):
    data = client_snapshot_data()
    if request.config.getoption("--update-snapshot", default=False):
        text = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        CLIENT_SNAPSHOT.write_bytes(text.encode("utf-8"))
    assert CLIENT_SNAPSHOT.exists(), "run pytest with --update-snapshot to write " + str(CLIENT_SNAPSHOT)
    on_disk = json.loads(CLIENT_SNAPSHOT.read_text(encoding="utf-8"))
    assert on_disk == data, "client-snapshot.json is stale: re-run pytest with --update-snapshot"


def test_client_snapshot_exercises_what_the_client_page_draws():
    data = client_snapshot_data()
    statuses = [i["statut"] for i in data["invoices"]]
    assert statuses.count("Payée") == 2 and "Très en retard" in statuses
    assert set(statuses) <= {"À payer", "En retard", "Très en retard", "Payée"}
    assert data["day"] == data["today"]["jour"]
    assert data["summary"]["en_retard_nombre"] == statuses.count("En retard") + statuses.count("Très en retard")
    assert data["history"]["BANK-5"] and all(t["etapes"] for t in data["tickets"])


def test_snapshot_exercises_what_the_dev_page_draws():
    data = snapshot_data()
    assert data["clock"]["day"] == data["clock"]["last_day"]
    assert {e["type"] for e in data["timeline"]["events"]} >= {"blocked", "unblocked"}
    assert data["timeline"]["payments"] == []  # nobody pays by script: payments are the participant's at runtime
    assert "client_behaviour" not in data["plan"]["scenario"]
    assert all(lot["delivery_summary"] for lot in data["plan"]["lots"])
    assert all(len(t["steps"]) >= 2 for t in data["plan"]["tickets"])
    assert all(i["lot"] or i["ticket"] for i in data["timeline"]["invoices"])
