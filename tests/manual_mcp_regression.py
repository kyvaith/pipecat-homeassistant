"""Read-only MCP smoke test using credentials already configured in the add-on."""

import argparse
import asyncio
import json
import os

from app.config import ConfigStore
from app.mcp_bridge import CombinedMCPBridge
from loguru import logger


async def run(native):
    config = ConfigStore().load()
    specs = config.enabled_mcp_servers()
    if native:
        specs = [
            {
                "id": "ha",
                "name": "Home Assistant native MCP",
                "url": "http://supervisor/core/api/mcp",
                "token": os.getenv("SUPERVISOR_TOKEN", ""),
                "include_prompts": True,
                "prefer_unprefixed": True,
            }
        ]
    if not specs:
        raise RuntimeError("No MCP servers configured")
    for spec in specs:
        async with CombinedMCPBridge([spec]) as bridge:
            tools = await bridge.tools_schema(refresh=True)
            names = [tool.name for tool in tools.standard_tools]
            lookup = next(
                (name for name in names if name.endswith("GetLiveContext")), None
            )
            result_bytes = 0
            if lookup:
                result_bytes = len(await bridge.call_tool(lookup, {}))
            print(
                json.dumps(
                    {
                        "server": spec["name"],
                        "tool_count": len(names),
                        "prompt_characters": len(bridge.prompt_context),
                        "read_only_tool": lookup,
                        "result_characters": result_bytes,
                    }
                ),
                flush=True,
            )
    print("MCP connection and cross-task cleanup completed", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native", action="store_true")
    args = parser.parse_args()
    logger.remove()
    logger.add(lambda message: print(str(message), end=""), level="WARNING")
    asyncio.run(run(args.native))
