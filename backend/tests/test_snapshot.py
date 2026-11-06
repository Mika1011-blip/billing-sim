"""The dev-page contract: the frontend renders from `frontend/src/test-fixtures/dev-snapshot.json`, which is the
backend's own output for the fallback scenario. If a dev route's shape changes this fails until the file is
regenerated: `python -m billing_sim.cli snapshot ../frontend/src/test-fixtures/dev-snapshot.json` (from backend/),
or run pytest with `--update-snapshot`."""

import json
from pathlib import Path

from billing_sim.cli import snapshot_data, write_snapshot

SNAPSHOT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "test-fixtures" / "dev-snapshot.json"


def test_frontend_snapshot_matches_the_backend(request):
    if request.config.getoption("--update-snapshot", default=False):
        write_snapshot(SNAPSHOT)
    assert SNAPSHOT.exists(), "run: python -m billing_sim.cli snapshot " + str(SNAPSHOT)
    on_disk = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert on_disk == snapshot_data(), "dev-snapshot.json is stale: re-run pytest with --update-snapshot"


def test_snapshot_exercises_what_the_dev_page_draws():
    data = snapshot_data()
    assert data["clock"]["day"] == data["clock"]["last_day"]
    assert {e["type"] for e in data["timeline"]["events"]} >= {"blocked", "unblocked"}
    assert any(p["amount"] > 0 for p in data["timeline"]["payments"])
    assert all(i["lot"] or i["ticket"] for i in data["timeline"]["invoices"])
