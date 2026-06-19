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

import httpx
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
    DEFAULT_AWS_NOVA_SONIC_MODEL,
    DEFAULT_AWS_NOVA_SONIC_VOICE,
    DEFAULT_CARTESIA_MODEL,
    DEFAULT_CARTESIA_VOICE,
    DEFAULT_ELEVENLABS_MODEL,
    DEFAULT_ELEVENLABS_VOICE,
    DEFAULT_GEMINI_LIVE_MODEL,
    DEFAULT_GEMINI_LIVE_VOICE,
    DEFAULT_GEMINI_TEXT_MODEL,
    DEFAULT_GOOGLE_TTS_VOICE,
    DEFAULT_OPENAI_TEXT_MODEL,
    DEFAULT_OPENAI_REALTIME_MODEL,
    DEFAULT_OPENAI_REALTIME_VOICE,
    DEFAULT_OPENAI_TTS_MODEL,
    DEFAULT_OPENAI_TTS_VOICE,
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


def _static_models_for(integration: IntegrationConfig, capability: str) -> list[dict[str, str]]:
    values: list[str] = []
    if integration.kind == "openai":
        if capability == "realtime":
            values = [integration.default_realtime_model or DEFAULT_OPENAI_REALTIME_MODEL]
        elif capability == "tts":
            values = [integration.default_model or DEFAULT_OPENAI_TTS_MODEL, DEFAULT_OPENAI_TTS_MODEL]
        else:
            values = [integration.default_model or DEFAULT_OPENAI_TEXT_MODEL]
    elif integration.kind == "gemini":
        values = [
            integration.default_realtime_model or DEFAULT_GEMINI_LIVE_MODEL,
            integration.default_model or DEFAULT_GEMINI_TEXT_MODEL,
        ]
    elif integration.kind == "cartesia":
        values = [integration.default_model or DEFAULT_CARTESIA_MODEL]
    elif integration.kind == "elevenlabs":
        values = [integration.default_model or DEFAULT_ELEVENLABS_MODEL]
    elif integration.kind == "google_cloud_tts":
        values = [integration.default_voice or DEFAULT_GOOGLE_TTS_VOICE]
    elif integration.kind == "aws_nova_sonic":
        values = [integration.default_realtime_model or DEFAULT_AWS_NOVA_SONIC_MODEL]
    elif integration.kind == "aws_bedrock":
        values = [integration.default_model or "amazon.nova-pro-v1:0"]
    else:
        values = [value for value in (integration.default_model, integration.default_realtime_model) if value]
    seen = set()
    return [
        {"id": value, "label": value}
        for value in values
        if value and not (value in seen or seen.add(value))
    ]


def _filter_openai_model(model_id: str, capability: str) -> bool:
    if capability == "realtime":
        return "realtime" in model_id
    if capability == "tts":
        return "tts" in model_id
    if capability == "stt":
        return "transcribe" in model_id or "whisper" in model_id
    return model_id.startswith(("gpt-", "o"))


@app.get("/api/assist/integrations/{integration_id}/models")
async def api_integration_models(integration_id: str, capability: str = "llm"):
    config = STORE.load()
    integration = config.integration(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    fallback = _static_models_for(integration, capability)
    try:
        if integration.kind == "openai" and (integration.api_key or config.openai_api_key):
            headers = {"Authorization": f"Bearer {integration.api_key or config.openai_api_key}"}
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get("https://api.openai.com/v1/models", headers=headers)
                response.raise_for_status()
            models = sorted(
                item["id"]
                for item in response.json().get("data", [])
                if _filter_openai_model(str(item.get("id", "")), capability)
            )
            if models:
                return {"ok": True, "models": [{"id": item, "label": item} for item in models]}

        if integration.kind == "gemini" and integration.api_key:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": integration.api_key},
                )
                response.raise_for_status()
            models = []
            for item in response.json().get("models", []):
                name = str(item.get("name", ""))
                methods = item.get("supportedGenerationMethods", [])
                if capability == "realtime" and "live" not in name.lower():
                    continue
                if capability != "realtime" and "generateContent" not in methods:
                    continue
                models.append(name)
            if models:
                return {"ok": True, "models": [{"id": item, "label": item} for item in sorted(models)]}
    except Exception as err:
        logger.debug("Model list fetch failed for {}: {}", integration_id, err)

    return {"ok": False, "models": fallback}


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


@app.post("/api/assist/integrations/{integration_id}/reset")
async def api_reset_integration(integration_id: str, request: Request):
    try:
        config = STORE.reset_integration_defaults(integration_id)
    except KeyError as err:
        raise HTTPException(status_code=404, detail="Integration not found") from err
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


def _enabled_step(flow: FlowConfig, kind: str):
    return next((step for step in flow.steps if step.kind == kind and step.enabled), None)


def _step_integration(
    config: RuntimeConfig,
    flow: FlowConfig,
    kind: str,
) -> tuple[Any, IntegrationConfig | None]:
    step = _enabled_step(flow, kind)
    if not step:
        return None, None
    return step, config.integration(step.integration_id)


def _secret(integration: IntegrationConfig | None, field: str = "api_key") -> str:
    if not integration:
        return ""
    return str(getattr(integration, field, "") or "").strip()


def _require_integration(
    integration: IntegrationConfig | None,
    role: str,
    fields: tuple[str, ...] = ("api_key",),
) -> IntegrationConfig:
    if not integration:
        raise RuntimeError(f"{role} integration is not selected")
    if not integration.enabled:
        raise RuntimeError(f"{integration.name} is disabled")
    if fields and not any(_secret(integration, field) for field in fields):
        readable = " or ".join(fields)
        raise RuntimeError(f"{integration.name} is missing {readable}")
    return integration


def _integration_api_key(
    integration: IntegrationConfig,
    role: str,
    fallback: str = "",
) -> str:
    api_key = (integration.api_key or fallback or "").strip()
    if not api_key:
        raise RuntimeError(f"{integration.name} is missing api_key for {role}")
    return api_key


def _step_model(step, integration: IntegrationConfig | None, fallback: str = "") -> str:
    return (
        (getattr(step, "model", "") if step else "")
        or (integration.default_model if integration else "")
        or fallback
    ).strip()


def _step_realtime_model(step, integration: IntegrationConfig | None, fallback: str = "") -> str:
    return (
        (getattr(step, "model", "") if step else "")
        or (integration.default_realtime_model if integration else "")
        or fallback
    ).strip()


def _step_voice(step, integration: IntegrationConfig | None, fallback: str = "") -> str:
    return (
        (getattr(step, "voice", "") if step else "")
        or (integration.default_voice if integration else "")
        or fallback
    ).strip()


def _runtime_mode(flow: FlowConfig, provider_kind: str | None = None) -> str:
    if flow.mode == "composed" or flow.mode == "classic":
        return "composed"
    if flow.pipeline_template in {
        "soniox_openai_cartesia",
        "soniox_openai_gradium",
        "deepgram_gemini_google_tts",
        "deepgram_google_google_tts",
        "speechmatics_aws_elevenlabs",
        "cloud_cascade",
        "local_first",
    }:
        return "composed"
    if provider_kind == "aws_nova_sonic" or flow.pipeline_template == "aws_nova_sonic":
        return "s2s"
    return "s2s"


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


def _aws_nova_sonic_service(
    *,
    integration: IntegrationConfig,
    flow: FlowConfig,
    model: str,
    tools_schema,
):
    from pipecat.services.aws.nova_sonic.llm import AWSNovaSonicLLMService

    tools = tools_schema.standard_tools if tools_schema and tools_schema.standard_tools else None
    return AWSNovaSonicLLMService(
        access_key_id=integration.access_key_id,
        secret_access_key=integration.secret_key,
        session_token=integration.token or None,
        region=integration.region or "us-east-1",
        settings=AWSNovaSonicLLMService.Settings(
            model=model or DEFAULT_AWS_NOVA_SONIC_MODEL,
            voice=flow.voice or integration.default_voice or DEFAULT_AWS_NOVA_SONIC_VOICE,
            system_instruction=flow.instructions,
        ),
        tools=tools,
    )


def _build_stt_service(config: RuntimeConfig, flow: FlowConfig):
    step, integration = _step_integration(config, flow, "stt")
    integration = _require_integration(integration, "STT", fields=())
    model = _step_model(step, integration)

    if integration.kind == "soniox":
        from pipecat.services.soniox.stt import SonioxSTTService

        return SonioxSTTService(
            api_key=_integration_api_key(integration, "STT"),
            settings=SonioxSTTService.Settings(model=model or None),
        )
    if integration.kind == "deepgram":
        from pipecat.services.deepgram.stt import DeepgramSTTService

        return DeepgramSTTService(
            api_key=_integration_api_key(integration, "STT"),
            settings=DeepgramSTTService.Settings(model=model or None),
        )
    if integration.kind == "speechmatics":
        from pipecat.services.speechmatics.stt import SpeechmaticsSTTService

        return SpeechmaticsSTTService(api_key=_integration_api_key(integration, "STT"))
    if integration.kind == "gradium":
        from pipecat.services.gradium.stt import GradiumSTTService

        return GradiumSTTService(
            api_key=_integration_api_key(integration, "STT"),
            settings=GradiumSTTService.Settings(model=model or None),
        )
    if integration.kind == "openai":
        from pipecat.services.openai.stt import OpenAIRealtimeSTTService

        return OpenAIRealtimeSTTService(
            api_key=_integration_api_key(integration, "STT", config.openai_api_key),
            model=model or "gpt-4o-mini-transcribe",
            language=flow.language or "en",
        )

    raise RuntimeError(f"STT provider {integration.kind} is not supported by composed runtime")


def _build_llm_service(config: RuntimeConfig, flow: FlowConfig, tools_schema=None):
    step, integration = _step_integration(config, flow, "llm")
    integration = _require_integration(integration, "LLM", fields=())
    model = _step_model(step, integration, flow.text_model)

    if integration.kind == "openai":
        from pipecat.services.openai.llm import OpenAILLMService

        api_key = integration.api_key or config.openai_api_key
        if not api_key:
            raise RuntimeError("OpenAI is missing api_key")
        return OpenAILLMService(
            api_key=api_key,
            organization=integration.organization or None,
            project=integration.project or None,
            settings=OpenAILLMService.Settings(
                model=model or DEFAULT_OPENAI_TEXT_MODEL,
                system_instruction=flow.instructions,
                max_tokens=flow.max_output_tokens,
            ),
        )
    if integration.kind == "gemini":
        from pipecat.services.google.llm import GoogleLLMService

        api_key = integration.api_key or os.getenv("GOOGLE_API_KEY", "")
        if not api_key:
            raise RuntimeError("Google Gemini is missing api_key")
        return GoogleLLMService(
            api_key=api_key,
            settings=GoogleLLMService.Settings(
                model=model or integration.default_model or DEFAULT_GEMINI_TEXT_MODEL,
                system_instruction=flow.instructions,
                max_tokens=flow.max_output_tokens or 4096,
            ),
        )
    if integration.kind == "aws_bedrock":
        from pipecat.services.aws.llm import AWSBedrockLLMService

        _require_integration(integration, "AWS Bedrock", fields=("access_key_id", "secret_key"))
        return AWSBedrockLLMService(
            aws_access_key=integration.access_key_id,
            aws_secret_key=integration.secret_key,
            aws_session_token=integration.token or None,
            aws_region=integration.region or "us-east-1",
            settings=AWSBedrockLLMService.Settings(
                model=model or integration.default_model,
                system_instruction=flow.instructions,
                max_tokens=flow.max_output_tokens,
            ),
        )
    if integration.kind == "openai_compatible":
        from pipecat.services.openai.llm import OpenAILLMService

        return OpenAILLMService(
            api_key=integration.api_key or "not-needed",
            base_url=integration.base_url or None,
            settings=OpenAILLMService.Settings(
                model=model or integration.default_model,
                system_instruction=flow.instructions,
                max_tokens=flow.max_output_tokens,
            ),
        )
    if integration.kind == "ollama":
        from pipecat.services.ollama.llm import OLLamaLLMService

        return OLLamaLLMService(
            base_url=integration.base_url or "http://localhost:11434/v1",
            settings=OLLamaLLMService.Settings(
                model=model or integration.default_model or "llama3.2",
                system_instruction=flow.instructions,
            ),
        )

    raise RuntimeError(f"LLM provider {integration.kind} is not supported by composed runtime")


def _build_tts_service(config: RuntimeConfig, flow: FlowConfig):
    step, integration = _step_integration(config, flow, "tts")
    integration = _require_integration(integration, "TTS", fields=())
    model = _step_model(step, integration)
    voice = _step_voice(step, integration)

    if integration.kind == "cartesia":
        from pipecat.services.cartesia.tts import CartesiaTTSService

        return CartesiaTTSService(
            api_key=_integration_api_key(integration, "TTS"),
            settings=CartesiaTTSService.Settings(
                model=model or DEFAULT_CARTESIA_MODEL,
                voice=voice or DEFAULT_CARTESIA_VOICE,
            ),
        )
    if integration.kind == "gradium":
        from pipecat.services.gradium.tts import GradiumTTSService

        return GradiumTTSService(
            api_key=_integration_api_key(integration, "TTS"),
            settings=GradiumTTSService.Settings(
                model=model or None,
                voice=voice or None,
            ),
        )
    if integration.kind == "google_cloud_tts":
        from pipecat.services.google.tts import GoogleHttpTTSService

        if not integration.credentials_json and not integration.credentials_path:
            raise RuntimeError("Google Cloud TTS is missing service account credentials")
        return GoogleHttpTTSService(
            credentials=integration.credentials_json or None,
            credentials_path=integration.credentials_path or None,
            location=integration.location or None,
            settings=GoogleHttpTTSService.Settings(
                voice=voice or DEFAULT_GOOGLE_TTS_VOICE,
                speaking_rate=flow.speed,
            ),
        )
    if integration.kind == "elevenlabs":
        from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

        return ElevenLabsTTSService(
            api_key=_integration_api_key(integration, "TTS"),
            settings=ElevenLabsTTSService.Settings(
                model=model or DEFAULT_ELEVENLABS_MODEL,
                voice=voice or DEFAULT_ELEVENLABS_VOICE,
                speed=flow.speed,
            ),
        )
    if integration.kind == "openai":
        from pipecat.services.openai.tts import OpenAITTSService

        return OpenAITTSService(
            api_key=_integration_api_key(integration, "TTS", config.openai_api_key),
            settings=OpenAITTSService.Settings(
                model=model or DEFAULT_OPENAI_TTS_MODEL,
                voice=voice or DEFAULT_OPENAI_TTS_VOICE,
                speed=flow.speed,
            ),
        )
    if integration.kind == "soniox":
        from pipecat.services.soniox.tts import SonioxTTSService

        return SonioxTTSService(
            api_key=_integration_api_key(integration, "TTS"),
            settings=SonioxTTSService.Settings(voice=voice or None),
        )

    raise RuntimeError(f"TTS provider {integration.kind} is not supported by composed runtime")


def _flow_enabled(flow: FlowConfig) -> bool:
    return bool(flow.conversation_flow.get("enabled"))


def _flow_node_configs(flow: FlowConfig, bridge: HomeAssistantMCPBridge | None):
    from pipecat_flows import FlowsFunctionSchema

    nodes = flow.conversation_flow.get("nodes") or []
    by_id: dict[str, dict[str, Any]] = {}

    def node_config(node: dict[str, Any]) -> dict[str, Any]:
        node_id = str(node.get("id") or node.get("label") or "node")
        if node_id in by_id:
            return by_id[node_id]

        functions = []
        for fn in node.get("functions") or []:
            name = str(fn.get("name") or f"go_to_{fn.get('next_node_id', 'next')}")
            description = str(fn.get("description") or "Continue the conversation.")
            properties = fn.get("properties") if isinstance(fn.get("properties"), dict) else {}
            required = fn.get("required") if isinstance(fn.get("required"), list) else []
            next_node_id = str(fn.get("next_node_id") or "")
            mcp_tool = str(fn.get("mcp_tool") or "")

            async def handler(args, flow_manager, *, next_node_id=next_node_id, mcp_tool=mcp_tool):
                result: Any = {"status": "ok"}
                if mcp_tool:
                    if not bridge:
                        result = {"status": "error", "error": "Home Assistant MCP is not connected"}
                    else:
                        result = {
                            "status": "ok",
                            "tool": mcp_tool,
                            "result": await bridge.call_tool(mcp_tool, dict(args or {})),
                        }
                next_node = by_id.get(next_node_id) if next_node_id else None
                return result, next_node

            functions.append(
                FlowsFunctionSchema(
                    name=name,
                    description=description,
                    properties=properties,
                    required=required,
                    handler=handler,
                )
            )

        config_node: dict[str, Any] = {
            "name": node_id,
            "role_message": str(node.get("role_message") or flow.instructions),
            "task_messages": [
                {
                    "role": "developer",
                    "content": str(node.get("task") or "Continue the conversation."),
                }
            ],
            "functions": functions,
            "respond_immediately": bool(node.get("respond_immediately", True)),
        }
        if node.get("post_actions"):
            config_node["post_actions"] = node.get("post_actions")
        by_id[node_id] = config_node
        return config_node

    for node in nodes:
        node_config(node)

    initial_id = str(flow.conversation_flow.get("initial_node_id") or "")
    return by_id.get(initial_id) or next(iter(by_id.values()), None)


async def run_bot(
    transport: BaseTransport,
    runner_args: RunnerArguments,
    config: RuntimeConfig,
    flow: FlowConfig,
    mcp_token: str = "",
):
    """Run one Pipecat session."""

    integration = config.model_integration(flow)
    provider_kind = integration.kind if integration else flow.provider_id
    runtime_mode = _runtime_mode(flow, provider_kind)

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

    audio_debug = None

    if runtime_mode == "s2s":
        if provider_kind not in {"openai", "gemini", "aws_nova_sonic"}:
            raise RuntimeError(
                f"Realtime speech-to-speech runtime for {provider_kind} is not supported"
            )

        if provider_kind == "gemini":
            api_key = (integration.api_key if integration else "") or os.getenv("GOOGLE_API_KEY", "")
        elif provider_kind == "openai":
            api_key = (integration.api_key if integration else "") or config.openai_api_key
        else:
            api_key = ""

        if provider_kind in {"gemini", "openai"} and not api_key:
            raise RuntimeError(f"The selected {provider_kind} realtime provider is missing an API key")

        if provider_kind == "aws_nova_sonic":
            integration = _require_integration(
                integration,
                "AWS Nova Sonic",
                fields=("access_key_id", "secret_key"),
            )
            model_step = flow.model_step()
            realtime_model = _step_realtime_model(
                model_step,
                integration,
                DEFAULT_AWS_NOVA_SONIC_MODEL,
            )
            llm = _aws_nova_sonic_service(
                integration=integration,
                flow=flow,
                model=realtime_model,
                tools_schema=tools_schema,
            )
        elif provider_kind == "gemini":
            realtime_model = _model_name(flow, integration, provider_kind)
            llm = _gemini_live_service(
                api_key=api_key,
                model=realtime_model,
                flow=flow,
                integration=integration,
            )
        else:
            realtime_model = _model_name(flow, integration, provider_kind)
            llm = _openai_realtime_service(
                api_key=api_key,
                model=realtime_model,
                flow=flow,
                integration=integration,
                tools_schema=tools_schema,
            )

        logger.info(
            "Starting {} speech-to-speech model {} for flow {}",
            provider_kind,
            realtime_model,
            flow.id,
        )

        if bridge and tools_schema:
            await bridge.register_tools_schema(tools_schema, llm)

        greeting_messages = (
            [{"role": "developer", "content": flow.greeting}]
            if flow.greeting.strip()
            else []
        )
        context = (
            LLMContext(greeting_messages, tools_schema)
            if tools_schema
            else LLMContext(greeting_messages)
        )
        user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
            context,
            realtime_service_mode=True,
        )

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
            if _flow_enabled(flow):
                logger.warning("Pipecat Flows are ignored for speech-to-speech runtime {}", provider_kind)
            if flow.greeting.strip():
                await worker.queue_frames([LLMRunFrame()])

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            logger.info("Client disconnected from flow {}", flow.id)
            await worker.cancel()

    else:
        from pipecat.audio.vad.silero import SileroVADAnalyzer
        from pipecat.processors.aggregators.llm_response_universal import LLMUserAggregatorParams

        stt = _build_stt_service(config, flow)
        llm = _build_llm_service(config, flow, tools_schema=tools_schema)
        tts = _build_tts_service(config, flow)

        _, stt_integration = _step_integration(config, flow, "stt")
        llm_step, llm_integration = _step_integration(config, flow, "llm")
        _, tts_integration = _step_integration(config, flow, "tts")
        llm_model = _step_model(llm_step, llm_integration, flow.text_model)
        provider_label = "+".join(
            item.kind
            for item in (stt_integration, llm_integration, tts_integration)
            if item is not None
        )
        logger.info(
            "Starting composed realtime pipeline {} with LLM {} for flow {}",
            provider_label,
            llm_model,
            flow.id,
        )

        initial_flow_node = None
        active_tools_schema = None if _flow_enabled(flow) else tools_schema
        context_messages = [{"role": "developer", "content": flow.instructions}]
        if flow.greeting.strip():
            context_messages.append({"role": "developer", "content": flow.greeting})
        context = LLMContext(context_messages, active_tools_schema) if active_tools_schema else LLMContext(context_messages)
        context_aggregator = LLMContextAggregatorPair(
            context,
            user_params=LLMUserAggregatorParams(
                vad_analyzer=SileroVADAnalyzer(),
                filter_incomplete_user_turns=True,
            ),
        )

        if bridge and tools_schema and not _flow_enabled(flow):
            await bridge.register_tools_schema(tools_schema, llm)

        if _flow_enabled(flow):
            initial_flow_node = _flow_node_configs(flow, bridge)

        if config.audio_debug_enabled:
            try:
                audio_debug = create_audio_debug_session(
                    config,
                    flow,
                    provider_label or "composed",
                    llm_model,
                )
            except Exception as err:
                logger.warning("Audio debug recorder could not start: {}", err)

        processors = [transport.input()]
        if audio_debug:
            processors.append(audio_debug.input_recorder)
        processors.extend([stt, context_aggregator.user(), llm, tts])
        if audio_debug:
            processors.append(audio_debug.output_recorder)
        processors.extend([transport.output(), context_aggregator.assistant()])

        pipeline = Pipeline(processors)
        worker = PipelineWorker(
            pipeline,
            params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
            idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
        )
        flow_manager = None
        if initial_flow_node:
            from pipecat_flows import FlowManager

            flow_manager = FlowManager(
                worker=worker,
                llm=llm,
                context_aggregator=context_aggregator,
                transport=transport,
            )

        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            logger.info("Client connected to composed flow {}", flow.id)
            if flow_manager and initial_flow_node:
                await flow_manager.initialize(initial_flow_node)
            elif flow.greeting.strip():
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
