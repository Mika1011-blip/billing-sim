"""POST /setup/generate: turn a request into a stored scenario."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from billing_sim.api.deps import Settings, get_settings
from billing_sim.mcp_manager.pipeline import generate
from billing_sim.scenario.haiku import GenerationFailed, GenerationUnavailable

router = APIRouter(prefix="/setup", tags=["setup"])


class GenerateRequest(BaseModel):
    request_text: str
    seed: int | None = None
    fallback: bool = False


@router.post("/generate")
def generate_scenario(body: GenerateRequest, settings: Settings = Depends(get_settings)):
    # A plain `def`: generation blocks on the model, so it runs in the thread pool (it opens its own connection).
    try:
        outcome = generate(body.request_text, seed=body.seed, fallback=body.fallback, settings=settings)
    except ValueError as error:
        return JSONResponse({"reason": str(error)}, status_code=422)
    except GenerationUnavailable as error:
        return JSONResponse({"detail": str(error)}, status_code=400)
    except GenerationFailed as error:
        return JSONResponse({"detail": str(error), "raw": error.raw}, status_code=502)
    if outcome.kind == "rejection":
        return JSONResponse({"reason": outcome.reason}, status_code=422)
    return {
        "kind": "plan",
        "plan": outcome.plan.model_dump(),
        "seed": outcome.seed,
        "warnings": outcome.warnings,
    }
