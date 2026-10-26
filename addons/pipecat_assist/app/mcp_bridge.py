"""Home Assistant MCP bridge for Pipecat and text requests."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from collections import deque
from collections.abc import Sequence
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any

import httpx
from loguru import logger
from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from mcp.client.session_group import StreamableHttpParameters
from mcp.shared.exceptions import MCPError

from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import LLMService
from pipecat.services.mcp_service import MCPClient


class MCPAuthenticationError(RuntimeError):
    """Raised when Home Assistant rejects the MCP bearer token."""


MCP_CALL_HISTORY: deque[dict[str, Any]] = deque(maxlen=100)
MCP_TOOLS_SCHEMA_CACHE: dict[tuple[str, str, tuple[str, ...]], tuple[ToolsSchema, float]] = {}
LLM_SCHEMA_SCALAR_TYPES = {"string", "number", "integer", "boolean", "object", "array"}
LLM_SCHEMA_STRING_FIELDS = {"description", "format", "title"}


def _compact_json(value: Any, limit: int = 1200) -> str:
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)
        except TypeError:
            text = str(value)
    if len(text) > limit:
        return f"{text[:limit]}..."
    return text


def list_mcp_call_history() -> dict[str, Any]:
    """Return recent Home Assistant MCP tool calls."""

    return {"calls": list(reversed(MCP_CALL_HISTORY))}


def clear_mcp_call_history() -> dict[str, Any]:
    """Clear recent Home Assistant MCP tool calls."""

    MCP_CALL_HISTORY.clear()
    return list_mcp_call_history()


def clear_mcp_tools_cache() -> None:
    """Clear cached MCP tool schemas."""

    MCP_TOOLS_SCHEMA_CACHE.clear()


def _schema_type(value: Any) -> tuple[str, bool]:
    if isinstance(value, str):
        return (value.lower(), value.lower() == "null")
    if isinstance(value, list):
        nullable = any(str(item).lower() == "null" for item in value)
        for item in value:
            item_type = str(item).lower()
            if item_type != "null":
                return item_type, nullable
        return "", nullable
    return "", False


def _sanitize_llm_schema(schema: Any) -> dict[str, Any]:
    """Return a Gemini/Pipecat-compatible subset of JSON Schema."""

    if not isinstance(schema, dict):
        return {"type": "string"}

    sanitized: dict[str, Any] = {}
    schema_type, nullable = _schema_type(schema.get("type"))
    if schema_type in LLM_SCHEMA_SCALAR_TYPES:
        sanitized["type"] = schema_type
    elif isinstance(schema.get("properties"), dict) or "additionalProperties" in schema or "propertyNames" in schema:
        sanitized["type"] = "object"
    elif isinstance(schema.get("items"), dict):
        sanitized["type"] = "array"

    for key in LLM_SCHEMA_STRING_FIELDS:
        value = schema.get(key)
        if isinstance(value, str) and value:
            sanitized[key] = value

    enum_values = schema.get("enum")
    if isinstance(enum_values, list):
        clean_enum = [
            value
            for value in enum_values
            if isinstance(value, str | int | float | bool) or value is None
        ]
        if clean_enum:
            sanitized["enum"] = clean_enum

    if "const" in schema and "enum" not in sanitized:
        const = schema.get("const")
        if isinstance(const, str | int | float | bool) or const is None:
            sanitized["enum"] = [const]

    properties = schema.get("properties")
    if isinstance(properties, dict):
        clean_properties = {
            str(name): _sanitize_llm_schema(value)
            for name, value in properties.items()
            if isinstance(name, str)
        }
        if clean_properties:
            sanitized["properties"] = clean_properties

    required = schema.get("required")
    if isinstance(required, list):
        allowed_names = set(sanitized.get("properties", {}).keys())
        clean_required = [
            name
            for name in required
            if isinstance(name, str) and (not allowed_names or name in allowed_names)
        ]
        if clean_required:
            sanitized["required"] = clean_required

    items = schema.get("items")
    if isinstance(items, dict):
        sanitized["items"] = _sanitize_llm_schema(items)

    any_of_items = schema.get("anyOf") or schema.get("any_of") or schema.get("oneOf") or schema.get("allOf")
    if isinstance(any_of_items, list):
        clean_any_of: list[dict[str, Any]] = []
        for item in any_of_items:
            item_type, item_nullable = _schema_type(item.get("type") if isinstance(item, dict) else None)
            nullable = nullable or item_nullable or item_type == "null"
            if item_type == "null":
                continue
            if isinstance(item, dict):
                clean_any_of.append(_sanitize_llm_schema(item))
        if clean_any_of:
            sanitized["anyOf"] = clean_any_of

    if isinstance(schema.get("nullable"), bool) or nullable:
        sanitized["nullable"] = bool(schema.get("nullable") or nullable)

    if not sanitized:
        return {"type": "string"}
    return sanitized


def _sanitize_tool_properties(properties: Any) -> dict[str, Any]:
    if not isinstance(properties, dict):
        return {}
    return {
        str(name): _sanitize_llm_schema(schema)
        for name, schema in properties.items()
        if isinstance(name, str)
    }


def _sanitize_function_schema(tool: FunctionSchema) -> FunctionSchema:
    properties = _sanitize_tool_properties(tool.properties)
    required = [
        name
        for name in (tool.required or [])
        if isinstance(name, str) and (not properties or name in properties)
    ]
    return FunctionSchema(
        name=tool.name,
        description=tool.description,
        properties=properties,
        required=required,
    )


def _sanitize_tools_schema(tools: ToolsSchema) -> ToolsSchema:
    return ToolsSchema(
        standard_tools=[_sanitize_function_schema(tool) for tool in tools.standard_tools]
    )


def _new_history_item(name: str, arguments: dict[str, Any]) -> tuple[dict[str, Any], float]:
    return (
        {
            "id": uuid.uuid4().hex[:12],
            "started_at": datetime.now(timezone.utc).isoformat(),
            "tool": name,
            "arguments": _compact_json(arguments),
        },
        time.perf_counter(),
    )


def _finish_history_item(
    history_item: dict[str, Any],
    started: float,
    *,
    ok: bool,
    result: str = "",
    error: str = "",
) -> None:
    history_item.update(
        {
            "ok": ok,
            "duration_ms": round((time.perf_counter() - started) * 1000),
        }
    )
    if ok:
        history_item["result"] = _compact_json(result, limit=1000)
    else:
        history_item["error"] = error or result or "MCP tool failed"
    MCP_CALL_HISTORY.append(history_item)


class RecordingMCPClient(MCPClient):
    """Pipecat MCP client that records tool calls for the Runtime UI."""

    async def call_tool(self, function_name: str, arguments: dict[str, Any]) -> str:
        history_item, started = _new_history_item(function_name, dict(arguments or {}))
        logger.debug("Calling mcp tool '{}'", function_name)
        results = None
        error = ""
        try:
            # Pipecat has no public SDK-session accessor; keep this dependency
            # isolated and covered by the real MCP transport regression tests.
            session = await self._open_session(as_owner=False)
            results = await session.call_tool(function_name, arguments=arguments)
            if getattr(results, "isError", False):
                error = "MCP server reported a tool error"
        except Exception as err:
            error = f"Error calling mcp tool {function_name}: {err}"
            logger.error(error)

        response = ""
        if results:
            if hasattr(results, "content") and results.content:
                for index, content in enumerate(results.content):
                    if hasattr(content, "text") and content.text:
                        logger.debug("Tool response chunk {}: {}", index, content.text)
                        response += content.text
            else:
                logger.error("Error getting content from {} results.", function_name)

        ok = results is not None and not error
        if ok:
            logger.info("Tool '{}' completed successfully", function_name)
            logger.debug("Final response: {}", response)
        else:
            response = response or error or "MCP tool failed"

        _finish_history_item(
            history_item,
            started,
            ok=ok,
            result=response,
            error=error,
        )
        if not ok:
            raise RuntimeError(response)
        return response or "Tool completed successfully."

    async def prompt_context(self) -> str:
        """Read fresh, argument-free MCP prompts, including HA LLM API context."""

        session = await self._open_session(as_owner=False)
        try:
            prompts = await session.list_prompts()
        except MCPError as err:
            if err.error.code == -32601:
                return ""
            raise
        texts: list[str] = []
        for prompt in prompts.prompts[:8]:
            if any(argument.required for argument in prompt.arguments or []):
                continue
            result = await session.get_prompt(prompt.name)
            for message in result.messages:
                content = message.content
                if getattr(content, "type", None) == "text" and content.text:
                    texts.append(content.text)
        return "\n\n".join(texts)[:24000]


def _tool_prefix(value: str) -> str:
    prefix = "".join(char if char.isalnum() else "_" for char in value.lower()).strip("_")
    return prefix or "mcp"


class HomeAssistantMCPBridge:
    """Small wrapper around Pipecat's MCPClient."""

    def __init__(
        self,
        url: str,
        token: str = "",
        tool_allowlist: Sequence[str] | None = None,
        *,
        name: str = "Home Assistant MCP",
    ):
        self.url = url
        self.token = token
        self.tool_allowlist = list(tool_allowlist or [])
        self.name = name
        self.client: RecordingMCPClient | None = None

    async def __aenter__(self) -> "HomeAssistantMCPBridge":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def start(self) -> None:
        """Connect to Home Assistant MCP."""

        if self.client:
            return
        await self._preflight_auth()
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        self.client = RecordingMCPClient(
            server_params=StreamableHttpParameters(
                url=self.url,
                headers=headers,
            ),
            tools_filter=self.tool_allowlist or None,
        )
        await self.client.start()
        logger.info("Connected to {} at {}", self.name, self.url)

    async def _preflight_auth(self) -> None:
        """Detect auth failures before MCPClient starts background tasks."""

        headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        payload = {"jsonrpc": "2.0", "id": "pipecat-assist-preflight", "method": "ping"}

        try:
            async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
                response = await client.post(self.url, headers=headers, json=payload)
        except httpx.HTTPError as err:
            raise RuntimeError(f"Home Assistant MCP is not reachable: {err}") from err

        if response.status_code in {401, 403}:
            raise MCPAuthenticationError(
                "Home Assistant MCP rejected the token. The add-on normally uses "
                "the Home Assistant Supervisor token automatically. If you are "
                "running outside the Supervisor or using a custom MCP URL, configure "
                "a long-lived access token."
            )
        if response.status_code == 404:
            raise RuntimeError(f"Home Assistant MCP endpoint was not found at {self.url}")
        if response.status_code >= 500:
            raise RuntimeError(
                f"Home Assistant MCP returned HTTP {response.status_code}. Check the Home Assistant logs."
            )

    async def close(self) -> None:
        """Close the MCP connection."""

        client = self.client
        self.client = None
        if not client:
            return
        try:
            await client.close()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.debug("Ignoring MCP close error: {}", err)

    async def tools_schema(
        self,
        *,
        cache_enabled: bool = True,
        cache_ttl_seconds: int = 300,
        refresh: bool = False,
    ) -> ToolsSchema:
        """Return MCP tools in Pipecat schema format."""

        if not self.client:
            raise RuntimeError("MCP bridge is not started")
        cache_key = (
            self.url,
            hashlib.sha256(self.token.encode()).hexdigest(),
            tuple(self.tool_allowlist),
        )
        cached = MCP_TOOLS_SCHEMA_CACHE.get(cache_key)
        now = time.time()
        if (
            cache_enabled
            and not refresh
            and cached
            and (cache_ttl_seconds <= 0 or now - cached[1] <= cache_ttl_seconds)
        ):
            logger.debug("Using cached MCP tool schema for {} at {}", self.name, self.url)
            return cached[0]

        tools = _sanitize_tools_schema(await self.client.tools())
        if cache_enabled:
            MCP_TOOLS_SCHEMA_CACHE[cache_key] = (tools, now)
        return tools

    async def register_tools_schema(self, tools: ToolsSchema, llm: LLMService) -> None:
        """Register MCP tools with a Pipecat LLM service."""

        if not self.client:
            raise RuntimeError("MCP bridge is not started")
        for tool in tools.standard_tools:
            async def handler(params, *, name=tool.name):
                result = await self.call_tool(name, dict(params.arguments or {}))
                await params.result_callback(result)

            llm.register_function(tool.name, handler)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """Call one MCP tool and return text content."""

        if not self.client:
            raise RuntimeError("MCP bridge is not started")
        return await self.client.call_tool(name, arguments)

    async def prompt_context(self) -> str:
        if not self.client:
            raise RuntimeError("MCP bridge is not started")
        return await self.client.prompt_context()



class CombinedMCPBridge:
    """Expose multiple MCP servers as one tool surface."""

    def __init__(
        self,
        servers: Sequence[dict[str, Any]],
        tool_allowlist: Sequence[str] | None = None,
    ):
        self.server_specs = list(servers)
        self.tool_allowlist = list(tool_allowlist or [])
        self.bridges: list[tuple[dict[str, Any], HomeAssistantMCPBridge]] = []
        self._tool_routes: dict[str, tuple[HomeAssistantMCPBridge, str]] = {}
        self._tools_schema: ToolsSchema | None = None
        self.prompt_context = ""

    async def __aenter__(self) -> "CombinedMCPBridge":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def start(self) -> None:
        """Connect all configured MCP servers."""

        if self.bridges:
            return
        errors: list[str] = []
        for spec in self.server_specs:
            bridge = HomeAssistantMCPBridge(
                str(spec.get("url") or ""),
                str(spec.get("token") or ""),
                self.tool_allowlist,
                name=str(spec.get("name") or spec.get("id") or "MCP Server"),
            )
            try:
                await bridge.start()
            except Exception as err:
                errors.append(f"{bridge.name}: {err}")
                with suppress(Exception):
                    await bridge.close()
                continue
            self.bridges.append((spec, bridge))

        if errors:
            for _, bridge in self.bridges:
                with suppress(Exception):
                    await bridge.close()
            self.bridges = []
            raise RuntimeError("; ".join(errors))
        if not self.bridges:
            raise RuntimeError("; ".join(errors) or "No MCP servers are configured")

    async def close(self) -> None:
        """Close all MCP connections."""

        bridges = self.bridges
        self.bridges = []
        self._tool_routes = {}
        self._tools_schema = None
        self.prompt_context = ""
        for _, bridge in bridges:
            with suppress(Exception):
                await bridge.close()

    async def tools_schema(
        self,
        *,
        cache_enabled: bool = True,
        cache_ttl_seconds: int = 300,
        refresh: bool = False,
    ) -> ToolsSchema:
        """Return a combined Pipecat tools schema."""

        if not self.bridges:
            raise RuntimeError("MCP bridge is not started")

        public_tools: list[FunctionSchema] = []
        prompt_parts: list[str] = []
        routes: dict[str, tuple[HomeAssistantMCPBridge, str]] = {}
        seen: set[str] = set()

        for spec, bridge in self.bridges:
            schema = await bridge.tools_schema(
                cache_enabled=cache_enabled,
                cache_ttl_seconds=cache_ttl_seconds,
                refresh=refresh,
            )
            if spec.get("include_prompts", False):
                prompt = await bridge.prompt_context()
                if prompt:
                    prompt_parts.append(f"Context from {bridge.name}:\n{prompt}")
            prefix = _tool_prefix(str(spec.get("id") or bridge.name))
            prefer_unprefixed = bool(spec.get("prefer_unprefixed"))
            for tool in schema.standard_tools:
                original_name = tool.name
                public_name = original_name
                if not prefer_unprefixed or public_name in seen:
                    public_name = f"{prefix}__{original_name}"
                if public_name in seen:
                    public_name = f"{prefix}_{len(seen)}__{original_name}"
                seen.add(public_name)
                routes[public_name] = (bridge, original_name)
                public_properties = _sanitize_tool_properties(tool.properties)
                public_tools.append(
                    FunctionSchema(
                        name=public_name,
                        description=f"{bridge.name}: {tool.description}",
                        properties=public_properties,
                        required=[
                            name
                            for name in (tool.required or [])
                            if isinstance(name, str) and name in public_properties
                        ],
                    )
                )

        self._tool_routes = routes
        self.prompt_context = "\n\n".join(prompt_parts)[:48000]
        self._tools_schema = ToolsSchema(standard_tools=public_tools)
        return self._tools_schema

    async def register_tools_schema(self, tools: ToolsSchema, llm: LLMService) -> None:
        """Register combined MCP callbacks with an LLM service."""

        if not self._tool_routes:
            await self.tools_schema()

        for public_name in self._tool_routes:
            async def handler(params, *, name=public_name) -> None:
                result = await self.call_tool(name, dict(params.arguments or {}))
                await params.result_callback(result)

            llm.register_function(public_name, handler)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """Call a routed MCP tool."""

        if not self._tool_routes:
            await self.tools_schema()
        route = self._tool_routes.get(name)
        if not route:
            raise RuntimeError(f"Unknown MCP tool: {name}")
        bridge, original_name = route
        return await bridge.call_tool(original_name, arguments)


async def check_mcp(
    url: str,
    token: str,
    tool_allowlist: Sequence[str] | None = None,
    *,
    cache_enabled: bool = True,
    cache_ttl_seconds: int = 300,
    refresh: bool = False,
) -> dict[str, Any]:
    """Probe MCP connectivity for the status endpoint."""

    try:
        async with HomeAssistantMCPBridge(url, token, tool_allowlist) as bridge:
            tools = await bridge.tools_schema(
                cache_enabled=cache_enabled,
                cache_ttl_seconds=cache_ttl_seconds,
                refresh=refresh,
            )
            return {
                "ok": True,
                "tool_count": len(tools.standard_tools),
                "tools": [tool.name for tool in tools.standard_tools[:50]],
            }
    except asyncio.CancelledError as err:
        logger.warning("MCP check was cancelled: {}", err)
        return {"ok": False, "error": "MCP check was cancelled", "tool_count": 0, "tools": []}
    except Exception as err:
        logger.warning("MCP check failed: {}", err)
        return {"ok": False, "error": str(err), "tool_count": 0, "tools": []}
