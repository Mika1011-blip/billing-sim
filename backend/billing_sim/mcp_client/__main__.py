"""Run the client MCP server over stdio: `python -m billing_sim.mcp_client` (database from SIM_DB_PATH)."""

import os

from billing_sim.mcp_client.server import build_server
from billing_sim.store.db import connect


def main() -> None:
    db_path = os.environ.get("SIM_DB_PATH", "./sim.sqlite")
    build_server(lambda: connect(db_path)).run(transport="stdio")


if __name__ == "__main__":
    main()
