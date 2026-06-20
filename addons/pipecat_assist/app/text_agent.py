"""Text bridge used by the Home Assistant Conversation integration."""

from __future__ import annotations

import asyncio
import json
import os
from contextlib import suppress
from typing import Any

from openai import AsyncOpenAI

from app.config import DEFAULT_GEMINI_TEXT_MODEL, DEFAULT_WEB_SEARCH_MODEL, RuntimeConfig
from app.mcp_bridge import HomeAssistantMCPBridge
from app.web_search_tool import WEB_SEARCH_TOOL_NAME, run_gemini_web_search, run_openai_web_search


def _format_openai_tools(tools_schema) -> list[dict[str, Any]]:
    """Convert Pipecat FunctionSchema objects to OpenAI Chat tools."""

    formatted: list[dict[str, Any]] = []
    for tool in tools_schema.standard_tools:
        formatted.append(
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": {
                        "type": "object",
                        "properties": tool.properties,
                        "required": tool.required,
                    },
                },
            }
        )
    return formatted


def _tool_args(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _text_model(config: RuntimeConfig, provider_kind: str, integration, flow) -> str:
    model = flow.text_model or (integration.default_model if integration else "") or config.text_model
    if provider_kind in {"gemini", "gemini_cloud"} and (not model or model.startswith(("gpt-", "claude-"))):
        return (integration.default_model if integration else "") or DEFAULT_GEMINI_TEXT_MODEL
    return model


def _web_search_step(flow):
    return next((step for step in flow.steps if step.kind == "web_search" and step.enabled), None)


def _web_search_enabled(flow) -> bool:
    return bool(flow.web_search_enabled or _web_search_step(flow))


def _web_search_announces(flow) -> bool:
    step = _web_search_step(flow)
    return bool(step and (step.settings or {}).get("announce", True))


def _effective_instructions(flow) -> str:
    instructions = flow.instructions
    if _web_search_announces(flow):
        instructions += (
            "\n\nWhen you decide to use web search, first say "
            '"Please hold, I\'m checking." Then run the search and answer briefly.'
        )
    return instructions


def _web_search_tool(config: RuntimeConfig, flow) -> tuple[dict[str, Any], Any, str] | None:
    if not _web_search_enabled(flow):
        return None
    integration = config.integration("web-search")
    if not integration or not integration.enabled:
        return None
    provider = config.integration(integration.provider_id or "openai-cloud")
    if not provider:
        return None
    model = integration.default_model or provider.default_model or DEFAULT_WEB_SEARCH_MODEL
    if provider.kind in {"openai", "openai_cloud"}:
        api_key = (provider.api_key or integration.api_key or config.openai_api_key or "").strip()
        if not api_key:
            return None

        async def runner(query: str) -> str:
            return await run_openai_web_search(api_key, model, query)

    elif provider.kind in {"gemini", "gemini_cloud"}:
        if model.startswith(("gpt-", "o", "claude-")):
            model = provider.default_model or DEFAULT_GEMINI_TEXT_MODEL
        api_key = (provider.api_key or integration.api_key or os.getenv("GOOGLE_API_KEY", "")).strip()
        if not api_key:
            return None

        async def runner(query: str) -> str:
            return await run_gemini_web_search(api_key, model or DEFAULT_GEMINI_TEXT_MODEL, query)

    else:
        return None

    return (
        {
            "type": "function",
            "function": {
                "name": WEB_SEARCH_TOOL_NAME,
                "description": "Search the web for fresh public information and return a concise answer.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query.",
                        },
                    },
                    "required": ["query"],
                },
            },
        },
        runner,
        model,
    )


async def run_text_conversation(
    config: RuntimeConfig,
    *,
    text: str,
    language: str | None,
    conversation_id: str | None,
    flow_id: str | None = None,
    mcp_token: str = "",
) -> dict[str, Any]:
    """Run a text request through OpenAI with HA MCP tools."""

    flow = config.selected_flow(flow_id)
    integration = config.model_integration(flow)
    provider_kind = integration.kind if integration else "openai"
    if provider_kind not in {"openai", "openai_cloud", "gemini", "gemini_cloud", "openai_compatible", "ollama"}:
        return {
            "speech": "This Pipecat Assist text bridge does not support the selected model provider yet.",
            "conversation_id": conversation_id,
            "continue_conversation": False,
            "error": "unsupported_text_provider",
        }

    if provider_kind in {"gemini", "gemini_cloud"}:
        api_key = (integration.api_key if integration else "") or os.getenv("GOOGLE_API_KEY", "")
    else:
        api_key = (integration.api_key if integration else "") or config.openai_api_key
    if provider_kind == "ollama" and not api_key:
        api_key = "ollama"
    if not api_key:
        return {
            "speech": "Pipecat Assist is missing an API key for the selected model provider.",
            "conversation_id": conversation_id,
            "continue_conversation": False,
            "error": "missing_provider_api_key",
        }

    system = (
        f"{_effective_instructions(flow)}\n\n"
        "You are answering through Home Assistant Conversation text mode. "
        "Use MCP tools silently for explicit smart-home requests. "
        "Keep the final answer short and natural."
    )
    if language and str(language).lower() != "pipecat-assist":
        system += f"\nThe user's language is {language}."

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": text},
    ]

    client_kwargs: dict[str, Any] = {"api_key": api_key}
    if integration and integration.base_url and provider_kind in {"openai_compatible", "ollama"}:
        client_kwargs["base_url"] = integration.base_url
    if provider_kind in {"gemini", "gemini_cloud"}:
        client_kwargs["base_url"] = (
            integration.base_url
            if integration and integration.base_url
            else "https://generativelanguage.googleapis.com/v1beta/openai/"
        )
    client = AsyncOpenAI(**client_kwargs)
    tools: list[dict[str, Any]] = []
    web_search = _web_search_tool(config, flow)
    if web_search:
        tools.append(web_search[0])

    bridge: HomeAssistantMCPBridge | None = None
    if flow.mcp_enabled and mcp_token:
        bridge = HomeAssistantMCPBridge(
            config.effective_mcp_url,
            mcp_token,
            flow.mcp_tool_allowlist,
        )
        try:
            await bridge.start()
            tools_schema = await bridge.tools_schema(
                cache_enabled=config.mcp_tools_cache_enabled,
                cache_ttl_seconds=config.mcp_tools_cache_ttl_seconds,
            )
            tools.extend(_format_openai_tools(tools_schema))
        except asyncio.CancelledError as err:
            with suppress(Exception):
                await bridge.close()
            bridge = None
            return {
                "speech": f"Home Assistant MCP is not available: {err}",
                "conversation_id": conversation_id,
                "continue_conversation": False,
                "error": "mcp_unavailable",
            }
        except Exception as err:
            with suppress(Exception):
                await bridge.close()
            bridge = None
            return {
                "speech": f"Home Assistant MCP is not available: {err}",
                "conversation_id": conversation_id,
                "continue_conversation": False,
                "error": "mcp_unavailable",
            }

    try:
        for _ in range(6):
            kwargs: dict[str, Any] = {
                "model": _text_model(config, provider_kind, integration, flow),
                "messages": messages,
            }
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"
            response = await client.chat.completions.create(**kwargs)
            message = response.choices[0].message
            messages.append(message.model_dump(exclude_none=True))

            tool_calls = message.tool_calls or []
            if not tool_calls:
                speech = message.content or ""
                return {
                    "speech": speech.strip() or "Done.",
                    "conversation_id": conversation_id,
                    "continue_conversation": False,
                }

            if bridge is None and any(tool_call.function.name != WEB_SEARCH_TOOL_NAME for tool_call in tool_calls):
                return {
                    "speech": "I need Home Assistant MCP tools for that, but MCP is not connected.",
                    "conversation_id": conversation_id,
                    "continue_conversation": False,
                    "error": "mcp_not_connected",
                }

            for tool_call in tool_calls:
                arguments = _tool_args(tool_call.function.arguments)
                if tool_call.function.name == WEB_SEARCH_TOOL_NAME:
                    if not web_search:
                        result = "Web search is not configured."
                    else:
                        _, search_runner, _ = web_search
                        result = await search_runner(str(arguments.get("query") or text))
                else:
                    result = await bridge.call_tool(tool_call.function.name, arguments)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": result,
                    }
                )

        return {
            "speech": "The request needed too many tool calls and was stopped.",
            "conversation_id": conversation_id,
            "continue_conversation": False,
            "error": "tool_loop_limit",
        }
    finally:
        if bridge:
            await bridge.close()
