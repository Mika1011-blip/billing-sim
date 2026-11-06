# Build context is the repository root (see docker-compose.yml): the backend resolves
# `contract_template.json` from the repo root (two levels above the package), so the
# image keeps the repo layout under /app and installs the package in editable mode.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SIM_DB_PATH=/data/sim.sqlite

WORKDIR /app
COPY contract_template.json /app/contract_template.json
COPY backend /app/backend
RUN pip install -e /app/backend

WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "billing_sim.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
