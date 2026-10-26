"""Text bridge used by the Home Assistant Conversation integration."""

from __future__ import annotations

import asyncio
import json
import os
from contextlib import suppress
from typing import Any

import httpx
from openai import AsyncOpenAI

from app.config import (
    DEFAULT_AWS_BEDROCK_MODEL,
    DEFAULT_GEMINI_TEXT_MODEL,
    DEFAULT_OPENAI_TEXT_MODEL,
    DEFAULT_WEB_SEARCH_MODEL,
    RuntimeConfig,
)
from app.mcp_bridge import CombinedMCPBridge
from app.openai_endpoint import openai_api_key
from app.web_search_tool import WEB_SEARCH_TOOL_NAME, run_gemini_web_search, run_openai_web_search

CONVERSATION_END_SYSTEM_HINT = (
    "If the user clearly ends the conversation, briefly acknowledge it and do not ask "
    "a follow-up question. The client will close the microphone after your farewell."
)


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


def _model_compatible(provider_kind: str, model: str) -> bool:
    clean = (model or "").strip().removeprefix("models/")
    if not clean:
        return False
    if provider_kind in {"openai", "openai_cloud"}:
        return not clean.startswith(("gemini-", "claude-", "amazon."))
    if provider_kind in {"gemini", "gemini_cloud"}:
        return clean.startswith("gemini-")
    if provider_kind == "anthropic":
        return clean.startswith("claude-")
    if provider_kind == "aws_bedrock":
        return clean.startswith(("amazon.", "anthropic.", "meta.", "mistral.", "cohere."))
    if provider_kind == "azure_openai":
        return not clean.startswith(("gemini-", "claude-", "amazon."))
    return True


def _provider_default_model(config: RuntimeConfig, provider_kind: str, integration) -> str:
    if provider_kind in {"openai", "openai_cloud"}:
        return (integration.default_model if integration else "") or DEFAULT_OPENAI_TEXT_MODEL
    if provider_kind in {"gemini", "gemini_cloud"}:
        return (integration.default_model if integration else "") or DEFAULT_GEMINI_TEXT_MODEL
    if provider_kind == "anthropic":
        return (integration.default_model if integration else "") or "claude-sonnet-4-5"
    if provider_kind == "aws_bedrock":
        return (integration.default_model if integration else "") or DEFAULT_AWS_BEDROCK_MODEL
    if provider_kind == "azure_openai":
        return (integration.deployment if integration else "") or (integration.default_model if integration else "") or DEFAULT_OPENAI_TEXT_MODEL
    return (integration.default_model if integration else "") or config.text_model or DEFAULT_OPENAI_TEXT_MODEL


def _text_model(config: RuntimeConfig, provider_kind: str, integration, flow) -> str:
    step = flow.model_step()
    candidates = [
        getattr(step, "model", "") if step else "",
        integration.deployment if integration and provider_kind == "azure_openai" else "",
        integration.default_model if integration else "",
        flow.text_model,
        config.text_model,
    ]
    for candidate in candidates:
        model = str(candidate or "").strip()
        if _model_compatible(provider_kind, model):
            return model
    return _provider_default_model(config, provider_kind, integration)


def _web_search_step(flow):
    return next((step for step in flow.steps if step.kind == "web_search" and step.enabled), None)


def _web_search_enabled(flow) -> bool:
    return bool(flow.web_search_enabled or _web_search_step(flow))


def _web_search_announces(flow) -> bool:
    step = _web_search_step(flow)
    return bool(step and (step.settings or {}).get("announce", True))


def _effective_instructions(flow) -> str:
    instructions = flow.instructions
    if CONVERSATION_END_SYSTEM_HINT not in instructions:
        instructions += f"\n\n{CONVERSATION_END_SYSTEM_HINT}"
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


def _anthropic_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    formatted = []
    for tool in tools:
        function = tool.get("function") or {}
        formatted.append(
            {
                "name": function.get("name"),
                "description": function.get("description") or "",
                "input_schema": function.get("parameters") or {"type": "object"},
            }
        )
    return [tool for tool in formatted if tool.get("name")]


def _bedrock_tool_config(tools: list[dict[str, Any]]) -> dict[str, Any]:
    formatted = []
    for tool in tools:
        function = tool.get("function") or {}
        name = function.get("name")
        if not name:
            continue
        formatted.append(
            {
                "toolSpec": {
                    "name": name,
                    "description": function.get("description") or "",
                    "inputSchema": {"json": function.get("parameters") or {"type": "object"}},
                }
            }
        )
    return {"tools": formatted} if formatted else {}


async def run_text_conversation(
    config: RuntimeConfig,
    *,
    text: str,
    language: str | None,
    conversation_id: str | None,
    flow_id: str | None = None,
    mcp_token: str = "",
) -> dict[str, Any]:
    """Run a text request through the selected LLM provider with HA MCP tools."""

    flow = config.selected_flow(flow_id)
    integration = config.model_integration(flow)
    provider_kind = integration.kind if integration else "openai"
    supported_providers = {
        "openai",
        "openai_cloud",
        "gemini",
        "gemini_cloud",
        "openai_compatible",
        "ollama",
        "azure_openai",
        "anthropic",
        "aws_bedrock",
    }
    if provider_kind not in supported_providers:
        return {
            "speech": f"HA Assist conversation does not support {provider_kind} as an LLM provider.",
            "conversation_id": conversation_id,
            "continue_conversation": False,
            "error": "unsupported_text_provider",
        }

    if provider_kind in {"gemini", "gemini_cloud"}:
        api_key = (integration.api_key if integration else "") or os.getenv("GOOGLE_API_KEY", "")
    elif provider_kind == "aws_bedrock":
        api_key = "bedrock"
    elif integration and integration.base_url and provider_kind in {"openai", "openai_cloud"}:
        api_key = openai_api_key(integration, "LLM", config.openai_api_key)
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

    tools: list[dict[str, Any]] = []
    web_search = _web_search_tool(config, flow)
    if web_search:
        tools.append(web_search[0])

    bridge: CombinedMCPBridge | None = None
    mcp_servers = config.enabled_mcp_servers(mcp_token) if flow.mcp_enabled else []
    if mcp_servers:
        bridge = CombinedMCPBridge(mcp_servers, flow.mcp_tool_allowlist)
        try:
            await bridge.start()
            tools_schema = await bridge.tools_schema(
                cache_enabled=config.mcp_tools_cache_enabled,
                cache_ttl_seconds=config.mcp_tools_cache_ttl_seconds,
            )
            tools.extend(_format_openai_tools(tools_schema))
            if bridge.prompt_context:
                messages[0]["content"] += f"\n\n{bridge.prompt_context}"
                system += f"\n\n{bridge.prompt_context}"
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

    async def call_tool(name: str, arguments: dict[str, Any]) -> str:
        if name == WEB_SEARCH_TOOL_NAME:
            if not web_search:
                return "Web search is not configured."
            _, search_runner, _ = web_search
            return await search_runner(str(arguments.get("query") or text))
        if bridge is None:
            return "Home Assistant MCP is not connected."
        return await bridge.call_tool(name, arguments)

    try:
        if provider_kind == "anthropic":
            model = _text_model(config, provider_kind, integration, flow)
            anthropic_messages: list[dict[str, Any]] = [{"role": "user", "content": text}]
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            anthropic_payload_tools = _anthropic_tools(tools)
            async with httpx.AsyncClient(timeout=60.0) as client:
                for _ in range(6):
                    payload: dict[str, Any] = {
                        "model": model,
                        "max_tokens": flow.max_output_tokens or 1024,
                        "system": system,
                        "messages": anthropic_messages,
                    }
                    if anthropic_payload_tools:
                        payload["tools"] = anthropic_payload_tools
                    response = await client.post(
                        "https://api.anthropic.com/v1/messages",
                        headers=headers,
                        json=payload,
                    )
                    response.raise_for_status()
                    data = response.json()
                    content = data.get("content") or []
                    tool_uses = [
                        item
                        for item in content
                        if isinstance(item, dict) and item.get("type") == "tool_use"
                    ]
                    text_parts = [
                        str(item.get("text") or "")
                        for item in content
                        if isinstance(item, dict) and item.get("type") == "text"
                    ]
                    if not tool_uses:
                        return {
                            "speech": " ".join(part for part in text_parts if part).strip() or "Done.",
                            "conversation_id": conversation_id,
                            "continue_conversation": False,
                        }
                    anthropic_messages.append({"role": "assistant", "content": content})
                    results = []
                    for tool_use in tool_uses:
                        name = str(tool_use.get("name") or "")
                        arguments = tool_use.get("input") if isinstance(tool_use.get("input"), dict) else {}
                        result = await call_tool(name, arguments)
                        results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": tool_use.get("id"),
                                "content": result,
                            }
                        )
                    anthropic_messages.append({"role": "user", "content": results})
            return {
                "speech": "The request needed too many tool calls and was stopped.",
                "conversation_id": conversation_id,
                "continue_conversation": False,
                "error": "tool_loop_limit",
            }

        if provider_kind == "aws_bedrock":
            import boto3

            model = _text_model(config, provider_kind, integration, flow)
            client_kwargs: dict[str, Any] = {"region_name": integration.region or "us-east-1"}
            if integration.access_key_id and integration.secret_key:
                client_kwargs["aws_access_key_id"] = integration.access_key_id
                client_kwargs["aws_secret_access_key"] = integration.secret_key
            if integration.token:
                client_kwargs["aws_session_token"] = integration.token
            bedrock = boto3.client("bedrock-runtime", **client_kwargs)
            bedrock_messages: list[dict[str, Any]] = [{"role": "user", "content": [{"text": text}]}]
            tool_config = _bedrock_tool_config(tools)
            for _ in range(6):
                kwargs: dict[str, Any] = {
                    "modelId": model,
                    "messages": bedrock_messages,
                    "system": [{"text": system}],
                }
                if flow.max_output_tokens:
                    kwargs["inferenceConfig"] = {"maxTokens": flow.max_output_tokens}
                if tool_config:
                    kwargs["toolConfig"] = tool_config
                response = await asyncio.to_thread(bedrock.converse, **kwargs)
                message = ((response.get("output") or {}).get("message") or {})
                content = message.get("content") or []
                bedrock_messages.append(message)
                tool_uses = [
                    item.get("toolUse")
                    for item in content
                    if isinstance(item, dict) and item.get("toolUse")
                ]
                if not tool_uses:
                    speech = " ".join(
                        str(item.get("text") or "")
                        for item in content
                        if isinstance(item, dict) and item.get("text")
                    )
                    return {
                        "speech": speech.strip() or "Done.",
                        "conversation_id": conversation_id,
                        "continue_conversation": False,
                    }
                tool_results = []
                for tool_use in tool_uses:
                    if not isinstance(tool_use, dict):
                        continue
                    result = await call_tool(
                        str(tool_use.get("name") or ""),
                        tool_use.get("input") if isinstance(tool_use.get("input"), dict) else {},
                    )
                    tool_results.append(
                        {
                            "toolResult": {
                                "toolUseId": tool_use.get("toolUseId"),
                                "content": [{"text": result}],
                            }
                        }
                    )
                bedrock_messages.append({"role": "user", "content": tool_results})
            return {
                "speech": "The request needed too many tool calls and was stopped.",
                "conversation_id": conversation_id,
                "continue_conversation": False,
                "error": "tool_loop_limit",
            }

        if provider_kind == "azure_openai":
            from openai import AsyncAzureOpenAI

            if not integration.endpoint:
                return {
                    "speech": "Azure OpenAI is missing its endpoint.",
                    "conversation_id": conversation_id,
                    "continue_conversation": False,
                    "error": "missing_provider_endpoint",
                }
            client = AsyncAzureOpenAI(
                api_key=api_key,
                azure_endpoint=integration.endpoint,
                api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21"),
            )
        else:
            client_kwargs: dict[str, Any] = {"api_key": api_key}
            if integration and integration.base_url and provider_kind in {"openai", "openai_cloud", "openai_compatible", "ollama"}:
                client_kwargs["base_url"] = integration.base_url
            if provider_kind in {"gemini", "gemini_cloud"}:
                client_kwargs["base_url"] = (
                    integration.base_url
                    if integration and integration.base_url
                    else "https://generativelanguage.googleapis.com/v1beta/openai/"
                )
            client = AsyncOpenAI(**client_kwargs)

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
                result = await call_tool(tool_call.function.name, arguments)
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
