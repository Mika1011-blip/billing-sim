#!/usr/bin/env bash
# Repo-wide test command: backend pytest, then frontend vitest when frontend/ exists.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -x "$ROOT/backend/.venv/Scripts/python.exe" ]; then
    PY="$ROOT/backend/.venv/Scripts/python.exe"
elif [ -x "$ROOT/backend/.venv/bin/python" ]; then
    PY="$ROOT/backend/.venv/bin/python"
else
    PY="python"
fi

(cd "$ROOT/backend" && "$PY" -m pytest -q)

if [ -f "$ROOT/frontend/package.json" ]; then
    (cd "$ROOT/frontend" && npm test -- --run)
fi

# Optional end-to-end run against a live stack: `docker compose up --build -d`, then `E2E=1 bash scripts/test.sh`.
# E2E_BASE_URL defaults to http://localhost:5173.
if [ "${E2E:-}" = "1" ]; then
    (cd "$ROOT/frontend" && npx playwright test)
fi
