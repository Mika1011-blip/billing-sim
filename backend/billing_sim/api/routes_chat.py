"""`POST /client/chat`: the client agent's answer, streamed as server-sent events."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

router = APIRouter(prefix="/client", tags=["client"])


class ChatBody(BaseModel):
    session_id: str
    message: str

    @field_validator("message")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message must not be blank")
        return value


@router.post("/chat")
async def chat(body: ChatBody, request: Request) -> StreamingResponse:
    agent = request.app.state.agent

    async def events() -> AsyncIterator[str]:
        async for event in agent.chat(body.session_id, body.message):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
