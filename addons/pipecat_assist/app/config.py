"""Runtime configuration for the Pipecat Assist add-on."""

from __future__ import annotations

import json
import os
import secrets
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

DATA_DIR = Path(os.getenv("PIPECAT_ASSIST_DATA_DIR", "/data"))
CONFIG_PATH = DATA_DIR / "pipecat_assist.json"
REDACTED = "__redacted__"

DEFAULT_INSTRUCTIONS = (
    "You are a realtime Home Assistant voice agent. Speak naturally and briefly. "
    "Use Home Assistant MCP tools only when the user clearly asks to control, "
    "inspect, or automate the home. Never invent device state. If a room, "
    "device, or action is ambiguous, ask one short clarification."
)

DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.5-flash"
DEFAULT_GEMINI_LIVE_MODEL = "models/gemini-3.1-flash-live-preview"
DEFAULT_GEMINI_LIVE_VOICE = "Charon"
DEFAULT_OPENAI_TEXT_MODEL = "gpt-5.4-mini"
DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime-2"
DEFAULT_OPENAI_REALTIME_VOICE = "marin"
DEFAULT_OPENAI_TTS_MODEL = "gpt-4o-mini-tts"
DEFAULT_OPENAI_TTS_VOICE = "marin"
DEFAULT_CARTESIA_MODEL = "sonic-3.5"
DEFAULT_CARTESIA_VOICE = "f786b574-daa5-4673-aa0c-cbe3e8534c02"
DEFAULT_ELEVENLABS_MODEL = "eleven_flash_v2_5"
DEFAULT_ELEVENLABS_VOICE = "21m00Tcm4TlvDq8ikWAM"
DEFAULT_GOOGLE_TTS_VOICE = "en-US-Chirp3-HD-Charon"
DEFAULT_AWS_NOVA_SONIC_MODEL = "amazon.nova-2-sonic-v1:0"
DEFAULT_AWS_NOVA_SONIC_VOICE = "matthew"
DEFAULT_AWS_BEDROCK_MODEL = "amazon.nova-pro-v1:0"
DEFAULT_DEEPGRAM_MODEL = "nova-3"
DEFAULT_SONIOX_MODEL = "stt-rt-v5"
DEFAULT_SPEECHMATICS_MODEL = "enhanced"
OPENAI_REALTIME_VOICES = {
    "alloy",
    "ash",
    "ballad",
    "cedar",
    "coral",
    "echo",
    "marin",
    "sage",
    "shimmer",
    "verse",
}
DEFAULT_MCP_URL = "http://supervisor/core/api/mcp"
SECRET_FIELDS = (
    "api_key",
    "token",
    "credentials_json",
    "secret_key",
    "access_key_id",
)


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _is_http_url(value: str | None) -> bool:
    value = (value or "").strip().lower()
    return value.startswith("http://") or value.startswith("https://")


def _validate_id(value: str, label: str) -> str:
    clean = value.strip()
    if not clean:
        raise ValueError(f"{label} cannot be empty")
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
    if any(char not in allowed for char in clean):
        raise ValueError(f"{label} may only contain letters, numbers, _ and -")
    return clean


class IntegrationConfig(BaseModel):
    """One cloud, local model server, or Home Assistant integration."""

    id: str
    name: str
    kind: Literal[
        "openai",
        "gemini",
        "google_cloud_tts",
        "soniox",
        "deepgram",
        "cartesia",
        "gradium",
        "speechmatics",
        "elevenlabs",
        "anthropic",
        "aws_bedrock",
        "aws_nova_sonic",
        "azure_openai",
        "openai_compatible",
        "ollama",
        "local_runtime",
        "home_assistant_mcp",
    ]
    enabled: bool = False
    api_key: str = ""
    token: str = ""
    base_url: str = ""
    endpoint: str = ""
    region: str = ""
    deployment: str = ""
    default_model: str = ""
    default_realtime_model: str = ""
    default_voice: str = ""
    organization: str = ""
    project: str = ""
    location: str = ""
    credentials_json: str = ""
    credentials_path: str = ""
    access_key_id: str = ""
    secret_key: str = ""

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        return _validate_id(value, "Integration id")


class PipelineStepConfig(BaseModel):
    """One visible step in the pipeline editor."""

    id: str
    kind: Literal["transport", "vad", "stt", "llm", "tools", "flow", "tts", "output"]
    label: str
    enabled: bool = True
    integration_id: str = ""
    model: str = ""
    voice: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        return _validate_id(value, "Pipeline step id")


def default_integrations() -> list[IntegrationConfig]:
    """Return first-run integrations shown in the UI."""

    return [
        IntegrationConfig(
            id="gemini",
            name="Google Gemini",
            kind="gemini",
            enabled=bool(os.getenv("GOOGLE_API_KEY")),
            api_key=os.getenv("GOOGLE_API_KEY", ""),
            default_model=os.getenv("GEMINI_TEXT_MODEL", DEFAULT_GEMINI_TEXT_MODEL),
            default_realtime_model=os.getenv("GEMINI_LIVE_MODEL", DEFAULT_GEMINI_LIVE_MODEL),
            default_voice=os.getenv("GEMINI_LIVE_VOICE", DEFAULT_GEMINI_LIVE_VOICE),
        ),
        IntegrationConfig(
            id="openai",
            name="OpenAI",
            kind="openai",
            enabled=bool(os.getenv("OPENAI_API_KEY")),
            api_key=os.getenv("OPENAI_API_KEY", ""),
            default_model=os.getenv("TEXT_MODEL", DEFAULT_OPENAI_TEXT_MODEL),
            default_realtime_model=os.getenv("REALTIME_MODEL", DEFAULT_OPENAI_REALTIME_MODEL),
            default_voice=os.getenv("REALTIME_VOICE", DEFAULT_OPENAI_REALTIME_VOICE),
        ),
        IntegrationConfig(
            id="google-cloud-tts",
            name="Google Cloud TTS",
            kind="google_cloud_tts",
            enabled=bool(os.getenv("GOOGLE_APPLICATION_CREDENTIALS")),
            credentials_path=os.getenv("GOOGLE_APPLICATION_CREDENTIALS", ""),
            location=os.getenv("GOOGLE_CLOUD_TTS_LOCATION", ""),
            default_model="google-tts",
            default_voice=os.getenv("GOOGLE_TTS_VOICE", DEFAULT_GOOGLE_TTS_VOICE),
        ),
        IntegrationConfig(
            id="soniox",
            name="Soniox",
            kind="soniox",
            enabled=bool(os.getenv("SONIOX_API_KEY")),
            api_key=os.getenv("SONIOX_API_KEY", ""),
            default_model=os.getenv("SONIOX_STT_MODEL", DEFAULT_SONIOX_MODEL),
            default_voice=os.getenv("SONIOX_TTS_VOICE", ""),
        ),
        IntegrationConfig(
            id="deepgram",
            name="Deepgram",
            kind="deepgram",
            enabled=bool(os.getenv("DEEPGRAM_API_KEY")),
            api_key=os.getenv("DEEPGRAM_API_KEY", ""),
            default_model=os.getenv("DEEPGRAM_STT_MODEL", DEFAULT_DEEPGRAM_MODEL),
        ),
        IntegrationConfig(
            id="cartesia",
            name="Cartesia",
            kind="cartesia",
            enabled=bool(os.getenv("CARTESIA_API_KEY")),
            api_key=os.getenv("CARTESIA_API_KEY", ""),
            default_model=os.getenv("CARTESIA_TTS_MODEL", DEFAULT_CARTESIA_MODEL),
            default_voice=os.getenv("CARTESIA_TTS_VOICE", DEFAULT_CARTESIA_VOICE),
        ),
        IntegrationConfig(
            id="gradium",
            name="Gradium",
            kind="gradium",
            enabled=bool(os.getenv("GRADIUM_API_KEY")),
            api_key=os.getenv("GRADIUM_API_KEY", ""),
            default_model=os.getenv("GRADIUM_TTS_MODEL", ""),
            default_voice=os.getenv("GRADIUM_TTS_VOICE", ""),
        ),
        IntegrationConfig(
            id="speechmatics",
            name="Speechmatics",
            kind="speechmatics",
            enabled=bool(os.getenv("SPEECHMATICS_API_KEY")),
            api_key=os.getenv("SPEECHMATICS_API_KEY", ""),
            default_model=os.getenv("SPEECHMATICS_STT_MODEL", DEFAULT_SPEECHMATICS_MODEL),
        ),
        IntegrationConfig(
            id="elevenlabs",
            name="ElevenLabs",
            kind="elevenlabs",
            enabled=bool(os.getenv("ELEVENLABS_API_KEY")),
            api_key=os.getenv("ELEVENLABS_API_KEY", ""),
            default_model=os.getenv("ELEVENLABS_TTS_MODEL", DEFAULT_ELEVENLABS_MODEL),
            default_voice=os.getenv("ELEVENLABS_TTS_VOICE", DEFAULT_ELEVENLABS_VOICE),
        ),
        IntegrationConfig(
            id="anthropic",
            name="Anthropic",
            kind="anthropic",
            enabled=False,
            default_model="claude-sonnet-4-5",
        ),
        IntegrationConfig(
            id="bedrock",
            name="AWS Bedrock",
            kind="aws_bedrock",
            enabled=False,
            region="us-east-1",
            default_model=DEFAULT_AWS_BEDROCK_MODEL,
        ),
        IntegrationConfig(
            id="aws-nova-sonic",
            name="AWS Nova Sonic",
            kind="aws_nova_sonic",
            enabled=False,
            region="us-east-1",
            default_realtime_model=DEFAULT_AWS_NOVA_SONIC_MODEL,
            default_voice=DEFAULT_AWS_NOVA_SONIC_VOICE,
        ),
        IntegrationConfig(
            id="openai-compatible",
            name="OpenAI-compatible",
            kind="openai_compatible",
            enabled=False,
            base_url="http://localhost:8000/v1",
        ),
        IntegrationConfig(
            id="ollama",
            name="Ollama",
            kind="ollama",
            enabled=False,
            base_url="http://localhost:11434/v1",
            default_model="llama3.2",
        ),
        IntegrationConfig(
            id="local-runtime",
            name="Local runtime",
            kind="local_runtime",
            enabled=False,
        ),
        IntegrationConfig(
            id="ha-mcp",
            name="Home Assistant MCP",
            kind="home_assistant_mcp",
            enabled=True,
            base_url=os.getenv("HA_MCP_URL", ""),
            token=os.getenv("LONGLIVED_TOKEN", ""),
        ),
    ]


def default_steps() -> list[PipelineStepConfig]:
    """Return the default visible Pipecat pipeline."""

    return [
        PipelineStepConfig(id="transport", kind="transport", label="SmallWebRTC"),
        PipelineStepConfig(
            id="vad",
            kind="vad",
            label="Gemini VAD",
            settings={"mode": "semantic_vad", "eagerness": "low"},
        ),
        PipelineStepConfig(
            id="llm",
            kind="llm",
            label="Live model",
            integration_id="gemini",
            model=os.getenv("GEMINI_LIVE_MODEL", DEFAULT_GEMINI_LIVE_MODEL),
        ),
        PipelineStepConfig(
            id="tools",
            kind="tools",
            label="HA MCP tools",
            integration_id="ha-mcp",
        ),
        PipelineStepConfig(
            id="flow",
            kind="flow",
            label="Conversation flow",
            enabled=False,
        ),
        PipelineStepConfig(
            id="output",
            kind="output",
            label="Native audio",
            integration_id="gemini",
            voice=os.getenv("GEMINI_LIVE_VOICE", DEFAULT_GEMINI_LIVE_VOICE),
        ),
    ]


def default_conversation_flow() -> dict[str, Any]:
    """Return a transparent Pipecat Flows graph for composed realtime pipelines."""

    return {
        "enabled": False,
        "initial_node_id": "passthrough",
        "nodes": [
            {
                "id": "passthrough",
                "label": "Pass-through",
                "role_message": DEFAULT_INSTRUCTIONS,
                "task": "Continue the conversation normally without changing the pipeline behavior.",
                "functions": [],
                "respond_immediately": False,
            },
        ],
    }


def _looks_like_old_pizza_example(flow: dict[str, Any]) -> bool:
    """Return true for the previous built-in pizza example."""

    nodes = flow.get("nodes") or []
    node_ids = {str(node.get("id", "")) for node in nodes}
    if node_ids != {"home_router", "pizza_order", "done"}:
        return False
    functions = [
        str(fn.get("name", ""))
        for node in nodes
        for fn in node.get("functions", []) or []
    ]
    return "start_pizza_order" in functions and "place_pizza_order" in functions


class FlowConfig(BaseModel):
    """One realtime assistant pipeline."""

    id: str = "home-default"
    name: str = "Gemini Live Home Assistant"
    enabled: bool = True
    mode: Literal["realtime", "composed", "classic", "text"] = "realtime"
    pipeline_template: Literal[
        "realtime_home",
        "gemini_live_home",
        "aws_nova_sonic",
        "soniox_openai_cartesia",
        "soniox_openai_gradium",
        "deepgram_gemini_google_tts",
        "deepgram_google_google_tts",
        "speechmatics_aws_elevenlabs",
        "cloud_cascade",
        "local_first",
        "custom",
    ] = "gemini_live_home"
    provider_id: str = "gemini"
    model: str = DEFAULT_GEMINI_LIVE_MODEL
    text_model: str = DEFAULT_GEMINI_TEXT_MODEL
    voice: str = DEFAULT_GEMINI_LIVE_VOICE
    speed: float = Field(default=1.0, ge=0.25, le=1.5)
    language: str | None = None
    instructions: str = DEFAULT_INSTRUCTIONS
    greeting: str = "Greet the user briefly and wait for their request."
    transcription_model: str = "gpt-realtime-whisper"
    noise_reduction: Literal["off", "near_field", "far_field"] = "near_field"
    vad_mode: Literal["semantic_vad", "server_vad"] = "semantic_vad"
    vad_eagerness: Literal["low", "medium", "high", "auto"] = "low"
    interrupt_response: bool = False
    max_output_tokens: int | None = Field(default=None, ge=1, le=4096)
    reasoning_effort: Literal["minimal", "low", "medium", "high", "xhigh"] | None = None
    mcp_enabled: bool = True
    mcp_tool_allowlist: list[str] = Field(default_factory=list)
    video_enabled: bool = False
    steps: list[PipelineStepConfig] = Field(default_factory=default_steps)
    conversation_flow: dict[str, Any] = Field(default_factory=default_conversation_flow)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        return _validate_id(value, "Flow id")

    def model_step(self) -> PipelineStepConfig | None:
        """Return the primary LLM/realtime step."""

        return next((step for step in self.steps if step.kind == "llm" and step.enabled), None)


class RuntimeConfig(BaseModel):
    """Persisted runtime configuration edited by the web UI."""

    version: int = 9
    openai_api_key: str = ""
    text_model: str = DEFAULT_GEMINI_TEXT_MODEL
    ha_mcp_url: str = ""
    longlived_token: str = ""
    satellite_shared_secret: str = ""
    runner_host: str = ""
    runner_port: int = Field(default=7860, ge=1024, le=65535)
    esp32_mode: bool = False
    enable_default_ice_servers: bool = False
    audio_debug_enabled: bool = False
    audio_debug_keep_sessions: int = Field(default=10, ge=1, le=100)
    selected_flow_id: str = "home-default"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    integrations: list[IntegrationConfig] = Field(default_factory=default_integrations)
    flows: list[FlowConfig] = Field(default_factory=lambda: [FlowConfig()])

    @field_validator("flows")
    @classmethod
    def validate_flows(cls, value: list[FlowConfig]) -> list[FlowConfig]:
        if not value:
            raise ValueError("At least one flow is required")
        ids = [flow.id for flow in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Flow ids must be unique")
        return value

    @field_validator("integrations")
    @classmethod
    def validate_integrations(cls, value: list[IntegrationConfig]) -> list[IntegrationConfig]:
        if not value:
            raise ValueError("At least one integration is required")
        ids = [integration.id for integration in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Integration ids must be unique")
        return value

    def selected_flow(self, requested_flow_id: str | None = None) -> FlowConfig:
        """Return the requested flow, falling back to selected/default flow."""

        candidates = [requested_flow_id, self.selected_flow_id, self.flows[0].id]
        for candidate in candidates:
            if not candidate:
                continue
            for flow in self.flows:
                if flow.id == candidate:
                    return flow
        return self.flows[0]

    def integration(self, integration_id: str | None) -> IntegrationConfig | None:
        """Return an integration by id."""

        if not integration_id:
            return None
        return next((item for item in self.integrations if item.id == integration_id), None)

    def model_integration(self, flow: FlowConfig) -> IntegrationConfig | None:
        """Return the integration used by the primary model step."""

        step = flow.model_step()
        integration_id = step.integration_id if step and step.integration_id else flow.provider_id
        return self.integration(integration_id)

    @property
    def mcp_integration(self) -> IntegrationConfig | None:
        """Return the Home Assistant MCP integration."""

        return next(
            (item for item in self.integrations if item.kind == "home_assistant_mcp"),
            None,
        )

    @property
    def effective_mcp_url(self) -> str:
        """Return the MCP URL used by the add-on."""

        integration = self.mcp_integration
        for candidate in (
            integration.base_url if integration else "",
            self.ha_mcp_url,
            os.getenv("HA_MCP_URL"),
            DEFAULT_MCP_URL,
        ):
            if _is_http_url(candidate):
                return candidate.strip()
        return DEFAULT_MCP_URL

    @property
    def effective_mcp_token(self) -> str:
        """Return the Home Assistant token used for MCP."""

        integration = self.mcp_integration
        return (
            (integration.token if integration else "")
            or self.longlived_token
            or os.getenv("LONGLIVED_TOKEN")
            or os.getenv("SUPERVISOR_TOKEN", "")
        )

    @property
    def effective_mcp_token_source(self) -> str:
        """Return where the effective MCP token came from."""

        integration = self.mcp_integration
        if integration and integration.token:
            return "integration"
        if self.longlived_token or os.getenv("LONGLIVED_TOKEN"):
            return "long-lived"
        if os.getenv("SUPERVISOR_TOKEN"):
            return "supervisor"
        return ""

    def public_dict(self) -> dict[str, Any]:
        """Return configuration safe enough for the UI."""

        data = self.model_dump()
        for key in ("openai_api_key", "longlived_token", "satellite_shared_secret"):
            configured = bool(data.get(key))
            data[f"{key}_configured"] = configured
            data[key] = REDACTED if configured else ""

        for integration in data["integrations"]:
            for key in SECRET_FIELDS:
                configured = bool(integration.get(key))
                integration[f"{key}_configured"] = configured
                integration[key] = REDACTED if configured else ""

        data["effective_mcp_url"] = self.effective_mcp_url
        data["mcp_token_source"] = self.effective_mcp_token_source
        return data


def default_config_from_environment() -> RuntimeConfig:
    """Create the first-run configuration from add-on options or environment."""

    instructions = os.getenv("INSTRUCTIONS") or DEFAULT_INSTRUCTIONS
    tool_allowlist = _split_csv(os.getenv("MCP_TOOL_ALLOWLIST"))
    flow = FlowConfig(
        model=os.getenv("GEMINI_LIVE_MODEL", DEFAULT_GEMINI_LIVE_MODEL),
        text_model=os.getenv("GEMINI_TEXT_MODEL", DEFAULT_GEMINI_TEXT_MODEL),
        voice=os.getenv("GEMINI_LIVE_VOICE", DEFAULT_GEMINI_LIVE_VOICE),
        instructions=instructions,
        mcp_tool_allowlist=tool_allowlist,
    )
    return RuntimeConfig(
        openai_api_key=os.getenv("OPENAI_API_KEY", ""),
        text_model=os.getenv("GEMINI_TEXT_MODEL", DEFAULT_GEMINI_TEXT_MODEL),
        ha_mcp_url=os.getenv("HA_MCP_URL", ""),
        longlived_token=os.getenv("LONGLIVED_TOKEN", ""),
        satellite_shared_secret=os.getenv("SATELLITE_SHARED_SECRET", ""),
        runner_host=os.getenv("RUNNER_HOST", ""),
        runner_port=_env_int("RUNNER_PORT", 7860),
        esp32_mode=_env_bool("ESP32_MODE", False),
        audio_debug_enabled=_env_bool("AUDIO_DEBUG_ENABLED", False),
        audio_debug_keep_sessions=min(100, max(1, _env_int("AUDIO_DEBUG_KEEP_SESSIONS", 10))),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        flows=[flow],
    )


def _looks_like_legacy_openai_default(flow: FlowConfig) -> bool:
    """Return true for the untouched pre-0.1.4 OpenAI first-run flow."""

    model_step = flow.model_step()
    return (
        flow.id == "home-default"
        and flow.pipeline_template == "realtime_home"
        and flow.provider_id == "openai"
        and flow.model in {"", "gpt-realtime-2"}
        and flow.text_model in {"", "gpt-5.4-mini"}
        and flow.voice in {"", "marin"}
        and model_step is not None
        and model_step.integration_id == "openai"
    )


def _gemini_flow_from_existing(flow: FlowConfig) -> FlowConfig:
    """Preserve user text fields while migrating the default flow to Gemini Live."""

    return FlowConfig(
        id=flow.id,
        name="Gemini Live Home Assistant",
        instructions=flow.instructions,
        greeting=flow.greeting,
        language=flow.language,
        mcp_enabled=flow.mcp_enabled,
        mcp_tool_allowlist=flow.mcp_tool_allowlist,
        video_enabled=flow.video_enabled,
        interrupt_response=flow.interrupt_response,
        max_output_tokens=flow.max_output_tokens,
        reasoning_effort=flow.reasoning_effort,
    )


def _is_realtime_model_for_provider(provider_kind: str, model: str) -> bool:
    """Return whether a realtime model value belongs to the selected provider."""

    model = (model or "").strip()
    if not model:
        return False
    if provider_kind == "gemini":
        return "gemini" in model
    if provider_kind == "openai":
        return "realtime" in model and not model.startswith("models/")
    return True


def _is_voice_for_provider(provider_kind: str, voice: str) -> bool:
    """Return whether a realtime voice value belongs to the selected provider."""

    voice = (voice or "").strip()
    if not voice:
        return False
    if provider_kind == "gemini":
        return voice not in OPENAI_REALTIME_VOICES
    if provider_kind == "openai":
        return voice in OPENAI_REALTIME_VOICES
    return True


def _flow_output_step(flow: FlowConfig) -> PipelineStepConfig | None:
    return next(
        (step for step in flow.steps if step.kind in {"output", "tts"} and step.enabled),
        None,
    )


def _repair_flow_provider_model(config: RuntimeConfig, flow: FlowConfig) -> bool:
    """Clear stale cross-provider realtime settings left by older UI template switches."""

    if flow.mode in {"composed", "classic"}:
        return False

    model_step = flow.model_step()
    integration_id = (
        model_step.integration_id if model_step and model_step.integration_id else flow.provider_id
    )
    integration = config.integration(integration_id)
    if not integration or integration.kind not in {"gemini", "openai"}:
        return False

    changed = False
    default_model = (
        integration.default_realtime_model
        or (DEFAULT_GEMINI_LIVE_MODEL if integration.kind == "gemini" else DEFAULT_OPENAI_REALTIME_MODEL)
    )
    default_voice = (
        integration.default_voice
        or (DEFAULT_GEMINI_LIVE_VOICE if integration.kind == "gemini" else DEFAULT_OPENAI_REALTIME_VOICE)
    )
    output_step = _flow_output_step(flow)

    if model_step and model_step.model and not _is_realtime_model_for_provider(
        integration.kind,
        model_step.model,
    ):
        model_step.model = ""
        changed = True

    if not _is_realtime_model_for_provider(integration.kind, flow.model):
        flow.model = default_model
        changed = True

    if output_step and output_step.voice and not _is_voice_for_provider(
        integration.kind,
        output_step.voice,
    ):
        output_step.voice = ""
        changed = True

    if not _is_voice_for_provider(integration.kind, flow.voice):
        flow.voice = default_voice
        changed = True

    return changed


def _repair_mcp_url_overrides(config: RuntimeConfig) -> bool:
    """Clear custom MCP URLs that httpx cannot use."""

    changed = False
    if config.ha_mcp_url and not _is_http_url(config.ha_mcp_url):
        config.ha_mcp_url = ""
        changed = True

    mcp = config.mcp_integration
    if mcp and mcp.base_url and not _is_http_url(mcp.base_url):
        mcp.base_url = ""
        changed = True

    return changed


def _repair_provider_defaults(config: RuntimeConfig) -> bool:
    """Repair provider defaults that can be pasted across integrations."""

    changed = False

    gemini = config.integration("gemini")
    if gemini:
        if not gemini.default_model:
            gemini.default_model = os.getenv("GEMINI_TEXT_MODEL", DEFAULT_GEMINI_TEXT_MODEL)
            changed = True
        if gemini.default_realtime_model in {"", "gemini-2.5-flash-live"}:
            gemini.default_realtime_model = os.getenv(
                "GEMINI_LIVE_MODEL",
                DEFAULT_GEMINI_LIVE_MODEL,
            )
            changed = True
        if not _is_voice_for_provider("gemini", gemini.default_voice):
            gemini.default_voice = os.getenv("GEMINI_LIVE_VOICE", DEFAULT_GEMINI_LIVE_VOICE)
            changed = True

    openai = config.integration("openai")
    if openai:
        if not openai.default_model:
            openai.default_model = os.getenv("TEXT_MODEL", DEFAULT_OPENAI_TEXT_MODEL)
            changed = True
        if not _is_realtime_model_for_provider("openai", openai.default_realtime_model):
            openai.default_realtime_model = os.getenv(
                "REALTIME_MODEL",
                DEFAULT_OPENAI_REALTIME_MODEL,
            )
            changed = True
        if not _is_voice_for_provider("openai", openai.default_voice):
            openai.default_voice = os.getenv("REALTIME_VOICE", DEFAULT_OPENAI_REALTIME_VOICE)
            changed = True

    google_tts = config.integration("google-cloud-tts")
    if google_tts:
        if not google_tts.default_voice:
            google_tts.default_voice = os.getenv("GOOGLE_TTS_VOICE", DEFAULT_GOOGLE_TTS_VOICE)
            changed = True
        if not google_tts.credentials_path and os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
            google_tts.credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
            google_tts.enabled = True
            changed = True

    provider_defaults = {
        "soniox": ("SONIOX_API_KEY", DEFAULT_SONIOX_MODEL, ""),
        "deepgram": ("DEEPGRAM_API_KEY", DEFAULT_DEEPGRAM_MODEL, ""),
        "cartesia": ("CARTESIA_API_KEY", DEFAULT_CARTESIA_MODEL, DEFAULT_CARTESIA_VOICE),
        "gradium": ("GRADIUM_API_KEY", "", ""),
        "speechmatics": ("SPEECHMATICS_API_KEY", DEFAULT_SPEECHMATICS_MODEL, ""),
        "elevenlabs": ("ELEVENLABS_API_KEY", DEFAULT_ELEVENLABS_MODEL, DEFAULT_ELEVENLABS_VOICE),
    }
    for integration_id, (env_key, default_model, default_voice) in provider_defaults.items():
        integration = config.integration(integration_id)
        if not integration:
            continue
        if os.getenv(env_key) and not integration.api_key:
            integration.api_key = os.getenv(env_key, "")
            integration.enabled = True
            changed = True
        if default_model and not integration.default_model:
            integration.default_model = default_model
            changed = True
        if default_voice and not integration.default_voice:
            integration.default_voice = default_voice
            changed = True

    bedrock = config.integration("bedrock")
    if bedrock and not bedrock.default_model:
        bedrock.default_model = DEFAULT_AWS_BEDROCK_MODEL
        changed = True

    nova_sonic = config.integration("aws-nova-sonic")
    if nova_sonic:
        if not nova_sonic.default_realtime_model:
            nova_sonic.default_realtime_model = DEFAULT_AWS_NOVA_SONIC_MODEL
            changed = True
        if not nova_sonic.default_voice:
            nova_sonic.default_voice = DEFAULT_AWS_NOVA_SONIC_VOICE
            changed = True

    return changed


class ConfigStore:
    """Read and write runtime configuration."""

    def __init__(self, path: Path = CONFIG_PATH):
        self.path = path

    def load(self) -> RuntimeConfig:
        """Load persisted config, creating it when absent."""

        default = default_config_from_environment()
        if not self.path.exists():
            if not default.satellite_shared_secret:
                default.satellite_shared_secret = secrets.token_urlsafe(24)
            self.save(default)
            return default

        with self.path.open("r", encoding="utf-8") as file:
            raw = json.load(file)
        data = default.model_dump()
        data.update(raw)
        config = RuntimeConfig.model_validate(data)

        changed = False
        integration_ids = {item.id for item in config.integrations}
        for integration in default.integrations:
            if integration.id not in integration_ids:
                config.integrations.append(integration)
                integration_ids.add(integration.id)
                changed = True

        for key in ("runner_port", "esp32_mode", "log_level"):
            default_value = getattr(default, key)
            if getattr(config, key) != default_value:
                setattr(config, key, default_value)
                changed = True

        openai = config.integration("openai")
        if config.openai_api_key and openai and not openai.api_key:
            openai.api_key = config.openai_api_key
            openai.enabled = True
            changed = True

        gemini = config.integration("gemini")
        if gemini:
            google_api_key = os.getenv("GOOGLE_API_KEY", "")
            if google_api_key and not gemini.api_key:
                gemini.api_key = google_api_key
                gemini.enabled = True
                changed = True
        changed = _repair_provider_defaults(config) or changed

        mcp = config.mcp_integration
        if config.ha_mcp_url and mcp and not mcp.base_url:
            mcp.base_url = config.ha_mcp_url
            changed = True
        if config.longlived_token and mcp and not mcp.token:
            mcp.token = config.longlived_token
            changed = True

        if not config.satellite_shared_secret:
            config.satellite_shared_secret = (
                default.satellite_shared_secret or secrets.token_urlsafe(24)
            )
            changed = True

        if config.version < 3:
            if config.flows and _looks_like_legacy_openai_default(config.flows[0]):
                config.flows[0] = _gemini_flow_from_existing(config.flows[0])
                config.selected_flow_id = config.flows[0].id
            changed = True

        if config.version < 4:
            config.version = 4
            changed = True

        if config.version < 5:
            config.version = 5
            for flow in config.flows:
                changed = _repair_flow_provider_model(config, flow) or changed
            changed = True

        if config.version < 6:
            config.version = 6
            for flow in config.flows:
                changed = _repair_flow_provider_model(config, flow) or changed
            changed = _repair_mcp_url_overrides(config) or changed
            changed = True

        if config.version < 7:
            config.version = 7
            changed = True

        if config.version < 8:
            config.version = 8
            for flow in config.flows:
                if "enabled" not in flow.conversation_flow:
                    flow.conversation_flow = default_conversation_flow()
                if not any(step.kind == "flow" for step in flow.steps):
                    output_index = next(
                        (
                            index
                            for index, step in enumerate(flow.steps)
                            if step.kind in {"tts", "output"}
                        ),
                        len(flow.steps),
                    )
                    flow.steps.insert(
                        output_index,
                        PipelineStepConfig(
                            id="flow",
                            kind="flow",
                            label="Conversation flow",
                            enabled=False,
                        ),
                    )
            changed = True

        if config.version < 9:
            config.version = 9
            for flow in config.flows:
                if _looks_like_old_pizza_example(flow.conversation_flow):
                    flow.conversation_flow = default_conversation_flow()
                    changed = True
            changed = True

        for flow in config.flows:
            changed = _repair_flow_provider_model(config, flow) or changed
        changed = _repair_mcp_url_overrides(config) or changed

        if changed:
            self.save(config)
        return config

    def save(self, config: RuntimeConfig) -> None:
        """Persist config atomically enough for a single add-on process."""

        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.path.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as file:
            json.dump(config.model_dump(), file, indent=2, sort_keys=True)
            file.write("\n")
        tmp_path.replace(self.path)

    def reset_mcp_defaults(self) -> RuntimeConfig:
        """Reset Home Assistant MCP settings to the Supervisor-backed defaults."""

        config = self.load()
        config.ha_mcp_url = ""
        config.longlived_token = ""

        integration = config.mcp_integration
        if not integration:
            integration = IntegrationConfig(
                id="ha-mcp",
                name="Home Assistant MCP",
                kind="home_assistant_mcp",
                enabled=True,
            )
            config.integrations.append(integration)

        integration.enabled = True
        integration.base_url = ""
        integration.token = ""

        self.save(config)
        return config

    def reset_integration_defaults(self, integration_id: str) -> RuntimeConfig:
        """Reset one integration to the add-on defaults."""

        config = self.load()
        current = config.integration(integration_id)
        if not current:
            raise KeyError(integration_id)

        defaults = default_config_from_environment().integrations
        replacement = next(
            (
                item
                for item in defaults
                if item.id == current.id or item.kind == current.kind
            ),
            None,
        )
        if replacement:
            next_item = replacement.model_copy(deep=True)
            next_item.id = current.id
            next_item.name = current.name
        else:
            next_item = IntegrationConfig(
                id=current.id,
                name=current.name,
                kind=current.kind,
            )

        config.integrations = [
            next_item if item.id == integration_id else item for item in config.integrations
        ]
        self.save(config)
        return config

    def update_from_public(self, payload: dict[str, Any]) -> RuntimeConfig:
        """Apply a UI update while preserving redacted secrets."""

        current = self.load()
        data = current.model_dump()
        data.update(payload)
        for key in ("openai_api_key", "longlived_token", "satellite_shared_secret"):
            incoming = payload.get(key)
            if incoming in (None, "", REDACTED):
                data[key] = getattr(current, key)

        current_integrations = {item.id: item for item in current.integrations}
        for item in data.get("integrations", []):
            current_item = current_integrations.get(item.get("id"))
            if not current_item:
                continue
            for key in SECRET_FIELDS:
                if item.get(key) in (None, "", REDACTED):
                    item[key] = getattr(current_item, key)

        config = RuntimeConfig.model_validate(data)
        _repair_provider_defaults(config)
        for flow in config.flows:
            _repair_flow_provider_model(config, flow)
        _repair_mcp_url_overrides(config)
        self.save(config)
        return config
