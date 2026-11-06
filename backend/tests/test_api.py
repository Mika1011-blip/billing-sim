import pytest
from fastapi.testclient import TestClient

from billing_sim.api.app import create_app
from billing_sim.api.deps import Settings, get_settings
from billing_sim.scenario import haiku


@pytest.fixture
def client(tmp_path):
    settings = Settings(db_path=tmp_path / "sim.sqlite")
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def generate(client, **body):
    return client.post("/setup/generate", json={"request_text": "x", "fallback": True, **body})


def test_generate_fallback(client):
    r = generate(client)
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "plan"
    assert len(body["plan"]["lots"]) == 3
    assert isinstance(body["seed"], int)
    assert isinstance(body["warnings"], list)


def test_generate_uses_given_seed(client):
    assert generate(client, seed=7).json()["seed"] == 7


def test_blank_request_422_without_haiku(client, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("haiku must not be called for a blank request")

    monkeypatch.setattr(haiku, "generate_plan", boom)
    r = client.post("/setup/generate", json={"request_text": "   "})
    assert r.status_code == 422
    assert "empty" in r.json()["reason"]


def test_generate_without_key_400(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CLAUDE_API_KEY", raising=False)
    r = client.post("/setup/generate", json={"request_text": "un tableau de bord", "fallback": False})
    assert r.status_code == 400
    assert "ANTHROPIC_API_KEY" in r.json()["detail"]


def test_rejection_is_422_with_reason_and_keeps_store(client, monkeypatch):
    generate(client)
    from billing_sim.scenario.schema import GenerationResult

    monkeypatch.setattr(
        haiku, "generate_plan", lambda *a, **k: GenerationResult(kind="rejection", reason="not a software project")
    )
    r = client.post("/setup/generate", json={"request_text": "un gâteau"})
    assert r.status_code == 422
    assert r.json() == {"reason": "not a software project"}
    assert client.get("/dev/plan").status_code == 200  # previous scenario untouched


def test_generation_failed_is_502_with_raw(client, monkeypatch):
    def fail(*args, **kwargs):
        error = haiku.GenerationFailed("bad json")
        error.raw = "{oops"
        raise error

    monkeypatch.setattr(haiku, "generate_plan", fail)
    r = client.post("/setup/generate", json={"request_text": "x"})
    assert r.status_code == 502
    assert r.json() == {"detail": "bad json", "raw": "{oops"}


def test_invalid_plan_is_422(client, monkeypatch):
    from billing_sim.scenario.fixture import load_fixture
    from billing_sim.scenario.schema import GenerationResult

    plan = load_fixture()
    plan.tickets[1].key = plan.tickets[0].key  # duplicate key
    monkeypatch.setattr(haiku, "generate_plan", lambda *a, **k: GenerationResult(kind="plan", plan=plan))
    r = client.post("/setup/generate", json={"request_text": "x"})
    assert r.status_code == 422
    assert "duplicate" in r.json()["reason"].lower()


def test_claude_api_key_accepted(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-test")
    assert get_settings().anthropic_api_key == "sk-test"


def test_clock_before_generate_is_404(client):
    assert client.get("/sim/clock").status_code == 404


def test_clock_and_step(client):
    generate(client)
    clock = client.get("/sim/clock").json()
    assert clock["day"] == 0
    assert clock["date"] == "2026-03-02"
    assert clock["last_day"] > 0
    assert client.put("/sim/clock", json={"day": 5}).json()["day"] == 5
    assert client.post("/sim/step", json={"n": 3}).json()["day"] == 8
    assert client.post("/sim/step", json={"n": -100}).json()["day"] == 0


def test_clock_clamps(client):
    generate(client)
    last = client.get("/sim/clock").json()["last_day"]
    r = client.put("/sim/clock", json={"day": 999999})
    assert r.status_code == 200
    assert r.json()["day"] == last


def test_dev_timeline_includes_future(client):
    generate(client)
    client.put("/sim/clock", json={"day": 0})
    body = client.get("/dev/timeline").json()
    all_days = [e["day"] for events in body.values() if isinstance(events, list) for e in events if "day" in e]
    assert any(d > 0 for d in all_days)


def test_dev_timeline_window(client):
    generate(client)
    everything = client.get("/dev/timeline").json()
    window = client.get("/dev/timeline", params={"from_day": 3, "to_day": 6}).json()
    assert window != everything


def test_dev_plan_ticket_diff_agent_tools(client):
    generate(client)
    plan = client.get("/dev/plan").json()
    key = plan["tickets"][0]["key"]
    assert client.get(f"/dev/ticket/{key}").status_code == 200
    assert client.get("/dev/diff").status_code == 200
    assert client.get("/dev/agent-tools").json() == []


def test_dev_ticket_404(client):
    generate(client)
    assert client.get("/dev/ticket/BANK-999").status_code == 404


def test_cors_allows_vite_origin(client):
    r = client.get("/sim/clock", headers={"Origin": "http://localhost:5173"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
