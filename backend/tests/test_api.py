import os

import pytest
from fastapi.testclient import TestClient

from billing_sim.api.app import create_app
from billing_sim.api.deps import Settings, get_settings, settings_from
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


def test_fallback_needs_no_request_text(client):
    r = client.post("/setup/generate", json={"request_text": "", "fallback": True})
    assert r.status_code == 200
    assert r.json()["kind"] == "plan"
    assert client.get("/dev/plan").json()["scenario"]["request_text"].strip()


def test_generate_uses_given_seed(client):
    assert generate(client, seed=7).json()["seed"] == 7


def test_blank_request_422_without_haiku(client, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("haiku must not be called for a blank request")

    monkeypatch.setattr(haiku, "generate_plan", boom)
    r = client.post("/setup/generate", json={"request_text": "   "})
    assert r.status_code == 422
    assert "empty" in r.json()["reason"]


def test_generate_without_key_400(client):
    r = client.post("/setup/generate", json={"request_text": "un tableau de bord", "fallback": False})
    assert r.status_code == 400
    assert "API key" in r.json()["detail"]


def test_settings_key_reaches_haiku(tmp_path, monkeypatch):
    seen = {}

    def fake(request_text, contract, *, client=None, model, api_key=None):
        seen["api_key"] = api_key
        raise haiku.GenerationFailed("{oops")

    monkeypatch.setattr(haiku, "generate_plan", fake)
    settings = Settings(db_path=tmp_path / "sim.sqlite", anthropic_api_key="dummy")
    with TestClient(create_app(settings)) as c:
        assert c.post("/setup/generate", json={"request_text": "x"}).status_code == 502
    assert seen["api_key"] == "dummy"


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
        raise haiku.GenerationFailed("{oops", "bad json")

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
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-test")
    assert get_settings().anthropic_api_key == "sk-test"


def test_anthropic_key_wins_over_claude_key():
    env = {"ANTHROPIC_API_KEY": "a", "CLAUDE_API_KEY": "c"}
    assert settings_from(env).anthropic_api_key == "a"
    assert settings_from({}).anthropic_api_key is None


def test_env_file_is_read_without_touching_os_environ(tmp_path, monkeypatch):
    env_file = tmp_path / "repo.env"
    env_file.write_text("CLAUDE_API_KEY=dummy" + chr(10) + "SIM_DB_PATH=from-env-file.sqlite" + chr(10), encoding="utf-8")
    monkeypatch.setenv("BILLING_SIM_ENV_FILE", str(env_file))
    settings = get_settings()
    assert settings.anthropic_api_key == "dummy"
    assert settings.db_path.name == "from-env-file.sqlite"
    assert "CLAUDE_API_KEY" not in os.environ


def test_real_environment_beats_env_file(tmp_path, monkeypatch):
    env_file = tmp_path / "repo.env"
    env_file.write_text("CLAUDE_API_KEY=from-file" + chr(10), encoding="utf-8")
    monkeypatch.setenv("BILLING_SIM_ENV_FILE", str(env_file))
    monkeypatch.setenv("CLAUDE_API_KEY", "from-env")
    assert get_settings().anthropic_api_key == "from-env"


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


def test_reset_wipes_scenario(client):
    generate(client)
    client.put("/sim/clock", json={"day": 5})
    r = client.post("/sim/reset")
    assert r.status_code == 200
    assert r.json() == {"status": "reset"}
    assert client.get("/sim/clock").status_code == 404
    assert client.get("/client/summary").status_code == 404


def test_reset_without_scenario_is_ok(client):
    assert client.post("/sim/reset").status_code == 200


def test_reset_then_generate_starts_at_day_zero(client):
    generate(client)
    client.put("/sim/clock", json={"day": 7})
    client.post("/sim/reset")
    generate(client)
    assert client.get("/sim/clock").json()["day"] == 0


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
    assert len(client.get("/dev/agent-tools").json()) == 13  # the client MCP server's tools (see test_wiring)


def test_dev_ticket_404(client):
    generate(client)
    assert client.get("/dev/ticket/BANK-999").status_code == 404


def test_cors_allows_vite_origin(client):
    r = client.get("/sim/clock", headers={"Origin": "http://localhost:5173"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
