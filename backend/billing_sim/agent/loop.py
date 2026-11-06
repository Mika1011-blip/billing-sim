"""The client agent: a streaming tool-use loop over the client MCP tools, with per-session history."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable
from typing import Any

import anthropic
from mcp.server.fastmcp import FastMCP

from billing_sim.agent.prompt import SYSTEM_PROMPT_FR
from billing_sim.agent.tools import anthropic_tool_defs, call_tool

logger = logging.getLogger(__name__)

AgentEvent = dict  # {"type": "text"|"tool_call"|"tool_result"|"info"|"done"|"error", ...}

HISTORY_LIMIT = 40
ERROR_NO_DATA = "Je n'ai pas pu consulter les données de la simulation."
ERROR_NO_ANSWER = "Je n'ai pas réussi à terminer ma réponse."
ERROR_UNUSABLE = "L'assistant n'a pas donné de réponse exploitable."
ERROR_NO_KEY = "Aucune clé API configurée."
INFO_NEW_DATE = "Nouvelle date : la conversation repart de zéro."


def _is_user_turn(message: dict) -> bool:
    return message["role"] == "user" and isinstance(message["content"], str)


def trim_history(history: list[dict], limit: int = HISTORY_LIMIT) -> list[dict]:
    """The last `limit` messages, starting on a real user turn (never on an orphan tool result)."""
    kept = history[-limit:]
    while kept and not _is_user_turn(kept[0]):
        kept = kept[1:]
    return kept


def _day_of(today_json: str) -> int | None:
    try:
        return json.loads(today_json)["jour"]
    except (ValueError, KeyError, TypeError):
        return None


class ClientAgent:
    """One per app. `chat` is an async generator of events; sessions live in memory only."""

    def __init__(
        self,
        client: anthropic.Anthropic | None,
        server: FastMCP,
        model: str,
        max_turns: int = 8,
        client_factory: Callable[[], anthropic.Anthropic | None] | None = None,
    ):
        self.client = client
        self.client_factory = client_factory  # asked on every chat when no fixed client is given
        self.server = server
        self.model = model
        self.max_turns = max_turns
        # session id -> (clock day the history was built at, history)
        self.sessions: dict[str, tuple[int | None, list[dict]]] = {}

    async def chat(self, session_id: str, message: str) -> AsyncIterator[AgentEvent]:
        client = self.client if self.client is not None else self.client_factory and self.client_factory()
        if client is None:
            yield {"type": "error", "message": ERROR_NO_KEY}
            yield {"type": "done"}
            return
        # No scenario loaded (empty database): answer without calling the model.
        today, failed = await call_tool(self.server, "get_today", {})
        if failed:
            logger.error(
                "get_today precheck failed, answering without the model: %s", today
            )
            yield {"type": "error", "message": ERROR_NO_DATA}
            yield {"type": "done"}
            return

        # Earlier answers and tool results belong to the day they were computed at: when the clock has moved
        # (either way) the model must not keep them, or a scrub back would leave it holding future facts.
        day = _day_of(today)
        stored_day, stored = self.sessions.get(session_id, (day, []))
        if stored_day != day:
            stored = []
            yield {"type": "info", "message": INFO_NEW_DATE}
        # Work on a copy and store it only at the end, so concurrent requests on one session cannot interleave.
        history = list(stored)
        start = len(history)
        history.append({"role": "user", "content": message})
        defs = await anthropic_tool_defs(self.server)
        failure = ERROR_NO_ANSWER
        completed = False
        try:
            for _ in range(self.max_turns):
                final = None
                async for kind, payload in self._model_turn(client, history, defs):
                    if kind == "text":
                        yield {"type": "text", "text": payload}
                    else:
                        final = payload
                blocks = [block for block in final.content if block.type == "tool_use"]
                if final.stop_reason == "tool_use" and blocks:
                    history.append({"role": "assistant", "content": final.content})
                elif final.content and not blocks:
                    history.append({"role": "assistant", "content": final.content})
                    completed = True
                    break
                else:  # empty reply, or cut off inside a tool_use block: nothing valid to keep
                    logger.error(
                        "unusable model reply (stop_reason=%s, %d blocks)",
                        final.stop_reason,
                        len(final.content),
                    )
                    failure = ERROR_UNUSABLE
                    break
                results = []
                for block in blocks:
                    yield {
                        "type": "tool_call",
                        "name": block.name,
                        "input": dict(block.input),
                    }
                    text, is_error = await call_tool(
                        self.server, block.name, dict(block.input)
                    )
                    yield {"type": "tool_result", "name": block.name}
                    result = {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": text,
                    }
                    if is_error:
                        result["is_error"] = True
                    results.append(result)
                history.append({"role": "user", "content": results})
        except anthropic.APIError as exc:
            logger.exception("Anthropic API call failed (%s)", type(exc).__name__)
            failure = ERROR_NO_DATA
        finally:
            if not completed:  # a half-finished exchange (dangling tool_use) would poison the next request
                del history[start:]
            self.sessions[session_id] = (day, trim_history(history))
        if not completed:
            yield {"type": "error", "message": failure}
        yield {"type": "done"}

    async def _model_turn(
        self, client: anthropic.Anthropic, history: list[dict], defs: list[dict]
    ) -> AsyncIterator[tuple[str, Any]]:
        """One streamed model call. The SDK client is synchronous, so it runs in a worker thread and hands
        its text deltas back through a queue; yields `("text", delta)` then one `("final", message)`."""
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        messages = list(history)

        def run() -> None:
            try:
                with client.messages.stream(
                    model=self.model,
                    max_tokens=4096,
                    system=SYSTEM_PROMPT_FR,
                    tools=defs,
                    messages=messages,
                ) as stream:
                    for event in stream:
                        if (
                            event.type == "content_block_delta"
                            and event.delta.type == "text_delta"
                        ):
                            loop.call_soon_threadsafe(
                                queue.put_nowait, ("text", event.delta.text)
                            )
                    final = stream.get_final_message()
                loop.call_soon_threadsafe(queue.put_nowait, ("final", final))
            except BaseException as exc:  # noqa: BLE001 - handed to the event loop, which re-raises it
                loop.call_soon_threadsafe(queue.put_nowait, ("error", exc))

        worker = loop.run_in_executor(None, run)
        while True:
            kind, payload = await queue.get()
            if kind == "error":
                raise payload
            yield kind, payload
            if kind == "final":
                break
        await worker
