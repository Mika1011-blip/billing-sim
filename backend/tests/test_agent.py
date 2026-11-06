import json
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from billing_sim.agent.loop import (
    ERROR_NO_DATA,
    ERROR_NO_KEY,
    ERROR_UNUSABLE,
    ClientAgent,
    trim_history,
)
from billing_sim.agent.prompt import SYSTEM_PROMPT_FR
from billing_sim.agent.tools import anthropic_tool_defs, dispatch
from billing_sim.api.app import create_app
from billing_sim.api.deps import Settings
from billing_sim.engine.clock import set_day
from billing_sim.mcp_client.server import build_server
from billing_sim.store.db import connect

TOOLS = [
    "get_today", "get_contract", "get_summary", "list_lots", "get_lot", "list_tickets", "get_ticket",
    "get_ticket_history", "list_invoices", "get_invoice", "list_payments", "list_pending_approvals", "explain_price",
]  # fmt: skip
ANSWER = "Le reste à payer est de 2 400 € [F-2026-001]."


class _KeepOpen:
    def __init__(self, conn):
        self._conn = conn

    def close(self):
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


class FakeStream:
    def __init__(self, deltas, final):
        self.deltas, self.final = deltas, final

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        yield SimpleNamespace(type="message_start")
        for text in self.deltas:
            yield SimpleNamespace(
                type="content_block_delta",
                delta=SimpleNamespace(type="text_delta", text=text),
            )
        yield SimpleNamespace(type="message_stop")

    def get_final_message(self):
        return self.final


class FakeClient:
    """`messages.stream(**kwargs)` plays the scripted turns in order and records each call's arguments."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.messages = SimpleNamespace(stream=self._stream)

    def _stream(self, **kwargs):
        kwargs["messages"] = list(
            kwargs["messages"]
        )  # the agent mutates its history afterwards
        self.calls.append(kwargs)
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return FakeStream(*step)


def tool_use_turn(name="get_summary", input=None, block_id="toolu_1"):
    block = SimpleNamespace(type="tool_use", id=block_id, name=name, input=input or {})
    return [], SimpleNamespace(stop_reason="tool_use", content=[block])


def answer_turn(text=ANSWER):
    block = SimpleNamespace(type="text", text=text)
    return [text[:12], text[12:]], SimpleNamespace(
        stop_reason="end_turn", content=[block]
    )


def full_script():
    return [tool_use_turn(), answer_turn()]


@pytest.fixture
def server(conn):
    return build_server(lambda: _KeepOpen(conn))


def make_agent(server, script):
    return ClientAgent(FakeClient(script), server, "claude-haiku-5-5")


@pytest.fixture
def agent(server):
    return make_agent(server, full_script() * 3)


async def run(agent, session="s1", message="Combien reste-t-il à payer ?"):
    return [event async for event in agent.chat(session, message)]


async def test_tool_defs_match_server(server):
    defs = await anthropic_tool_defs(server)
    assert [d["name"] for d in defs] == TOOLS
    assert all(d["description"] and d["input_schema"]["type"] == "object" for d in defs)
    assert all(set(d) == {"name", "description", "input_schema"} for d in defs)


async def test_dispatch_returns_json_text_and_error_text(server):
    assert json.loads(await dispatch(server, "get_today", {}))["jour"] == 0
    missing = await dispatch(server, "get_ticket", {"key": "BANK-999"})
    assert isinstance(missing, str) and "BANK-999" in missing
    assert isinstance(await dispatch(server, "no_such_tool", {}), str)
    assert isinstance(await dispatch(server, "get_ticket", {}), str)  # missing argument


async def test_chat_event_sequence(agent):
    events = await run(agent)
    types = [e["type"] for e in events]
    assert types[:3] == ["tool_call", "tool_result", "text"]
    assert types[-1] == "done"
    assert set(types[2:-1]) == {"text"}
    assert events[0] == {"type": "tool_call", "name": "get_summary", "input": {}}
    assert events[1] == {"type": "tool_result", "name": "get_summary"}
    assert "".join(e["text"] for e in events if e["type"] == "text") == ANSWER


async def test_model_call_arguments(agent):
    await run(agent)
    call = agent.client.calls[0]
    assert call["model"] == "claude-haiku-5-5"
    assert call["system"] == SYSTEM_PROMPT_FR
    assert call["max_tokens"] == 4096
    assert [t["name"] for t in call["tools"]] == TOOLS
    assert "tool_choice" not in call


def test_prompt_says_the_client_pays_and_names_the_overdue_tiers():
    assert (
        "Le client règle ses factures depuis son tableau de bord ; tu ne peux pas payer à sa place. Une facture est "
        "*En retard* après sa date d'échéance et *Très en retard* 30 jours après ; rappelle les montants et les dates."
    ) in SYSTEM_PROMPT_FR
    assert "Très en retard" in SYSTEM_PROMPT_FR


async def test_tool_dispatched_against_clock(agent):
    await run(agent)
    second = agent.client.calls[1]["messages"]
    assistant, results = second[-2], second[-1]
    assert (
        assistant["role"] == "assistant" and assistant["content"][0].type == "tool_use"
    )
    assert results["role"] == "user"
    (result,) = results["content"]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "toolu_1"
    assert json.loads(result["content"])["facture"] == 0


async def test_all_tool_results_in_one_user_message(server):
    blocks = [
        SimpleNamespace(type="tool_use", id="a", name="get_today", input={}),
        SimpleNamespace(type="tool_use", id="b", name="list_lots", input={}),
    ]
    both = ([], SimpleNamespace(stop_reason="tool_use", content=blocks))
    agent = make_agent(server, [both, answer_turn()])
    events = await run(agent)
    assert [e["type"] for e in events] == [
        "tool_call",
        "tool_result",
        "tool_call",
        "tool_result",
        "text",
        "text",
        "done",
    ]
    last = agent.client.calls[1]["messages"][-1]
    assert [r["tool_use_id"] for r in last["content"]] == ["a", "b"]


async def test_tool_error_is_passed_back_to_the_model(server):
    missing = tool_use_turn("get_ticket", {"key": "BANK-999"})
    agent = make_agent(server, [missing, answer_turn("Introuvable.")])
    events = await run(agent)
    assert events[-1] == {"type": "done"}
    (result,) = agent.client.calls[1]["messages"][-1]["content"]
    assert "BANK-999" in result["content"]


async def test_history_kept_per_session(agent):
    await run(agent, "a")
    first_len = len(agent.client.calls[0]["messages"])
    await run(agent, "a")
    assert first_len == 1
    assert len(agent.client.calls[2]["messages"]) >= 3
    await run(agent, "b")
    assert len(agent.client.calls[4]["messages"]) == 1


NEW_DATE = {"type": "info", "message": "Nouvelle date : la conversation repart de zéro."}


async def test_clock_change_starts_a_fresh_conversation(server, conn):
    agent = make_agent(server, full_script() * 4)
    set_day(conn, 30)
    await run(agent)
    events = await run(agent)  # same day: the history carries over, no notice
    assert NEW_DATE not in events
    assert len(agent.client.calls[2]["messages"]) >= 3

    set_day(conn, 10)  # scrubbed back: everything the model saw at day 30 is the future
    events = await run(agent)
    assert events[0] == NEW_DATE
    assert events.count(NEW_DATE) == 1
    assert len(agent.client.calls[4]["messages"]) == 1
    assert agent.client.calls[4]["messages"][0]["content"] == "Combien reste-t-il à payer ?"

    set_day(conn, 50)  # forward moves reset too: the earlier answers describe a stale date
    events = await run(agent)
    assert events[0] == NEW_DATE
    assert len(agent.client.calls[6]["messages"]) == 1


def test_trim_history_keeps_last_40_from_a_user_turn():
    history = []
    for i in range(30):
        history += [
            {"role": "user", "content": f"q{i}"},
            {"role": "assistant", "content": [SimpleNamespace(type="tool_use")]},
            {"role": "user", "content": [{"type": "tool_result"}]},
            {"role": "assistant", "content": [SimpleNamespace(type="text")]},
        ]
    kept = trim_history(history)
    assert len(kept) <= 40
    assert kept[0]["role"] == "user" and isinstance(kept[0]["content"], str)
    assert kept[-1] is history[-1]


async def test_error_event_when_no_scenario(server):
    agent = make_agent(build_server(lambda: connect(":memory:")), full_script())
    events = await run(agent)
    assert events == [{"type": "error", "message": ERROR_NO_DATA}, {"type": "done"}]
    assert agent.client.calls == []


async def test_error_event_when_api_fails_and_history_recovers(server):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    agent = make_agent(
        server,
        [tool_use_turn(), anthropic.APIConnectionError(request=request), answer_turn()],
    )
    events = await run(agent)
    assert [e["type"] for e in events] == ["tool_call", "tool_result", "error", "done"]
    assert events[2]["message"] == ERROR_NO_DATA
    assert agent.sessions["s1"][1] == []  # the half-finished exchange is rolled back
    events = await run(agent)
    assert events[-1] == {"type": "done"}
    assert len(agent.client.calls[-1]["messages"]) == 1


async def test_max_turns_ends_with_error(server):
    agent = ClientAgent(FakeClient([tool_use_turn()] * 2), server, "m", max_turns=2)
    events = await run(agent)
    assert [e["type"] for e in events][-2:] == ["error", "done"]


async def test_no_client_yields_no_key_error(server):
    events = await run(ClientAgent(None, server, "m"))
    assert events == [{"type": "error", "message": ERROR_NO_KEY}, {"type": "done"}]


# --- the route -------------------------------------------------------------------------------------------------


def sse(response):
    return [
        json.loads(line[len("data: ") :])
        for line in response.text.split("\n\n")
        if line.startswith("data: ")
    ]


@pytest.fixture
def app_client(tmp_path):
    app = create_app(
        Settings(db_path=tmp_path / "sim.sqlite", anthropic_api_key="test-key")
    )
    with TestClient(app) as test_client:
        yield test_client


def test_chat_route_streams_sse(app_client, tmp_path):
    assert (
        app_client.post(
            "/setup/generate", json={"request_text": "x", "fallback": True}
        ).status_code
        == 200
    )
    app_client.app.state.agent.client = FakeClient(full_script())
    response = app_client.post(
        "/client/chat", json={"session_id": "s", "message": "Bonjour"}
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    events = sse(response)
    assert events[0]["type"] == "tool_call" and events[-1] == {"type": "done"}
    assert "[F-2026-001]" in "".join(e.get("text", "") for e in events)


def test_chat_route_without_scenario_reports_error(app_client):
    response = app_client.post(
        "/client/chat", json={"session_id": "s", "message": "Bonjour"}
    )
    assert sse(response) == [
        {"type": "error", "message": ERROR_NO_DATA},
        {"type": "done"},
    ]


def test_chat_route_without_api_key(tmp_path):
    with TestClient(create_app(Settings(db_path=tmp_path / "sim.sqlite"))) as client:
        response = client.post(
            "/client/chat", json={"session_id": "s", "message": "Bonjour"}
        )
    assert response.status_code == 200
    assert sse(response) == [
        {"type": "error", "message": ERROR_NO_KEY},
        {"type": "done"},
    ]


@pytest.mark.parametrize(
    "body",
    [
        {"session_id": "s", "message": "   "},
        {"session_id": "s", "message": ""},
        {"session_id": "s"},
    ],
)
def test_chat_route_rejects_blank_message(app_client, body):
    assert app_client.post("/client/chat", json=body).status_code == 422


async def test_api_error_is_logged_with_its_class_name(server, caplog):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    agent = make_agent(server, [anthropic.APIConnectionError(request=request)])
    with caplog.at_level("ERROR", logger="billing_sim.agent.loop"):
        events = await run(agent)
    assert events[-2]["type"] == "error"
    assert any(
        "APIConnectionError" in r.getMessage() and r.exc_info for r in caplog.records
    )


async def test_precheck_failure_is_logged(caplog):
    agent = make_agent(build_server(lambda: connect(":memory:")), [])
    with caplog.at_level("ERROR", logger="billing_sim.agent.loop"):
        await run(agent)
    assert any("get_today" in r.getMessage() for r in caplog.records)


async def test_empty_end_turn_is_an_error_and_history_unchanged(server):
    empty = ([], SimpleNamespace(stop_reason="end_turn", content=[]))
    agent = make_agent(server, [empty])
    events = await run(agent)
    assert events == [{"type": "error", "message": ERROR_UNUSABLE}, {"type": "done"}]
    assert agent.sessions["s1"][1] == []


async def test_max_tokens_inside_tool_use_is_an_error_and_session_still_works(server):
    cut = tool_use_turn()[1]
    cut.stop_reason = "max_tokens"
    agent = make_agent(server, [([], cut), answer_turn()])
    events = await run(agent)
    assert events == [{"type": "error", "message": ERROR_UNUSABLE}, {"type": "done"}]
    assert agent.sessions["s1"][1] == []
    agent.client.script.insert(0, tool_use_turn())
    events = await run(agent)
    assert events[-1] == {"type": "done"} and "error" not in [e["type"] for e in events]
    assert len(agent.client.calls[1]["messages"]) == 1


async def test_tool_error_result_is_flagged(server):
    agent = make_agent(
        server,
        [tool_use_turn("get_ticket", {"key": "BANK-999"}), answer_turn("Introuvable.")],
    )
    await run(agent)
    (result,) = agent.client.calls[1]["messages"][-1]["content"]
    assert result["is_error"] is True


async def test_successful_tool_result_has_no_error_flag(agent):
    await run(agent)
    (result,) = agent.client.calls[1]["messages"][-1]["content"]
    assert "is_error" not in result
