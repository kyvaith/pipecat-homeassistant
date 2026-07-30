"""Pipecat Assist add-on entry point."""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import time
import unicodedata
import uuid
import wave
from contextlib import suppress
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode, urljoin, urlsplit

import httpx
from fastapi import HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from loguru import logger
from starlette.staticfiles import StaticFiles

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.frames.frames import ErrorFrame, LLMRunFrame, URLImageRawFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frameworks.rtvi import RTVIObserverParams
from pipecat.runner.run import app, main as runner_main
from pipecat.runner.types import RunnerArguments, WebSocketRunnerArguments
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
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.workers.runner import WorkerRunner

from app.config import (
    COMPOSED_STEP_PROVIDER_KINDS,
    DEFAULT_AWS_NOVA_SONIC_MODEL,
    DEFAULT_AWS_NOVA_SONIC_VOICE,
    DEFAULT_CARTESIA_MODEL,
    DEFAULT_CARTESIA_VOICE,
    DEFAULT_DEEPGRAM_MODEL,
    DEFAULT_ELEVENLABS_MODEL,
    DEFAULT_ELEVENLABS_VOICE,
    DEFAULT_GEMINI_LIVE_MODEL,
    DEFAULT_GEMINI_LIVE_VOICE,
    DEFAULT_GEMINI_TEXT_MODEL,
    DEFAULT_GEMINI_TTS_MODEL,
    GEMINI_TTS_FALLBACK_MODELS,
    DEFAULT_GOOGLE_TTS_VOICE,
    DEFAULT_GOOGLE_IMAGEN_MODEL,
    DEFAULT_FAL_IMAGE_MODEL,
    DEFAULT_OPENAI_TEXT_MODEL,
    DEFAULT_OPENAI_REALTIME_MODEL,
    DEFAULT_OPENAI_REALTIME_VOICE,
    DEFAULT_OPENAI_STT_MODEL,
    DEFAULT_OPENAI_TTS_MODEL,
    DEFAULT_OPENAI_TTS_VOICE,
    DEFAULT_SONIOX_MODEL,
    DEFAULT_SPEECHMATICS_MODEL,
    DEFAULT_WEB_SEARCH_MODEL,
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
from app.esphome_provisioner import ESPHomeProvisioner
from app.mcp_bridge import (
    CombinedMCPBridge,
    check_mcp,
    clear_mcp_call_history,
    clear_mcp_tools_cache,
    list_mcp_call_history,
)
from app.session_memory import SESSION_MEMORY
from app.text_agent import run_text_conversation
from app.va_pipecat import websocket_transport_params
from app.va_pipecat_protocol import VaPipecatProtocol
from app.web_search_tool import run_gemini_web_search, run_openai_web_search, web_search_schema

STORE = ConfigStore()
STARTED_AT = time.time()
UI_DIR = Path(__file__).parent / "ui"
UI_CACHE_HEADERS = {"Cache-Control": "no-store"}
SUPERVISOR_URL = os.getenv("SUPERVISOR", "http://supervisor").rstrip("/")
HA_MCP_ADDON_PORT = 9583
HA_MCP_ADDON_SECRET_RE = re.compile(
    r"MCP Server URL(?:\s*\([^)]+\))?:\s*(?P<url>https?://[^\s\"'<>]+)",
    re.IGNORECASE,
)

DEFAULT_HA_STT_SAMPLE_RATE = 16000
DEFAULT_HA_STT_SAMPLE_WIDTH = 2
DEFAULT_HA_STT_CHANNELS = 1
OPENAI_TTS_FORMATS = {"mp3", "opus", "aac", "flac", "wav", "pcm"}
TTS_MEDIA_TYPES = {
    "aac": "audio/aac",
    "flac": "audio/flac",
    "mp3": "audio/mpeg",
    "opus": "audio/ogg",
    "pcm": "audio/L16",
    "wav": "audio/wav",
}
CONVERSATION_END_SYSTEM_HINT = (
    "If the user clearly ends the conversation, briefly acknowledge it and do not ask "
    "a follow-up question. The client will close the microphone after your farewell."
)
HA_STT_BRIDGE_KINDS = {
    "deepgram",
    "gemini",
    "gemini_cloud",
    "gradium",
    "local_runtime",
    "openai",
    "openai_cloud",
    "soniox",
    "speechmatics",
}
HA_TTS_BRIDGE_KINDS = {
    "cartesia",
    "elevenlabs",
    "gemini",
    "gemini_cloud",
    "google_cloud_tts",
    "google_streaming_tts",
    "gradium",
    "local_runtime",
    "openai",
    "openai_cloud",
    "soniox",
}
IMAGE_GENERATION_KINDS = {"google_imagen", "fal_image"}
PROVIDER_RETRY_STATUSES = {429, 500, 502, 503, 504}
TTS_PREFETCH_TTL_SECONDS = 90
TTS_PREFETCH: dict[tuple[str, str, str], tuple[float, Any]] = {}
HA_LIVE_TURN_TTL_SECONDS = 120
HA_LIVE_TRANSCRIPT_TIMEOUT_SECONDS = 30
HA_LIVE_RESULT_TIMEOUT_SECONDS = 75
HA_LIVE_TURNS_BY_TRANSCRIPT: dict[tuple[str, str], "HALiveTurn"] = {}
HA_LIVE_TURNS_BY_SPEECH: dict[tuple[str, str], "HALiveTurn"] = {}
HA_ASSIST_WARMUP_TASK: asyncio.Task | None = None
ESPHOME_PROVISIONER = ESPHomeProvisioner(
    STORE.load,
    supervisor_url=SUPERVISOR_URL,
    supervisor_token=os.getenv("SUPERVISOR_TOKEN", ""),
)


@dataclass
class HALiveTurn:
    flow_id: str
    provider: str
    started_at: float = field(default_factory=time.time)
    transcript: str = ""
    speech: str = ""
    audio_chunks: list[bytes] = field(default_factory=list)
    audio_sample_rate: int = 24000
    transcript_ready: asyncio.Event = field(default_factory=asyncio.Event)
    done: asyncio.Event = field(default_factory=asyncio.Event)
    error: str = ""
    task: asyncio.Task | None = None

    @property
    def audio(self) -> bytes:
        return b"".join(self.audio_chunks)

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


def _parse_speech_content(value: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for entry in value.split(";"):
        key, _, raw = entry.strip().partition("=")
        if key:
            fields[key] = raw.strip()
    return fields


def _wav_from_pcm(
    audio: bytes,
    *,
    sample_rate: int = DEFAULT_HA_STT_SAMPLE_RATE,
    sample_width: int = DEFAULT_HA_STT_SAMPLE_WIDTH,
    channels: int = DEFAULT_HA_STT_CHANNELS,
) -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setnchannels(channels)
        writer.setsampwidth(sample_width)
        writer.setframerate(sample_rate)
        writer.writeframes(audio)
    return output.getvalue()


def _audio_for_cloud_stt(request: Request, audio: bytes) -> tuple[bytes, str]:
    """Return a valid upload payload for cloud STT APIs.

    Home Assistant's live Assist pipeline streams raw 16-bit PCM chunks while
    advertising WAV/PCM metadata. Cloud HTTP STT APIs expect a real WAV file.
    """

    content_type = request.headers.get("content-type") or "audio/wav"
    metadata = _parse_speech_content(request.headers.get("x-speech-content", ""))
    return _audio_for_cloud_stt_metadata(audio, metadata, content_type)


def _audio_for_cloud_stt_metadata(
    audio: bytes,
    metadata: dict[str, Any],
    content_type: str = "audio/wav",
) -> tuple[bytes, str]:
    """Return a valid upload payload using parsed Home Assistant speech metadata."""

    audio_format = metadata.get("format", "wav").lower()
    codec = metadata.get("codec", "pcm").lower()
    if audio_format == "wav" and codec == "pcm" and not audio.startswith(b"RIFF"):
        sample_rate = int(metadata.get("sample_rate") or DEFAULT_HA_STT_SAMPLE_RATE)
        bit_rate = int(metadata.get("bit_rate") or 16)
        channels = int(metadata.get("channel") or DEFAULT_HA_STT_CHANNELS)
        sample_width = max(1, bit_rate // 8)
        return _wav_from_pcm(
            audio,
            sample_rate=sample_rate,
            sample_width=sample_width,
            channels=channels,
        ), "audio/wav"
    return audio, content_type


def _pcm_stream_payload(chunk: bytes) -> bytes:
    """Return raw PCM payload, stripping a WAV header when a streamed chunk has one."""

    if chunk.startswith(b"RIFF"):
        data_index = chunk.find(b"data")
        if data_index >= 0 and len(chunk) >= data_index + 8:
            return chunk[data_index + 8 :]
    return chunk


def _normalized_turn_text(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def _ha_live_turn_key(flow_id: str, text: str) -> tuple[str, str]:
    return flow_id, _normalized_turn_text(text)


def _prune_ha_live_turns() -> None:
    now = time.time()
    for table in (HA_LIVE_TURNS_BY_TRANSCRIPT, HA_LIVE_TURNS_BY_SPEECH):
        for key, turn in list(table.items()):
            if now - turn.started_at > HA_LIVE_TURN_TTL_SECONDS:
                table.pop(key, None)


def _remember_ha_live_transcript(turn: HALiveTurn) -> None:
    transcript = turn.transcript.strip()
    if not transcript:
        return
    _prune_ha_live_turns()
    HA_LIVE_TURNS_BY_TRANSCRIPT[_ha_live_turn_key(turn.flow_id, transcript)] = turn


def _remember_ha_live_speech(turn: HALiveTurn) -> None:
    speech = turn.speech.strip()
    if not speech:
        return
    _prune_ha_live_turns()
    HA_LIVE_TURNS_BY_SPEECH[_ha_live_turn_key(turn.flow_id, speech)] = turn


def _find_ha_live_turn_by_transcript(flow_id: str, text: str) -> HALiveTurn | None:
    _prune_ha_live_turns()
    return HA_LIVE_TURNS_BY_TRANSCRIPT.get(_ha_live_turn_key(flow_id, text))


def _find_ha_live_turn_by_speech(flow_id: str, text: str) -> HALiveTurn | None:
    _prune_ha_live_turns()
    return HA_LIVE_TURNS_BY_SPEECH.get(_ha_live_turn_key(flow_id, text))


def _ws_metadata_value(metadata: dict[str, Any], key: str, default: Any) -> Any:
    value = metadata.get(key)
    return default if value in {None, ""} else value


def _stt_metadata_from_start(start: dict[str, Any]) -> dict[str, Any]:
    metadata = start.get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def _preferred_tts_format(payload: dict[str, Any]) -> str:
    options = payload.get("options")
    if not isinstance(options, dict):
        return "mp3"
    preferred = str(options.get("preferred_format") or "").strip().lower()
    return preferred if preferred in OPENAI_TTS_FORMATS else "mp3"


def _gemini_model_path(model: str) -> str:
    clean = (model or "").strip() or DEFAULT_GEMINI_TEXT_MODEL
    return clean.removeprefix("models/")


async def _gemini_generate_content(
    api_key: str,
    model: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{quote(_gemini_model_path(model), safe='')}:generateContent"
    async def request() -> httpx.Response:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(url, params={"key": api_key}, json=payload)
            response.raise_for_status()
            return response

    response = await _provider_call("Gemini", request)
    data = response.json()
    return data if isinstance(data, dict) else {}


def _provider_status(err: Exception) -> int | None:
    response = getattr(err, "response", None)
    status = getattr(response, "status_code", None) or getattr(err, "status_code", None)
    try:
        return int(status) if status else None
    except (TypeError, ValueError):
        return None


def _provider_body(err: Exception) -> Any:
    body = getattr(err, "body", None)
    if body:
        return body
    response = getattr(err, "response", None)
    if response is None:
        return None
    with suppress(Exception):
        return response.json()
    with suppress(Exception):
        return response.text
    return None


def _provider_message_from_body(body: Any) -> str:
    if isinstance(body, list):
        return "; ".join(filter(None, (_provider_message_from_body(item) for item in body)))
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or error.get("status") or error.get("code") or "").strip()
        if isinstance(error, str):
            return error.strip()
        return str(body.get("message") or body.get("detail") or "").strip()
    if isinstance(body, str):
        return body.strip()
    return ""


def _provider_safe_detail(label: str, err: Exception) -> str:
    status = _provider_status(err)
    message = _provider_message_from_body(_provider_body(err)) or str(err).split(" for url ")[0]
    message = message.replace("\n", " ").strip()
    if status:
        return f"{label} failed with HTTP {status}: {message}"
    return f"{label} failed: {message}"


def _provider_http_exception(label: str, err: Exception) -> HTTPException:
    if isinstance(err, HTTPException):
        return err
    status = _provider_status(err)
    http_status = status if status in {400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504} else 502
    if http_status >= 500:
        http_status = 503
    return HTTPException(status_code=http_status, detail=_provider_safe_detail(label, err))


def _provider_retryable(err: Exception) -> bool:
    status = _provider_status(err)
    return bool(status in PROVIDER_RETRY_STATUSES)


async def _provider_call(label: str, request, attempts: int = 3):
    for attempt in range(1, attempts + 1):
        try:
            return await request()
        except HTTPException:
            raise
        except Exception as err:
            if attempt >= attempts or not _provider_retryable(err):
                raise _provider_http_exception(label, err) from err
            logger.warning(
                "{} attempt {}/{} failed, retrying: {}",
                label,
                attempt,
                attempts,
                _provider_safe_detail(label, err),
            )
            await asyncio.sleep(min(2.0, 0.35 * (2 ** (attempt - 1))))

    raise HTTPException(status_code=503, detail=f"{label} failed after retries")


def _gemini_text(data: dict[str, Any]) -> str:
    for candidate in data.get("candidates") or []:
        for part in (candidate.get("content") or {}).get("parts") or []:
            text = part.get("text")
            if text:
                return str(text).strip()
    return ""


def _gemini_inline_audio(data: dict[str, Any]) -> tuple[bytes, str]:
    for candidate in data.get("candidates") or []:
        for part in (candidate.get("content") or {}).get("parts") or []:
            inline = part.get("inlineData") or part.get("inline_data") or {}
            encoded = inline.get("data")
            if encoded:
                return base64.b64decode(encoded), str(inline.get("mimeType") or inline.get("mime_type") or "audio/wav")
    raise HTTPException(status_code=502, detail="Gemini did not return audio")


def _gemini_tts_model_candidates(model: str, integration: IntegrationConfig) -> list[str]:
    fallback_models = {item.removeprefix("models/") for item in GEMINI_TTS_FALLBACK_MODELS}
    custom_candidates = []
    for candidate in (model, integration.default_tts_model):
        clean = (candidate or "").strip()
        if clean and clean.removeprefix("models/") not in fallback_models:
            custom_candidates.append(clean)
    candidates = [*custom_candidates, DEFAULT_GEMINI_TTS_MODEL, *GEMINI_TTS_FALLBACK_MODELS]
    seen: set[str] = set()
    values: list[str] = []
    for candidate in candidates:
        clean = (candidate or "").strip()
        if not clean or clean in seen:
            continue
        seen.add(clean)
        values.append(clean)
    return values


def _gemini_no_audio_reason(data: dict[str, Any]) -> str:
    reasons: list[str] = []
    for candidate in data.get("candidates") or []:
        reason = str(candidate.get("finishReason") or candidate.get("finish_reason") or "").strip()
        if reason:
            reasons.append(reason)
    prompt_feedback = data.get("promptFeedback") or data.get("prompt_feedback") or {}
    block_reason = str(prompt_feedback.get("blockReason") or prompt_feedback.get("block_reason") or "").strip()
    if block_reason:
        reasons.append(f"prompt blocked: {block_reason}")
    return ", ".join(dict.fromkeys(reasons))


def _audio_extension_for_media_type(media_type: str) -> str:
    clean = media_type.lower().split(";")[0].strip()
    return {
        "audio/aac": "aac",
        "audio/flac": "flac",
        "audio/l16": "wav",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/ogg": "opus",
        "audio/pcm": "wav",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
    }.get(clean, "wav")


def _mime_param(media_type: str, name: str) -> str:
    for chunk in media_type.split(";")[1:]:
        key, _, value = chunk.strip().partition("=")
        if key.lower() == name:
            return value.strip()
    return ""


def _normalize_inline_audio(audio: bytes, media_type: str) -> tuple[bytes, str, str]:
    extension = _audio_extension_for_media_type(media_type)
    if extension == "wav" and not audio.startswith(b"RIFF"):
        sample_rate = int(_mime_param(media_type, "rate") or _mime_param(media_type, "sample_rate") or 24000)
        return (
            _wav_from_pcm(audio, sample_rate=sample_rate, sample_width=2, channels=1),
            "audio/wav",
            "wav",
        )
    return audio, media_type.split(";")[0] or "audio/wav", extension


@app.middleware("http")
async def protect_satellite_offer(request: Request, call_next):
    """Require the shared satellite token for direct SmallWebRTC offers."""

    if _is_offer_path(request.url.path):
        secret = STORE.load().satellite_shared_secret
        if secret and not hmac.compare_digest(_extract_token(request), secret):
            return JSONResponse({"detail": "Invalid satellite token"}, status_code=401)
    try:
        return await call_next(request)
    except Exception as err:
        if _is_offer_path(request.url.path):
            logger.exception("SmallWebRTC offer failed: {}", err)
            return JSONResponse({"detail": str(err) or err.__class__.__name__}, status_code=400)
        raise


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


def _esphome_ws_query(config: RuntimeConfig) -> str:
    values = {
        "token": config.satellite_shared_secret,
        "flow_id": config.selected_flow_id,
    }
    return urlencode({key: value for key, value in values.items() if value})


def _esphome_ws_url(config: RuntimeConfig, request: Request) -> str:
    host = config.runner_host
    if host in {"0.0.0.0", "::", ""}:
        host = request.url.hostname or "homeassistant.local"
    query = _esphome_ws_query(config)
    suffix = f"?{query}" if query else ""
    # The host-network runner port is plain WebSocket even when this response
    # was reached through an HTTPS Home Assistant Ingress page.
    return f"ws://{host}:{config.runner_port}/api/assist/esphome{suffix}"


def _esphome_ws_path(config: RuntimeConfig) -> str:
    query = _esphome_ws_query(config)
    suffix = f"?{query}" if query else ""
    return f"api/assist/esphome{suffix}"


def _va_pipecat_protocol(config: RuntimeConfig) -> VaPipecatProtocol:
    """Build the ESPHome protocol contract from persisted runtime settings."""

    return VaPipecatProtocol(
        _should_end_conversation,
        follow_up_ms=config.esphome_follow_up_ms,
        follow_up_open_delay_ms=config.esphome_follow_up_open_delay_ms,
        wake_open_delay_ms=config.esphome_wake_open_delay_ms,
        playback_prebuffer_ms=config.esphome_playback_prebuffer_ms,
    )


def _supervisor_headers() -> dict[str, str]:
    token = os.getenv("SUPERVISOR_TOKEN", "")
    if not token:
        raise RuntimeError("Supervisor token is not available in this add-on.")
    return {"Authorization": f"Bearer {token}"}


def _supervisor_payload(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload.get("data")
    return payload


def _looks_like_ha_mcp_addon(addon: dict[str, Any]) -> bool:
    slug = str(addon.get("slug") or "").lower()
    name = str(addon.get("name") or "").lower()
    image = str(addon.get("image") or "").lower()
    repository = str(addon.get("repository") or addon.get("url") or "").lower()
    return (
        slug == "ha_mcp"
        or slug == "ha_mcp_dev"
        or slug.endswith("_ha_mcp")
        or slug.endswith("_ha_mcp_dev")
        or "home assistant mcp server" in name
        or "homeassistant-ai/ha-mcp" in image
        or "homeassistant-ai/ha-mcp" in repository
    )


def _extract_ha_mcp_secret_path(text: str) -> tuple[str, str]:
    for match in HA_MCP_ADDON_SECRET_RE.finditer(text or ""):
        raw_url = match.group("url").rstrip(".,;)")
        path = urlsplit(raw_url).path.strip("/")
        if path and path != "settings":
            return path, "logs"
    return "", ""


def _ha_mcp_secret_path_from_options(addon: dict[str, Any]) -> tuple[str, str]:
    options = addon.get("options")
    if not isinstance(options, dict):
        return "", ""
    value = str(options.get("secret_path") or "").strip().strip("/")
    return (value, "options") if value else ("", "")


def _ha_mcp_addon_port(addon: dict[str, Any]) -> int:
    ports = addon.get("ports")
    if isinstance(ports, dict):
        for key, value in ports.items():
            if str(key).startswith(f"{HA_MCP_ADDON_PORT}/"):
                with suppress(TypeError, ValueError):
                    port = int(value)
                    if port > 0:
                        return port
    return HA_MCP_ADDON_PORT


def _ha_mcp_local_url(addon: dict[str, Any], path: str) -> str:
    port = _ha_mcp_addon_port(addon)
    return f"http://127.0.0.1:{port}/{path.strip('/')}"


async def _supervisor_json(client: httpx.AsyncClient, path: str) -> Any:
    response = await client.get(f"{SUPERVISOR_URL}{path}", headers=_supervisor_headers())
    response.raise_for_status()
    return _supervisor_payload(response.json())


async def _supervisor_text(client: httpx.AsyncClient, path: str) -> str:
    response = await client.get(f"{SUPERVISOR_URL}{path}", headers=_supervisor_headers())
    response.raise_for_status()
    return response.text


async def detect_ha_mcp_server_addon() -> dict[str, Any]:
    """Detect the homeassistant-ai/ha-mcp add-on endpoint through Supervisor."""

    try:
        headers = _supervisor_headers()
    except RuntimeError as err:
        return {"ok": False, "error": str(err)}

    try:
        async with httpx.AsyncClient(timeout=10.0, headers=headers) as client:
            addons_payload = await _supervisor_json(client, "/addons")
            addons = addons_payload.get("addons") if isinstance(addons_payload, dict) else []
            if not isinstance(addons, list):
                addons = []
            addon = next(
                (item for item in addons if isinstance(item, dict) and _looks_like_ha_mcp_addon(item)),
                None,
            )
            if not addon:
                return {
                    "ok": False,
                    "installed": False,
                    "error": "Home Assistant MCP Server add-on was not found.",
                }

            slug = str(addon.get("slug") or "").strip()
            if slug:
                with suppress(Exception):
                    info = await _supervisor_json(client, f"/addons/{slug}/info")
                    if isinstance(info, dict):
                        addon = {**addon, **info, "slug": slug}

            path, source = _ha_mcp_secret_path_from_options(addon)
            if not path and slug:
                with suppress(Exception):
                    logs = await _supervisor_text(client, f"/addons/{slug}/logs")
                    path, source = _extract_ha_mcp_secret_path(logs)

            if not path:
                return {
                    "ok": False,
                    "installed": True,
                    "running": str(addon.get("state") or "").lower() == "started",
                    "slug": slug,
                    "error": (
                        "Could not detect the HA MCP secret URL. Start or restart the "
                        "Home Assistant MCP Server add-on, then try auto-detect again."
                    ),
                }

            return {
                "ok": True,
                "installed": True,
                "running": str(addon.get("state") or "").lower() == "started",
                "slug": slug,
                "url": _ha_mcp_local_url(addon, path),
                "source": source,
            }
    except httpx.HTTPStatusError as err:
        return {
            "ok": False,
            "error": f"Supervisor API returned HTTP {err.response.status_code}.",
        }
    except httpx.HTTPError as err:
        return {"ok": False, "error": f"Supervisor API is not reachable: {err}"}


def _config_response(config: RuntimeConfig, request: Request) -> dict[str, Any]:
    data = config.public_dict()
    data["runner_offer_url"] = _offer_url(config, request)
    data["runner_offer_path"] = _offer_path(config)
    data["esphome_ws_url"] = _esphome_ws_url(config, request)
    data["esphome_ws_path"] = _esphome_ws_path(config)
    data["esphome_provisioning"] = ESPHOME_PROVISIONER.status()
    return data


def _is_http_endpoint(value: str) -> bool:
    return value.startswith("http://") or value.startswith("https://")


def _mcp_endpoint_for_integration(integration: IntegrationConfig) -> tuple[str, str]:
    url = (integration.base_url or integration.endpoint).strip()
    token = ""
    if integration.kind != "ha_mcp":
        token = (integration.token or integration.api_key).strip()
    return url, token


async def _check_integration_mcp(
    config: RuntimeConfig,
    integration: IntegrationConfig,
    payload: dict[str, Any],
) -> dict[str, Any]:
    flow = config.selected_flow(payload.get("flow_id"))
    refresh = bool(payload.get("refresh", True))
    if refresh:
        clear_mcp_tools_cache()

    if integration.kind == "home_assistant_mcp":
        url = config.effective_mcp_url
        token = config.effective_mcp_token
    else:
        url, token = _mcp_endpoint_for_integration(integration)

    if not _is_http_endpoint(url):
        return {"ok": False, "error": "MCP server URL is missing.", "tool_count": 0, "tools": []}

    return await check_mcp(
        url,
        token,
        flow.mcp_tool_allowlist,
        cache_enabled=config.mcp_tools_cache_enabled,
        cache_ttl_seconds=config.mcp_tools_cache_ttl_seconds,
        refresh=refresh,
    )


@app.get("/api/assist/status")
async def api_status(request: Request):
    config = STORE.load()
    flow = config.selected_flow(None)
    flow_errors = _runtime_flow_errors(config, flow)
    return {
        "ok": True,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "runner": {
            "host": config.runner_host,
            "port": config.runner_port,
            "offer_url": _offer_url(config, request),
            "offer_path": _offer_path(config),
            "esphome_ws_path": "api/assist/esphome",
        },
        "selected_flow_id": config.selected_flow_id,
        "selected_flow_ready": not flow_errors,
        "selected_flow_errors": flow_errors,
        "flow_count": len(config.flows),
        "mcp_url": config.effective_mcp_url,
        "mcp_token_configured": bool(config.effective_mcp_token),
        "mcp_token_source": config.effective_mcp_token_source,
    }


@app.websocket("/api/assist/esphome")
async def api_esphome_satellite(websocket: WebSocket):
    """Run an authenticated raw-PCM Pipecat session for an ESPHome satellite."""

    config = STORE.load()
    secret = config.satellite_shared_secret
    supplied_token = _extract_token(websocket)
    if secret and not hmac.compare_digest(supplied_token, secret):
        logger.warning("ESPHome satellite rejected: invalid or missing token")
        await websocket.close(code=4401)
        return

    flow_id = str(websocket.query_params.get("flow_id") or "").strip()
    flow = config.selected_flow(flow_id)
    flow_errors = _runtime_flow_errors(config, flow)
    if flow_errors:
        await websocket.close(code=4400, reason=flow_errors[0][:120])
        return

    client_id = (
        str(websocket.query_params.get("client_id") or "").strip()
        or str(websocket.client.host if websocket.client else "")
        or f"esphome-{uuid.uuid4().hex[:12]}"
    )
    session_id = str(uuid.uuid4())
    await websocket.accept()
    await websocket.send_text(_va_pipecat_protocol(config).hello())
    logger.info(
        "ESPHome satellite connected client_id={} flow={} session={}",
        client_id,
        flow.id,
        session_id,
    )

    runner_args = WebSocketRunnerArguments(
        websocket=websocket,
        transport_type="websocket",
        session_id=session_id,
        body={
            "client_id": client_id,
            "device_id": client_id,
            "flow_id": flow.id,
            "transport": "va-pipecat",
        },
    )
    # ESPHome keeps this low-latency control connection open from boot. The
    # generic runner's five-minute idle timeout is useful for browser calls but
    # would churn the satellite pipeline and MCP/model warm state.
    runner_args.pipeline_idle_timeout_secs = None
    try:
        await bot(runner_args)
    except WebSocketDisconnect:
        logger.info("ESPHome satellite disconnected client_id={}", client_id)
    except Exception as err:
        logger.exception("ESPHome satellite session failed client_id={}: {}", client_id, err)
        with suppress(Exception):
            payload = _va_pipecat_protocol(config).error_message(
                "session_failed",
                str(err) or err.__class__.__name__,
                recoverable=True,
            )
            await websocket.send_text(payload)
        with suppress(Exception):
            await websocket.close(code=1011)


@app.get("/api/assist/config")
async def api_get_config(request: Request):
    config = STORE.load()
    return _config_response(config, request)


@app.put("/api/assist/config")
async def api_update_config(payload: dict[str, Any], request: Request):
    config = STORE.update_from_public(payload)
    _schedule_ha_assist_warmup(config, reason="config_update")
    ESPHOME_PROVISIONER.request_scan()
    return _config_response(config, request)


def _static_models_for(integration: IntegrationConfig, capability: str) -> list[dict[str, str]]:
    values: list[str] = []
    if integration.kind == "openai":
        if capability == "realtime":
            values = [integration.default_realtime_model or DEFAULT_OPENAI_REALTIME_MODEL]
        else:
            values = []
    elif integration.kind == "openai_cloud":
        if capability == "stt":
            values = [integration.default_stt_model or DEFAULT_OPENAI_STT_MODEL, DEFAULT_OPENAI_STT_MODEL]
        elif capability == "tts":
            values = [integration.default_tts_model or DEFAULT_OPENAI_TTS_MODEL, DEFAULT_OPENAI_TTS_MODEL]
        else:
            values = [integration.default_model or DEFAULT_OPENAI_TEXT_MODEL, DEFAULT_OPENAI_TEXT_MODEL]
    elif integration.kind == "gemini":
        if capability == "realtime":
            values = [integration.default_realtime_model or DEFAULT_GEMINI_LIVE_MODEL]
        else:
            values = []
    elif integration.kind == "gemini_cloud":
        if capability == "llm":
            values = [integration.default_model or DEFAULT_GEMINI_TEXT_MODEL]
        elif capability == "tts":
            values = [integration.default_tts_model or DEFAULT_GEMINI_TTS_MODEL, DEFAULT_GEMINI_TTS_MODEL]
        else:
            values = []
    elif integration.kind == "cartesia":
        values = [integration.default_model or DEFAULT_CARTESIA_MODEL]
    elif integration.kind == "elevenlabs":
        values = [integration.default_model or DEFAULT_ELEVENLABS_MODEL]
    elif integration.kind == "google_cloud_tts":
        values = [integration.default_voice or DEFAULT_GOOGLE_TTS_VOICE]
    elif integration.kind == "google_streaming_tts":
        values = [integration.default_voice or DEFAULT_GOOGLE_TTS_VOICE]
    elif integration.kind == "web_search":
        values = [integration.default_model or DEFAULT_WEB_SEARCH_MODEL, DEFAULT_WEB_SEARCH_MODEL]
    elif integration.kind == "google_imagen":
        values = [integration.default_model or DEFAULT_GOOGLE_IMAGEN_MODEL, DEFAULT_GOOGLE_IMAGEN_MODEL]
    elif integration.kind == "fal_image":
        values = [integration.default_model or DEFAULT_FAL_IMAGE_MODEL, DEFAULT_FAL_IMAGE_MODEL]
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
        if integration.kind in {"openai", "openai_cloud"} and (integration.api_key or config.openai_api_key):
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

        if integration.kind in {"gemini", "gemini_cloud"} and integration.api_key:
            if integration.kind == "gemini_cloud" and capability == "stt":
                return {"ok": False, "models": fallback}
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
                if integration.kind == "gemini" and capability == "realtime" and "live" not in name.lower():
                    continue
                if integration.kind == "gemini_cloud" and capability == "realtime":
                    continue
                if integration.kind == "gemini_cloud" and capability == "tts" and "tts" not in name.lower():
                    continue
                if integration.kind == "gemini_cloud" and capability == "llm" and "tts" in name.lower():
                    continue
                if integration.kind == "gemini_cloud" and "generateContent" not in methods:
                    continue
                if integration.kind == "gemini" and capability != "realtime":
                    continue
                models.append(name.removeprefix("models/") if integration.kind == "gemini" else name)
            if models:
                return {"ok": True, "models": [{"id": item, "label": item} for item in sorted(models)]}
    except Exception as err:
        logger.debug("Model list fetch failed for {}: {}", integration_id, err)

    return {"ok": False, "models": fallback}


@app.post("/api/assist/mcp/check")
async def api_check_mcp(payload: dict[str, Any] | None = None):
    config = STORE.load()
    payload = payload or {}
    flow = config.selected_flow(payload.get("flow_id"))
    refresh = bool(payload.get("refresh", True))
    if refresh:
        clear_mcp_tools_cache()
    return await check_mcp(
        config.effective_mcp_url,
        config.effective_mcp_token,
        flow.mcp_tool_allowlist,
        cache_enabled=config.mcp_tools_cache_enabled,
        cache_ttl_seconds=config.mcp_tools_cache_ttl_seconds,
        refresh=refresh,
    )


@app.post("/api/assist/mcp/reset")
async def api_reset_mcp(request: Request):
    config = STORE.reset_mcp_defaults()
    return _config_response(config, request)


@app.get("/api/assist/mcp/history")
async def api_mcp_history():
    return list_mcp_call_history()


@app.delete("/api/assist/mcp/history")
async def api_clear_mcp_history():
    return clear_mcp_call_history()


@app.post("/api/assist/integrations/{integration_id}/reset")
async def api_reset_integration(integration_id: str, request: Request):
    try:
        config = STORE.reset_integration_defaults(integration_id)
    except KeyError as err:
        raise HTTPException(status_code=404, detail="Integration not found") from err
    return _config_response(config, request)


@app.post("/api/assist/integrations/{integration_id}/detect")
async def api_detect_integration(integration_id: str, request: Request):
    config = STORE.load()
    integration = config.integration(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    if integration.kind != "ha_mcp":
        raise HTTPException(status_code=400, detail="Auto-detect is only available for the HA MCP Server add-on")

    detection = await detect_ha_mcp_server_addon()
    if detection.get("ok"):
        integration.enabled = True
        integration.base_url = str(detection.get("url") or "")
        integration.token = ""
        integration.api_key = ""
        STORE.save(config)

    data = _config_response(config, request)
    data["detection"] = detection
    return data


@app.post("/api/assist/integrations/{integration_id}/mcp/check")
async def api_check_integration_mcp(integration_id: str, request: Request, payload: dict[str, Any] | None = None):
    config = STORE.load()
    integration = config.integration(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    if integration.kind not in {"home_assistant_mcp", "ha_mcp", "mcp_server"}:
        raise HTTPException(status_code=400, detail="Integration is not an MCP server")

    payload = payload or {}
    detection: dict[str, Any] | None = None
    if integration.kind == "ha_mcp" and not _is_http_endpoint((integration.base_url or integration.endpoint).strip()):
        detection = await detect_ha_mcp_server_addon()
        if detection.get("ok"):
            integration.enabled = True
            integration.base_url = str(detection.get("url") or "")
            integration.token = ""
            integration.api_key = ""
            STORE.save(config)
        else:
            return {
                "ok": False,
                "error": detection.get("error") or "Could not detect the HA MCP Server add-on.",
                "tool_count": 0,
                "tools": [],
                "detection": detection,
            }

    result = await _check_integration_mcp(config, integration, payload)
    if detection:
        result["detection"] = detection
        result["config"] = _config_response(config, request)
    return result


@app.post("/api/assist/conversation")
async def api_conversation(payload: dict[str, Any]):
    started_at = time.perf_counter()
    text = str(payload.get("text", "")).strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    config = STORE.load()
    flow = config.selected_flow(payload.get("flow_id"))
    live_turn = _find_ha_live_turn_by_transcript(flow.id, text)
    if live_turn:
        try:
            live_result = await _ha_live_conversation_result(
                live_turn,
                conversation_id=payload.get("conversation_id"),
            )
        except Exception as err:
            raise HTTPException(
                status_code=502,
                detail=f"Pipecat Live Bridge conversation failed: {err}",
            ) from err
        if live_result:
            end_conversation = _should_end_conversation(
                text,
                str(live_result.get("speech") or ""),
            )
            live_result["end_conversation"] = end_conversation
            live_result["continue_conversation"] = not end_conversation
            logger.info(
                "HA Assist conversation served from Pipecat Live Bridge flow={} input={} speech={} continue={} total_ms={:.0f}",
                flow.id,
                _text_fingerprint(text),
                _text_fingerprint(str(live_result.get("speech") or "")),
                live_result["continue_conversation"],
                (time.perf_counter() - started_at) * 1000,
            )
            return live_result
        raise HTTPException(status_code=502, detail="Pipecat Live Bridge conversation returned no speech")

    async def request():
        result = await run_text_conversation(
            config,
            text=text,
            language=payload.get("language"),
            conversation_id=payload.get("conversation_id"),
            flow_id=flow.id,
            mcp_token=config.effective_mcp_token,
        )
        end_conversation = _should_end_conversation(text, str(result.get("speech") or ""))
        result["end_conversation"] = end_conversation
        result["continue_conversation"] = (
            not bool(result.get("error"))
            and not end_conversation
        )
        if not result.get("error"):
            _start_tts_prefetch(
                config=config,
                flow=flow,
                text=str(result.get("speech") or ""),
                language=payload.get("language"),
            )
        logger.info(
            "HA Assist conversation served flow={} input={} speech={} error={} total_ms={:.0f}",
            flow.id,
            _text_fingerprint(text),
            _text_fingerprint(str(result.get("speech") or "")),
            result.get("error") or "",
            (time.perf_counter() - started_at) * 1000,
        )
        return result

    return await _provider_call("HA Assist conversation", request, attempts=1)


def _json_from_model_text(text: str) -> Any:
    """Parse JSON from a model answer that should contain only JSON."""

    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.strip("`")
        if clean.lower().startswith("json"):
            clean = clean[4:].strip()
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        pass

    start = clean.find("{")
    end = clean.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(clean[start : end + 1])
        except json.JSONDecodeError as err:
            raise ValueError("Model did not return valid JSON") from err
    start = clean.find("[")
    end = clean.rfind("]")
    if start >= 0 and end > start:
        try:
            return json.loads(clean[start : end + 1])
        except json.JSONDecodeError as err:
            raise ValueError("Model did not return valid JSON") from err
    raise ValueError("Model did not return valid JSON")


def _ai_task_prompt(payload: dict[str, Any]) -> str:
    task_name = str(payload.get("task_name") or "AI Task").strip()
    instructions = str(payload.get("instructions") or "").strip()
    fields = payload.get("structure_fields") if isinstance(payload.get("structure_fields"), list) else []
    if not fields:
        return f"Task: {task_name}\n\n{instructions}"

    field_lines = []
    for field in fields:
        if not isinstance(field, dict):
            continue
        required = "required" if field.get("required") else "optional"
        description = str(field.get("description") or "").strip()
        name = str(field.get("name") or "").strip()
        selector = str(field.get("selector") or "").strip()
        detail = f"{name} ({required})"
        extras = ", ".join(part for part in (description, selector) if part)
        field_lines.append(f"- {detail}: {extras}" if extras else f"- {detail}")

    return (
        f"Task: {task_name}\n\n"
        f"{instructions}\n\n"
        "Return only a JSON object for Home Assistant AI Tasks. "
        "Do not include markdown, commentary, or code fences. Fields:\n"
        + "\n".join(field_lines)
    )


def _ai_image_task_prompt(payload: dict[str, Any]) -> str:
    task_name = str(payload.get("task_name") or "Image generation task").strip()
    instructions = str(payload.get("instructions") or "").strip()
    return f"{task_name}\n\n{instructions}".strip()


def _enabled_image_generation_integration(
    config: RuntimeConfig,
    payload: dict[str, Any],
) -> IntegrationConfig:
    provider_id = str(payload.get("provider_id") or config.ai_image_provider_id or "").strip()
    if provider_id:
        integration = config.integration(provider_id)
        if not integration:
            raise HTTPException(status_code=404, detail=f"Image generation integration {provider_id} not found")
        if integration.kind not in IMAGE_GENERATION_KINDS:
            raise HTTPException(status_code=400, detail=f"{integration.name} cannot generate images")
        try:
            return _require_integration(integration, "Image generation", fields=())
        except RuntimeError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    for integration in config.integrations:
        if integration.kind not in IMAGE_GENERATION_KINDS or not integration.enabled:
            continue
        try:
            return _require_integration(integration, "Image generation", fields=())
        except RuntimeError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    raise HTTPException(
        status_code=400,
        detail="No image generation integration is enabled. Enable Google Imagen or fal Image Generation.",
    )


def _google_image_api_key(config: RuntimeConfig, integration: IntegrationConfig) -> str:
    candidates = [
        integration.api_key,
        (config.integration("gemini-cloud").api_key if config.integration("gemini-cloud") else ""),
        (config.integration("gemini").api_key if config.integration("gemini") else ""),
        os.getenv("GOOGLE_API_KEY", ""),
    ]
    api_key = next((candidate.strip() for candidate in candidates if candidate and candidate.strip()), "")
    if not api_key:
        raise HTTPException(status_code=400, detail=f"{integration.name} is missing api_key for image generation")
    return api_key


def _image_frame_size(size: Any) -> tuple[int, int] | None:
    if not isinstance(size, (list, tuple)) or len(size) != 2:
        return None
    try:
        width = int(size[0])
        height = int(size[1])
    except (TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return width, height


def _encode_image_frame(
    image_data: bytes,
    size: Any,
    image_format: str | None,
) -> tuple[bytes, str, int | None, int | None]:
    if not image_data:
        raise HTTPException(status_code=502, detail="Image provider returned an empty image")

    from PIL import Image

    with suppress(Exception):
        image = Image.open(BytesIO(image_data))
        image.load()
        mime = {
            "JPEG": "image/jpeg",
            "PNG": "image/png",
            "WEBP": "image/webp",
        }.get(str(image.format or "").upper(), "image/png")
        return image_data, mime, image.size[0], image.size[1]

    frame_size = _image_frame_size(size)
    if not frame_size:
        raise HTTPException(status_code=502, detail="Image provider returned raw image data without size")

    mode = str(image_format or "RGB").strip() or "RGB"
    try:
        image = Image.frombytes(mode, frame_size, image_data)
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Image provider returned unsupported image data: {err}") from err

    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGBA" if "A" in image.mode else "RGB")
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue(), "image/png", image.size[0], image.size[1]


async def _run_pipecat_image_generation(
    config: RuntimeConfig,
    integration: IntegrationConfig,
    prompt: str,
) -> dict[str, Any]:
    model = (integration.default_model or "").strip()
    if integration.kind == "google_imagen":
        from pipecat.services.google.image import GoogleImageGenService

        model = model or DEFAULT_GOOGLE_IMAGEN_MODEL
        service = GoogleImageGenService(
            api_key=_google_image_api_key(config, integration),
            settings=GoogleImageGenService.Settings(model=model, number_of_images=1),
        )
    elif integration.kind == "fal_image":
        import aiohttp
        from pipecat.services.fal.image import FalImageGenService

        model = model or DEFAULT_FAL_IMAGE_MODEL
        api_key = _integration_api_key_or_400(integration, "image generation", os.getenv("FAL_KEY", ""))
        aiohttp_session = aiohttp.ClientSession()
        service = FalImageGenService(
            aiohttp_session=aiohttp_session,
            key=api_key,
            settings=FalImageGenService.Settings(
                model=model,
                num_images=1,
                image_size="square_hd",
                format="png",
            ),
        )
    else:
        raise HTTPException(status_code=400, detail=f"{integration.name} cannot generate images")

    session = getattr(service, "_aiohttp_session", None)
    try:
        async for frame in service.run_image_gen(prompt):
            if isinstance(frame, ErrorFrame):
                detail = getattr(frame, "error", None) or str(frame)
                raise HTTPException(status_code=502, detail=str(detail))
            if isinstance(frame, URLImageRawFrame) or hasattr(frame, "image"):
                encoded, mime_type, width, height = _encode_image_frame(
                    getattr(frame, "image", b""),
                    getattr(frame, "size", None),
                    getattr(frame, "format", None),
                )
                return {
                    "image": encoded,
                    "mime_type": mime_type,
                    "width": width,
                    "height": height,
                    "model": model,
                    "revised_prompt": prompt,
                    "source_url": getattr(frame, "url", None),
                }
    finally:
        if integration.kind == "fal_image" and session:
            await session.close()

    raise HTTPException(status_code=502, detail=f"{integration.name} did not return an image")


@app.post("/api/assist/ai-task")
async def api_ai_task(payload: dict[str, Any]):
    """Run a Home Assistant AI Task through the selected Pipecat Assist text model."""

    config = STORE.load()
    flow = config.selected_flow(payload.get("flow_id"))
    text = _ai_task_prompt(payload)
    if not text.strip():
        raise HTTPException(status_code=400, detail="instructions are required")

    result = await run_text_conversation(
        config,
        text=text,
        language=payload.get("language"),
        conversation_id=payload.get("conversation_id"),
        flow_id=flow.id,
        mcp_token=config.effective_mcp_token,
    )
    if result.get("error"):
        raise HTTPException(status_code=502, detail=result.get("speech") or result.get("error"))

    speech = str(result.get("speech") or "").strip()
    data: Any = speech
    if payload.get("structured"):
        try:
            data = _json_from_model_text(speech)
        except ValueError as err:
            raise HTTPException(status_code=502, detail=str(err)) from err

    return {
        "conversation_id": result.get("conversation_id") or payload.get("conversation_id"),
        "data": data,
    }


@app.post("/api/assist/ai-task/image")
async def api_ai_task_image(payload: dict[str, Any]):
    """Run a Home Assistant AI Task image request through a Pipecat image service."""

    prompt = _ai_image_task_prompt(payload)
    if not prompt:
        raise HTTPException(status_code=400, detail="instructions are required")

    config = STORE.load()
    integration = _enabled_image_generation_integration(config, payload)
    started_at = time.perf_counter()
    result = await _run_pipecat_image_generation(config, integration, prompt)
    logger.info(
        "HA AI Task image generated provider={} model={} prompt={} bytes={} total_ms={:.0f}",
        integration.kind,
        result.get("model") or "",
        _text_fingerprint(prompt),
        len(result["image"]),
        (time.perf_counter() - started_at) * 1000,
    )
    return {
        "conversation_id": payload.get("conversation_id"),
        "image_base64": base64.b64encode(result["image"]).decode("ascii"),
        "mime_type": result["mime_type"],
        "width": result.get("width"),
        "height": result.get("height"),
        "model": result.get("model"),
        "revised_prompt": result.get("revised_prompt"),
        "source_url": result.get("source_url"),
    }


async def _transcribe_audio_bytes(
    *,
    config: RuntimeConfig,
    flow: FlowConfig,
    audio: bytes,
    metadata: dict[str, Any],
    content_type: str,
) -> dict[str, str]:
    step, integration = _ha_assist_step_integration(config, flow, "stt", HA_STT_BRIDGE_KINDS)
    if not integration:
        raise _bridge_unavailable("STT", _ha_supported_stt_names())
    integration = _require_integration(integration, "STT", fields=())
    model = _step_model_for(step, integration, "stt", _ha_stt_model_fallback(integration))
    if not audio:
        raise HTTPException(status_code=400, detail="No audio was provided")
    stt_audio, stt_content_type = _audio_for_cloud_stt_metadata(audio, metadata, content_type)

    if integration.kind in {"openai", "openai_cloud"}:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=_integration_api_key_or_400(integration, "STT", config.openai_api_key))
        openai_stt_model = model or DEFAULT_OPENAI_STT_MODEL
        if "realtime" in openai_stt_model:
            openai_stt_model = DEFAULT_OPENAI_STT_MODEL

        async def request_openai_stt():
            return await client.audio.transcriptions.create(
                file=("speech.wav", BytesIO(stt_audio), stt_content_type),
                model=openai_stt_model,
                language=_runtime_language(flow, integration) or None,
            )

        result = await _provider_call(f"{integration.name} STT", request_openai_stt)
        return {"text": (getattr(result, "text", "") or "").strip()}

    if integration.kind in {"gemini", "gemini_cloud"}:
        api_key = _integration_api_key_or_400(integration, "STT", os.getenv("GOOGLE_API_KEY", ""))
        data = await _gemini_generate_content(
            api_key,
            integration.default_model or flow.text_model or DEFAULT_GEMINI_TEXT_MODEL,
            {
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "text": (
                                    "Transcribe the provided speech to plain text. "
                                    "Return only the transcript, without commentary."
                                )
                            },
                            {
                                "inlineData": {
                                    "mimeType": stt_content_type,
                                    "data": base64.b64encode(stt_audio).decode("ascii"),
                                }
                            },
                        ],
                    }
                ]
            },
        )
        return {"text": _gemini_text(data)}

    if integration.kind == "deepgram":
        headers = {
            "Authorization": f"Token {_integration_api_key_or_400(integration, 'STT')}",
            "Content-Type": stt_content_type,
        }
        params = {"model": model or DEFAULT_DEEPGRAM_MODEL, "smart_format": "true"}
        async def request_deepgram_stt() -> httpx.Response:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    "https://api.deepgram.com/v1/listen",
                    params=params,
                    headers=headers,
                    content=stt_audio,
                )
                response.raise_for_status()
                return response

        response = await _provider_call("Deepgram STT", request_deepgram_stt)
        data = response.json()
        transcript = (
            data.get("results", {})
            .get("channels", [{}])[0]
            .get("alternatives", [{}])[0]
            .get("transcript", "")
        )
        return {"text": str(transcript).strip()}

    if integration.kind in {"gradium", "soniox"}:
        async def request_streaming_stt() -> str:
            queue: asyncio.Queue[bytes | None] = asyncio.Queue()
            await queue.put(audio)
            await queue.put(None)
            return await _streaming_transcribe_audio(
                websocket=None,
                queue=queue,
                config=config,
                flow=flow,
                step=step,
                integration=integration,
                model=model,
                metadata=metadata,
            )

        transcript = await _provider_call(f"{integration.name} STT", request_streaming_stt)
        return {"text": transcript.strip()}

    if integration.kind == "speechmatics":
        async def request_speechmatics_stt() -> str:
            queue: asyncio.Queue[bytes | None] = asyncio.Queue()
            await queue.put(audio)
            await queue.put(None)
            return await _speechmatics_transcribe_stream(
                websocket=None,
                queue=queue,
                integration=integration,
                flow=flow,
                model=model,
                metadata=metadata,
            )

        transcript = await _provider_call("Speechmatics STT", request_speechmatics_stt)
        return {"text": transcript.strip()}

    if integration.kind == "local_runtime":
        transcript = await _provider_call(
            "Local runtime STT",
            lambda: _local_runtime_transcribe(
                integration=integration,
                audio=stt_audio,
                content_type=stt_content_type,
                metadata=metadata,
                model=model,
            ),
        )
        return {"text": transcript.strip()}

    raise HTTPException(
        status_code=400,
        detail=f"HA Assist STT bridge does not support {integration.name}. Use {_ha_supported_stt_names()}.",
    )


@app.post("/api/assist/stt")
async def api_stt(request: Request, flow_id: str | None = None):
    """Best-effort STT bridge for the classic Home Assistant Assist pipeline."""

    config = STORE.load()
    flow = config.selected_flow(flow_id)
    metadata = _parse_speech_content(request.headers.get("x-speech-content", ""))
    content_type = request.headers.get("content-type") or "audio/wav"
    return await _transcribe_audio_bytes(
        config=config,
        flow=flow,
        audio=await request.body(),
        metadata=metadata,
        content_type=content_type,
    )


async def _handle_ha_live_stt_stream(
    *,
    websocket: WebSocket,
    config: RuntimeConfig,
    flow: FlowConfig,
    integration: IntegrationConfig,
    metadata: dict[str, Any],
    content_type: str,
) -> None:
    turn, live_queue = _start_gemini_live_ha_turn(
        config=config,
        flow=flow,
        integration=integration,
        websocket=websocket,
        input_sample_rate=int(
            _ws_metadata_value(metadata, "sample_rate", DEFAULT_HA_STT_SAMPLE_RATE)
            or DEFAULT_HA_STT_SAMPLE_RATE
        ),
    )
    chunks: list[bytes] = []
    await websocket.send_json({"type": "ready", "mode": "live", "provider": "gemini"})
    try:
        while True:
            message = await websocket.receive()
            message_type = message.get("type")
            if message_type == "websocket.disconnect":
                raise WebSocketDisconnect()
            if data := message.get("bytes"):
                chunks.append(data)
                await live_queue.put(data)
                continue
            raw_text = message.get("text")
            if not raw_text:
                continue
            try:
                event = json.loads(raw_text)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "end":
                break
    finally:
        with suppress(Exception):
            await live_queue.put(None)

    transcript = await _wait_for_ha_live_transcript(turn)
    if turn.error:
        raise HTTPException(status_code=502, detail=f"Pipecat Live Bridge failed: {turn.error}")
    if not transcript:
        logger.info("Pipecat Live Bridge returned no transcript for flow {}; treating as no speech", flow.id)
        await websocket.send_json({"type": "final", "text": ""})
        await websocket.close()
        return

    await websocket.send_json({"type": "final", "text": transcript.strip()})
    await websocket.close()


@app.websocket("/api/assist/stt/stream")
async def api_stt_stream(websocket: WebSocket):
    """Streaming STT bridge for the classic Home Assistant Assist pipeline."""

    await websocket.accept()
    provider_task: asyncio.Task[str] | None = None
    provider_queue: asyncio.Queue[bytes | None] | None = None
    chunks: list[bytes] = []
    metadata: dict[str, Any] = {}
    content_type = "audio/wav"
    config = STORE.load()
    flow = config.selected_flow(None)

    try:
        start = await websocket.receive_json()
        if not isinstance(start, dict) or start.get("type") != "start":
            await websocket.send_json({"type": "error", "detail": "Expected start message"})
            await websocket.close(code=1003)
            return

        flow = config.selected_flow(start.get("flow_id"))
        metadata = _stt_metadata_from_start(start)
        content_type = str(start.get("content_type") or "audio/wav")
        logger.info(
            "HA Assist STT stream started flow={} content_type={} metadata={}",
            flow.id,
            content_type,
            metadata,
        )
        live_integration = _ha_live_bridge_integration(config, flow, metadata)
        if live_integration:
            logger.info("HA Assist STT using Pipecat Live Bridge for flow {}", flow.id)
            await _handle_ha_live_stt_stream(
                websocket=websocket,
                config=config,
                flow=flow,
                integration=live_integration,
                metadata=metadata,
                content_type=content_type,
            )
            return

        step, integration = _ha_assist_step_integration(config, flow, "stt", HA_STT_BRIDGE_KINDS)
        if not integration:
            raise _bridge_unavailable("STT", _ha_supported_stt_names())
        integration = _require_integration(integration, "STT", fields=())
        model = _step_model_for(step, integration, "stt", _ha_stt_model_fallback(integration))
        streaming_kind = _streaming_stt_kind(integration, model)
        logger.info(
            "HA Assist STT selected flow={} integration={} kind={} model={} mode={}",
            flow.id,
            integration.name,
            integration.kind,
            model,
            streaming_kind or "buffered",
        )

        if streaming_kind:
            provider_queue = asyncio.Queue(maxsize=32)
            provider_task = asyncio.create_task(
                _streaming_transcribe_audio(
                    websocket=websocket,
                    queue=provider_queue,
                    config=config,
                    flow=flow,
                    step=step,
                    integration=integration,
                    model=model,
                    metadata=metadata,
                )
            )
            await websocket.send_json({"type": "ready", "mode": "streaming", "provider": integration.kind})
        else:
            await websocket.send_json({"type": "ready", "mode": "buffered", "provider": integration.kind})

        while True:
            message = await websocket.receive()
            message_type = message.get("type")
            if message_type == "websocket.disconnect":
                raise WebSocketDisconnect()
            if data := message.get("bytes"):
                chunks.append(data)
                if provider_queue and provider_task and not provider_task.done():
                    await provider_queue.put(data)
                continue
            raw_text = message.get("text")
            if not raw_text:
                continue
            try:
                event = json.loads(raw_text)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "end":
                break

        audio = b"".join(chunks)
        logger.info(
            "HA Assist STT stream received flow={} chunks={} bytes={}",
            flow.id,
            len(chunks),
            len(audio),
        )

        if provider_queue and provider_task and not provider_task.done():
            await provider_queue.put(None)

        transcript = ""
        if provider_task:
            try:
                transcript = await provider_task
            except Exception as err:
                raise HTTPException(
                    status_code=502,
                    detail=f"{integration.name} streaming STT failed: {err}",
                ) from err

        if not transcript:
            if streaming_kind:
                logger.info(
                    "HA Assist streaming STT returned no transcript flow={} integration={}; treating as no speech",
                    flow.id,
                    integration.name,
                )
            else:
                result = await _transcribe_audio_bytes(
                    config=config,
                    flow=flow,
                    audio=audio,
                    metadata=metadata,
                    content_type=content_type,
                )
                transcript = result.get("text", "")

        logger.info(
            "HA Assist STT stream finished flow={} transcript={}",
            flow.id,
            _text_fingerprint(transcript),
        )
        await websocket.send_json({"type": "final", "text": transcript.strip()})
        await websocket.close()
    except WebSocketDisconnect:
        logger.info("HA Assist STT stream disconnected flow={}", flow.id)
        if provider_queue:
            with suppress(Exception):
                await provider_queue.put(None)
        if provider_task:
            provider_task.cancel()
    except HTTPException as err:
        await _send_ws_json(websocket, {"type": "error", "detail": err.detail})
        with suppress(Exception):
            await websocket.close(code=1011)
    except Exception as err:
        logger.exception("HA Assist streaming STT failed: {}", err)
        await _send_ws_json(websocket, {"type": "error", "detail": str(err)})
        with suppress(Exception):
            await websocket.close(code=1011)


def _tts_prefetch_key(flow_id: str, text: str, response_format: str) -> tuple[str, str, str]:
    return (flow_id, response_format, text.strip())


def _text_fingerprint(text: str) -> str:
    clean = text.strip()
    digest = hashlib.sha1(clean.encode("utf-8")).hexdigest()[:10]
    return f"len={len(clean)} sha1={digest}"


def _legacy_should_end_conversation(*texts: str | None) -> bool:
    """Return true when the user or assistant clearly closes the conversation."""

    phrases = (
        "to wszystko",
        "dziękuję to wszystko",
        "dziekuje to wszystko",
        "koniec rozmowy",
        "kończymy rozmowę",
        "konczymy rozmowe",
        "ok koniec",
        "okej koniec",
        "dzięki koniec",
        "dzieki koniec",
        "that is all",
        "that's all",
        "thanks that's all",
        "thank you that's all",
        "end conversation",
        "stop listening",
        "we are done",
        "goodbye",
        "bye for now",
    )
    for text in texts:
        clean = str(text or "").strip().lower()
        if not clean:
            continue
        compact = " ".join(clean.replace(".", " ").replace(",", " ").replace("!", " ").split())
        if any(phrase in compact for phrase in phrases):
            return True
    return False


def _conversation_end_text(text: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").replace("ł", "l").replace("Ł", "L"))
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii").lower()
    ascii_text = re.sub(r"[^a-z0-9']+", " ", ascii_text)
    return re.sub(r"\s+", " ", ascii_text).strip()


def _should_end_conversation(*texts: str | None) -> bool:
    """Return true when the user or assistant clearly closes the conversation."""

    phrase_patterns = (
        r"\b(to wszystko|wystarczy|dziekuje to wszystko|dzieki to wszystko)\b",
        r"\b(dziekuje koniec|dzieki koniec|ok koniec|okej koniec|dobra koniec)\b",
        r"\b(koniec rozmowy|konczymy rozmowe|zakoncz rozmowe|zakonczmy rozmowe)\b",
        r"\b(przestan sluchac|nie sluchaj|nie nasluchuj)\b",
        r"\b(that is all|that's all|thanks that's all|thank you that's all)\b",
        r"\b(end conversation|stop listening|we are done|goodbye|bye for now)\b",
        r"\b(milego dnia|do uslyszenia|do zobaczenia|na razie)\b",
        r"\b(have a nice day|talk to you later|see you later)\b",
    )
    short_end_pattern = re.compile(
        r"^(?:ok|okej|dobra|no|dziekuje|dzieki|thanks|thank you)?\s*"
        r"(?:koniec|wystarczy|goodbye|bye)\s*$"
    )
    for text in texts:
        clean = _conversation_end_text(text)
        if not clean:
            continue
        if short_end_pattern.search(clean):
            return True
        if any(re.search(pattern, clean) for pattern in phrase_patterns):
            return True
    return False


def _prune_tts_prefetch() -> None:
    now = time.time()
    stale = [
        key
        for key, (created_at, task) in TTS_PREFETCH.items()
        if now - created_at > TTS_PREFETCH_TTL_SECONDS or task.cancelled()
    ]
    for key in stale:
        TTS_PREFETCH.pop(key, None)


def _pop_tts_prefetch(
    flow_id: str,
    text: str,
    response_format: str,
) -> tuple[str, float, Any] | None:
    exact_key = _tts_prefetch_key(flow_id, text, response_format)
    cached = TTS_PREFETCH.pop(exact_key, None)
    if cached:
        return "exact", cached[0], cached[1]

    clean = text.strip()
    for key in list(TTS_PREFETCH):
        cached_flow_id, _, cached_text = key
        if cached_flow_id == flow_id and cached_text == clean:
            created_at, task = TTS_PREFETCH.pop(key)
            return "format-fallback", created_at, task
    return None


def _local_runtime_url(integration: IntegrationConfig, suffix: str) -> str:
    if integration.endpoint:
        return integration.endpoint.strip()
    if not integration.base_url:
        raise HTTPException(
            status_code=400,
            detail=f"{integration.name} is missing base_url or endpoint",
        )
    return urljoin(integration.base_url.rstrip("/") + "/", suffix.lstrip("/"))


async def _local_runtime_transcribe(
    *,
    integration: IntegrationConfig,
    audio: bytes,
    content_type: str,
    metadata: dict[str, Any],
    model: str,
) -> str:
    headers = {
        "Content-Type": content_type,
        "X-Sample-Rate": str(_ws_metadata_value(metadata, "sample_rate", DEFAULT_HA_STT_SAMPLE_RATE)),
        "X-Language": str(_ws_metadata_value(metadata, "language", integration.language or "en")),
    }
    if model:
        headers["X-Model"] = model
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(_local_runtime_url(integration, "stt"), content=audio, headers=headers)
        response.raise_for_status()
    media_type = response.headers.get("content-type", "")
    if "json" in media_type:
        data = response.json()
        if isinstance(data, dict):
            return str(data.get("text") or data.get("transcript") or data.get("result") or "").strip()
    return response.text.strip()


async def _local_runtime_tts(
    *,
    integration: IntegrationConfig,
    text: str,
    model: str,
    voice: str,
    language: str,
    speed: float,
) -> tuple[bytes, str, str]:
    payload = {
        "text": text,
        "model": model,
        "voice": voice,
        "language": language,
        "speed": speed,
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(_local_runtime_url(integration, "tts"), json=payload)
        response.raise_for_status()
    media_type = response.headers.get("content-type", "audio/wav").split(";")[0]
    if "json" not in media_type:
        return response.content, media_type, _audio_extension_for_media_type(media_type)

    data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("Local runtime TTS returned invalid JSON")
    encoded = data.get("audio") or data.get("audio_base64") or data.get("audioContent")
    if not encoded:
        raise RuntimeError("Local runtime TTS JSON did not include audio")
    audio = base64.b64decode(str(encoded))
    declared_type = str(data.get("media_type") or data.get("mime_type") or "audio/wav")
    return _normalize_inline_audio(audio, declared_type)


def _google_tts_language_code(voice: str, language: str) -> str:
    parts = [part for part in (voice or "").split("-") if part]
    if len(parts) >= 2:
        return f"{parts[0]}-{parts[1]}"
    value = (language or "").replace("_", "-")
    if value and value.lower() != "pipecat-assist":
        language_parts = value.split("-")
        if len(language_parts) >= 2:
            return f"{language_parts[0]}-{language_parts[1].upper()}"
        return f"{language_parts[0]}-{language_parts[0].upper()}"
    return "en-US"


async def _google_cloud_tts_audio(
    *,
    integration: IntegrationConfig,
    text: str,
    voice: str,
    language: str,
    speed: float,
) -> tuple[bytes, str, str]:
    from google.api_core.client_options import ClientOptions
    from google.auth import default as google_auth_default
    from google.cloud import texttospeech_v1
    from google.oauth2 import service_account

    credentials = None
    if integration.credentials_json:
        credentials = service_account.Credentials.from_service_account_info(
            json.loads(integration.credentials_json)
        )
    elif integration.credentials_path:
        credentials = service_account.Credentials.from_service_account_file(integration.credentials_path)
    else:
        credentials, _ = google_auth_default(scopes=["https://www.googleapis.com/auth/cloud-platform"])

    client_options = None
    if integration.location:
        client_options = ClientOptions(api_endpoint=f"{integration.location}-texttospeech.googleapis.com")
    client = texttospeech_v1.TextToSpeechAsyncClient(
        credentials=credentials,
        client_options=client_options,
    )
    sample_rate = 24000
    voice_name = voice or DEFAULT_GOOGLE_TTS_VOICE
    request = texttospeech_v1.SynthesizeSpeechRequest(
        input=texttospeech_v1.SynthesisInput(text=text),
        voice=texttospeech_v1.VoiceSelectionParams(
            language_code=_google_tts_language_code(voice_name, language),
            name=voice_name,
        ),
        audio_config=texttospeech_v1.AudioConfig(
            audio_encoding=texttospeech_v1.AudioEncoding.LINEAR16,
            sample_rate_hertz=sample_rate,
            speaking_rate=speed,
        ),
    )
    response = await client.synthesize_speech(request=request)
    audio = response.audio_content
    if audio.startswith(b"RIFF"):
        return audio, "audio/wav", "wav"
    return _wav_from_pcm(audio, sample_rate=sample_rate, sample_width=2, channels=1), "audio/wav", "wav"


async def _cartesia_tts_audio(
    *,
    integration: IntegrationConfig,
    text: str,
    model: str,
    voice: str,
    language: str,
    speed: float,
) -> tuple[bytes, str, str]:
    payload: dict[str, Any] = {
        "model_id": model or DEFAULT_CARTESIA_MODEL,
        "transcript": text,
        "voice": {"mode": "id", "id": voice or DEFAULT_CARTESIA_VOICE},
        "output_format": {
            "container": "raw",
            "encoding": "pcm_s16le",
            "sample_rate": 24000,
        },
    }
    if language:
        payload["language"] = language.split("-", 1)[0].lower()
    if speed and abs(speed - 1.0) > 0.001:
        payload["generation_config"] = {"speed": speed}
    headers = {
        "Cartesia-Version": "2026-03-01",
        "X-API-Key": _integration_api_key_or_400(integration, "TTS"),
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            (integration.endpoint or "https://api.cartesia.ai").rstrip("/") + "/tts/bytes",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
    if not response.content:
        raise RuntimeError("Cartesia TTS returned no audio")
    return _wav_from_pcm(response.content, sample_rate=24000, sample_width=2, channels=1), "audio/wav", "wav"


async def _gradium_tts_audio(
    *,
    integration: IntegrationConfig,
    text: str,
    voice: str,
) -> tuple[bytes, str, str]:
    api_key = _integration_api_key_or_400(integration, "TTS")
    context_id = f"ha-{hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]}"
    url = integration.endpoint or "wss://api.gradium.ai/api/speech/tts"
    headers = {"x-api-key": api_key, "x-api-source": "pipecat-assist"}
    audio = bytearray()
    async with _websocket_connect(url, headers) as provider_ws:
        await provider_ws.send(
            json.dumps(
                {
                    "type": "setup",
                    "output_format": "pcm",
                    "voice_id": voice or "_6Aslh2DxfmnRLmP",
                    "close_ws_on_eos": False,
                    "client_req_id": context_id,
                }
            )
        )
        await provider_ws.send(json.dumps({"type": "text", "text": text, "client_req_id": context_id}))
        await provider_ws.send(json.dumps({"type": "end_of_stream", "client_req_id": context_id}))
        async with asyncio.timeout(60):
            async for raw in provider_ws:
                message = json.loads(raw)
                if message.get("type") == "audio" and message.get("client_req_id") == context_id:
                    audio.extend(base64.b64decode(str(message.get("audio") or "")))
                elif message.get("type") == "end_of_stream" and message.get("client_req_id") == context_id:
                    break
                elif message.get("type") == "error":
                    raise RuntimeError(message.get("message") or "Gradium TTS failed")
    if not audio:
        raise RuntimeError("Gradium TTS returned no audio")
    return _wav_from_pcm(bytes(audio), sample_rate=48000, sample_width=2, channels=1), "audio/wav", "wav"


async def _soniox_tts_audio(
    *,
    integration: IntegrationConfig,
    flow: FlowConfig,
    text: str,
    model: str,
    voice: str,
) -> tuple[bytes, str, str]:
    api_key = _integration_api_key_or_400(integration, "TTS")
    context_id = f"ha-{hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]}"
    sample_rate = 24000
    language = _normalize_language_hint(_runtime_language(flow, integration)) or "en"
    config_msg = {
        "api_key": api_key,
        "stream_id": context_id,
        "model": model or "tts-rt-v1",
        "voice": voice or "Adrian",
        "audio_format": "pcm_s16le",
        "sample_rate": sample_rate,
        "language": language,
    }
    audio = bytearray()
    async with _websocket_connect(integration.endpoint or "wss://tts-rt.soniox.com/tts-websocket", {}) as provider_ws:
        await provider_ws.send(json.dumps(config_msg))
        await provider_ws.send(json.dumps({"text": text, "text_end": False, "stream_id": context_id}))
        await provider_ws.send(json.dumps({"text": "", "text_end": True, "stream_id": context_id}))
        async with asyncio.timeout(60):
            async for raw in provider_ws:
                message = json.loads(raw)
                if message.get("error_code") is not None:
                    raise RuntimeError(message.get("error_message") or "Soniox TTS failed")
                if message.get("stream_id") != context_id:
                    continue
                if message.get("audio"):
                    audio.extend(base64.b64decode(str(message.get("audio"))))
                if message.get("terminated"):
                    break
    if not audio:
        raise RuntimeError("Soniox TTS returned no audio")
    return _wav_from_pcm(bytes(audio), sample_rate=sample_rate, sample_width=2, channels=1), "audio/wav", "wav"


async def _synthesize_tts_audio(
    *,
    config: RuntimeConfig,
    flow: FlowConfig,
    text: str,
    payload: dict[str, Any],
) -> tuple[bytes, str, str]:
    started_at = time.perf_counter()
    step, integration = _ha_assist_step_integration(config, flow, "tts", HA_TTS_BRIDGE_KINDS)
    if not integration:
        raise _bridge_unavailable("TTS", _ha_supported_tts_names())
    integration = _require_integration(integration, "TTS", fields=())
    model = _step_model_for(step, integration, "tts", _ha_tts_model_fallback(integration))
    voice = _step_voice(step, integration, _ha_tts_voice_fallback(integration))
    response_format = _preferred_tts_format(payload)
    language = _runtime_language(flow, integration, payload.get("language"))
    speed = _runtime_speed(flow, integration)
    logger.info(
        "HA Assist TTS synth started flow={} integration={} kind={} model={} voice={} text={} requested_format={}",
        flow.id,
        integration.name,
        integration.kind,
        model,
        voice,
        _text_fingerprint(text),
        response_format,
    )

    if integration.kind in {"openai", "openai_cloud"}:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=_integration_api_key_or_400(integration, "TTS", config.openai_api_key))
        async def request_openai_tts():
            return await client.audio.speech.create(
                model=model or DEFAULT_OPENAI_TTS_MODEL,
                voice=voice or DEFAULT_OPENAI_TTS_VOICE,
                input=text,
                response_format=response_format,
                speed=speed,
            )

        result = await _provider_call(f"{integration.name} TTS", request_openai_tts)
        logger.info(
            "HA Assist TTS synth finished flow={} integration={} model={} voice={} duration_ms={:.0f}",
            flow.id,
            integration.name,
            model or DEFAULT_OPENAI_TTS_MODEL,
            voice or DEFAULT_OPENAI_TTS_VOICE,
            (time.perf_counter() - started_at) * 1000,
        )
        return result.content, TTS_MEDIA_TYPES.get(response_format, "audio/mpeg"), response_format

    if integration.kind in {"gemini", "gemini_cloud"}:
        api_key = _integration_api_key_or_400(integration, "TTS", os.getenv("GOOGLE_API_KEY", ""))
        audio = await _synthesize_gemini_tts_audio(
            api_key=api_key,
            integration=integration,
            model=model,
            text=text,
            voice=voice,
        )
        logger.info(
            "HA Assist TTS synth finished flow={} integration={} model={} voice={} duration_ms={:.0f}",
            flow.id,
            integration.name,
            model or DEFAULT_GEMINI_TTS_MODEL,
            voice or DEFAULT_GEMINI_LIVE_VOICE,
            (time.perf_counter() - started_at) * 1000,
        )
        return audio

    if integration.kind == "cartesia":
        audio = await _provider_call(
            "Cartesia TTS",
            lambda: _cartesia_tts_audio(
                integration=integration,
                text=text,
                model=model,
                voice=voice,
                language=language,
                speed=speed,
            ),
        )
        logger.info(
            "HA Assist TTS synth finished flow={} integration={} model={} voice={} duration_ms={:.0f}",
            flow.id,
            integration.name,
            model or DEFAULT_CARTESIA_MODEL,
            voice or DEFAULT_CARTESIA_VOICE,
            (time.perf_counter() - started_at) * 1000,
        )
        return audio

    if integration.kind == "gradium":
        audio = await _provider_call(
            "Gradium TTS",
            lambda: _gradium_tts_audio(integration=integration, text=text, voice=voice),
        )
        logger.info(
            "HA Assist TTS synth finished flow={} integration={} model={} voice={} duration_ms={:.0f}",
            flow.id,
            integration.name,
            model or "default",
            voice or "_6Aslh2DxfmnRLmP",
            (time.perf_counter() - started_at) * 1000,
        )
        return audio

    if integration.kind in {"google_cloud_tts", "google_streaming_tts"}:
        audio = await _provider_call(
            f"{integration.name} TTS",
            lambda: _google_cloud_tts_audio(
                integration=integration,
                text=text,
                voice=voice,
                language=language,
                speed=speed,
            ),
        )
        logger.info(
            "HA Assist TTS synth finished flow={} integration={} model={} voice={} duration_ms={:.0f}",
            flow.id,
            integration.name,
            model,
            voice or DEFAULT_GOOGLE_TTS_VOICE,
            (time.perf_counter() - started_at) * 1000,
        )
        return audio

    if integration.kind == "elevenlabs":
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice or DEFAULT_ELEVENLABS_VOICE}"
        headers = {
            "xi-api-key": _integration_api_key_or_400(integration, "TTS"),
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        body: dict[str, Any] = {"text": text, "model_id": model or DEFAULT_ELEVENLABS_MODEL}
        if speed and abs(speed - 1.0) > 0.001:
            body["voice_settings"] = {"speed": speed}

        async def request_elevenlabs_tts() -> httpx.Response:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    url,
                    headers=headers,
                    json=body,
                )
                response.raise_for_status()
                return response

        response = await _provider_call("ElevenLabs TTS", request_elevenlabs_tts)
        logger.info(
            "HA Assist TTS synth finished flow={} integration={} model={} voice={} duration_ms={:.0f}",
            flow.id,
            integration.name,
            model or DEFAULT_ELEVENLABS_MODEL,
            voice or DEFAULT_ELEVENLABS_VOICE,
            (time.perf_counter() - started_at) * 1000,
        )
        return response.content, "audio/mpeg", "mp3"

    if integration.kind == "soniox":
        audio = await _provider_call(
            "Soniox TTS",
            lambda: _soniox_tts_audio(
                integration=integration,
                flow=flow,
                text=text,
                model=model,
                voice=voice,
            ),
        )
        logger.info(
            "HA Assist TTS synth finished flow={} integration={} model={} voice={} duration_ms={:.0f}",
            flow.id,
            integration.name,
            model or "tts-rt-v1",
            voice or "Adrian",
            (time.perf_counter() - started_at) * 1000,
        )
        return audio

    if integration.kind == "local_runtime":
        audio = await _provider_call(
            "Local runtime TTS",
            lambda: _local_runtime_tts(
                integration=integration,
                text=text,
                model=model,
                voice=voice,
                language=language,
                speed=speed,
            ),
        )
        logger.info(
            "HA Assist TTS synth finished flow={} integration={} model={} voice={} duration_ms={:.0f}",
            flow.id,
            integration.name,
            model,
            voice,
            (time.perf_counter() - started_at) * 1000,
        )
        return audio

    raise HTTPException(
        status_code=400,
        detail=f"HA Assist TTS bridge does not support {integration.name}. Use {_ha_supported_tts_names()}.",
    )


def _start_tts_prefetch(
    *,
    config: RuntimeConfig,
    flow: FlowConfig,
    text: str,
    language: str | None,
) -> None:
    text = text.strip()
    if not text:
        return
    if _find_ha_live_turn_by_speech(flow.id, text):
        return
    _prune_tts_prefetch()
    payload = {
        "text": text,
        "language": language or flow.language or "en",
        "options": {"preferred_format": "mp3"},
        "flow_id": flow.id,
    }
    key = _tts_prefetch_key(flow.id, text, "mp3")
    if key in TTS_PREFETCH:
        return

    async def runner() -> tuple[bytes, str, str]:
        started_at = time.perf_counter()
        try:
            return await _synthesize_tts_audio(config=config, flow=flow, text=text, payload=payload)
        finally:
            logger.info(
                "HA Assist TTS prefetch finished flow={} text={} duration_ms={:.0f}",
                flow.id,
                _text_fingerprint(text),
                (time.perf_counter() - started_at) * 1000,
            )

    task = asyncio.create_task(runner())
    logger.info(
        "HA Assist TTS prefetch started flow={} text={} format={}",
        flow.id,
        _text_fingerprint(text),
        "mp3",
    )
    task.add_done_callback(lambda item: item.exception() if not item.cancelled() else None)
    TTS_PREFETCH[key] = (time.time(), task)


async def _synthesize_gemini_tts_audio(
    *,
    api_key: str,
    integration: IntegrationConfig,
    model: str,
    text: str,
    voice: str,
) -> tuple[bytes, str, str]:
    payload = {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice or integration.default_voice or DEFAULT_GEMINI_LIVE_VOICE,
                    }
                }
            },
        },
    }
    last_error: HTTPException | None = None
    for candidate in _gemini_tts_model_candidates(model, integration):
        for attempt in range(2):
            data: dict[str, Any] | None = None
            try:
                data = await _gemini_generate_content(api_key, candidate, payload)
                return _normalize_inline_audio(*_gemini_inline_audio(data))
            except HTTPException as err:
                if err.status_code in {401, 403}:
                    raise
                reason = ""
                if err.status_code == 502 and data is not None:
                    reason = _gemini_no_audio_reason(data)
                detail = f"{err.detail}{f' ({reason})' if reason else ''}"
                last_error = HTTPException(status_code=err.status_code, detail=detail)
                logger.debug(
                    "Gemini TTS model {} attempt {}/2 failed: {}",
                    candidate,
                    attempt + 1,
                    detail,
                )
                if err.status_code == 502 and data is not None and attempt == 0:
                    await asyncio.sleep(0.2)
                    continue
                break
    if last_error:
        raise last_error
    raise HTTPException(status_code=502, detail="Gemini TTS could not select a model")


@app.post("/api/assist/tts")
async def api_tts(payload: dict[str, Any]):
    """Best-effort TTS bridge for the classic Home Assistant Assist pipeline."""

    started_at = time.perf_counter()
    config = STORE.load()
    flow = config.selected_flow(payload.get("flow_id"))
    text = str(payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text was provided")

    response_format = _preferred_tts_format(payload)
    live_turn = _find_ha_live_turn_by_speech(flow.id, text)
    if live_turn:
        try:
            live_audio = await _ha_live_tts_audio(live_turn)
        except Exception as err:
            raise HTTPException(
                status_code=502,
                detail=f"Pipecat Live Bridge TTS failed: {err}",
            ) from err
        if live_audio:
            audio, media_type, extension = live_audio
            logger.info(
                "HA Assist TTS served from Pipecat Live Bridge flow={} text={} requested_format={} output={} bytes={} total_ms={:.0f}",
                flow.id,
                _text_fingerprint(text),
                response_format,
                extension,
                len(audio),
                (time.perf_counter() - started_at) * 1000,
            )
            return Response(content=audio, media_type=media_type, headers={"X-Audio-Extension": extension})
        raise HTTPException(status_code=502, detail="Pipecat Live Bridge TTS returned no audio")

    _prune_tts_prefetch()
    cached = _pop_tts_prefetch(flow.id, text, response_format)
    cache_status = "miss"
    prefetch_age_ms = 0.0
    wait_started_at = time.perf_counter()
    if cached:
        cache_status, created_at, task = cached
        prefetch_age_ms = max(0.0, (time.time() - created_at) * 1000)
        try:
            audio, media_type, extension = await task
        except Exception as err:
            logger.debug("Prefetched TTS failed; synthesizing on demand: {}", err)
            cache_status = f"{cache_status}-failed"
            audio, media_type, extension = await _synthesize_tts_audio(
                config=config,
                flow=flow,
                text=text,
                payload=payload,
            )
    else:
        audio, media_type, extension = await _synthesize_tts_audio(
            config=config,
            flow=flow,
            text=text,
            payload=payload,
        )
    logger.info(
        "HA Assist TTS served flow={} text={} cache={} prefetch_age_ms={:.0f} requested_format={} output={} bytes={} wait_ms={:.0f} total_ms={:.0f}",
        flow.id,
        _text_fingerprint(text),
        cache_status,
        prefetch_age_ms,
        response_format,
        extension,
        len(audio),
        (time.perf_counter() - wait_started_at) * 1000,
        (time.perf_counter() - started_at) * 1000,
    )
    return Response(content=audio, media_type=media_type, headers={"X-Audio-Extension": extension})


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


def _runtime_language(
    flow: FlowConfig,
    integration: IntegrationConfig | None,
    override: str | None = None,
) -> str:
    return (override or "").strip() or (integration.language if integration else "") or flow.language or "en"


def _pipecat_language(language: str | None) -> Language | str:
    value = (language or "").strip()
    if not value or value.lower() == "pipecat-assist":
        value = "en"
    normalized = value.replace("_", "-").lower()
    for candidate in Language:
        if candidate.value.lower() == normalized:
            return candidate
    base = normalized.split("-", 1)[0]
    for candidate in Language:
        if candidate.value.lower() == base:
            return candidate
    return value


def _runtime_speed(flow: FlowConfig, integration: IntegrationConfig | None) -> float:
    return float((integration.speed if integration else None) or flow.speed or 1.0)


def _tts_text_aggregation_mode(integration: IntegrationConfig | None):
    if not integration or integration.tts_streaming_mode != "token":
        return None
    if integration.kind not in {"cartesia", "soniox", "gradium", "google_streaming_tts"}:
        return None
    from pipecat.services.tts_service import TextAggregationMode

    return TextAggregationMode.TOKEN


def _session_properties(
    flow: FlowConfig,
    tools_schema,
    voice: str | None = None,
    integration: IntegrationConfig | None = None,
) -> SessionProperties:
    tools = tools_schema if tools_schema and tools_schema.standard_tools else None
    vad_enabled = _enabled_step(flow, "vad") is not None
    return SessionProperties(
        audio=AudioConfiguration(
            input=AudioInput(
                transcription=InputAudioTranscription(
                    model=flow.transcription_model,
                    language=_runtime_language(flow, integration),
                ),
                turn_detection=_turn_detection(flow) if vad_enabled else None,
                noise_reduction=_noise_reduction(flow) if vad_enabled else None,
            ),
            output=AudioOutput(voice=voice or flow.voice, speed=_runtime_speed(flow, integration)),
        ),
        output_modalities=["audio"],
        tools=tools,
        tool_choice="auto" if tools else None,
        max_output_tokens=flow.max_output_tokens,
        reasoning=Reasoning(effort=flow.reasoning_effort) if flow.reasoning_effort else None,
    )


def _transport_params(config: RuntimeConfig, flow: FlowConfig) -> dict[str, Any]:
    return {
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            video_in_enabled=flow.video_enabled,
        ),
        "websocket": lambda: websocket_transport_params(
            _should_end_conversation,
            follow_up_ms=config.esphome_follow_up_ms,
            follow_up_open_delay_ms=config.esphome_follow_up_open_delay_ms,
            wake_open_delay_ms=config.esphome_wake_open_delay_ms,
            playback_prebuffer_ms=config.esphome_playback_prebuffer_ms,
        ),
    }


def _rtvi_observer_params() -> RTVIObserverParams:
    """Expose live transcript and assistant text events to the WebRTC clients."""

    return RTVIObserverParams(
        bot_output_enabled=True,
        bot_llm_enabled=True,
        bot_tts_enabled=True,
        bot_speaking_enabled=True,
        user_llm_enabled=True,
        user_speaking_enabled=True,
        user_transcription_enabled=True,
        metrics_enabled=True,
    )


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


def _configured_integration(integration: IntegrationConfig | None) -> bool:
    return bool(integration and integration.enabled)


def _ha_assist_step_integration(
    config: RuntimeConfig,
    flow: FlowConfig,
    kind: str,
    supported_kinds: set[str],
) -> tuple[Any, IntegrationConfig | None]:
    """Return the explicit HA Assist step integration without provider fallback."""

    step, integration = _step_integration(config, flow, kind)
    if not step:
        return None, None
    if not integration:
        return step, None
    if integration.kind not in supported_kinds:
        raise HTTPException(
            status_code=400,
            detail=(
                f"HA Assist {kind.upper()} bridge cannot use {integration.name} "
                f"({integration.kind}). Select a {kind.upper()} integration supported by HA Assist."
            ),
        )
    return step, integration


def _bridge_unavailable(role: str, supported_names: str) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail=(
            f"HA Assist {role} requires an enabled explicit {role} step. "
            f"Configure one of: {supported_names}. Gemini Live speech-to-speech "
            "pipelines are bridged automatically when Home Assistant sends mono 16-bit PCM audio."
        ),
    )


def _ha_supported_stt_names() -> str:
    return (
        "Soniox, Deepgram, Speechmatics, Gradium, OpenAI Cloud/Realtime, "
        "Google Gemini Cloud, and Local runtime"
    )


def _ha_supported_tts_names() -> str:
    return (
        "Cartesia, Gradium, Google Cloud TTS, Google Cloud TTS Streaming, "
        "ElevenLabs, OpenAI Cloud/Realtime, Google Gemini Cloud, Soniox, "
        "and Local runtime"
    )


def _streaming_stt_kind(integration: IntegrationConfig | None, model: str) -> str:
    if not integration:
        return ""
    if integration.kind == "deepgram":
        return "deepgram"
    if integration.kind == "gradium":
        return "gradium"
    if integration.kind == "soniox":
        return "soniox"
    if integration.kind == "speechmatics":
        return "speechmatics"
    if integration.kind in {"openai", "openai_cloud"}:
        if "realtime" in (model or "") or "realtime" in (integration.default_stt_model or ""):
            return "openai_realtime"
    return ""


def _ha_stt_model_fallback(integration: IntegrationConfig | None) -> str:
    if not integration:
        return ""
    if integration.kind in {"openai", "openai_cloud"}:
        return DEFAULT_OPENAI_STT_MODEL
    if integration.kind == "deepgram":
        return DEFAULT_DEEPGRAM_MODEL
    if integration.kind == "soniox":
        return integration.default_model or DEFAULT_SONIOX_MODEL
    if integration.kind == "speechmatics":
        return integration.default_model or DEFAULT_SPEECHMATICS_MODEL
    return integration.default_model or ""


def _ha_tts_model_fallback(integration: IntegrationConfig | None) -> str:
    if not integration:
        return ""
    if integration.kind in {"openai", "openai_cloud"}:
        return DEFAULT_OPENAI_TTS_MODEL
    if integration.kind in {"gemini", "gemini_cloud"}:
        return DEFAULT_GEMINI_TTS_MODEL
    if integration.kind == "cartesia":
        return DEFAULT_CARTESIA_MODEL
    if integration.kind == "elevenlabs":
        return DEFAULT_ELEVENLABS_MODEL
    if integration.kind == "google_cloud_tts":
        return "google-tts"
    if integration.kind == "google_streaming_tts":
        return "google-streaming-tts"
    if integration.kind == "gradium":
        return integration.default_model or "default"
    if integration.kind == "soniox":
        return integration.default_tts_model or integration.default_model or "tts-rt-v1"
    return integration.default_tts_model or integration.default_model or ""


def _ha_tts_voice_fallback(integration: IntegrationConfig | None) -> str:
    if not integration:
        return ""
    if integration.kind in {"openai", "openai_cloud"}:
        return DEFAULT_OPENAI_TTS_VOICE
    if integration.kind in {"gemini", "gemini_cloud"}:
        return DEFAULT_GEMINI_LIVE_VOICE
    if integration.kind == "cartesia":
        return DEFAULT_CARTESIA_VOICE
    if integration.kind == "elevenlabs":
        return DEFAULT_ELEVENLABS_VOICE
    if integration.kind in {"google_cloud_tts", "google_streaming_tts"}:
        return DEFAULT_GOOGLE_TTS_VOICE
    if integration.kind == "gradium":
        return integration.default_voice or "_6Aslh2DxfmnRLmP"
    if integration.kind == "soniox":
        return integration.default_voice or "Adrian"
    return integration.default_voice or ""


def _openai_realtime_transcription_model(flow: FlowConfig, model: str) -> str:
    for candidate in (model, flow.transcription_model, "gpt-realtime-whisper"):
        candidate = (candidate or "").strip()
        if candidate and "realtime" in candidate:
            return candidate
    return "gpt-realtime-whisper"


def _normalize_language_hint(language: str | None) -> str:
    value = (language or "").strip()
    if not value or value.lower() == "pipecat-assist":
        return ""
    return value.split("-")[0].lower()


def _websocket_connect(url: str, headers: dict[str, str]):
    import inspect
    import websockets

    header_key = (
        "additional_headers"
        if "additional_headers" in inspect.signature(websockets.connect).parameters
        else "extra_headers"
    )
    return websockets.connect(url, **{header_key: headers})


async def _send_ws_json(websocket: WebSocket, payload: dict[str, Any]) -> None:
    with suppress(Exception):
        await websocket.send_json(payload)


def _ha_live_bridge_integration(
    config: RuntimeConfig,
    flow: FlowConfig,
    metadata: dict[str, Any],
) -> IntegrationConfig | None:
    """Return Gemini Live when the active pipeline can be wrapped for HA Assist."""

    integration = config.model_integration(flow)
    provider_kind = integration.kind if integration else flow.provider_id
    if _runtime_mode(flow, provider_kind) != "s2s" or provider_kind != "gemini":
        return None
    if not _configured_integration(integration):
        return None
    if not ((integration.api_key if integration else "") or os.getenv("GOOGLE_API_KEY", "")):
        return None

    codec = str(_ws_metadata_value(metadata, "codec", "pcm") or "pcm").lower()
    sample_rate = int(
        _ws_metadata_value(metadata, "sample_rate", DEFAULT_HA_STT_SAMPLE_RATE)
        or DEFAULT_HA_STT_SAMPLE_RATE
    )
    bit_rate = int(
        _ws_metadata_value(metadata, "bit_rate", DEFAULT_HA_STT_SAMPLE_WIDTH * 8)
        or DEFAULT_HA_STT_SAMPLE_WIDTH * 8
    )
    channels = int(_ws_metadata_value(metadata, "channel", DEFAULT_HA_STT_CHANNELS) or DEFAULT_HA_STT_CHANNELS)
    if bit_rate != 16 or channels != 1 or "pcm" not in codec:
        logger.info(
            "Skipping Pipecat Live Bridge for flow {} because HA audio is {} Hz, {} bit, {} channel, codec={}",
            flow.id,
            sample_rate,
            bit_rate,
            channels,
            codec,
        )
        return None
    return integration


def _gemini_live_ha_setup(
    config: RuntimeConfig,
    flow: FlowConfig,
    integration: IntegrationConfig,
    tools_schema: ToolsSchema | None,
) -> dict[str, Any]:
    setup: dict[str, Any] = {
        "model": _gemini_model(_model_name(flow, integration, "gemini")),
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": _gemini_voice(flow, integration),
                    }
                }
            },
        },
        "systemInstruction": {
            "parts": [
                {
                    "text": (
                        f"{_effective_instructions(flow)}\n\n"
                        "You are running inside Home Assistant Assist through Pipecat Live Bridge. "
                        "Use Home Assistant tools silently for explicit smart-home requests, "
                        "then answer briefly and naturally."
                    )
                }
            ]
        },
        "inputAudioTranscription": {},
        "outputAudioTranscription": {},
        "realtimeInputConfig": {
            "automaticActivityDetection": {
                "disabled": True,
            }
        },
    }
    if flow.max_output_tokens:
        setup["generationConfig"]["maxOutputTokens"] = flow.max_output_tokens
    if tools_schema and tools_schema.standard_tools:
        setup["tools"] = [_gemini_live_tool_declarations(tools_schema)]
    return setup


async def _warm_mcp_tools_schema(
    config: RuntimeConfig,
    flow: FlowConfig,
) -> ToolsSchema | None:
    mcp_servers = config.enabled_mcp_servers(config.effective_mcp_token) if flow.mcp_enabled else []
    if not mcp_servers:
        return None
    bridge = CombinedMCPBridge(mcp_servers, flow.mcp_tool_allowlist)
    try:
        await bridge.start()
        tools = await bridge.tools_schema(
            cache_enabled=config.mcp_tools_cache_enabled,
            cache_ttl_seconds=config.mcp_tools_cache_ttl_seconds,
            refresh=False,
        )
        logger.info(
            "HA Assist warmup cached MCP schema flow={} tools={}",
            flow.id,
            len(tools.standard_tools),
        )
        return tools if tools.standard_tools else None
    finally:
        with suppress(Exception):
            await bridge.close()


async def _warm_gemini_live_ha_setup(
    config: RuntimeConfig,
    flow: FlowConfig,
    integration: IntegrationConfig,
    tools_schema: ToolsSchema | None,
) -> None:
    api_key = _integration_api_key(
        integration,
        "Pipecat Live Bridge warmup",
        os.getenv("GOOGLE_API_KEY", ""),
    )
    url = (
        "wss://generativelanguage.googleapis.com/ws/"
        "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
        f"?key={quote(api_key, safe='')}"
    )
    started_at = time.perf_counter()
    async with _websocket_connect(url, {}) as provider_ws:
        await provider_ws.send(
            json.dumps({"setup": _gemini_live_ha_setup(config, flow, integration, tools_schema)})
        )
        async with asyncio.timeout(10):
            while True:
                raw = await provider_ws.recv()
                message = json.loads(raw)
                if message.get("setupComplete") is not None:
                    break
                if message.get("error"):
                    raise RuntimeError(_gemini_live_error_message(message))
    logger.info(
        "HA Assist warmup completed Pipecat Live Bridge setup flow={} model={} duration_ms={:.0f}",
        flow.id,
        _model_name(flow, integration, "gemini"),
        (time.perf_counter() - started_at) * 1000,
    )


async def _warm_ha_assist_flow(config: RuntimeConfig, flow: FlowConfig, reason: str) -> None:
    started_at = time.perf_counter()
    try:
        mcp_tools_schema = None
        try:
            mcp_tools_schema = await _warm_mcp_tools_schema(config, flow)
        except Exception as err:
            logger.debug("HA Assist MCP warmup skipped/failed for flow {}: {}", flow.id, err)
        local_tool_schemas = [schema for schema in [_web_search_tool_schema(config, flow)] if schema]
        tools_schema = _merge_tools_schema(mcp_tools_schema, local_tool_schemas)
        integration = _ha_live_bridge_integration(
            config,
            flow,
            {
                "codec": "pcm",
                "sample_rate": DEFAULT_HA_STT_SAMPLE_RATE,
                "bit_rate": DEFAULT_HA_STT_SAMPLE_WIDTH * 8,
                "channel": DEFAULT_HA_STT_CHANNELS,
            },
        )
        if integration:
            await _warm_gemini_live_ha_setup(config, flow, integration, tools_schema)
        logger.info(
            "HA Assist warmup finished flow={} reason={} duration_ms={:.0f}",
            flow.id,
            reason,
            (time.perf_counter() - started_at) * 1000,
        )
    except asyncio.CancelledError:
        raise
    except Exception as err:
        logger.debug("HA Assist warmup skipped/failed for flow {}: {}", flow.id, err)


def _schedule_ha_assist_warmup(
    config: RuntimeConfig | None = None,
    *,
    reason: str = "startup",
) -> None:
    global HA_ASSIST_WARMUP_TASK
    try:
        config = config or STORE.load()
        flow = config.selected_flow(None)
    except Exception as err:
        logger.debug("HA Assist warmup could not load configuration: {}", err)
        return

    if HA_ASSIST_WARMUP_TASK and not HA_ASSIST_WARMUP_TASK.done():
        HA_ASSIST_WARMUP_TASK.cancel()
    HA_ASSIST_WARMUP_TASK = asyncio.create_task(_warm_ha_assist_flow(config, flow, reason))

    def _log_result(task: asyncio.Task) -> None:
        with suppress(asyncio.CancelledError):
            if err := task.exception():
                logger.debug("HA Assist warmup task failed: {}", err)

    HA_ASSIST_WARMUP_TASK.add_done_callback(_log_result)


@app.on_event("startup")
async def _startup_warm_ha_assist() -> None:
    _schedule_ha_assist_warmup(reason="startup")
    ESPHOME_PROVISIONER.start()


@app.on_event("shutdown")
async def _shutdown_esphome_provisioner() -> None:
    await ESPHOME_PROVISIONER.stop()


def _gemini_live_tool_declarations(tools_schema: ToolsSchema) -> dict[str, Any]:
    declarations: list[dict[str, Any]] = []
    for tool in tools_schema.standard_tools:
        declarations.append(
            {
                "name": tool.name,
                "description": tool.description,
                "parameters": {
                    "type": "object",
                    "properties": tool.properties,
                    "required": tool.required,
                },
            }
        )
    return {"functionDeclarations": declarations}


class _LocalFunctionParams:
    def __init__(self, arguments: dict[str, Any]):
        self.arguments = arguments
        self.result = ""

    async def result_callback(self, result: Any) -> None:
        self.result = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)


async def _call_local_live_tool(schema: FunctionSchema, arguments: dict[str, Any]) -> str:
    handler = getattr(schema, "handler", None)
    if not handler:
        return "Tool has no local handler."
    params = _LocalFunctionParams(arguments)
    await handler(params)
    return params.result or "Tool completed."


async def _call_gemini_live_tool(
    *,
    function_call: dict[str, Any],
    bridge: CombinedMCPBridge | None,
    local_tools: dict[str, FunctionSchema],
    mcp_tool_names: set[str],
) -> dict[str, Any]:
    name = str(function_call.get("name") or "")
    call_id = str(function_call.get("id") or "")
    args = function_call.get("args")
    arguments = args if isinstance(args, dict) else {}
    try:
        if name in local_tools:
            result = await _call_local_live_tool(local_tools[name], arguments)
        elif bridge and name in mcp_tool_names:
            result = await bridge.call_tool(name, arguments)
        else:
            result = f"Unknown tool: {name}"
        return {"id": call_id, "name": name, "response": {"result": result}}
    except Exception as err:
        logger.warning("Pipecat Live Bridge tool {} failed: {}", name, err)
        return {"id": call_id, "name": name, "response": {"error": str(err)}}


def _gemini_live_error_message(message: dict[str, Any]) -> str:
    error = message.get("error") if isinstance(message, dict) else None
    if isinstance(error, dict):
        return str(error.get("message") or error.get("status") or error)
    return str(error or "")


def _append_gemini_live_text(existing: str, chunk: str) -> str:
    if not chunk:
        return existing
    if not existing:
        return chunk
    if chunk.startswith(existing):
        return chunk
    if existing.endswith(chunk):
        return existing
    if existing.endswith((" ", "\n")) or chunk.startswith((" ", "\n", ".", ",", "!", "?", ":", ";")):
        return f"{existing}{chunk}"
    if len(chunk) > 2 and existing[-1].isalnum() and chunk[0].isalnum():
        return f"{existing} {chunk}"
    return f"{existing}{chunk}"


async def _handle_gemini_live_message(
    *,
    websocket: WebSocket | None,
    provider_ws,
    message: dict[str, Any],
    turn: HALiveTurn,
    bridge: CombinedMCPBridge | None,
    local_tools: dict[str, FunctionSchema],
    mcp_tool_names: set[str],
) -> str:
    if message.get("error"):
        raise RuntimeError(_gemini_live_error_message(message))

    tool_call = message.get("toolCall")
    if isinstance(tool_call, dict):
        function_calls = tool_call.get("functionCalls") or []
        responses = [
            await _call_gemini_live_tool(
                function_call=call,
                bridge=bridge,
                local_tools=local_tools,
                mcp_tool_names=mcp_tool_names,
            )
            for call in function_calls
            if isinstance(call, dict)
        ]
        if responses:
            await provider_ws.send(json.dumps({"toolResponse": {"functionResponses": responses}}))

    server_content = message.get("serverContent")
    if not isinstance(server_content, dict):
        return ""

    input_transcription = server_content.get("inputTranscription")
    if isinstance(input_transcription, dict):
        text = str(input_transcription.get("text") or "")
        if text:
            turn.transcript = _append_gemini_live_text(turn.transcript, text)
            if websocket:
                await _send_ws_json(websocket, {"type": "partial", "text": turn.transcript.strip()})

    output_transcription = server_content.get("outputTranscription")
    if isinstance(output_transcription, dict):
        text = str(output_transcription.get("text") or "")
        if text:
            turn.speech = _append_gemini_live_text(turn.speech, text)

    model_turn = server_content.get("modelTurn")
    parts = model_turn.get("parts") if isinstance(model_turn, dict) else []
    for part in parts or []:
        if not isinstance(part, dict):
            continue
        text = str(part.get("text") or "")
        if text and not output_transcription:
            turn.speech = _append_gemini_live_text(turn.speech, text)
        inline = part.get("inlineData") or part.get("inline_data")
        if isinstance(inline, dict) and inline.get("data"):
            media_type = str(inline.get("mimeType") or inline.get("mime_type") or "audio/pcm;rate=24000")
            turn.audio_sample_rate = int(
                _mime_param(media_type, "rate") or _mime_param(media_type, "sample_rate") or 24000
            )
            turn.audio_chunks.append(base64.b64decode(str(inline["data"])))

    if server_content.get("generationComplete"):
        return "generation_complete"
    if server_content.get("turnComplete"):
        return "turn_complete"
    return ""


async def _send_gemini_live_audio_queue(
    provider_ws,
    queue: "asyncio.Queue[bytes | None]",
    *,
    sample_rate: int,
) -> None:
    await provider_ws.send(json.dumps({"realtimeInput": {"activityStart": {}}}))
    while True:
        chunk = await queue.get()
        if chunk is None:
            break
        payload = _pcm_stream_payload(chunk)
        if not payload:
            continue
        await provider_ws.send(
            json.dumps(
                {
                    "realtimeInput": {
                        "audio": {
                            "data": base64.b64encode(payload).decode("ascii"),
                            "mimeType": f"audio/pcm;rate={sample_rate or DEFAULT_HA_STT_SAMPLE_RATE}",
                        }
                    }
                }
            )
        )
    await provider_ws.send(json.dumps({"realtimeInput": {"activityEnd": {}}}))


async def _run_gemini_live_ha_turn(
    *,
    turn: HALiveTurn,
    queue: "asyncio.Queue[bytes | None]",
    websocket: WebSocket | None,
    config: RuntimeConfig,
    flow: FlowConfig,
    integration: IntegrationConfig,
    input_sample_rate: int,
) -> None:
    started_at = time.perf_counter()
    bridge: CombinedMCPBridge | None = None
    mcp_tools_schema: ToolsSchema | None = None
    try:
        local_tool_schemas = [schema for schema in [_web_search_tool_schema(config, flow)] if schema]
        local_tools = {schema.name: schema for schema in local_tool_schemas}
        mcp_servers = config.enabled_mcp_servers(config.effective_mcp_token) if flow.mcp_enabled else []
        if mcp_servers:
            bridge = CombinedMCPBridge(mcp_servers, flow.mcp_tool_allowlist)
            try:
                await bridge.start()
                mcp_tools_schema = await bridge.tools_schema(
                    cache_enabled=config.mcp_tools_cache_enabled,
                    cache_ttl_seconds=config.mcp_tools_cache_ttl_seconds,
                )
            except Exception as err:
                with suppress(Exception):
                    await bridge.close()
                raise RuntimeError(f"MCP tools are enabled but unavailable: {err}") from err
        tools_schema = _merge_tools_schema(mcp_tools_schema, local_tool_schemas)
        mcp_tool_names = {
            tool.name for tool in (mcp_tools_schema.standard_tools if mcp_tools_schema else [])
        }
        api_key = _integration_api_key(
            integration,
            "Pipecat Live Bridge",
            os.getenv("GOOGLE_API_KEY", ""),
        )
        url = (
            "wss://generativelanguage.googleapis.com/ws/"
            "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
            f"?key={quote(api_key, safe='')}"
        )
        async with _websocket_connect(url, {}) as provider_ws:
            await provider_ws.send(
                json.dumps({"setup": _gemini_live_ha_setup(config, flow, integration, tools_schema)})
            )
            async with asyncio.timeout(10):
                while True:
                    raw = await provider_ws.recv()
                    message = json.loads(raw)
                    if message.get("setupComplete") is not None:
                        break
                    if message.get("error"):
                        raise RuntimeError(_gemini_live_error_message(message))

            sender_task = asyncio.create_task(
                _send_gemini_live_audio_queue(provider_ws, queue, sample_rate=input_sample_rate)
            )
            completion_reason = ""
            try:
                async with asyncio.timeout(HA_LIVE_RESULT_TIMEOUT_SECONDS):
                    async for raw in provider_ws:
                        message = json.loads(raw)
                        completion_reason = await _handle_gemini_live_message(
                            websocket=websocket,
                            provider_ws=provider_ws,
                            message=message,
                            turn=turn,
                            bridge=bridge,
                            local_tools=local_tools,
                            mcp_tool_names=mcp_tool_names,
                        )
                        if completion_reason:
                            break
            finally:
                sender_task.cancel()
                with suppress(Exception):
                    await sender_task
        _remember_ha_live_transcript(turn)
        _remember_ha_live_speech(turn)
        turn.transcript_ready.set()
        logger.info(
            "Pipecat Live Bridge turn finished flow={} completion={} transcript={} speech={} audio_bytes={} duration_ms={:.0f}",
            flow.id,
            completion_reason or "unknown",
            _text_fingerprint(turn.transcript),
            _text_fingerprint(turn.speech),
            len(turn.audio),
            (time.perf_counter() - started_at) * 1000,
        )
    except Exception as err:
        turn.error = str(err)
        logger.warning("Pipecat Live Bridge failed for flow {}: {}", flow.id, err)
    finally:
        if not turn.transcript_ready.is_set():
            turn.transcript_ready.set()
        turn.done.set()
        if bridge:
            with suppress(Exception):
                await bridge.close()


def _start_gemini_live_ha_turn(
    *,
    config: RuntimeConfig,
    flow: FlowConfig,
    integration: IntegrationConfig,
    websocket: WebSocket | None,
    input_sample_rate: int,
) -> tuple[HALiveTurn, "asyncio.Queue[bytes | None]"]:
    turn = HALiveTurn(flow_id=flow.id, provider="gemini-live")
    queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=32)
    turn.task = asyncio.create_task(
        _run_gemini_live_ha_turn(
            turn=turn,
            queue=queue,
            websocket=websocket,
            config=config,
            flow=flow,
            integration=integration,
            input_sample_rate=input_sample_rate,
        )
    )
    return turn, queue


async def _wait_for_ha_live_transcript(turn: HALiveTurn) -> str:
    with suppress(TimeoutError):
        async with asyncio.timeout(HA_LIVE_TRANSCRIPT_TIMEOUT_SECONDS):
            await turn.transcript_ready.wait()
    return turn.transcript.strip()


async def _ha_live_conversation_result(
    turn: HALiveTurn,
    *,
    conversation_id: str | None,
) -> dict[str, Any] | None:
    async with asyncio.timeout(HA_LIVE_RESULT_TIMEOUT_SECONDS):
        await turn.done.wait()
    if turn.error or not turn.speech.strip():
        return None
    _remember_ha_live_speech(turn)
    end_conversation = _should_end_conversation(turn.transcript, turn.speech)
    return {
        "speech": turn.speech.strip(),
        "conversation_id": conversation_id,
        "continue_conversation": not end_conversation,
        "end_conversation": end_conversation,
        "error": "",
        "source": "pipecat_live_bridge",
    }


async def _ha_live_tts_audio(turn: HALiveTurn) -> tuple[bytes, str, str] | None:
    async with asyncio.timeout(HA_LIVE_RESULT_TIMEOUT_SECONDS):
        await turn.done.wait()
    if turn.error or not turn.audio:
        return None
    return (
        _wav_from_pcm(
            turn.audio,
            sample_rate=turn.audio_sample_rate or 24000,
            sample_width=2,
            channels=1,
        ),
        "audio/wav",
        "wav",
    )


async def _openai_realtime_transcribe_stream(
    *,
    websocket: WebSocket,
    queue: "asyncio.Queue[bytes | None]",
    config: RuntimeConfig,
    flow: FlowConfig,
    integration: IntegrationConfig,
    model: str,
    metadata: dict[str, Any],
) -> str:
    api_key = _integration_api_key(integration, "STT", config.openai_api_key)
    sample_rate = int(_ws_metadata_value(metadata, "sample_rate", 24000) or 24000)
    language = _normalize_language_hint(str(_ws_metadata_value(metadata, "language", "")))
    transcription_model = _openai_realtime_transcription_model(flow, model)
    url = f"wss://api.openai.com/v1/realtime?model={quote(transcription_model, safe='')}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "OpenAI-Beta": "realtime=v1",
    }

    async with _websocket_connect(url, headers) as provider_ws:
        session: dict[str, Any] = {
            "type": "transcription",
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": sample_rate},
                    "transcription": {"model": transcription_model},
                }
            },
        }
        if language:
            session["audio"]["input"]["transcription"]["language"] = language
        if flow.vad_eagerness:
            session["audio"]["input"]["transcription"]["delay"] = (
                "low" if flow.vad_eagerness == "auto" else flow.vad_eagerness
            )
        await provider_ws.send(json.dumps({"type": "session.update", "session": session}))

        async def sender() -> None:
            while True:
                chunk = await queue.get()
                if chunk is None:
                    break
                payload = _pcm_stream_payload(chunk)
                if not payload:
                    continue
                await provider_ws.send(
                    json.dumps(
                        {
                            "type": "input_audio_buffer.append",
                            "audio": base64.b64encode(payload).decode("ascii"),
                        }
                    )
                )
            await provider_ws.send(json.dumps({"type": "input_audio_buffer.commit"}))

        sender_task = asyncio.create_task(sender())
        transcript = ""
        try:
            async with asyncio.timeout(45):
                async for raw in provider_ws:
                    event = json.loads(raw)
                    event_type = str(event.get("type") or "")
                    if event_type == "conversation.item.input_audio_transcription.delta":
                        delta = str(event.get("delta") or "")
                        if delta:
                            await _send_ws_json(websocket, {"type": "partial", "text": delta})
                    elif event_type == "conversation.item.input_audio_transcription.completed":
                        transcript = str(event.get("transcript") or "").strip()
                        break
                    elif event_type == "error":
                        error = event.get("error") or {}
                        raise RuntimeError(error.get("message") or "OpenAI realtime transcription failed")
        finally:
            sender_task.cancel()
            with suppress(Exception):
                await sender_task
        return transcript


async def _deepgram_transcribe_stream(
    *,
    websocket: WebSocket,
    queue: "asyncio.Queue[bytes | None]",
    integration: IntegrationConfig,
    model: str,
    metadata: dict[str, Any],
) -> str:
    api_key = _integration_api_key(integration, "STT")
    sample_rate = int(_ws_metadata_value(metadata, "sample_rate", DEFAULT_HA_STT_SAMPLE_RATE) or DEFAULT_HA_STT_SAMPLE_RATE)
    channels = int(_ws_metadata_value(metadata, "channel", DEFAULT_HA_STT_CHANNELS) or DEFAULT_HA_STT_CHANNELS)
    language = _normalize_language_hint(str(_ws_metadata_value(metadata, "language", "")))
    params = {
        "model": model or integration.default_stt_model or integration.default_model or DEFAULT_DEEPGRAM_MODEL,
        "encoding": "linear16",
        "sample_rate": sample_rate,
        "channels": channels,
        "smart_format": "true",
        "interim_results": "true",
        "endpointing": "300",
    }
    if language:
        params["language"] = language
    url = f"wss://api.deepgram.com/v1/listen?{urlencode(params)}"

    async with _websocket_connect(url, {"Authorization": f"Token {api_key}"}) as provider_ws:
        async def sender() -> None:
            while True:
                chunk = await queue.get()
                if chunk is None:
                    break
                payload = _pcm_stream_payload(chunk)
                if payload:
                    await provider_ws.send(payload)
            await provider_ws.send(json.dumps({"type": "CloseStream"}))

        sender_task = asyncio.create_task(sender())
        final_parts: list[str] = []
        latest_partial = ""
        try:
            async with asyncio.timeout(45):
                async for raw in provider_ws:
                    data = json.loads(raw)
                    if data.get("type") == "Metadata":
                        continue
                    channel = data.get("channel") or {}
                    alternatives = channel.get("alternatives") or []
                    transcript = str((alternatives[0] if alternatives else {}).get("transcript") or "").strip()
                    if not transcript:
                        if data.get("type") == "CloseStream":
                            break
                        continue
                    if data.get("is_final"):
                        final_parts.append(transcript)
                    else:
                        latest_partial = transcript
                        await _send_ws_json(websocket, {"type": "partial", "text": transcript})
                    if data.get("speech_final"):
                        break
        finally:
            sender_task.cancel()
            with suppress(Exception):
                await sender_task
        return " ".join(final_parts).strip() or latest_partial.strip()


def _gradium_input_format(sample_rate: int) -> tuple[str, int]:
    if sample_rate in {8000, 16000, 24000}:
        return f"pcm_{sample_rate}", sample_rate
    return "pcm_16000", 16000


def _normalize_stt_language(metadata: dict[str, Any], flow: FlowConfig, integration: IntegrationConfig) -> str:
    return (
        _normalize_language_hint(str(_ws_metadata_value(metadata, "language", "")))
        or _normalize_language_hint(_runtime_language(flow, integration))
        or "en"
    )


async def _soniox_transcribe_stream(
    *,
    websocket: WebSocket | None,
    queue: "asyncio.Queue[bytes | None]",
    integration: IntegrationConfig,
    flow: FlowConfig,
    model: str,
    metadata: dict[str, Any],
) -> str:
    api_key = _integration_api_key(integration, "STT")
    sample_rate = int(_ws_metadata_value(metadata, "sample_rate", DEFAULT_HA_STT_SAMPLE_RATE) or DEFAULT_HA_STT_SAMPLE_RATE)
    channels = int(_ws_metadata_value(metadata, "channel", DEFAULT_HA_STT_CHANNELS) or DEFAULT_HA_STT_CHANNELS)
    language = _normalize_stt_language(metadata, flow, integration)
    config = {
        "api_key": api_key,
        "model": model or integration.default_model or DEFAULT_SONIOX_MODEL,
        "audio_format": "pcm_s16le",
        "num_channels": channels,
        "enable_endpoint_detection": False,
        "sample_rate": sample_rate,
        "language_hints": [language] if language else None,
    }
    url = integration.endpoint or "wss://stt-rt.soniox.com/transcribe-websocket"
    logger.info(
        "HA Assist Soniox STT streaming started integration={} model={} language={} sample_rate={}",
        integration.name,
        config["model"],
        language,
        sample_rate,
    )

    async with _websocket_connect(url, {}) as provider_ws:
        await provider_ws.send(json.dumps(config))

        async def sender() -> None:
            while True:
                chunk = await queue.get()
                if chunk is None:
                    break
                payload = _pcm_stream_payload(chunk)
                if payload:
                    await provider_ws.send(payload)
            await provider_ws.send(json.dumps({"type": "finalize"}))
            await provider_ws.send("")

        sender_task = asyncio.create_task(sender())
        final_tokens: list[str] = []
        latest_partial = ""
        try:
            async with asyncio.timeout(45):
                async for raw in provider_ws:
                    data = json.loads(raw)
                    if data.get("error_code") or data.get("error_message"):
                        raise RuntimeError(data.get("error_message") or data.get("error_code") or "Soniox STT failed")
                    tokens = data.get("tokens") or []
                    non_final_tokens: list[str] = []
                    for token in tokens:
                        text = str(token.get("text") or "")
                        if token.get("is_final"):
                            if text:
                                final_tokens.append(text)
                            else:
                                transcript = "".join(final_tokens).strip()
                                if transcript:
                                    return transcript
                        elif text:
                            non_final_tokens.append(text)
                    partial = ("".join(final_tokens) + "".join(non_final_tokens)).strip()
                    if partial:
                        latest_partial = partial
                        if websocket:
                            await _send_ws_json(websocket, {"type": "partial", "text": latest_partial})
                    if data.get("finished"):
                        break
        finally:
            sender_task.cancel()
            with suppress(Exception):
                await sender_task
    return "".join(final_tokens).strip() or latest_partial.strip()


async def _gradium_transcribe_stream(
    *,
    websocket: WebSocket | None,
    queue: "asyncio.Queue[bytes | None]",
    integration: IntegrationConfig,
    flow: FlowConfig,
    model: str,
    metadata: dict[str, Any],
) -> str:
    api_key = _integration_api_key(integration, "STT")
    source_rate = int(_ws_metadata_value(metadata, "sample_rate", DEFAULT_HA_STT_SAMPLE_RATE) or DEFAULT_HA_STT_SAMPLE_RATE)
    channels = int(_ws_metadata_value(metadata, "channel", DEFAULT_HA_STT_CHANNELS) or DEFAULT_HA_STT_CHANNELS)
    input_format, target_rate = _gradium_input_format(source_rate)
    language = _normalize_stt_language(metadata, flow, integration)
    headers = {"x-api-key": api_key, "x-api-source": "pipecat-assist"}
    url = integration.endpoint or "wss://api.gradium.ai/api/speech/asr"
    setup_msg: dict[str, Any] = {
        "type": "setup",
        "model_name": model or integration.default_model or "default",
        "input_format": input_format,
        "json_config": {"language": language, "delay_in_frames": 8},
    }
    logger.info(
        "HA Assist Gradium STT streaming started integration={} model={} language={} source_rate={} target_rate={}",
        integration.name,
        setup_msg["model_name"],
        language,
        source_rate,
        target_rate,
    )

    async with _websocket_connect(url, headers) as provider_ws:
        await provider_ws.send(json.dumps(setup_msg))
        ready = json.loads(await provider_ws.recv())
        if ready.get("type") == "error":
            raise RuntimeError(ready.get("message") or "Gradium STT setup failed")
        if ready.get("type") != "ready":
            raise RuntimeError(f"Gradium STT returned unexpected setup response: {ready.get('type')}")

        async def sender() -> None:
            resample_state = None
            audio_buffer = bytearray()
            chunk_size = int(80 * target_rate * 2 * channels / 1000)
            while True:
                chunk = await queue.get()
                if chunk is None:
                    break
                payload = _pcm_stream_payload(chunk)
                if not payload:
                    continue
                if source_rate != target_rate:
                    try:
                        import audioop
                    except ModuleNotFoundError as err:
                        raise RuntimeError("Gradium STT needs 8, 16, or 24 kHz PCM audio") from err
                    payload, resample_state = audioop.ratecv(
                        payload,
                        2,
                        channels,
                        source_rate,
                        target_rate,
                        resample_state,
                    )
                audio_buffer.extend(payload)
                while len(audio_buffer) >= chunk_size:
                    frame = bytes(audio_buffer[:chunk_size])
                    del audio_buffer[:chunk_size]
                    await provider_ws.send(
                        json.dumps(
                            {
                                "type": "audio",
                                "audio": base64.b64encode(frame).decode("ascii"),
                            }
                        )
                    )
            if audio_buffer:
                await provider_ws.send(
                    json.dumps(
                        {
                            "type": "audio",
                            "audio": base64.b64encode(bytes(audio_buffer)).decode("ascii"),
                        }
                    )
                )
            await provider_ws.send(json.dumps({"type": "flush", "flush_id": "final"}))

        sender_task = asyncio.create_task(sender())
        parts: list[str] = []
        latest_partial = ""
        flushed = False
        try:
            async with asyncio.timeout(45):
                async for raw in provider_ws:
                    data = json.loads(raw)
                    message_type = str(data.get("type") or "")
                    if message_type == "text":
                        text = str(data.get("text") or "").strip()
                        if text:
                            parts.append(text)
                            latest_partial = " ".join(parts).strip()
                            if websocket:
                                await _send_ws_json(websocket, {"type": "partial", "text": latest_partial})
                    elif message_type == "flushed":
                        flushed = True
                        await asyncio.sleep(0.12)
                        break
                    elif message_type == "error":
                        raise RuntimeError(data.get("message") or "Gradium STT failed")
                    elif message_type == "end_of_stream" and flushed:
                        break
        finally:
            sender_task.cancel()
            with suppress(Exception):
                await sender_task
    return " ".join(parts).strip() or latest_partial.strip()


def _speechmatics_transcript_text(data: dict[str, Any]) -> str:
    metadata = data.get("metadata") or {}
    transcript = str(metadata.get("transcript") or data.get("transcript") or "").strip()
    if transcript:
        return transcript

    parts: list[str] = []
    for result in data.get("results") or []:
        alternatives = result.get("alternatives") or []
        content = str((alternatives[0] if alternatives else {}).get("content") or "").strip()
        if not content:
            continue
        if result.get("type") == "punctuation" and parts:
            parts[-1] = f"{parts[-1]}{content}"
        else:
            parts.append(content)
    return " ".join(parts).strip()


def _speechmatics_model(model: str, integration: IntegrationConfig) -> str:
    candidate = (model or integration.default_stt_model or integration.default_model or DEFAULT_SPEECHMATICS_MODEL).strip()
    return candidate if candidate in {"standard", "enhanced", "melia-1"} else DEFAULT_SPEECHMATICS_MODEL


async def _speechmatics_transcribe_stream(
    *,
    websocket: WebSocket | None,
    queue: "asyncio.Queue[bytes | None]",
    integration: IntegrationConfig,
    flow: FlowConfig,
    model: str,
    metadata: dict[str, Any],
) -> str:
    api_key = _integration_api_key(integration, "STT")
    sample_rate = int(_ws_metadata_value(metadata, "sample_rate", DEFAULT_HA_STT_SAMPLE_RATE) or DEFAULT_HA_STT_SAMPLE_RATE)
    language = (
        _normalize_language_hint(str(_ws_metadata_value(metadata, "language", "")))
        or _normalize_language_hint(_runtime_language(flow, integration))
        or "en"
    )
    stt_model = _speechmatics_model(model, integration)
    start_message = {
        "message": "StartRecognition",
        "audio_format": {
            "type": "raw",
            "encoding": "pcm_s16le",
            "sample_rate": sample_rate,
        },
        "transcription_config": {
            "language": language,
            "model": stt_model,
            "enable_partials": True,
            "max_delay": 0.7,
            "max_delay_mode": "fixed",
            "conversation_config": {"end_of_utterance_silence_trigger": 0.2},
        },
    }

    url = "wss://eu.rt.speechmatics.com/v2"
    logger.info(
        "HA Assist Speechmatics STT streaming started integration={} model={} language={} sample_rate={}",
        integration.name,
        stt_model,
        language,
        sample_rate,
    )

    async with _websocket_connect(url, {"Authorization": f"Bearer {api_key}"}) as provider_ws:
        await provider_ws.send(json.dumps(start_message))

        async def sender() -> None:
            seq_no = 0
            while True:
                chunk = await queue.get()
                if chunk is None:
                    break
                payload = _pcm_stream_payload(chunk)
                if not payload:
                    continue
                await provider_ws.send(payload)
                seq_no += 1
            await provider_ws.send(
                json.dumps({"message": "EndOfStream", "last_seq_no": max(seq_no - 1, 0)})
            )

        sender_task = asyncio.create_task(sender())
        final_parts: list[str] = []
        latest_partial = ""
        try:
            async with asyncio.timeout(45):
                async for raw in provider_ws:
                    data = json.loads(raw)
                    message = str(data.get("message") or "")
                    if message in {"RecognitionStarted", "AudioAdded", "Info"}:
                        continue
                    if message == "AddPartialTranscript":
                        latest_partial = _speechmatics_transcript_text(data)
                        if latest_partial and websocket:
                            await _send_ws_json(websocket, {"type": "partial", "text": latest_partial})
                        continue
                    if message == "AddTranscript":
                        transcript = _speechmatics_transcript_text(data)
                        if transcript:
                            final_parts.append(transcript)
                        continue
                    if message == "EndOfTranscript":
                        break
                    if message == "Error":
                        raise RuntimeError(data.get("reason") or data.get("type") or "Speechmatics STT failed")
        finally:
            sender_task.cancel()
            with suppress(Exception):
                await sender_task

    return " ".join(final_parts).strip() or latest_partial.strip()


async def _streaming_transcribe_audio(
    *,
    websocket: WebSocket,
    queue: "asyncio.Queue[bytes | None]",
    config: RuntimeConfig,
    flow: FlowConfig,
    step,
    integration: IntegrationConfig,
    model: str,
    metadata: dict[str, Any],
) -> str:
    kind = _streaming_stt_kind(integration, model)
    if kind == "openai_realtime":
        return await _openai_realtime_transcribe_stream(
            websocket=websocket,
            queue=queue,
            config=config,
            flow=flow,
            integration=integration,
            model=model,
            metadata=metadata,
        )
    if kind == "deepgram":
        return await _deepgram_transcribe_stream(
            websocket=websocket,
            queue=queue,
            integration=integration,
            model=model,
            metadata=metadata,
        )
    if kind == "gradium":
        return await _gradium_transcribe_stream(
            websocket=websocket,
            queue=queue,
            integration=integration,
            flow=flow,
            model=model,
            metadata=metadata,
        )
    if kind == "soniox":
        return await _soniox_transcribe_stream(
            websocket=websocket,
            queue=queue,
            integration=integration,
            flow=flow,
            model=model,
            metadata=metadata,
        )
    if kind == "speechmatics":
        return await _speechmatics_transcribe_stream(
            websocket=websocket,
            queue=queue,
            integration=integration,
            flow=flow,
            model=model,
            metadata=metadata,
        )
    raise RuntimeError(f"{integration.name} does not expose a HA Assist streaming STT bridge yet")


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


def _enabled_web_search_step(flow: FlowConfig):
    return _enabled_step(flow, "web_search")


def _web_search_enabled(flow: FlowConfig) -> bool:
    return bool(flow.web_search_enabled or _enabled_web_search_step(flow))


def _memory_enabled(config: RuntimeConfig, flow: FlowConfig) -> bool:
    memory_step = _enabled_step(flow, "memory")
    return config.session_memory_enabled and (flow.memory_enabled or memory_step is not None)


def _web_search_announces(flow: FlowConfig) -> bool:
    step = _enabled_web_search_step(flow)
    if not step:
        return False
    return bool((step.settings or {}).get("announce", True))


def _effective_instructions(flow: FlowConfig) -> str:
    instructions = flow.instructions
    if CONVERSATION_END_SYSTEM_HINT not in instructions:
        instructions += f"\n\n{CONVERSATION_END_SYSTEM_HINT}"
    if _web_search_announces(flow):
        instructions += (
            "\n\nWhen you decide to use web search, first say "
            '"Please hold, I\'m checking." Then run the search and answer briefly.'
        )
    return instructions


def _web_search_tool_schema(config: RuntimeConfig, flow: FlowConfig) -> FunctionSchema | None:
    """Return the optional web search tool schema for a flow."""

    if not _web_search_enabled(flow):
        return None
    integration = config.integration("web-search")
    if not integration or not integration.enabled:
        return None
    provider = config.integration(integration.provider_id or "openai-cloud")
    if not provider:
        logger.warning("Web search is enabled, but no search LLM provider is selected")
        return None
    model = integration.default_model or provider.default_model or DEFAULT_WEB_SEARCH_MODEL

    if provider.kind in {"openai", "openai_cloud"}:
        api_key = (provider.api_key or integration.api_key or config.openai_api_key or "").strip()
        if not api_key:
            logger.warning("Web search is enabled, but {} has no API key", provider.name)
            return None

        async def runner(query: str) -> str:
            return await run_openai_web_search(api_key, model, query)

        return web_search_schema(runner, model)

    if provider.kind in {"gemini", "gemini_cloud"}:
        if model.startswith(("gpt-", "o", "claude-")):
            model = provider.default_model or DEFAULT_GEMINI_TEXT_MODEL
        api_key = (provider.api_key or integration.api_key or os.getenv("GOOGLE_API_KEY", "")).strip()
        if not api_key:
            logger.warning("Web search is enabled, but {} has no API key", provider.name)
            return None

        async def runner(query: str) -> str:
            return await run_gemini_web_search(api_key, model or DEFAULT_GEMINI_TEXT_MODEL, query)

        return web_search_schema(runner, model or DEFAULT_GEMINI_TEXT_MODEL)

    logger.warning("Web search provider {} is not supported yet", provider.kind)
    return None


def _merge_tools_schema(
    base_schema,
    extra_tools: list[FunctionSchema] | None = None,
) -> ToolsSchema | None:
    """Return one ToolsSchema with MCP and local assistant tools."""

    tools: list[FunctionSchema] = []
    if base_schema and getattr(base_schema, "standard_tools", None):
        tools.extend(base_schema.standard_tools)
    tools.extend(extra_tools or [])
    return ToolsSchema(standard_tools=tools) if tools else None


def _register_local_tool_handlers(llm, tools: list[FunctionSchema]) -> None:
    """Register local function handlers when the LLM service needs explicit callbacks."""

    for schema in tools:
        handler = getattr(schema, "handler", None)
        if handler:
            llm.register_function(schema.name, handler)


def _integration_api_key(
    integration: IntegrationConfig,
    role: str,
    fallback: str = "",
) -> str:
    api_key = (integration.api_key or fallback or "").strip()
    if not api_key:
        raise RuntimeError(f"{integration.name} is missing api_key for {role}")
    return api_key


def _integration_api_key_or_400(
    integration: IntegrationConfig,
    role: str,
    fallback: str = "",
) -> str:
    try:
        return _integration_api_key(integration, role, fallback)
    except RuntimeError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


def _step_model(step, integration: IntegrationConfig | None, fallback: str = "") -> str:
    return (
        (getattr(step, "model", "") if step else "")
        or (integration.default_model if integration else "")
        or fallback
    ).strip()


def _step_model_for(
    step,
    integration: IntegrationConfig | None,
    capability: str,
    fallback: str = "",
) -> str:
    if getattr(step, "model", ""):
        return step.model.strip()
    if not integration:
        return fallback.strip()
    if capability == "stt":
        return (integration.default_stt_model or fallback).strip()
    if capability == "tts":
        return (integration.default_tts_model or integration.default_model or fallback).strip()
    if capability == "realtime":
        return (integration.default_realtime_model or fallback).strip()
    return (integration.default_model or fallback).strip()


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


def _provider_names_for_kinds(config: RuntimeConfig, kinds: set[str]) -> str:
    names = sorted({item.name for item in config.integrations if item.kind in kinds})
    return ", ".join(names or sorted(kinds))


def _runtime_flow_errors(config: RuntimeConfig, flow: FlowConfig) -> list[str]:
    """Return pipeline errors that would prevent a WebRTC runtime from starting."""

    errors: list[str] = []
    if not flow.enabled:
        errors.append(f"Pipeline {flow.name} is disabled.")

    model_integration = config.model_integration(flow)
    provider_kind = model_integration.kind if model_integration else flow.provider_id
    runtime_mode = _runtime_mode(flow, provider_kind)

    if runtime_mode == "s2s":
        if provider_kind not in {"openai", "gemini", "aws_nova_sonic"}:
            errors.append(f"Realtime speech-to-speech runtime for {provider_kind} is not supported.")
        if any(step.kind in {"stt", "tts"} and step.enabled for step in flow.steps):
            errors.append("Speech-to-speech pipelines cannot use separate STT or TTS steps.")
        return errors

    role_labels = {"stt": "STT", "llm": "LLM", "tts": "TTS"}
    for kind, supported_kinds in COMPOSED_STEP_PROVIDER_KINDS.items():
        step, integration = _step_integration(config, flow, kind)
        label = role_labels[kind]
        if not step:
            errors.append(f"Composed pipeline needs an enabled {label} step.")
            continue
        if not step.integration_id:
            errors.append(f"{step.label or label} needs an integration.")
            continue
        if not integration:
            errors.append(f"{step.label or label} uses missing integration {step.integration_id}.")
            continue
        if integration.kind not in supported_kinds:
            supported_names = _provider_names_for_kinds(config, supported_kinds)
            if kind == "stt" and integration.kind == "gemini_cloud":
                errors.append(
                    "Google Gemini Cloud can transcribe buffered HA Assist audio, but it is not "
                    f"a composed realtime STT processor. Use one of: {supported_names}."
                )
            else:
                errors.append(
                    f"{integration.name} cannot be used as {label} in composed realtime pipelines. "
                    f"Use one of: {supported_names}."
                )
            continue
        if not integration.enabled:
            errors.append(f"{integration.name} is disabled.")

    return errors


def _runner_body(runner_args: RunnerArguments) -> dict[str, Any]:
    body = runner_args.body if isinstance(runner_args.body, dict) else {}
    request_data = body.get("request_data")
    return request_data if isinstance(request_data, dict) else body


def _session_client_id(runner_args: RunnerArguments, flow: FlowConfig) -> str:
    body = _runner_body(runner_args)
    for key in ("client_id", "device_id", "satellite_id", "source"):
        value = str(body.get(key, "")).strip()
        if value:
            return f"{flow.id}:{value}"
    return f"{flow.id}:default"


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


def _gemini_vad(flow: FlowConfig, *, local_turn_detection: bool = False):
    try:
        from pipecat.services.google.gemini_live.llm import GeminiVADParams
    except ImportError:
        from pipecat.services.google.gemini_live import GeminiVADParams

    if local_turn_detection:
        # Local Silero VAD emits the activity_start/activity_end markers. Leaving
        # Gemini server VAD enabled at the same time creates two competing turn
        # detectors and duplicate interruptions.
        return GeminiVADParams(disabled=True)

    silence_by_eagerness = {
        "high": 300,
        "medium": 500,
        "low": 800,
    }
    silence_duration_ms = silence_by_eagerness.get(flow.vad_eagerness)
    return GeminiVADParams(silence_duration_ms=silence_duration_ms)


def _composed_vad_analyzer(flow: FlowConfig):
    """Return local VAD tuned for browser and ESP32 composed pipelines."""

    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.audio.vad.vad_analyzer import VADParams

    stop_secs_by_eagerness = {
        "high": 0.2,
        "medium": 0.2,
        "auto": 0.2,
        "low": 0.2,
    }
    return SileroVADAnalyzer(
        params=VADParams(
            confidence=0.7,
            start_secs=0.12,
            stop_secs=stop_secs_by_eagerness.get(flow.vad_eagerness, 0.45),
            min_volume=0.02,
        )
    )


def _gemini_live_service(
    *,
    api_key: str,
    model: str,
    flow: FlowConfig,
    integration: IntegrationConfig | None,
    local_turn_detection: bool = False,
    inference_on_context_initialization: bool = True,
):
    try:
        from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
    except ImportError:
        from pipecat.services.google.gemini_live import GeminiLiveLLMService

    class ResilientGeminiLiveLLMService(GeminiLiveLLMService):
        """Do not count a normal long-lived session renewal as a rapid failure."""

        async def _handle_user_started_speaking(self, frame):
            logger.debug(
                "Gemini local turn start: vad_disabled={} ready={} session={}",
                getattr(self, "_vad_disabled", False),
                getattr(self, "_ready_for_realtime_input", False),
                bool(getattr(self, "_session", None)),
            )
            await super()._handle_user_started_speaking(frame)

        async def _handle_user_stopped_speaking(self, frame):
            logger.debug(
                "Gemini local turn stop: vad_disabled={} ready={} session={}",
                getattr(self, "_vad_disabled", False),
                getattr(self, "_ready_for_realtime_input", False),
                bool(getattr(self, "_session", None)),
            )
            await super()._handle_user_stopped_speaking(frame)

        async def _handle_connection_error(self, error: Exception) -> bool:
            connection_started = getattr(self, "_connection_start_time", None)
            if (
                connection_started
                and time.time() - connection_started >= 30.0
                and getattr(self, "_consecutive_failures", 0)
            ):
                logger.info(
                    "Gemini connection was stable before renewal; resetting failure counter"
                )
                self._consecutive_failures = 0
            return await super()._handle_connection_error(error)

    settings_kwargs: dict[str, Any] = {
        "model": _gemini_model(model),
        "system_instruction": _effective_instructions(flow),
        "voice": _gemini_voice(flow, integration),
        "language": _runtime_language(flow, integration) or "en-US",
    }
    if _enabled_step(flow, "vad"):
        settings_kwargs["vad"] = _gemini_vad(
            flow,
            local_turn_detection=local_turn_detection,
        )
    if flow.max_output_tokens:
        settings_kwargs["max_tokens"] = flow.max_output_tokens

    return ResilientGeminiLiveLLMService(
        api_key=api_key,
        settings=ResilientGeminiLiveLLMService.Settings(**settings_kwargs),
        inference_on_context_initialization=inference_on_context_initialization,
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
            system_instruction=_effective_instructions(flow),
            session_properties=_session_properties(
                flow,
                tools_schema,
                voice=_openai_voice(flow, integration),
                integration=integration,
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
            system_instruction=_effective_instructions(flow),
        ),
        tools=tools,
    )


def _build_stt_service(
    config: RuntimeConfig,
    flow: FlowConfig,
    language_override: str | None = None,
):
    step, integration = _step_integration(config, flow, "stt")
    integration = _require_integration(integration, "STT", fields=())
    model = _step_model_for(step, integration, "stt")
    language = _runtime_language(flow, integration, language_override)
    logger.info(
        "Building composed STT service integration={} kind={} model={} language={}",
        integration.name,
        integration.kind,
        model or "",
        language,
    )

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

        return SpeechmaticsSTTService(
            api_key=_integration_api_key(integration, "STT"),
            settings=SpeechmaticsSTTService.Settings(
                model=model or None,
                language=_pipecat_language(language),
            ),
        )
    if integration.kind == "gradium":
        from pipecat.services.gradium.stt import GradiumSTTService

        return GradiumSTTService(
            api_key=_integration_api_key(integration, "STT"),
            settings=GradiumSTTService.Settings(model=model or None),
        )
    if integration.kind in {"openai", "openai_cloud"}:
        from pipecat.services.openai.stt import OpenAIRealtimeSTTService

        return OpenAIRealtimeSTTService(
            api_key=_integration_api_key(integration, "STT", config.openai_api_key),
            model=model or DEFAULT_OPENAI_STT_MODEL,
            language=language,
        )

    raise RuntimeError(f"STT provider {integration.kind} is not supported by composed runtime")


def _build_llm_service(config: RuntimeConfig, flow: FlowConfig, tools_schema=None):
    step, integration = _step_integration(config, flow, "llm")
    integration = _require_integration(integration, "LLM", fields=())
    model = _step_model_for(step, integration, "llm", flow.text_model)

    if integration.kind in {"openai", "openai_cloud"}:
        from pipecat.services.openai.llm import OpenAILLMService

        api_key = integration.api_key or config.openai_api_key
        if not api_key:
            raise RuntimeError("OpenAI is missing api_key")
        settings_kwargs: dict[str, Any] = {
            "model": model or DEFAULT_OPENAI_TEXT_MODEL,
            "system_instruction": _effective_instructions(flow),
        }
        if flow.max_output_tokens:
            settings_kwargs["max_tokens"] = flow.max_output_tokens
        return OpenAILLMService(
            api_key=api_key,
            organization=integration.organization or None,
            project=integration.project or None,
            settings=OpenAILLMService.Settings(**settings_kwargs),
        )
    if integration.kind in {"gemini", "gemini_cloud"}:
        from pipecat.services.google.llm import GoogleLLMService

        api_key = integration.api_key or os.getenv("GOOGLE_API_KEY", "")
        if not api_key:
            raise RuntimeError("Google Gemini is missing api_key")
        return GoogleLLMService(
            api_key=api_key,
            settings=GoogleLLMService.Settings(
                model=model or integration.default_model or DEFAULT_GEMINI_TEXT_MODEL,
                system_instruction=_effective_instructions(flow),
                max_tokens=flow.max_output_tokens or 4096,
            ),
        )
    if integration.kind == "aws_bedrock":
        from pipecat.services.aws.llm import AWSBedrockLLMService

        _require_integration(integration, "AWS Bedrock", fields=("access_key_id", "secret_key"))
        settings_kwargs: dict[str, Any] = {
            "model": model or integration.default_model,
            "system_instruction": _effective_instructions(flow),
        }
        if flow.max_output_tokens:
            settings_kwargs["max_tokens"] = flow.max_output_tokens
        return AWSBedrockLLMService(
            aws_access_key=integration.access_key_id,
            aws_secret_key=integration.secret_key,
            aws_session_token=integration.token or None,
            aws_region=integration.region or "us-east-1",
            settings=AWSBedrockLLMService.Settings(**settings_kwargs),
        )
    if integration.kind == "openai_compatible":
        from pipecat.services.openai.llm import OpenAILLMService

        settings_kwargs: dict[str, Any] = {
            "model": model or integration.default_model,
            "system_instruction": _effective_instructions(flow),
        }
        if flow.max_output_tokens:
            settings_kwargs["max_tokens"] = flow.max_output_tokens
        return OpenAILLMService(
            api_key=integration.api_key or "not-needed",
            base_url=integration.base_url or None,
            settings=OpenAILLMService.Settings(**settings_kwargs),
        )
    if integration.kind == "ollama":
        from pipecat.services.ollama.llm import OLLamaLLMService

        return OLLamaLLMService(
            base_url=integration.base_url or "http://localhost:11434/v1",
            settings=OLLamaLLMService.Settings(
                model=model or integration.default_model or "llama3.2",
                system_instruction=_effective_instructions(flow),
            ),
        )

    raise RuntimeError(f"LLM provider {integration.kind} is not supported by composed runtime")


def _build_tts_service(config: RuntimeConfig, flow: FlowConfig):
    step, integration = _step_integration(config, flow, "tts")
    integration = _require_integration(integration, "TTS", fields=())
    model = _step_model_for(step, integration, "tts")
    voice = _step_voice(step, integration)
    speed = _runtime_speed(flow, integration)
    text_aggregation_mode = _tts_text_aggregation_mode(integration)

    if integration.kind == "cartesia":
        from pipecat.services.cartesia.tts import CartesiaTTSService

        return CartesiaTTSService(
            api_key=_integration_api_key(integration, "TTS"),
            text_aggregation_mode=text_aggregation_mode,
            settings=CartesiaTTSService.Settings(
                model=model or DEFAULT_CARTESIA_MODEL,
                voice=voice or DEFAULT_CARTESIA_VOICE,
            ),
        )
    if integration.kind == "gradium":
        from pipecat.services.gradium.tts import GradiumTTSService

        return GradiumTTSService(
            api_key=_integration_api_key(integration, "TTS"),
            text_aggregation_mode=text_aggregation_mode,
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
                speaking_rate=speed,
            ),
        )
    if integration.kind == "google_streaming_tts":
        from pipecat.services.google.tts import GoogleTTSService

        if not integration.credentials_json and not integration.credentials_path:
            raise RuntimeError("Google Cloud TTS Streaming is missing service account credentials")
        return GoogleTTSService(
            credentials=integration.credentials_json or None,
            credentials_path=integration.credentials_path or None,
            location=integration.location or None,
            text_aggregation_mode=text_aggregation_mode,
            settings=GoogleTTSService.Settings(
                voice=voice or DEFAULT_GOOGLE_TTS_VOICE,
            ),
        )
    if integration.kind == "elevenlabs":
        from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

        return ElevenLabsTTSService(
            api_key=_integration_api_key(integration, "TTS"),
            text_aggregation_mode=text_aggregation_mode,
            settings=ElevenLabsTTSService.Settings(
                model=model or DEFAULT_ELEVENLABS_MODEL,
                voice=voice or DEFAULT_ELEVENLABS_VOICE,
                speed=speed,
            ),
        )
    if integration.kind in {"openai", "openai_cloud"}:
        from pipecat.services.openai.tts import OpenAITTSService

        return OpenAITTSService(
            api_key=_integration_api_key(integration, "TTS", config.openai_api_key),
            settings=OpenAITTSService.Settings(
                model=model or DEFAULT_OPENAI_TTS_MODEL,
                voice=voice or DEFAULT_OPENAI_TTS_VOICE,
                speed=speed,
            ),
        )
    if integration.kind == "soniox":
        from pipecat.services.soniox.tts import SonioxTTSService

        return SonioxTTSService(
            api_key=_integration_api_key(integration, "TTS"),
            text_aggregation_mode=text_aggregation_mode,
            settings=SonioxTTSService.Settings(voice=voice or None),
        )

    raise RuntimeError(f"TTS provider {integration.kind} is not supported by composed runtime")


def _flow_enabled(flow: FlowConfig) -> bool:
    return bool(flow.conversation_flow.get("enabled"))


def _flow_node_configs(flow: FlowConfig, bridge: CombinedMCPBridge | None):
    from pipecat_flows import FlowsFunctionSchema

    nodes = flow.conversation_flow.get("nodes") or []
    by_id: dict[str, dict[str, Any]] = {}

    def _messages_text(value: Any, fallback: str = "") -> str:
        if isinstance(value, str):
            return value or fallback
        if isinstance(value, list):
            parts = [
                str(item.get("content", ""))
                for item in value
                if isinstance(item, dict) and item.get("content")
            ]
            return "\n".join(parts) or fallback
        return fallback

    def node_config(node: dict[str, Any]) -> dict[str, Any]:
        node_id = str(node.get("id") or node.get("label") or "node")
        if node_id in by_id:
            return by_id[node_id]
        data = node.get("data") if isinstance(node.get("data"), dict) else node

        functions = []
        for fn in data.get("functions") or []:
            name = str(fn.get("name") or f"go_to_{fn.get('next_node_id', 'next')}")
            description = str(fn.get("description") or "Continue the conversation.")
            properties = fn.get("properties") if isinstance(fn.get("properties"), dict) else {}
            required = fn.get("required") if isinstance(fn.get("required"), list) else []
            decision = fn.get("decision") if isinstance(fn.get("decision"), dict) else {}
            next_node_id = str(
                fn.get("next_node_id")
                or decision.get("default_next_node_id")
                or ""
            )
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
            "role_message": _messages_text(data.get("role_messages"), str(data.get("role_message") or _effective_instructions(flow))),
            "task_messages": data.get("task_messages") if isinstance(data.get("task_messages"), list) else [
                {
                    "role": "developer",
                    "content": str(data.get("task") or "Continue the conversation."),
                }
            ],
            "functions": functions,
            "respond_immediately": bool(data.get("respond_immediately", True)),
        }
        if data.get("pre_actions"):
            config_node["pre_actions"] = data.get("pre_actions")
        if data.get("post_actions"):
            config_node["post_actions"] = data.get("post_actions")
        if data.get("context_strategy"):
            config_node["context_strategy"] = data.get("context_strategy")
        by_id[node_id] = config_node
        return config_node

    for node in nodes:
        node_config(node)

    initial_id = str(flow.conversation_flow.get("initial_node_id") or "")
    if not initial_id:
        initial_id = next(
            (
                str(node.get("id"))
                for node in nodes
                if node.get("type") == "initial"
                or (isinstance(node.get("data"), dict) and node["data"].get("role_messages"))
            ),
            "",
        )
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
    session_body = _runner_body(runner_args)
    is_esphome_satellite = session_body.get("transport") == "va-pipecat"
    client_id = _session_client_id(runner_args, flow)
    language_override = str(session_body.get("language") or "").strip() or None

    bridge: CombinedMCPBridge | None = None
    mcp_tools_schema = None
    mcp_servers = config.enabled_mcp_servers(mcp_token) if flow.mcp_enabled else []
    if mcp_servers:
        bridge = CombinedMCPBridge(mcp_servers, flow.mcp_tool_allowlist)
        try:
            await bridge.start()
            mcp_tools_schema = await bridge.tools_schema(
                cache_enabled=config.mcp_tools_cache_enabled,
                cache_ttl_seconds=config.mcp_tools_cache_ttl_seconds,
            )
            if not mcp_tools_schema.standard_tools:
                mcp_tools_schema = None
        except asyncio.CancelledError as err:
            with suppress(Exception):
                await bridge.close()
            bridge = None
            raise RuntimeError(f"MCP tools are enabled but startup was cancelled: {err}") from err
        except Exception as err:
            with suppress(Exception):
                await bridge.close()
            bridge = None
            raise RuntimeError(f"MCP tools are enabled but unavailable: {err}") from err

    local_tool_schemas = [schema for schema in [_web_search_tool_schema(config, flow)] if schema]
    tools_schema = _merge_tools_schema(mcp_tools_schema, local_tool_schemas)
    context_for_memory = None
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
                local_turn_detection=bool(_enabled_step(flow, "vad")),
                inference_on_context_initialization=not is_esphome_satellite,
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
        _register_local_tool_handlers(llm, local_tool_schemas)

        logger.info(
            "Starting {} speech-to-speech model {} for flow {}",
            provider_kind,
            realtime_model,
            flow.id,
        )

        if bridge and mcp_tools_schema:
            await bridge.register_tools_schema(mcp_tools_schema, llm)

        greeting_messages = (
            [{"role": "developer", "content": flow.greeting}]
            if flow.greeting.strip()
            else []
        )
        context_messages = SESSION_MEMORY.restore(
            client_id,
            greeting_messages,
            enabled=_memory_enabled(config, flow),
            reuse_seconds=config.session_memory_reuse_seconds,
            max_messages=config.session_memory_max_messages,
        )
        context = (
            LLMContext(context_messages, tools_schema)
            if tools_schema
            else LLMContext(context_messages)
        )
        context_for_memory = context
        user_params = None
        if provider_kind == "gemini" and _enabled_step(flow, "vad"):
            from pipecat.turns.user_stop import SpeechTimeoutUserTurnStopStrategy
            from pipecat.turns.user_turn_strategies import UserTurnStrategies

            user_params = LLMUserAggregatorParams(
                vad_analyzer=_composed_vad_analyzer(flow),
                user_turn_strategies=UserTurnStrategies(
                    stop=[SpeechTimeoutUserTurnStopStrategy(user_speech_timeout=0.2)]
                ),
            )
        user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
            context,
            user_params=user_params,
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
            rtvi_observer_params=_rtvi_observer_params(),
            idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
        )

        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            logger.info("Client connected to flow {}", flow.id)
            if _flow_enabled(flow):
                logger.warning("Pipecat Flows are ignored for speech-to-speech runtime {}", provider_kind)
            if is_esphome_satellite or flow.greeting.strip():
                await worker.queue_frames([LLMRunFrame()])

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            logger.info("Client disconnected from flow {}", flow.id)
            await worker.cancel()

    else:
        from pipecat.processors.audio.vad_processor import VADProcessor
        from pipecat.turns.user_stop import SpeechTimeoutUserTurnStopStrategy
        from pipecat.turns.user_turn_strategies import UserTurnStrategies

        stt = _build_stt_service(config, flow, language_override=language_override)
        llm = _build_llm_service(config, flow, tools_schema=tools_schema)
        _register_local_tool_handlers(llm, local_tool_schemas)
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
        context_messages = [{"role": "developer", "content": _effective_instructions(flow)}]
        if flow.greeting.strip():
            context_messages.append({"role": "developer", "content": flow.greeting})
        context_messages = SESSION_MEMORY.restore(
            client_id,
            context_messages,
            enabled=_memory_enabled(config, flow),
            reuse_seconds=config.session_memory_reuse_seconds,
            max_messages=config.session_memory_max_messages,
        )
        context = LLMContext(context_messages, active_tools_schema) if active_tools_schema else LLMContext(context_messages)
        context_for_memory = context
        vad_step = _enabled_step(flow, "vad")
        vad_processor = VADProcessor(vad_analyzer=_composed_vad_analyzer(flow)) if vad_step else None
        if vad_step:
            context_aggregator = LLMContextAggregatorPair(
                context,
                user_params=LLMUserAggregatorParams(
                    user_turn_strategies=UserTurnStrategies(
                        stop=[SpeechTimeoutUserTurnStopStrategy(user_speech_timeout=0.2)]
                    ),
                    user_turn_stop_timeout=2.0,
                ),
            )
        else:
            context_aggregator = LLMContextAggregatorPair(context)

        if bridge and mcp_tools_schema and not _flow_enabled(flow):
            await bridge.register_tools_schema(mcp_tools_schema, llm)

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
        if vad_processor:
            processors.append(vad_processor)
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
            rtvi_observer_params=_rtvi_observer_params(),
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
            elif flow.greeting.strip() and not is_esphome_satellite:
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
        if context_for_memory:
            SESSION_MEMORY.cache(
                client_id,
                context_for_memory,
                enabled=_memory_enabled(config, flow),
                max_messages=config.session_memory_max_messages,
            )
        if bridge:
            await bridge.close()
        if audio_debug:
            with suppress(Exception):
                audio_debug.close()


async def bot(runner_args: RunnerArguments):
    """Pipecat runner entry point."""

    config = STORE.load()
    body = _runner_body(runner_args)
    flow = config.selected_flow(body.get("flow_id"))
    flow_errors = _runtime_flow_errors(config, flow)
    if flow_errors:
        raise RuntimeError(flow_errors[0])
    transport = await create_transport(runner_args, _transport_params(config, flow))
    await run_bot(transport, runner_args, config, flow, mcp_token=config.effective_mcp_token)


def main() -> None:
    _configure_logging()
    parser = argparse.ArgumentParser(description="Pipecat Assist")
    runner_main(parser)


if __name__ == "__main__":
    main()
