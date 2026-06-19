"""Pipecat Assist add-on entry point."""

from __future__ import annotations

import argparse
import asyncio
import hmac
import os
import time
from contextlib import suppress
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from loguru import logger
from starlette.staticfiles import StaticFiles

from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.runner.run import app, main as runner_main
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.openai.realtime.events import (
    AudioConfiguration,
    AudioInput,
    AudioOutput,
    InputAudioNoiseReduction,
    InputAudioTranscription,
    Reasoning,
    SemanticTurnDetection,
    SessionProperties,
    TurnDetection,
)
from pipecat.services.openai.realtime.llm import OpenAIRealtimeLLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.workers.runner import WorkerRunner

from app.config import (
    DEFAULT_GEMINI_LIVE_MODEL,
    DEFAULT_GEMINI_LIVE_VOICE,
    DEFAULT_OPENAI_REALTIME_MODEL,
    DEFAULT_OPENAI_REALTIME_VOICE,
    ConfigStore,
    FlowConfig,
    IntegrationConfig,
    OPENAI_REALTIME_VOICES,
    RuntimeConfig,
)
from app.audio_debug import (
    audio_debug_file_path,
    clear_audio_recordings,
    create_audio_debug_session,
    list_audio_recordings,
)
from app.mcp_bridge import HomeAssistantMCPBridge, check_mcp
from app.text_agent import run_text_conversation

STORE = ConfigStore()
STARTED_AT = time.time()
UI_DIR = Path(__file__).parent / "ui"
UI_CACHE_HEADERS = {"Cache-Control": "no-store"}

app.mount("/assets", StaticFiles(directory=UI_DIR), name="assets")


def _configure_logging() -> None:
    config = STORE.load()
    logger.remove()
    logger.add(lambda message: print(message, end=""), level=config.log_level)


def _extract_token(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.query_params.get("token", "")


def _is_offer_path(path: str) -> bool:
    return path == "/api/offer" or (path.startswith("/sessions/") and path.endswith("/api/offer"))


@app.middleware("http")
async def protect_satellite_offer(request: Request, call_next):
    """Require the shared satellite token for direct SmallWebRTC offers."""

    if _is_offer_path(request.url.path):
        secret = STORE.load().satellite_shared_secret
        if secret and not hmac.compare_digest(_extract_token(request), secret):
            return JSONResponse({"detail": "Invalid satellite token"}, status_code=401)
    return await call_next(request)


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(UI_DIR / "index.html", headers=UI_CACHE_HEADERS)


@app.get("/index.js", include_in_schema=False)
@app.get("/index.css", include_in_schema=False)
@app.get("/logo.svg", include_in_schema=False)
async def ui_asset(request: Request):
    return FileResponse(UI_DIR / request.url.path.lstrip("/"), headers=UI_CACHE_HEADERS)


def _offer_url(config: RuntimeConfig, request: Request) -> str:
    host = config.runner_host
    if host in {"0.0.0.0", "::", ""}:
        host = request.url.hostname or "homeassistant.local"
    token = quote(config.satellite_shared_secret)
    suffix = f"?token={token}" if token else ""
    return f"http://{host}:{config.runner_port}/api/offer{suffix}"


def _offer_path(config: RuntimeConfig) -> str:
    token = quote(config.satellite_shared_secret)
    suffix = f"?token={token}" if token else ""
    return f"api/offer{suffix}"


@app.get("/api/assist/status")
async def api_status(request: Request):
    config = STORE.load()
    return {
        "ok": True,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "runner": {
            "host": config.runner_host,
            "port": config.runner_port,
            "esp32_mode": config.esp32_mode,
            "offer_url": _offer_url(config, request),
            "offer_path": _offer_path(config),
        },
        "selected_flow_id": config.selected_flow_id,
        "flow_count": len(config.flows),
        "mcp_url": config.effective_mcp_url,
        "mcp_token_configured": bool(config.effective_mcp_token),
        "mcp_token_source": config.effective_mcp_token_source,
    }


@app.get("/api/assist/config")
async def api_get_config(request: Request):
    config = STORE.load()
    data = config.public_dict()
    data["runner_offer_url"] = _offer_url(config, request)
    data["runner_offer_path"] = _offer_path(config)
    return data


@app.put("/api/assist/config")
async def api_update_config(payload: dict[str, Any], request: Request):
    config = STORE.update_from_public(payload)
    data = config.public_dict()
    data["runner_offer_url"] = _offer_url(config, request)
    data["runner_offer_path"] = _offer_path(config)
    return data


@app.post("/api/assist/mcp/check")
async def api_check_mcp(payload: dict[str, Any] | None = None):
    config = STORE.load()
    flow = config.selected_flow((payload or {}).get("flow_id"))
    return await check_mcp(config.effective_mcp_url, config.effective_mcp_token, flow.mcp_tool_allowlist)


@app.post("/api/assist/mcp/reset")
async def api_reset_mcp(request: Request):
    config = STORE.reset_mcp_defaults()
    data = config.public_dict()
    data["runner_offer_url"] = _offer_url(config, request)
    data["runner_offer_path"] = _offer_path(config)
    return data


@app.post("/api/assist/conversation")
async def api_conversation(payload: dict[str, Any]):
    text = str(payload.get("text", "")).strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    config = STORE.load()
    return await run_text_conversation(
        config,
        text=text,
        language=payload.get("language"),
        conversation_id=payload.get("conversation_id"),
        flow_id=payload.get("flow_id"),
        mcp_token=config.effective_mcp_token,
    )


@app.get("/api/assist/debug/audio")
async def api_audio_debug():
    config = STORE.load()
    return {
        "enabled": config.audio_debug_enabled,
        "keep_sessions": config.audio_debug_keep_sessions,
        "recordings": list_audio_recordings(),
    }


@app.delete("/api/assist/debug/audio")
async def api_clear_audio_debug():
    config = STORE.load()
    clear_audio_recordings()
    return {
        "enabled": config.audio_debug_enabled,
        "keep_sessions": config.audio_debug_keep_sessions,
        "recordings": [],
    }


@app.get("/api/assist/debug/audio/{filename}")
async def api_audio_debug_file(filename: str):
    try:
        path = audio_debug_file_path(filename)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio debug file not found")
    return FileResponse(
        path,
        media_type="audio/wav",
        filename=filename,
        headers=UI_CACHE_HEADERS,
    )


def _turn_detection(flow: FlowConfig):
    if flow.vad_mode == "server_vad":
        return TurnDetection()
    return SemanticTurnDetection(
        eagerness=flow.vad_eagerness,
        create_response=True,
        interrupt_response=flow.interrupt_response,
    )


def _noise_reduction(flow: FlowConfig):
    if flow.noise_reduction == "off":
        return None
    return InputAudioNoiseReduction(type=flow.noise_reduction)


def _session_properties(flow: FlowConfig, tools_schema, voice: str | None = None) -> SessionProperties:
    tools = tools_schema if tools_schema and tools_schema.standard_tools else None
    return SessionProperties(
        audio=AudioConfiguration(
            input=AudioInput(
                transcription=InputAudioTranscription(
                    model=flow.transcription_model,
                    language=flow.language,
                ),
                turn_detection=_turn_detection(flow),
                noise_reduction=_noise_reduction(flow),
            ),
            output=AudioOutput(voice=voice or flow.voice, speed=flow.speed),
        ),
        output_modalities=["audio"],
        tools=tools,
        tool_choice="auto" if tools else None,
        max_output_tokens=flow.max_output_tokens,
        reasoning=Reasoning(effort=flow.reasoning_effort) if flow.reasoning_effort else None,
    )


def _transport_params(flow: FlowConfig) -> dict[str, Any]:
    return {
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            video_in_enabled=flow.video_enabled,
        ),
    }


def _output_step(flow: FlowConfig):
    return next(
        (step for step in flow.steps if step.kind in {"output", "tts"} and step.enabled),
        None,
    )


def _realtime_model_matches_provider(provider_kind: str, model: str) -> bool:
    model = (model or "").strip()
    if not model:
        return False
    if provider_kind == "gemini":
        return "gemini" in model
    if provider_kind == "openai":
        return "realtime" in model and not model.startswith("models/")
    return True


def _realtime_voice_matches_provider(provider_kind: str, voice: str) -> bool:
    voice = (voice or "").strip()
    if not voice:
        return False
    if provider_kind == "gemini":
        return voice not in OPENAI_REALTIME_VOICES
    if provider_kind == "openai":
        return voice in OPENAI_REALTIME_VOICES
    return True


def _model_name(
    flow: FlowConfig,
    integration: IntegrationConfig | None,
    provider_kind: str | None = None,
) -> str:
    model_step = flow.model_step()
    model = (
        (model_step.model if model_step else "")
        or flow.model
        or (integration.default_realtime_model if integration else "")
    ).strip()
    kind = integration.kind if integration else provider_kind
    if kind == "gemini" and not _realtime_model_matches_provider(
        "gemini",
        model,
    ):
        return (integration.default_realtime_model if integration else "") or DEFAULT_GEMINI_LIVE_MODEL
    if kind == "openai" and not _realtime_model_matches_provider(
        "openai",
        model,
    ):
        return (integration.default_realtime_model if integration else "") or DEFAULT_OPENAI_REALTIME_MODEL
    return model


def _openai_voice(flow: FlowConfig, integration: IntegrationConfig | None) -> str:
    output_step = _output_step(flow)
    for candidate in (
        output_step.voice if output_step else "",
        flow.voice,
        integration.default_voice if integration else "",
    ):
        if _realtime_voice_matches_provider("openai", candidate):
            return candidate
    return DEFAULT_OPENAI_REALTIME_VOICE


def _gemini_model(model: str) -> str:
    model = model.strip() or DEFAULT_GEMINI_LIVE_MODEL
    return model if model.startswith("models/") else f"models/{model}"


def _gemini_voice(flow: FlowConfig, integration: IntegrationConfig | None) -> str:
    output_step = _output_step(flow)
    for candidate in (
        output_step.voice if output_step else "",
        flow.voice,
        integration.default_voice if integration else "",
    ):
        if _realtime_voice_matches_provider("gemini", candidate):
            return candidate
    return DEFAULT_GEMINI_LIVE_VOICE


def _gemini_vad(flow: FlowConfig):
    try:
        from pipecat.services.google.gemini_live.llm import GeminiVADParams
    except ImportError:
        from pipecat.services.google.gemini_live import GeminiVADParams

    silence_by_eagerness = {
        "high": 300,
        "medium": 500,
        "low": 800,
    }
    silence_duration_ms = silence_by_eagerness.get(flow.vad_eagerness)
    return GeminiVADParams(silence_duration_ms=silence_duration_ms)


def _gemini_live_service(
    *,
    api_key: str,
    model: str,
    flow: FlowConfig,
    integration: IntegrationConfig | None,
):
    try:
        from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
    except ImportError:
        from pipecat.services.google.gemini_live import GeminiLiveLLMService

    settings_kwargs: dict[str, Any] = {
        "model": _gemini_model(model),
        "system_instruction": flow.instructions,
        "voice": _gemini_voice(flow, integration),
        "language": flow.language or "en-US",
        "vad": _gemini_vad(flow),
    }
    if flow.max_output_tokens:
        settings_kwargs["max_tokens"] = flow.max_output_tokens

    return GeminiLiveLLMService(
        api_key=api_key,
        settings=GeminiLiveLLMService.Settings(**settings_kwargs),
    )


def _openai_realtime_service(
    *,
    api_key: str,
    model: str,
    flow: FlowConfig,
    integration: IntegrationConfig | None,
    tools_schema,
):
    return OpenAIRealtimeLLMService(
        api_key=api_key,
        settings=OpenAIRealtimeLLMService.Settings(
            model=model,
            system_instruction=flow.instructions,
            session_properties=_session_properties(
                flow,
                tools_schema,
                voice=_openai_voice(flow, integration),
            ),
        ),
    )


async def run_bot(
    transport: BaseTransport,
    runner_args: RunnerArguments,
    config: RuntimeConfig,
    flow: FlowConfig,
    mcp_token: str = "",
):
    """Run one Pipecat session."""

    integration = config.model_integration(flow)
    if integration:
        provider_kind = integration.kind
    elif flow.provider_id in {"gemini", "openai"}:
        provider_kind = flow.provider_id
    else:
        provider_kind = "openai"
    if provider_kind not in {"openai", "gemini"}:
        raise RuntimeError(
            f"Realtime voice runtime for {provider_kind} is not enabled in this build yet"
        )

    if provider_kind == "gemini":
        api_key = (integration.api_key if integration else "") or os.getenv("GOOGLE_API_KEY", "")
    else:
        api_key = (integration.api_key if integration else "") or config.openai_api_key
    if not api_key:
        raise RuntimeError(f"The selected {provider_kind} realtime provider is missing an API key")

    realtime_model = _model_name(flow, integration, provider_kind)
    logger.info(
        "Starting {} realtime model {} for flow {}",
        provider_kind,
        realtime_model,
        flow.id,
    )

    bridge: HomeAssistantMCPBridge | None = None
    tools_schema = None
    if flow.mcp_enabled and mcp_token:
        bridge = HomeAssistantMCPBridge(
            config.effective_mcp_url,
            mcp_token,
            flow.mcp_tool_allowlist,
        )
        try:
            await bridge.start()
            tools_schema = await bridge.tools_schema()
            if not tools_schema.standard_tools:
                tools_schema = None
        except asyncio.CancelledError as err:
            logger.warning("Starting without MCP tools after MCP startup was cancelled: {}", err)
            with suppress(Exception):
                await bridge.close()
            bridge = None
        except Exception as err:
            logger.warning("Starting without MCP tools: {}", err)
            with suppress(Exception):
                await bridge.close()
            bridge = None

    if provider_kind == "gemini":
        llm = _gemini_live_service(
            api_key=api_key,
            model=realtime_model,
            flow=flow,
            integration=integration,
        )
    else:
        llm = _openai_realtime_service(
            api_key=api_key,
            model=realtime_model,
            flow=flow,
            integration=integration,
            tools_schema=tools_schema,
        )
    if bridge and tools_schema:
        await bridge.register_tools_schema(tools_schema, llm)

    if tools_schema:
        context = LLMContext([{"role": "developer", "content": flow.greeting}], tools_schema)
    else:
        context = LLMContext([{"role": "developer", "content": flow.greeting}])
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        realtime_service_mode=True,
    )

    audio_debug = None
    if config.audio_debug_enabled:
        try:
            audio_debug = create_audio_debug_session(
                config,
                flow,
                provider_kind,
                realtime_model,
            )
        except Exception as err:
            logger.warning("Audio debug recorder could not start: {}", err)
    processors = [transport.input()]
    if audio_debug:
        processors.append(audio_debug.input_recorder)
    processors.extend([user_aggregator, llm])
    if audio_debug:
        processors.append(audio_debug.output_recorder)
    processors.extend([transport.output(), assistant_aggregator])

    pipeline = Pipeline(processors)

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected to flow {}", flow.id)
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected from flow {}", flow.id)
        await worker.cancel()

    try:
        runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
        await runner.add_workers(worker)
        await runner.run()
    finally:
        if bridge:
            await bridge.close()
        if audio_debug:
            with suppress(Exception):
                audio_debug.close()


async def bot(runner_args: RunnerArguments):
    """Pipecat runner entry point."""

    config = STORE.load()
    body = runner_args.body if isinstance(runner_args.body, dict) else {}
    flow = config.selected_flow(body.get("flow_id"))
    transport = await create_transport(runner_args, _transport_params(flow))
    await run_bot(transport, runner_args, config, flow, mcp_token=config.effective_mcp_token)


def main() -> None:
    _configure_logging()
    parser = argparse.ArgumentParser(description="Pipecat Assist")
    runner_main(parser)


if __name__ == "__main__":
    main()
