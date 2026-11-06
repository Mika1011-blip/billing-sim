"""Bridge between the client MCP server and the Anthropic tool-use API."""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from billing_sim.mcp_client.server import agent_tool_list


async def anthropic_tool_defs(server: FastMCP) -> list[dict]:
    """The server's tools as Anthropic tool definitions: `{name, description, input_schema}`."""
    return await agent_tool_list(server)


def _text_of(result: object) -> str:
    """The text of a `call_tool` result, whatever shape this `mcp` version returns (content list or (content, structured))."""
    if isinstance(result, tuple):
        result = result[0]
    if isinstance(result, list):
        return "\n".join(
            block.text for block in result if getattr(block, "type", "text") == "text"
        )
    return str(result)


async def call_tool(server: FastMCP, name: str, args: dict) -> tuple[str, bool]:
    """Run one tool; returns `(text, is_error)`. A failing tool yields its error text, it never raises."""
    try:
        return _text_of(await server.call_tool(name, args)), False
    except Exception as exc:  # noqa: BLE001 - ToolError, unknown tool, bad arguments, a database failure: all become text
        return str(exc) or exc.__class__.__name__, True


async def dispatch(server: FastMCP, name: str, args: dict) -> str:
    """Run one tool and return its JSON text; tool errors come back as text, never raised."""
    return (await call_tool(server, name, args))[0]
