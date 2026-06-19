import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  ChevronLeft,
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  Download,
  GitBranch,
  Home,
  Mic2,
  Moon,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Settings,
  SlidersHorizontal,
  Sun,
  Trash2,
  Volume2,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import "./styles.css";

function documentBaseUrl() {
  const script = [...document.scripts].find((item) => {
    if (!item.src) return false;
    try {
      return new URL(item.src).pathname.endsWith("/index.js");
    } catch {
      return false;
    }
  });
  return script ? new URL("./", script.src).href : new URL("./", window.location.href).href;
}

function appUrl(path) {
  return new URL(path, documentBaseUrl()).href;
}

const API = {
  config: appUrl("api/assist/config"),
  status: appUrl("api/assist/status"),
  mcp: appUrl("api/assist/mcp/check"),
  mcpReset: appUrl("api/assist/mcp/reset"),
  audioDebug: appUrl("api/assist/debug/audio"),
  integrationReset: (integrationId) =>
    appUrl(`api/assist/integrations/${encodeURIComponent(integrationId)}/reset`),
  models: (integrationId, capability = "llm") =>
    appUrl(`api/assist/integrations/${encodeURIComponent(integrationId)}/models?capability=${encodeURIComponent(capability)}`),
};

const REDACTED = "__redacted__";
const GEMINI_TEXT_MODEL = "gemini-3.5-flash";
const GEMINI_LIVE_MODEL = "models/gemini-3.1-flash-live-preview";
const GEMINI_LIVE_VOICE = "Charon";
const OPENAI_TEXT_MODEL = "gpt-5.4-mini";
const OPENAI_REALTIME_MODEL = "gpt-realtime-2";
const OPENAI_REALTIME_VOICE = "marin";
const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const OPENAI_TTS_VOICE = "marin";
const CARTESIA_MODEL = "sonic-3.5";
const CARTESIA_VOICE = "f786b574-daa5-4673-aa0c-cbe3e8534c02";
const ELEVENLABS_MODEL = "eleven_flash_v2_5";
const ELEVENLABS_VOICE = "21m00Tcm4TlvDq8ikWAM";
const GOOGLE_TTS_VOICE = "en-US-Chirp3-HD-Charon";
const AWS_NOVA_SONIC_MODEL = "amazon.nova-2-sonic-v1:0";
const AWS_NOVA_SONIC_VOICE = "matthew";
const AWS_BEDROCK_MODEL = "amazon.nova-pro-v1:0";
const DEEPGRAM_MODEL = "nova-3";
const SONIOX_MODEL = "stt-rt-v5";
const SPEECHMATICS_MODEL = "enhanced";
const OPENAI_REALTIME_VOICES = [
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
];

const providerKinds = [
  ["openai", "OpenAI", Cloud],
  ["gemini", "Gemini", Cloud],
  ["google_cloud_tts", "Google Cloud TTS", Cloud],
  ["soniox", "Soniox", Cloud],
  ["deepgram", "Deepgram", Cloud],
  ["cartesia", "Cartesia", Cloud],
  ["gradium", "Gradium", Cloud],
  ["speechmatics", "Speechmatics", Cloud],
  ["elevenlabs", "ElevenLabs", Cloud],
  ["anthropic", "Anthropic", Cloud],
  ["aws_bedrock", "Bedrock", Cloud],
  ["aws_nova_sonic", "AWS Nova Sonic", Radio],
  ["azure_openai", "Azure OpenAI", Cloud],
  ["openai_compatible", "OpenAI-compatible", Server],
  ["ollama", "Ollama", Cpu],
  ["local_runtime", "Local runtime", Cpu],
  ["home_assistant_mcp", "Home Assistant MCP", Home],
];

const protectedIntegrationIds = ["gemini", "openai", "ha-mcp"];

const stepTypes = [
  ["transport", "Transport", Radio, "neutral"],
  ["vad", "Turn", Mic2, "amber"],
  ["stt", "STT", Mic2, "blue"],
  ["llm", "Model", Bot, "violet"],
  ["tools", "Tools", Wrench, "green"],
  ["flow", "Pipecat Flow", Workflow, "rose"],
  ["tts", "TTS", Volume2, "mint"],
  ["output", "Output", Volume2, "neutral"],
];

const addableStepTypes = stepTypes.filter(([kind]) => !["transport", "output"].includes(kind));

const stepProviders = {
  stt: ["soniox", "deepgram", "speechmatics", "gradium", "openai"],
  llm: ["openai", "gemini", "aws_bedrock", "openai_compatible", "ollama"],
  tts: ["cartesia", "gradium", "google_cloud_tts", "elevenlabs", "openai", "soniox"],
  tools: ["home_assistant_mcp"],
  output: ["gemini", "openai", "aws_nova_sonic"],
};

const templates = [
  {
    id: "gemini_live_home",
    label: "Gemini Live",
    icon: Cloud,
    group: "Speech-to-speech",
    mode: "realtime",
    provider: "gemini",
    accent: "blue",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["vad", "vad", "Gemini VAD", ""],
      ["llm", "llm", "Live model", "gemini"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["output", "output", "Native audio", "gemini"],
    ],
  },
  {
    id: "realtime_home",
    label: "OpenAI Realtime",
    icon: Radio,
    group: "Speech-to-speech",
    mode: "realtime",
    provider: "openai",
    accent: "green",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["vad", "vad", "Semantic VAD", ""],
      ["llm", "llm", "Realtime model", "openai"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["output", "output", "Audio output", "openai"],
    ],
  },
  {
    id: "aws_nova_sonic",
    label: "AWS Nova Sonic",
    icon: Radio,
    group: "Speech-to-speech",
    mode: "realtime",
    provider: "aws-nova-sonic",
    accent: "amber",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["vad", "vad", "Nova Sonic VAD", ""],
      ["llm", "llm", "Nova Sonic", "aws-nova-sonic"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["output", "output", "Native audio", "aws-nova-sonic"],
    ],
  },
  {
    id: "soniox_openai_cartesia",
    label: "Soniox + OpenAI + Cartesia",
    icon: Workflow,
    group: "Composed realtime",
    mode: "composed",
    provider: "openai",
    accent: "mint",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["stt", "stt", "Soniox STT", "soniox"],
      ["llm", "llm", "OpenAI LLM", "openai"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["tts", "tts", "Cartesia TTS", "cartesia"],
      ["output", "output", "Audio output", ""],
    ],
  },
  {
    id: "soniox_openai_gradium",
    label: "Soniox + OpenAI + Gradium",
    icon: Workflow,
    group: "Composed realtime",
    mode: "composed",
    provider: "openai",
    accent: "mint",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["stt", "stt", "Soniox STT", "soniox"],
      ["llm", "llm", "OpenAI LLM", "openai"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["tts", "tts", "Gradium TTS", "gradium"],
      ["output", "output", "Audio output", ""],
    ],
  },
  {
    id: "deepgram_gemini_google_tts",
    label: "Deepgram + Gemini + Google TTS",
    icon: Workflow,
    group: "Composed realtime",
    mode: "composed",
    provider: "gemini",
    accent: "blue",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["stt", "stt", "Deepgram STT", "deepgram"],
      ["llm", "llm", "Gemini LLM", "gemini"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["tts", "tts", "Google TTS Chirp 3", "google-cloud-tts"],
      ["output", "output", "Audio output", ""],
    ],
  },
  {
    id: "deepgram_google_google_tts",
    label: "Deepgram + Google + Google TTS",
    icon: Workflow,
    group: "Composed realtime",
    mode: "composed",
    provider: "gemini",
    accent: "blue",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["stt", "stt", "Deepgram STT", "deepgram"],
      ["llm", "llm", "Google LLM", "gemini"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["tts", "tts", "Google TTS Chirp 3", "google-cloud-tts"],
      ["output", "output", "Audio output", ""],
    ],
  },
  {
    id: "speechmatics_aws_elevenlabs",
    label: "Speechmatics + AWS + ElevenLabs",
    icon: Workflow,
    group: "Composed realtime",
    mode: "composed",
    provider: "bedrock",
    accent: "rose",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["stt", "stt", "Speechmatics STT", "speechmatics"],
      ["llm", "llm", "AWS Nova Pro", "bedrock"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["tts", "tts", "ElevenLabs TTS", "elevenlabs"],
      ["output", "output", "Audio output", ""],
    ],
  },
  {
    id: "cloud_cascade",
    label: "Cloud Custom",
    icon: Cloud,
    group: "Custom",
    mode: "composed",
    provider: "gemini",
    accent: "blue",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["stt", "stt", "Cloud STT", "gemini"],
      ["llm", "llm", "Cloud LLM", "gemini"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["tts", "tts", "Cloud TTS", "gemini"],
      ["output", "output", "Audio output", ""],
    ],
  },
  {
    id: "local_first",
    label: "Local First",
    icon: Cpu,
    group: "Local",
    mode: "composed",
    provider: "ollama",
    accent: "amber",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["vad", "vad", "Local VAD", "local-runtime"],
      ["stt", "stt", "Local STT", "local-runtime"],
      ["llm", "llm", "Local LLM", "ollama"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["tts", "tts", "Local TTS", "local-runtime"],
      ["output", "output", "Audio output", ""],
    ],
  },
  {
    id: "custom",
    label: "Custom",
    icon: GitBranch,
    group: "Custom",
    mode: "composed",
    provider: "openai-compatible",
    accent: "red",
    steps: [],
  },
];

const defaultFlow = {
  id: "home-default",
  name: "Gemini Live Home Assistant",
  enabled: true,
  mode: "realtime",
  pipeline_template: "gemini_live_home",
  provider_id: "gemini",
  model: GEMINI_LIVE_MODEL,
  text_model: GEMINI_TEXT_MODEL,
  voice: GEMINI_LIVE_VOICE,
  speed: 1,
  language: "",
  instructions:
    "You are a realtime Home Assistant voice agent. Speak naturally and briefly. Use Home Assistant MCP tools only when the user clearly asks to control, inspect, or automate the home. Never invent device state. If a room, device, or action is ambiguous, ask one short clarification.",
  greeting: "Greet the user briefly and wait for their request.",
  transcription_model: "gpt-realtime-whisper",
  noise_reduction: "near_field",
  vad_mode: "semantic_vad",
  vad_eagerness: "low",
  interrupt_response: false,
  max_output_tokens: "",
  reasoning_effort: "",
  mcp_enabled: true,
  mcp_tool_allowlist: [],
  video_enabled: false,
  steps: [],
  conversation_flow: {
    enabled: false,
    initial_node_id: "passthrough",
    nodes: [
      {
        id: "passthrough",
        label: "Pass-through",
        role_message:
          "You are a realtime Home Assistant voice agent. Speak naturally and briefly. Use Home Assistant MCP tools only when the user clearly asks to control, inspect, or automate the home.",
        task: "Continue the conversation normally without changing the pipeline behavior.",
        functions: [],
        respond_immediately: false,
      },
    ],
  },
};

const pizzaConversationFlow = {
  enabled: true,
  initial_node_id: "home_router",
  nodes: [
    {
      id: "home_router",
      label: "Home router",
      role_message:
        "You are a realtime Home Assistant voice agent. Speak naturally and briefly. Use Home Assistant MCP tools only when the user clearly asks to control, inspect, or automate the home.",
      task: "Handle normal smart-home requests. If the user wants to order pizza, call start_pizza_order.",
      functions: [
        {
          name: "start_pizza_order",
          description: "Start a guided pizza ordering conversation.",
          properties: {},
          required: [],
          next_node_id: "pizza_order",
        },
      ],
    },
    {
      id: "pizza_order",
      label: "Pizza order",
      role_message: "Collect pizza order details, confirm them, then call the configured Home Assistant MCP tool.",
      task: "Collect size, toppings, delivery details, and confirmation.",
      functions: [
        {
          name: "place_pizza_order",
          description: "Place the pizza order through Home Assistant MCP after confirmation.",
          properties: {
            size: { type: "string", description: "Pizza size" },
            toppings: { type: "array", items: { type: "string" }, description: "Requested toppings" },
            address: { type: "string", description: "Delivery address" },
            notes: { type: "string", description: "Optional notes" },
          },
          required: ["size", "toppings"],
          mcp_tool: "",
          next_node_id: "done",
        },
      ],
    },
    {
      id: "done",
      label: "Done",
      role_message: "Speak briefly and naturally.",
      task: "Confirm the result and end the conversation.",
      post_actions: [{ type: "end_conversation" }],
    },
  ],
};

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeStep(kind, label, integrationId = "", suffix = "") {
  return {
    id: `${kind}-${suffix || crypto.randomUUID().slice(0, 8)}`,
    kind,
    label,
    enabled: kind !== "flow",
    integration_id: integrationId,
    model: "",
    voice: "",
    settings: {},
  };
}

function providerDefaults(provider) {
  if (provider === "gemini") {
    return {
      model: GEMINI_LIVE_MODEL,
      text_model: GEMINI_TEXT_MODEL,
      voice: GEMINI_LIVE_VOICE,
    };
  }
  if (provider === "openai") {
    return {
      model: OPENAI_REALTIME_MODEL,
      text_model: OPENAI_TEXT_MODEL,
      voice: OPENAI_REALTIME_VOICE,
    };
  }
  if (provider === "aws-nova-sonic" || provider === "aws_nova_sonic") {
    return { model: AWS_NOVA_SONIC_MODEL, text_model: AWS_BEDROCK_MODEL, voice: AWS_NOVA_SONIC_VOICE };
  }
  if (provider === "bedrock" || provider === "aws_bedrock") {
    return { model: AWS_BEDROCK_MODEL, text_model: AWS_BEDROCK_MODEL, voice: "" };
  }
  if (provider === "soniox") return { model: SONIOX_MODEL, text_model: "", voice: "" };
  if (provider === "deepgram") return { model: DEEPGRAM_MODEL, text_model: "", voice: "" };
  if (provider === "cartesia") return { model: CARTESIA_MODEL, text_model: "", voice: CARTESIA_VOICE };
  if (provider === "elevenlabs") return { model: ELEVENLABS_MODEL, text_model: "", voice: ELEVENLABS_VOICE };
  if (provider === "google-cloud-tts" || provider === "google_cloud_tts") {
    return { model: "google-tts", text_model: "", voice: GOOGLE_TTS_VOICE };
  }
  if (provider === "speechmatics") return { model: SPEECHMATICS_MODEL, text_model: "", voice: "" };
  if (provider === "openai_compatible" || provider === "openai-compatible") return { model: "", text_model: "", voice: "" };
  return {};
}

function integrationDefaults(config, integrationId) {
  const integration = config?.integrations?.find(
    (item) => item.id === integrationId || item.kind === integrationId,
  );
  const fallback = providerDefaults(integrationId);
  return {
    model: integration?.default_realtime_model || integration?.default_model || fallback.model || "",
    text_model: integration?.default_model || fallback.text_model || "",
    voice: integration?.default_voice || fallback.voice || "",
    kind: integration?.kind || integrationId || "",
  };
}

function providerKindForIntegration(config, integrationId) {
  const integration = config?.integrations?.find(
    (item) => item.id === integrationId || item.kind === integrationId,
  );
  return integration?.kind || integrationId || "";
}

function realtimeModelMatchesProvider(provider, model) {
  const value = String(model || "").trim();
  if (!value) return false;
  if (provider === "gemini") return value.includes("gemini");
  if (provider === "openai") return value.includes("realtime") && !value.startsWith("models/");
  return true;
}

function realtimeVoiceMatchesProvider(provider, voice) {
  const value = String(voice || "").trim();
  if (!value) return false;
  if (provider === "gemini") return !OPENAI_REALTIME_VOICES.includes(value);
  if (provider === "openai") return OPENAI_REALTIME_VOICES.includes(value);
  return true;
}

function stepDefaults(config, integrationId, kind, mode) {
  const integration = config?.integrations?.find((item) => item.id === integrationId || item.kind === integrationId);
  const fallback = providerDefaults(integrationId);
  if (!integration) return fallback;
  if (kind === "llm" && mode === "realtime") {
    return {
      model: integration.default_realtime_model || fallback.model || integration.default_model || "",
      text_model: integration.default_model || fallback.text_model || "",
      voice: integration.default_voice || fallback.voice || "",
    };
  }
  return {
    model: integration.default_model || fallback.text_model || fallback.model || "",
    text_model: integration.default_model || fallback.text_model || "",
    voice: integration.default_voice || fallback.voice || "",
  };
}

function stepsFromTemplate(template, config) {
  return template.steps.map(([id, kind, label, integrationId]) => {
    return {
      ...makeStep(kind, label, integrationId, id),
      id,
      enabled: kind !== "flow" || template.mode === "composed",
    };
  });
}

function applyTemplate(flow, templateId, config = null) {
  const template = templates.find((item) => item.id === templateId) || templates[0];
  const defaults = integrationDefaults(config, template.provider);
  const steps = template.id === "custom" && flow.steps?.length ? flow.steps : stepsFromTemplate(template, config);
  const llm = steps.find((step) => step.kind === "llm");
  const output = steps.find((step) => step.kind === "output" || step.kind === "tts");
  const isRealtime = template.mode === "realtime";
  const providerKind = providerKindForIntegration(config, llm?.integration_id || template.provider);
  const stepModel =
    isRealtime && !realtimeModelMatchesProvider(providerKind, llm?.model) ? "" : llm?.model || "";
  const flowModel =
    isRealtime && !realtimeModelMatchesProvider(providerKind, flow.model) ? "" : flow.model || "";
  const stepVoice =
    isRealtime && !realtimeVoiceMatchesProvider(providerKind, output?.voice) ? "" : output?.voice || "";
  const flowVoice =
    isRealtime && !realtimeVoiceMatchesProvider(providerKind, flow.voice) ? "" : flow.voice || "";
  return {
    ...flow,
    mode: template.mode,
    pipeline_template: template.id,
    provider_id: llm?.integration_id || template.provider,
    model: defaults.model || flowModel || stepModel || "",
    text_model: defaults.text_model || flow.text_model || "",
    voice: defaults.voice || flowVoice || stepVoice || "",
    steps,
    conversation_flow:
      template.mode === "composed"
        ? flow.conversation_flow || clone(defaultFlow.conversation_flow)
        : { ...(flow.conversation_flow || clone(defaultFlow.conversation_flow)), enabled: false },
  };
}

function deriveFlowMode(flow, config) {
  const steps = flow.steps || [];
  const hasStt = steps.some((step) => step.kind === "stt" && step.enabled);
  const hasTts = steps.some((step) => step.kind === "tts" && step.enabled);
  const llm = steps.find((step) => step.kind === "llm" && step.enabled);
  const providerKind = providerKindForIntegration(config, llm?.integration_id || flow.provider_id);
  if (!hasStt && !hasTts && ["gemini", "openai", "aws_nova_sonic"].includes(providerKind)) {
    return "realtime";
  }
  return "composed";
}

function ensureShape(config) {
  const shaped = clone(config);
  shaped.integrations ||= [];
  shaped.audio_debug_enabled = Boolean(shaped.audio_debug_enabled);
  shaped.audio_debug_keep_sessions = Math.min(
    100,
    Math.max(1, Number(shaped.audio_debug_keep_sessions || 10)),
  );
  shaped.flows = (shaped.flows?.length ? shaped.flows : [clone(defaultFlow)]).map((flow) => {
    const merged = { ...clone(defaultFlow), ...flow };
    if (!merged.conversation_flow?.nodes?.length) merged.conversation_flow = clone(defaultFlow.conversation_flow);
    if (!merged.steps?.length) return applyTemplate(merged, merged.pipeline_template || "gemini_live_home", shaped);
    return merged;
  });
  shaped.selected_flow_id ||= shaped.flows[0].id;
  return shaped;
}

function syncFlow(flow, config = null) {
  const llm = flow.steps?.find((step) => step.kind === "llm" && step.enabled);
  const providerId = llm?.integration_id || flow.provider_id || "gemini";
  const defaults = providerDefaults(providerId);
  const mode = config ? deriveFlowMode(flow, config) : flow.mode;
  const isRealtime = mode === "realtime";
  const flowModel = isRealtime && !realtimeModelMatchesProvider(providerId, flow.model) ? "" : flow.model || "";
  const flowVoice = isRealtime && !realtimeVoiceMatchesProvider(providerId, flow.voice) ? "" : flow.voice || "";
  const steps = (flow.steps || []).map((step) => ({
    ...step,
    model: "",
    voice: "",
  }));
  const hasTools = steps.some((step) => step.kind === "tools" && step.enabled);
  return {
    ...flow,
    mode,
    steps,
    provider_id: providerId,
    model: flowModel || defaults.model || "",
    voice: flowVoice || defaults.voice || "",
    mcp_enabled: hasTools,
    language: flow.language || null,
    max_output_tokens: flow.max_output_tokens ? Number(flow.max_output_tokens) : null,
    reasoning_effort: flow.reasoning_effort || null,
    mcp_tool_allowlist: Array.isArray(flow.mcp_tool_allowlist)
      ? flow.mcp_tool_allowlist
      : String(flow.mcp_tool_allowlist || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
  };
}

function kindLabel(kind) {
  return providerKinds.find(([id]) => id === kind)?.[1] || kind;
}

function secretValue(value) {
  return value === REDACTED ? "" : value || "";
}

function secretStatus(item, key) {
  if (!item) return "missing";
  if (item[`${key}_configured`] || item[key] === REDACTED) return "configured";
  return secretValue(item[key]) ? "pending" : "missing";
}

function secretPlaceholder(item, key, fallback = "") {
  return secretStatus(item, key) === "configured" ? "configured" : fallback;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTimestamp(value) {
  if (!value) return "running";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function integrationSummary(integration) {
  if (!integration.enabled) return "disabled";
  if (integration.kind === "home_assistant_mcp") {
    if (integration.base_url || secretStatus(integration, "token") === "configured") return "Manual";
    return "Automatic";
  }
  if (
    [
      "gemini",
      "openai",
      "anthropic",
      "azure_openai",
      "soniox",
      "deepgram",
      "cartesia",
      "gradium",
      "speechmatics",
      "elevenlabs",
    ].includes(integration.kind)
  ) {
    const status = secretStatus(integration, "api_key");
    if (status === "configured") return "API key saved";
    if (status === "pending") return "save pending";
    return "API key missing";
  }
  if (integration.kind === "google_cloud_tts") {
    if (integration.credentials_path) return "credentials path";
    return secretStatus(integration, "credentials_json") === "configured" ? "credentials saved" : "credentials missing";
  }
  if (integration.kind === "aws_bedrock") {
    return integration.region ? `region ${integration.region}` : "region missing";
  }
  if (integration.kind === "aws_nova_sonic") {
    return integration.region ? `region ${integration.region}` : "region missing";
  }
  if (["ollama", "openai_compatible", "local_runtime"].includes(integration.kind)) {
    return integration.base_url || integration.endpoint || "endpoint missing";
  }
  return kindLabel(integration.kind);
}

function stepIcon(kind) {
  return stepTypes.find(([id]) => id === kind)?.[2] || Workflow;
}

function stepTone(kind) {
  return stepTypes.find(([id]) => id === kind)?.[3] || "neutral";
}

function runtimeTone(flow) {
  if (flow.mode === "realtime") return "s2s";
  if (flow.mode === "composed") return "composed";
  return "custom";
}

function StatusPill({ validation }) {
  return (
    <div className={validation.ok ? "status-pill ok" : "status-pill error"}>
      {validation.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
      <span>{validation.ok ? "Ready" : "Configuration error"}</span>
    </div>
  );
}

function Button({ children, icon: Icon, variant = "primary", title, ...props }) {
  return (
    <button className={`button ${variant}`} title={title} {...props}>
      {Icon && <Icon size={16} strokeWidth={2} />}
      {children && <span>{children}</span>}
    </button>
  );
}

function Field({ label, children, wide = false }) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [audioDebug, setAudioDebug] = useState({ recordings: [] });
  const [tab, setTab] = useState("assistant");
  const [pipelineStage, setPipelineStage] = useState("list");
  const [selectedStepId, setSelectedStepId] = useState("");
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("gemini");
  const [modelOptions, setModelOptions] = useState({});
  const [message, setMessage] = useState({ text: "", tone: "" });
  const [fatalError, setFatalError] = useState("");
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("pipecat-assist-theme") || "dark");

  useEffect(() => {
    load().catch((err) => setFatalError(String(err)));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pipecat-assist-theme", theme);
  }, [theme]);

  const selectedFlow = useMemo(() => {
    if (!config) return null;
    return config.flows.find((flow) => flow.id === config.selected_flow_id) || config.flows[0];
  }, [config]);

  const selectedStep = useMemo(() => {
    if (!selectedFlow) return null;
    return (
      selectedFlow.steps.find((step) => step.id === selectedStepId) ||
      selectedFlow.steps.find((step) => step.kind === "llm") ||
      selectedFlow.steps[0]
    );
  }, [selectedFlow, selectedStepId]);

  const selectedIntegration = useMemo(() => {
    if (!config) return null;
    return (
      config.integrations.find((integration) => integration.id === selectedIntegrationId) ||
      config.integrations[0]
    );
  }, [config, selectedIntegrationId]);

  const activeValidation = useMemo(() => {
    if (!config || !selectedFlow) return { ok: false, errors: ["Configuration is loading"], warnings: [] };
    return validatePipeline(config, selectedFlow);
  }, [config, selectedFlow]);

  async function load() {
    setFatalError("");
    const [configResponse, statusResponse, audioResponse] = await Promise.all([
      fetch(API.config),
      fetch(API.status),
      fetch(API.audioDebug).catch(() => null),
    ]);
    if (!configResponse.ok) {
      throw new Error(`Config API failed: ${configResponse.status}`);
    }
    if (!statusResponse.ok) {
      throw new Error(`Status API failed: ${statusResponse.status}`);
    }
    const nextConfig = ensureShape(await configResponse.json());
    setConfig(nextConfig);
    setStatus(await statusResponse.json());
    if (audioResponse?.ok) {
      setAudioDebug(await audioResponse.json());
    }
    const flow = nextConfig.flows.find((item) => item.id === nextConfig.selected_flow_id) || nextConfig.flows[0];
    setSelectedStepId(flow.steps.find((step) => step.kind === "llm")?.id || flow.steps[0]?.id || "");
  }

  async function refreshStatus() {
    const response = await fetch(API.status);
    if (response.ok) {
      setStatus(await response.json());
    }
  }

  async function refreshAudioDebug() {
    const response = await fetch(API.audioDebug);
    if (response.ok) {
      setAudioDebug(await response.json());
    }
  }

  function updateConfig(updater) {
    setConfig((current) => ensureShape(updater(clone(current))));
  }

  function updateFlow(flowId, updater) {
    updateConfig((draft) => {
      draft.flows = draft.flows.map((flow) =>
        flow.id === flowId ? syncFlow(updater(clone(flow)), draft) : flow,
      );
      return draft;
    });
  }

  function updateSelectedFlow(updater) {
    updateFlow(selectedFlow.id, updater);
  }

  function updateStep(stepId, updater) {
    updateSelectedFlow((flow) => {
      flow.steps = flow.steps.map((step) => (step.id === stepId ? updater(clone(step)) : step));
      return flow;
    });
  }

  function updateIntegration(integrationId, updater) {
    updateConfig((draft) => {
      draft.integrations = draft.integrations.map((item) =>
        item.id === integrationId ? updater(clone(item)) : item,
      );
      return draft;
    });
  }

  async function loadModelOptions(integrationId, capability = "llm") {
    const key = `${integrationId}:${capability}`;
    if (modelOptions[key]) return;
    const response = await fetch(API.models(integrationId, capability));
    if (!response.ok) return;
    const result = await response.json();
    setModelOptions((current) => ({ ...current, [key]: result.models || [] }));
  }

  function selectFlow(flowId) {
    updateConfig((draft) => {
      draft.selected_flow_id = flowId;
      return draft;
    });
    const flow = config.flows.find((item) => item.id === flowId);
    setSelectedStepId(flow?.steps.find((step) => step.kind === "llm")?.id || flow?.steps[0]?.id || "");
    setPipelineStage("editor");
  }

  function addFlow(templateId = "gemini_live_home") {
    const template = templates.find((item) => item.id === templateId) || templates[0];
    const baseName = template.label;
    const id = slugify(`${baseName}-${config.flows.length + 1}`);
    const flow = applyTemplate(
      {
        ...clone(defaultFlow),
        id,
        name: baseName,
      },
      template.id,
      config,
    );
    updateConfig((draft) => {
      draft.flows.push(flow);
      draft.selected_flow_id = id;
      return draft;
    });
    setSelectedStepId("llm");
    setPipelineStage("editor");
  }

  function duplicateFlow() {
    const copy = clone(selectedFlow);
    copy.id = slugify(`${selectedFlow.id}-copy-${config.flows.length + 1}`);
    copy.name = `${selectedFlow.name} copy`;
    updateConfig((draft) => {
      draft.flows.push(copy);
      draft.selected_flow_id = copy.id;
      return draft;
    });
  }

  function deleteFlow() {
    if (config.flows.length <= 1) return;
    updateConfig((draft) => {
      draft.flows = draft.flows.filter((flow) => flow.id !== selectedFlow.id);
      draft.selected_flow_id = draft.flows[0].id;
      return draft;
    });
  }

  function addStep(kind = "llm") {
    const [, label] = stepTypes.find(([id]) => id === kind) || stepTypes[3];
    const step = makeStep(kind, label, kind === "tools" ? "ha-mcp" : selectedFlow.provider_id);
    updateSelectedFlow((flow) => {
      flow.pipeline_template = "custom";
      flow.steps.push(step);
      return flow;
    });
    setSelectedStepId(step.id);
  }

  function deleteStep(stepId) {
    if (selectedFlow.steps.length <= 1) return;
    updateSelectedFlow((flow) => {
      flow.pipeline_template = "custom";
      flow.steps = flow.steps.filter((step) => step.id !== stepId);
      return flow;
    });
    setSelectedStepId(selectedFlow.steps.find((step) => step.id !== stepId)?.id || "");
  }

  function insertStep(kind, index = selectedFlow.steps.length) {
    const [, label] = stepTypes.find(([id]) => id === kind) || stepTypes[3];
    const integrationId = kind === "tools" ? "ha-mcp" : "";
    const step = makeStep(kind, label, integrationId);
    if (kind === "flow") {
      step.enabled = true;
    }
    updateSelectedFlow((flow) => {
      flow.pipeline_template = "custom";
      const nextSteps = [...flow.steps];
      nextSteps.splice(index, 0, step);
      flow.steps = nextSteps;
      if (kind === "flow") {
        flow.conversation_flow = {
          ...(flow.conversation_flow?.nodes?.length ? flow.conversation_flow : clone(defaultFlow.conversation_flow)),
          enabled: true,
        };
      }
      return flow;
    });
    setSelectedStepId(step.id);
  }

  function addIntegration(kind = "openai_compatible") {
    const label = kindLabel(kind);
    const id = slugify(`${kind}-${config.integrations.length + 1}`);
    const integration = {
      id,
      name: label,
      kind,
      enabled: true,
      api_key: "",
      token: "",
      base_url: kind === "ollama" ? "http://localhost:11434/v1" : "",
      endpoint: "",
      region: "",
      deployment: "",
      default_model: providerDefaults(kind).text_model || "",
      default_realtime_model: providerDefaults(kind).model || "",
      default_voice: providerDefaults(kind).voice || "",
      organization: "",
      project: "",
      location: "",
      credentials_json: "",
      credentials_path: "",
      access_key_id: "",
      secret_key: "",
    };
    updateConfig((draft) => {
      draft.integrations.push(integration);
      return draft;
    });
    setSelectedIntegrationId(id);
  }

  function deleteIntegration(integrationId) {
    if (protectedIntegrationIds.includes(integrationId)) return;
    updateConfig((draft) => {
      draft.integrations = draft.integrations.filter((item) => item.id !== integrationId);
      draft.flows = draft.flows.map((flow) => ({
        ...flow,
        steps: flow.steps.map((step) =>
          step.integration_id === integrationId ? { ...step, integration_id: "" } : step,
        ),
      }));
      return draft;
    });
    setSelectedIntegrationId("gemini");
  }

  async function save() {
    setSaving(true);
    setMessage({ text: "Saving", tone: "" });
    const payload = {
      ...config,
      flows: config.flows.map((flow) => syncFlow(flow, config)),
    };
    const response = await fetch(API.config, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!response.ok) {
      setMessage({ text: await response.text(), tone: "error" });
      return;
    }
    const nextConfig = ensureShape(await response.json());
    setConfig(nextConfig);
    await refreshStatus();
    setAudioDebug((current) => ({
      ...current,
      enabled: nextConfig.audio_debug_enabled,
      keep_sessions: nextConfig.audio_debug_keep_sessions,
    }));
    setMessage({ text: "Saved", tone: "ok" });
  }

  async function checkMcp() {
    setMessage({ text: "Checking MCP", tone: "" });
    const response = await fetch(API.mcp, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow_id: selectedFlow.id }),
    });
    const result = await response.json();
    setMessage(
      result.ok
        ? { text: `MCP connected: ${result.tool_count} tools`, tone: "ok" }
        : { text: result.error || "MCP check failed", tone: "error" },
    );
  }

  async function resetMcpDefaults() {
    setMessage({ text: "Resetting MCP", tone: "" });
    const response = await fetch(API.mcpReset, { method: "POST" });
    if (!response.ok) {
      setMessage({ text: await response.text(), tone: "error" });
      return;
    }
    setConfig(ensureShape(await response.json()));
    await refreshStatus();
    setMessage({ text: "MCP reset to Supervisor defaults", tone: "ok" });
  }

  async function resetIntegrationDefaults(integrationId) {
    setMessage({ text: "Resetting integration", tone: "" });
    const response = await fetch(API.integrationReset(integrationId), { method: "POST" });
    if (!response.ok) {
      setMessage({ text: await response.text(), tone: "error" });
      return;
    }
    const nextConfig = ensureShape(await response.json());
    setConfig(nextConfig);
    setSelectedIntegrationId(integrationId);
    await refreshStatus();
    setMessage({ text: "Integration reset to defaults", tone: "ok" });
  }

  async function clearAudioDebug() {
    setMessage({ text: "Clearing audio captures", tone: "" });
    const response = await fetch(API.audioDebug, { method: "DELETE" });
    if (!response.ok) {
      setMessage({ text: await response.text(), tone: "error" });
      return;
    }
    setAudioDebug(await response.json());
    setMessage({ text: "Audio captures cleared", tone: "ok" });
  }

  async function copyOfferUrl() {
    await navigator.clipboard.writeText(config.runner_offer_url || "");
    setMessage({ text: "Copied", tone: "ok" });
  }

  if (!config || !selectedFlow) {
    return (
      <main className="loading">
        <img src="assets/logo.svg" alt="" />
        {fatalError ? (
          <>
            <strong>Interface did not load</strong>
            <span>{fatalError}</span>
            <Button icon={RefreshCw} variant="secondary" onClick={() => load().catch((err) => setFatalError(String(err)))}>
              Retry
            </Button>
          </>
        ) : (
          <span>Loading</span>
        )}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="nav">
        <div className="brand">
          <img src="assets/logo.svg" alt="" />
          <div>
            <h1>Pipecat Assist</h1>
            <span className={activeValidation.ok ? "state ok" : "state error"}>
              {activeValidation.ok ? "ready" : "setup needed"}
            </span>
          </div>
        </div>

        <nav className="tabs" aria-label="Pipecat Assist">
          {[
            ["assistant", "Assistant", Bot],
            ["pipelines", "Pipelines", Workflow],
            ["integrations", "Integrations", SlidersHorizontal],
            ["runtime", "Runtime", Settings],
          ].map(([id, label, Icon]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h2>
              {tab === "assistant"
                ? "Assistant"
                : tab === "pipelines"
                  ? "Pipelines"
                  : tab === "integrations"
                    ? "Integrations"
                    : "Runtime"}
            </h2>
            <span>{activeValidation.ok ? `${selectedFlow.mode} pipeline` : activeValidation.errors[0]}</span>
          </div>
          <div className="actions">
            <Button icon={RefreshCw} variant="secondary" onClick={load} title="Reload" />
            <StatusPill validation={activeValidation} />
          </div>
        </header>

        {tab === "assistant" && (
          <AssistantView
            config={config}
            flow={selectedFlow}
            status={status}
            selectFlow={selectFlow}
            setTab={setTab}
          />
        )}

        {tab === "pipelines" && (
          <PipelineView
            config={config}
            flow={selectedFlow}
            selectedStep={selectedStep}
            setSelectedStepId={setSelectedStepId}
            updateFlow={updateSelectedFlow}
            updateStep={updateStep}
            addStep={addStep}
            insertStep={insertStep}
            deleteStep={deleteStep}
            duplicateFlow={duplicateFlow}
            deleteFlow={deleteFlow}
            selectFlow={selectFlow}
            addFlow={addFlow}
            pipelineStage={pipelineStage}
            setPipelineStage={setPipelineStage}
            save={save}
            saving={saving}
          />
        )}

        {tab === "integrations" && (
          <IntegrationsView
            config={config}
            selectedIntegration={selectedIntegration}
            setSelectedIntegrationId={setSelectedIntegrationId}
            updateIntegration={updateIntegration}
            addIntegration={addIntegration}
            deleteIntegration={deleteIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            checkMcp={checkMcp}
            resetMcpDefaults={resetMcpDefaults}
            resetIntegrationDefaults={resetIntegrationDefaults}
            save={save}
            saving={saving}
          />
        )}

        {tab === "runtime" && (
          <RuntimeView
            config={config}
            flow={selectedFlow}
            status={status}
            checkMcp={checkMcp}
            resetMcpDefaults={resetMcpDefaults}
            copyOfferUrl={copyOfferUrl}
            audioDebug={audioDebug}
            refreshAudioDebug={refreshAudioDebug}
            clearAudioDebug={clearAudioDebug}
            updateConfig={updateConfig}
            updateIntegration={updateIntegration}
            save={save}
            saving={saving}
          />
        )}

        <div className={message.tone ? `message ${message.tone}` : "message"} role="status">
          {message.tone === "ok" && <CheckCircle2 size={16} />}
          {message.tone === "error" && <AlertCircle size={16} />}
          <span>{message.text}</span>
        </div>
      </main>
    </div>
  );
}

function pipelineTemplate(flow) {
  return templates.find((item) => item.id === flow.pipeline_template) || templates[0];
}

function pipelineReadiness(config, flow) {
  const missing = [];
  const providerSteps = (flow.steps || []).filter((step) =>
    ["stt", "llm", "tts", "output"].includes(step.kind) && step.integration_id,
  );
  for (const step of providerSteps) {
    const integration = config.integrations.find((item) => item.id === step.integration_id);
    if (!integration || !integration.enabled) {
      missing.push(step.integration_id);
      continue;
    }
    if (
      !["home_assistant_mcp", "google_cloud_tts", "aws_bedrock", "aws_nova_sonic", "ollama", "local_runtime"].includes(
        integration.kind,
      ) &&
      secretStatus(integration, "api_key") === "missing"
    ) {
      missing.push(integration.name);
    }
    if (integration.kind === "google_cloud_tts" && !integration.credentials_path && secretStatus(integration, "credentials_json") === "missing") {
      missing.push(integration.name);
    }
    if (["aws_bedrock", "aws_nova_sonic"].includes(integration.kind)) {
      if (secretStatus(integration, "access_key_id") === "missing" || secretStatus(integration, "secret_key") === "missing") {
        missing.push(integration.name);
      }
    }
  }
  return [...new Set(missing)];
}

function mcpMode(config, status) {
  const mcp = config.integrations.find((item) => item.kind === "home_assistant_mcp");
  const source = status?.mcp_token_source || config.mcp_token_source || "";
  const manual = Boolean(mcp?.base_url || mcp?.token_configured || mcp?.token === REDACTED || config.longlived_token_configured);
  if (manual) return { label: "Manual", tone: "manual" };
  if (source === "supervisor") return { label: "Automatic", tone: "ok" };
  return { label: "Error", tone: "error" };
}

function validatePipeline(config, flow) {
  const errors = [];
  const warnings = [];
  if (!flow.enabled) errors.push("Active pipeline is disabled.");

  const enabledSteps = (flow.steps || []).filter((step) => step.enabled);
  const llmSteps = enabledSteps.filter((step) => step.kind === "llm");
  if (!llmSteps.length) errors.push("Pipeline needs one model step.");
  if (llmSteps.length > 1) warnings.push("More than one model step is enabled.");

  const hasStt = enabledSteps.some((step) => step.kind === "stt");
  const hasTts = enabledSteps.some((step) => step.kind === "tts");
  const hasFlow = enabledSteps.some((step) => step.kind === "flow") || flow.conversation_flow?.enabled;
  const derivedMode = deriveFlowMode(flow, config);

  if (derivedMode === "realtime" && hasFlow) {
    errors.push("Pipecat Flow is only available for composed realtime pipelines.");
  }
  if (derivedMode === "realtime" && (hasStt || hasTts)) {
    errors.push("Speech-to-speech pipelines cannot also use separate STT or TTS steps.");
  }
  if (derivedMode === "composed" && (!hasStt || !hasTts)) {
    errors.push("Composed pipelines need both STT and TTS steps.");
  }

  for (const step of enabledSteps) {
    if (!["stt", "llm", "tts", "tools", "output"].includes(step.kind)) continue;
    if (!step.integration_id) {
      if (step.kind !== "output") errors.push(`${step.label} needs an integration.`);
      continue;
    }
    const integration = config.integrations.find((item) => item.id === step.integration_id);
    if (!integration) {
      errors.push(`${step.label} uses a missing integration.`);
      continue;
    }
    if (!integration.enabled) {
      errors.push(`${integration.name} is disabled.`);
    }
    const allowed = stepProviders[step.kind];
    if (allowed && !allowed.includes(integration.kind)) {
      errors.push(`${integration.name} cannot be used as ${step.kind.toUpperCase()}.`);
    }
    if (
      ["gemini", "openai", "soniox", "deepgram", "cartesia", "gradium", "speechmatics", "elevenlabs"].includes(
        integration.kind,
      ) &&
      secretStatus(integration, "api_key") === "missing"
    ) {
      errors.push(`${integration.name} API key is missing.`);
    }
    if (integration.kind === "google_cloud_tts" && !integration.credentials_path && secretStatus(integration, "credentials_json") === "missing") {
      errors.push("Google Cloud TTS credentials are missing.");
    }
    if (["aws_bedrock", "aws_nova_sonic"].includes(integration.kind)) {
      if (secretStatus(integration, "access_key_id") === "missing" || secretStatus(integration, "secret_key") === "missing") {
        errors.push(`${integration.name} AWS credentials are missing.`);
      }
    }
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

function AssistantView({ config, flow, status, selectFlow, setTab }) {
  const template = pipelineTemplate(flow);
  const Icon = template.icon || Bot;
  const validation = validatePipeline(config, flow);
  return (
    <div className="assistant-grid">
      <section className={`assistant-hero ${template.accent || "blue"}`}>
        <div className="assistant-badge">
          <Icon size={34} />
        </div>
        <div className="assistant-title">
          <span>{template.group || flow.mode}</span>
          <h3>{flow.name}</h3>
          <strong>{validation.ok ? "Ready" : validation.errors[0]}</strong>
        </div>
        <VoiceTest config={config} flow={flow} />
      </section>

      <section className="panel assistant-side">
        <div className="panel-head">
          <div>
            <h3>Active pipeline</h3>
            <span>{status?.mcp_token_source || config.mcp_token_source || "MCP pending"}</span>
          </div>
          <Button icon={Workflow} variant="secondary" onClick={() => setTab("pipelines")}>
            Edit
          </Button>
        </div>
        <div className="flow-list compact">
          {config.flows.map((item) => {
            const TemplateIcon = pipelineTemplate(item).icon || Workflow;
            const itemValidation = validatePipeline(config, item);
            return (
              <button
                key={item.id}
                className={`flow-card ${runtimeTone(item)} ${item.id === flow.id ? "active" : ""}`}
                onClick={() => selectFlow(item.id)}
              >
                <TemplateIcon size={18} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{itemValidation.ok ? pipelineTemplate(item).label : itemValidation.errors[0]}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function OldPipelineView({
  config,
  flow,
  selectedStep,
  setSelectedStepId,
  updateFlow,
  updateStep,
  addStep,
  deleteStep,
  duplicateFlow,
  deleteFlow,
}) {
  return (
    <div className="workspace-grid">
      <section className="panel main-panel">
        <div className="panel-head">
          <div>
            <h3>Pipeline</h3>
            <span>{flow.steps.length} steps</span>
          </div>
          <div className="button-row">
            <Button icon={Copy} variant="secondary" onClick={duplicateFlow}>
              Duplicate
            </Button>
            <Button icon={Trash2} variant="danger" onClick={deleteFlow} disabled={config.flows.length <= 1}>
              Delete
            </Button>
          </div>
        </div>

        <div className="template-groups">
          {[...new Set(templates.map((template) => template.group || "Other"))].map((group) => (
            <div className="template-group" key={group}>
              <span>{group}</span>
              <div className="template-grid">
                {templates
                  .filter((template) => (template.group || "Other") === group)
                  .map((template) => {
                    const Icon = template.icon;
                    return (
                      <button
                        key={template.id}
                        className={
                          flow.pipeline_template === template.id
                            ? `template-card active ${template.accent}`
                            : `template-card ${template.accent}`
                        }
                        onClick={() => updateFlow((draft) => applyTemplate(draft, template.id, config))}
                      >
                        <Icon size={20} />
                        <strong>{template.label}</strong>
                        <small>{template.mode}</small>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>

        <div className="pipeline-canvas">
          {flow.steps.map((step, index) => {
            const Icon = stepIcon(step.kind);
            return (
              <React.Fragment key={step.id}>
                <button
                  className={selectedStep?.id === step.id ? "node selected" : "node"}
                  onClick={() => setSelectedStepId(step.id)}
                >
                  <Icon size={19} />
                  <strong>{step.label}</strong>
                  <span>{step.integration_id || step.kind}</span>
                </button>
                {index < flow.steps.length - 1 && <div className="connector" />}
              </React.Fragment>
            );
          })}
          <button className="node add-node" onClick={() => addStep("llm")}>
            <Plus size={18} />
            <strong>Add</strong>
            <span>step</span>
          </button>
        </div>
      </section>

      <section className="panel inspector">
        <div className="panel-head">
          <div>
            <h3>Inspector</h3>
            <span>{selectedStep?.label || flow.name}</span>
          </div>
        </div>

        <div className="form-grid">
          <Field label="Name">
            <input value={flow.name} onChange={(event) => updateFlow((draft) => ({ ...draft, name: event.target.value }))} />
          </Field>
          <Field label="ID">
            <input value={flow.id} readOnly />
          </Field>
          <Toggle checked={flow.enabled} onChange={(value) => updateFlow((draft) => ({ ...draft, enabled: value }))} label="Enabled" />
          <Toggle checked={flow.video_enabled} onChange={(value) => updateFlow((draft) => ({ ...draft, video_enabled: value }))} label="Video input" />
        </div>

        {selectedStep?.kind === "flow" ? (
          <>
            <div className="divider" />
            <ConversationFlowEditor flow={flow} updateFlow={updateFlow} />
          </>
        ) : selectedStep ? (
          <>
            <div className="divider" />
            <div className="form-grid">
              <Field label="Step label">
                <input
                  value={selectedStep.label}
                  onChange={(event) => updateStep(selectedStep.id, (step) => ({ ...step, label: event.target.value }))}
                />
              </Field>
              <Field label="Step type">
                <select
                  value={selectedStep.kind}
                  onChange={(event) => updateStep(selectedStep.id, (step) => ({ ...step, kind: event.target.value }))}
                >
                  {stepTypes.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              {["stt", "llm", "tools", "tts", "output"].includes(selectedStep.kind) && (
                <Field label="Integration">
                  <select
                    value={selectedStep.integration_id || ""}
                    onChange={(event) => {
                      const integrationId = event.target.value;
                      const defaults = stepDefaults(config, integrationId, selectedStep.kind, flow.mode);
                      updateStep(selectedStep.id, (step) => ({
                        ...step,
                        integration_id: integrationId,
                        model: ["stt", "llm", "tts"].includes(step.kind) ? defaults.model || "" : step.model,
                        voice:
                          step.kind === "output" || step.kind === "tts"
                            ? defaults.voice || ""
                            : step.voice,
                      }));
                    }}
                  >
                    <option value="">None</option>
                    {config.integrations.map((integration) => (
                      <option key={integration.id} value={integration.id}>
                        {integration.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {["stt", "llm", "tts"].includes(selectedStep.kind) && (
                <Field label="Model">
                  <input
                    value={selectedStep.model || ""}
                    onChange={(event) => updateStep(selectedStep.id, (step) => ({ ...step, model: event.target.value }))}
                  />
                </Field>
              )}
              {["tts", "output"].includes(selectedStep.kind) && (
                <Field label="Voice">
                  <input
                    value={selectedStep.voice || ""}
                    onChange={(event) => updateStep(selectedStep.id, (step) => ({ ...step, voice: event.target.value }))}
                  />
                </Field>
              )}
              <Toggle
                checked={selectedStep.enabled}
                onChange={(value) => updateStep(selectedStep.id, (step) => ({ ...step, enabled: value }))}
                label="Step enabled"
              />
              <Button
                icon={Trash2}
                variant="danger"
                onClick={() => deleteStep(selectedStep.id)}
                disabled={flow.steps.length <= 1}
              >
                Remove step
              </Button>
            </div>
          </>
        ) : null}

        <div className="divider" />
        <div className="form-grid">
          <Field label="Text model">
            <input value={flow.text_model || ""} onChange={(event) => updateFlow((draft) => ({ ...draft, text_model: event.target.value }))} />
          </Field>
          <Field label="Language">
            <input value={flow.language || ""} onChange={(event) => updateFlow((draft) => ({ ...draft, language: event.target.value }))} />
          </Field>
          <Field label="Noise reduction">
            <select value={flow.noise_reduction} onChange={(event) => updateFlow((draft) => ({ ...draft, noise_reduction: event.target.value }))}>
              <option value="off">off</option>
              <option value="near_field">near field</option>
              <option value="far_field">far field</option>
            </select>
          </Field>
          <Field label="VAD">
            <select value={flow.vad_mode} onChange={(event) => updateFlow((draft) => ({ ...draft, vad_mode: event.target.value }))}>
              <option value="semantic_vad">semantic</option>
              <option value="server_vad">server</option>
            </select>
          </Field>
          <Field label="VAD eagerness">
            <select value={flow.vad_eagerness} onChange={(event) => updateFlow((draft) => ({ ...draft, vad_eagerness: event.target.value }))}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="auto">auto</option>
            </select>
          </Field>
          <Field label="Speed">
            <input
              type="number"
              min="0.25"
              max="1.5"
              step="0.05"
              value={flow.speed}
              onChange={(event) => updateFlow((draft) => ({ ...draft, speed: Number(event.target.value || 1) }))}
            />
          </Field>
          <Toggle checked={flow.mcp_enabled} onChange={(value) => updateFlow((draft) => ({ ...draft, mcp_enabled: value }))} label="MCP tools" />
          <Toggle
            checked={flow.interrupt_response}
            onChange={(value) => updateFlow((draft) => ({ ...draft, interrupt_response: value }))}
            label="Interrupt response"
          />
          <Field label="MCP allowlist" wide>
            <input
              value={(flow.mcp_tool_allowlist || []).join(", ")}
              onChange={(event) =>
                updateFlow((draft) => ({
                  ...draft,
                  mcp_tool_allowlist: event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                }))
              }
            />
          </Field>
          <Field label="Instructions" wide>
            <textarea rows={8} value={flow.instructions} onChange={(event) => updateFlow((draft) => ({ ...draft, instructions: event.target.value }))} />
          </Field>
          <Field label="Greeting" wide>
            <input value={flow.greeting} onChange={(event) => updateFlow((draft) => ({ ...draft, greeting: event.target.value }))} />
          </Field>
        </div>
      </section>
    </div>
  );
}

function PipelineView({
  config,
  flow,
  selectedStep,
  setSelectedStepId,
  updateFlow,
  updateStep,
  insertStep,
  deleteStep,
  duplicateFlow,
  deleteFlow,
  selectFlow,
  addFlow,
  pipelineStage,
  setPipelineStage,
  save,
  saving,
}) {
  const validation = validatePipeline(config, flow);
  const templatesByGroup = [...new Set(templates.map((template) => template.group || "Other"))];

  if (pipelineStage === "flow") {
    return (
      <section className="panel flow-page">
        <div className="panel-head">
          <div>
            <h3>Pipecat Flow</h3>
            <span>{flow.name}</span>
          </div>
          <div className="button-row">
            <Button icon={ChevronLeft} variant="secondary" onClick={() => setPipelineStage("editor")}>
              Back
            </Button>
            <Button icon={Save} onClick={save} disabled={saving}>
              Save
            </Button>
          </div>
        </div>
        <ConversationFlowEditor flow={flow} updateFlow={updateFlow} />
      </section>
    );
  }

  if (pipelineStage === "list") {
    return (
      <div className="pipelines-home">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Pipelines</h3>
              <span>{config.flows.length} configured</span>
            </div>
            <select
              className="add-select"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) addFlow(event.target.value);
                event.target.value = "";
              }}
            >
              <option value="">Add pipeline</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </div>
          <div className="pipeline-card-grid">
            {config.flows.map((item) => {
              const template = pipelineTemplate(item);
              const Icon = template.icon || Workflow;
              const itemValidation = validatePipeline(config, item);
              return (
                <button
                  key={item.id}
                  className={`pipeline-card ${runtimeTone(item)} ${item.id === flow.id ? "active" : ""}`}
                  onClick={() => selectFlow(item.id)}
                >
                  <Icon size={24} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.mode === "realtime" ? "speech-to-speech" : "composed realtime"}</small>
                  </span>
                  <em className={itemValidation.ok ? "ok" : "error"}>
                    {itemValidation.ok ? "Ready" : itemValidation.errors[0]}
                  </em>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Starters</h3>
              <span>Choose a complete pipeline, then edit its steps</span>
            </div>
          </div>
          <div className="template-groups compact">
            {templatesByGroup.map((group) => (
              <div className="template-group" key={group}>
                <span>{group}</span>
                <div className="template-grid">
                  {templates
                    .filter((template) => (template.group || "Other") === group)
                    .map((template) => {
                      const Icon = template.icon;
                      return (
                        <button
                          key={template.id}
                          className={`template-card ${template.accent}`}
                          onClick={() => addFlow(template.id)}
                        >
                          <Icon size={20} />
                          <strong>{template.label}</strong>
                          <small>{template.mode === "realtime" ? "speech-to-speech" : "composed"}</small>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  const flowSupported = flow.mode === "composed";
  const selectedTone = selectedStep ? stepTone(selectedStep.kind) : "neutral";

  return (
    <div className="pipeline-editor-grid">
      <section className="panel main-panel">
        <div className="panel-head">
          <div>
            <h3>{flow.name}</h3>
            <span>{flow.mode === "realtime" ? "speech-to-speech" : "composed realtime"}</span>
          </div>
          <div className="button-row">
            <Button icon={ChevronLeft} variant="secondary" onClick={() => setPipelineStage("list")}>
              Pipelines
            </Button>
            <Button icon={Copy} variant="secondary" onClick={duplicateFlow}>
              Duplicate
            </Button>
            <Button icon={Trash2} variant="danger" onClick={deleteFlow} disabled={config.flows.length <= 1}>
              Delete
            </Button>
          </div>
        </div>

        <div className={validation.ok ? "validation-card ok" : "validation-card error"}>
          {validation.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{validation.ok ? "Pipeline is valid." : validation.errors[0]}</span>
        </div>

        <StepPalette insertStep={insertStep} flowSupported={flowSupported} />
        <div className="pipeline-canvas">
          <DropSlot index={0} insertStep={insertStep} />
          {flow.steps.map((step, index) => {
            const Icon = stepIcon(step.kind);
            const disabledFlow = step.kind === "flow" && !flowSupported;
            return (
              <React.Fragment key={step.id}>
                <button
                  className={
                    selectedStep?.id === step.id
                      ? `node selected tone-${stepTone(step.kind)} ${disabledFlow ? "unsupported" : ""}`
                      : `node tone-${stepTone(step.kind)} ${disabledFlow ? "unsupported" : ""}`
                  }
                  onClick={() => {
                    setSelectedStepId(step.id);
                    if (step.kind === "flow" && flowSupported) setPipelineStage("flow");
                  }}
                >
                  <Icon size={19} />
                  <strong>{step.label}</strong>
                  <span>{disabledFlow ? "not available for S2S" : step.integration_id || step.kind}</span>
                </button>
                {index < flow.steps.length - 1 && (
                  <div className="connector">
                    <ArrowRight size={14} />
                  </div>
                )}
                <DropSlot index={index + 1} insertStep={insertStep} />
              </React.Fragment>
            );
          })}
        </div>
        <div className="editor-actions">
          <Button icon={Save} onClick={save} disabled={saving}>
            Save pipeline
          </Button>
        </div>
      </section>

      <section className={`panel inspector tone-panel-${selectedTone}`}>
        <div className="panel-head">
          <div>
            <h3>{selectedStep ? "Step" : "Pipeline"}</h3>
            <span>{selectedStep?.label || flow.name}</span>
          </div>
        </div>

        <div className="form-grid">
          <Field label="Name">
            <input value={flow.name} onChange={(event) => updateFlow((draft) => ({ ...draft, name: event.target.value }))} />
          </Field>
          <Toggle checked={flow.enabled} onChange={(value) => updateFlow((draft) => ({ ...draft, enabled: value }))} label="Enabled" />
          <Toggle checked={flow.video_enabled} onChange={(value) => updateFlow((draft) => ({ ...draft, video_enabled: value }))} label="Video input" />
        </div>

        {selectedStep?.kind === "flow" ? (
          <>
            <div className="divider" />
            <div className="flow-inline">
              <strong>{flowSupported ? "Pipecat Flow editor" : "Unavailable"}</strong>
              <span>
                {flowSupported
                  ? "Open the nested composer to edit nodes and functions."
                  : "Official Pipecat Flows are not available for speech-to-speech models."}
              </span>
              <Button icon={Workflow} onClick={() => setPipelineStage("flow")} disabled={!flowSupported}>
                Open composer
              </Button>
            </div>
          </>
        ) : selectedStep ? (
          <>
            <div className="divider" />
            <div className="form-grid">
              <Field label="Step label">
                <input
                  value={selectedStep.label}
                  onChange={(event) => updateStep(selectedStep.id, (step) => ({ ...step, label: event.target.value }))}
                />
              </Field>
              {["stt", "llm", "tools", "tts", "output"].includes(selectedStep.kind) && (
                <Field label="Integration">
                  <select
                    value={selectedStep.integration_id || ""}
                    onChange={(event) => {
                      const integrationId = event.target.value;
                      updateStep(selectedStep.id, (step) => ({
                        ...step,
                        integration_id: integrationId,
                        model: "",
                        voice: "",
                      }));
                    }}
                  >
                    <option value="">None</option>
                    {config.integrations
                      .filter((integration) => {
                        const allowed = stepProviders[selectedStep.kind];
                        return !allowed || allowed.includes(integration.kind);
                      })
                      .map((integration) => (
                        <option key={integration.id} value={integration.id}>
                          {integration.name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <Toggle
                checked={selectedStep.enabled}
                onChange={(value) => updateStep(selectedStep.id, (step) => ({ ...step, enabled: value }))}
                label="Step enabled"
              />
              <Button
                icon={Trash2}
                variant="danger"
                onClick={() => deleteStep(selectedStep.id)}
                disabled={flow.steps.length <= 1}
              >
                Remove step
              </Button>
            </div>
          </>
        ) : null}

        <div className="divider" />
        <div className="form-grid">
          <Field label="Language">
            <input value={flow.language || ""} onChange={(event) => updateFlow((draft) => ({ ...draft, language: event.target.value }))} />
          </Field>
          <Field label="Noise reduction">
            <select value={flow.noise_reduction} onChange={(event) => updateFlow((draft) => ({ ...draft, noise_reduction: event.target.value }))}>
              <option value="off">off</option>
              <option value="near_field">near field</option>
              <option value="far_field">far field</option>
            </select>
          </Field>
          <Field label="VAD">
            <select value={flow.vad_mode} onChange={(event) => updateFlow((draft) => ({ ...draft, vad_mode: event.target.value }))}>
              <option value="semantic_vad">semantic</option>
              <option value="server_vad">server</option>
            </select>
          </Field>
          <Field label="VAD eagerness">
            <select value={flow.vad_eagerness} onChange={(event) => updateFlow((draft) => ({ ...draft, vad_eagerness: event.target.value }))}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="auto">auto</option>
            </select>
          </Field>
          <Field label="Speed">
            <select value={String(flow.speed)} onChange={(event) => updateFlow((draft) => ({ ...draft, speed: Number(event.target.value || 1) }))}>
              <option value="0.75">0.75x</option>
              <option value="0.9">0.9x</option>
              <option value="1">1.0x</option>
              <option value="1.1">1.1x</option>
              <option value="1.25">1.25x</option>
            </select>
          </Field>
          <Toggle
            checked={flow.interrupt_response}
            onChange={(value) => updateFlow((draft) => ({ ...draft, interrupt_response: value }))}
            label="Allow barge-in"
          />
          <p className="field-help">Allows the user to interrupt assistant audio while it is speaking.</p>
          <Field label="Instructions" wide>
            <textarea rows={8} value={flow.instructions} onChange={(event) => updateFlow((draft) => ({ ...draft, instructions: event.target.value }))} />
          </Field>
          <Toggle
            checked={!flow.greeting}
            onChange={(value) => updateFlow((draft) => ({ ...draft, greeting: value ? "" : defaultFlow.greeting }))}
            label="No greeting"
          />
          <Field label="Greeting" wide>
            <input
              value={flow.greeting}
              disabled={!flow.greeting}
              onChange={(event) => updateFlow((draft) => ({ ...draft, greeting: event.target.value }))}
            />
          </Field>
        </div>
      </section>
    </div>
  );
}

function StepPalette({ insertStep, flowSupported }) {
  return (
    <div className="step-palette">
      {addableStepTypes.map(([kind, label, Icon]) => {
        const disabled = kind === "flow" && !flowSupported;
        return (
          <button
            key={kind}
            className={`palette-step tone-${stepTone(kind)} ${disabled ? "disabled" : ""}`}
            draggable={!disabled}
            onDragStart={(event) => event.dataTransfer.setData("application/x-step-kind", kind)}
            onClick={() => !disabled && insertStep(kind)}
            disabled={disabled}
            title={disabled ? "Pipecat Flow is available only for composed realtime pipelines" : `Add ${label}`}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function DropSlot({ index, insertStep }) {
  const [over, setOver] = useState(false);
  return (
    <button
      className={over ? "drop-slot over" : "drop-slot"}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const kind = event.dataTransfer.getData("application/x-step-kind");
        if (kind) insertStep(kind, index);
      }}
      onClick={() => insertStep("llm", index)}
      title="Drop a step here"
    >
      <Plus size={12} />
    </button>
  );
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function ConversationFlowEditor({ flow, updateFlow }) {
  const nodes = flow.conversation_flow?.nodes || [];
  const [selectedNodeId, setSelectedNodeId] = useState(
    flow.conversation_flow?.initial_node_id || nodes[0]?.id || "",
  );
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0];

  function updateConversationFlow(updater) {
    updateFlow((draft) => {
      const current = draft.conversation_flow?.nodes?.length
        ? clone(draft.conversation_flow)
        : clone(defaultFlow.conversation_flow);
      draft.conversation_flow = updater(current);
      return draft;
    });
  }

  function updateNode(nodeId, updater) {
    updateConversationFlow((conversationFlow) => {
      conversationFlow.nodes = conversationFlow.nodes.map((node) =>
        node.id === nodeId ? updater(clone(node)) : node,
      );
      return conversationFlow;
    });
  }

  function addNode() {
    const id = slugify(`node-${nodes.length + 1}`);
    updateConversationFlow((conversationFlow) => {
      conversationFlow.nodes.push({
        id,
        label: "New node",
        role_message: flow.instructions,
        task: "Continue the conversation.",
        functions: [],
      });
      return conversationFlow;
    });
    setSelectedNodeId(id);
  }

  function removeNode(nodeId) {
    if (nodes.length <= 1) return;
    updateConversationFlow((conversationFlow) => {
      conversationFlow.nodes = conversationFlow.nodes.filter((node) => node.id !== nodeId);
      if (conversationFlow.initial_node_id === nodeId) {
        conversationFlow.initial_node_id = conversationFlow.nodes[0]?.id || "";
      }
      return conversationFlow;
    });
    setSelectedNodeId(nodes.find((node) => node.id !== nodeId)?.id || "");
  }

  function addFunction() {
    if (!selectedNode) return;
    updateNode(selectedNode.id, (node) => {
      node.functions = node.functions || [];
      node.functions.push({
        name: slugify(`function-${node.functions.length + 1}`).replaceAll("-", "_"),
        description: "Continue the flow.",
        properties: {},
        required: [],
        next_node_id: "",
        mcp_tool: "",
      });
      return node;
    });
  }

  function updateFunction(index, updater) {
    updateNode(selectedNode.id, (node) => {
      node.functions = (node.functions || []).map((fn, fnIndex) =>
        fnIndex === index ? updater(clone(fn)) : fn,
      );
      return node;
    });
  }

  function removeFunction(index) {
    updateNode(selectedNode.id, (node) => {
      node.functions = (node.functions || []).filter((_, fnIndex) => fnIndex !== index);
      return node;
    });
  }

  function loadPizzaExample() {
    updateConversationFlow(() => clone(pizzaConversationFlow));
    setSelectedNodeId(pizzaConversationFlow.initial_node_id);
  }

  function resetPassthrough() {
    const next = { ...clone(defaultFlow.conversation_flow), enabled: true };
    updateConversationFlow(() => next);
    setSelectedNodeId(next.initial_node_id);
  }

  return (
    <div className="flow-editor">
      <div className="section-title">
        <strong>Visual composer</strong>
        <span>FlowManager for composed realtime pipelines</span>
        <div className="button-row">
          <Button icon={RotateCcw} variant="secondary" onClick={resetPassthrough}>
            Pass-through
          </Button>
          <Button icon={Workflow} variant="secondary" onClick={loadPizzaExample}>
            Load pizza example
          </Button>
        </div>
      </div>
      <div className="form-grid">
        <Toggle
          checked={flow.conversation_flow?.enabled}
          onChange={(value) =>
            updateConversationFlow((conversationFlow) => ({ ...conversationFlow, enabled: value }))
          }
          label="Enabled"
        />
        <Field label="Initial node">
          <select
            value={flow.conversation_flow?.initial_node_id || nodes[0]?.id || ""}
            onChange={(event) =>
              updateConversationFlow((conversationFlow) => ({
                ...conversationFlow,
                initial_node_id: event.target.value,
              }))
            }
          >
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label || node.id}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flow-graph">
        {nodes.map((node, index) => (
          <React.Fragment key={node.id}>
            <button
              className={selectedNode?.id === node.id ? `graph-node active tone-${index % 5}` : `graph-node tone-${index % 5}`}
              onClick={() => setSelectedNodeId(node.id)}
            >
              <strong>{node.label || node.id}</strong>
              <span>{(node.functions || []).map((fn) => fn.next_node_id).filter(Boolean).join(", ") || "pass-through"}</span>
            </button>
            {index < nodes.length - 1 && <ArrowRight size={16} />}
          </React.Fragment>
        ))}
      </div>

      <div className="flow-node-grid">
        <div className="flow-node-list">
          {nodes.map((node, index) => (
            <button
              key={node.id}
              className={selectedNode?.id === node.id ? `flow-node active tone-${index % 5}` : `flow-node tone-${index % 5}`}
              onClick={() => setSelectedNodeId(node.id)}
            >
              <strong>{node.label || node.id}</strong>
              <span>{(node.functions || []).length} functions</span>
            </button>
          ))}
          <button className="flow-node add-node" onClick={addNode}>
            <Plus size={16} />
            <strong>Add node</strong>
          </button>
        </div>

        {selectedNode && (
          <div className="flow-node-detail">
            <div className="form-grid">
              <Field label="Label">
                <input
                  value={selectedNode.label || ""}
                  onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, label: event.target.value }))}
                />
              </Field>
              <Field label="ID">
                <input value={selectedNode.id} readOnly />
              </Field>
              <Field label="Role" wide>
                <textarea
                  rows={3}
                  value={selectedNode.role_message || ""}
                  onChange={(event) =>
                    updateNode(selectedNode.id, (node) => ({ ...node, role_message: event.target.value }))
                  }
                />
              </Field>
              <Field label="Task" wide>
                <textarea
                  rows={3}
                  value={selectedNode.task || ""}
                  onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, task: event.target.value }))}
                />
              </Field>
            </div>

            <div className="section-title">
              <strong>Functions</strong>
              <Button icon={Plus} variant="secondary" onClick={addFunction}>
                Add
              </Button>
            </div>
            {(selectedNode.functions || []).map((fn, index) => (
              <div className="function-row" key={`${selectedNode.id}-${index}`}>
                <div className="form-grid">
                  <Field label="Name">
                    <input
                      value={fn.name || ""}
                      onChange={(event) => updateFunction(index, (item) => ({ ...item, name: event.target.value }))}
                    />
                  </Field>
                  <Field label="Next node">
                    <select
                      value={fn.next_node_id || ""}
                      onChange={(event) => updateFunction(index, (item) => ({ ...item, next_node_id: event.target.value }))}
                    >
                      <option value="">Stay</option>
                      {nodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.label || node.id}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="MCP tool">
                    <input
                      value={fn.mcp_tool || ""}
                      onChange={(event) => updateFunction(index, (item) => ({ ...item, mcp_tool: event.target.value }))}
                    />
                  </Field>
                  <Field label="Required">
                    <input
                      value={(fn.required || []).join(", ")}
                      onChange={(event) =>
                        updateFunction(index, (item) => ({
                          ...item,
                          required: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        }))
                      }
                    />
                  </Field>
                  <Field label="Description" wide>
                    <input
                      value={fn.description || ""}
                      onChange={(event) =>
                        updateFunction(index, (item) => ({ ...item, description: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Parameters JSON" wide>
                    <textarea
                      rows={5}
                      value={JSON.stringify(fn.properties || {}, null, 2)}
                      onChange={(event) =>
                        updateFunction(index, (item) => ({
                          ...item,
                          properties: safeJson(event.target.value, item.properties || {}),
                        }))
                      }
                    />
                  </Field>
                </div>
                <Button icon={Trash2} variant="danger" onClick={() => removeFunction(index)}>
                  Remove
                </Button>
              </div>
            ))}
            <Button icon={Trash2} variant="danger" onClick={() => removeNode(selectedNode.id)} disabled={nodes.length <= 1}>
              Remove node
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function IntegrationsView({
  config,
  selectedIntegration,
  setSelectedIntegrationId,
  updateIntegration,
  addIntegration,
  deleteIntegration,
  modelOptions,
  loadModelOptions,
  checkMcp,
  resetMcpDefaults,
  resetIntegrationDefaults,
  save,
  saving,
}) {
  return (
    <div className="workspace-grid">
      <section className="panel main-panel">
        <div className="panel-head">
          <div>
            <h3>Providers</h3>
            <span>{config.integrations.length} integrations</span>
          </div>
          <div className="button-row">
            <select
              className="add-select"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) addIntegration(event.target.value);
                event.target.value = "";
              }}
            >
              <option value="">Add supported</option>
              {providerKinds
                .filter(([kind]) => kind !== "home_assistant_mcp")
                .map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="integration-list">
          {config.integrations.map((integration) => {
            const Icon = providerKinds.find(([id]) => id === integration.kind)?.[2] || Cloud;
            return (
              <button
                key={integration.id}
                className={
                  selectedIntegration?.id === integration.id
                    ? `integration-card active ${integration.enabled ? "enabled" : "disabled"}`
                    : `integration-card ${integration.enabled ? "enabled" : "disabled"}`
                }
                onClick={() => setSelectedIntegrationId(integration.id)}
              >
                <Icon size={20} />
                <span>
                  <strong>{integration.name}</strong>
                  <small>{integrationSummary(integration)}</small>
                </span>
                <span className={integration.enabled ? "dot on" : "dot"} />
              </button>
            );
          })}
        </div>
      </section>

      {selectedIntegration && (
        <section className="panel inspector integration-editor">
          <div className="panel-head">
            <div>
              <h3>{selectedIntegration.name}</h3>
              <span>{selectedIntegration.kind === "home_assistant_mcp" ? mcpMode(config).label : kindLabel(selectedIntegration.kind)}</span>
            </div>
            <Button
              icon={Trash2}
              variant="danger"
              onClick={() => deleteIntegration(selectedIntegration.id)}
              disabled={protectedIntegrationIds.includes(selectedIntegration.id)}
            />
          </div>

          <IntegrationIdentity integration={selectedIntegration} updateIntegration={updateIntegration} />
          <IntegrationSettings
            integration={selectedIntegration}
            config={config}
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            checkMcp={checkMcp}
            resetMcpDefaults={resetMcpDefaults}
          />
          <div className="editor-actions">
            <Button icon={RotateCcw} variant="secondary" onClick={() => resetIntegrationDefaults(selectedIntegration.id)}>
              Reset defaults
            </Button>
            <Button icon={Save} onClick={save} disabled={saving}>
              Save integration
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function IntegrationIdentity({ integration, updateIntegration }) {
  return (
    <div className="settings-section">
      <div className="section-title">
        <strong>Identity</strong>
        <span>{integration.enabled ? "enabled" : "disabled"}</span>
      </div>
      <div className="form-grid">
        <div className="wide">
          <Toggle
            checked={integration.enabled}
            onChange={(value) => updateIntegration(integration.id, (item) => ({ ...item, enabled: value }))}
            label="Enabled"
          />
        </div>
        <Field label="Name">
          <input
            value={integration.name}
            onChange={(event) => updateIntegration(integration.id, (item) => ({ ...item, name: event.target.value }))}
          />
        </Field>
      </div>
    </div>
  );
}

function IntegrationSettings({ integration, config, updateIntegration, modelOptions, loadModelOptions, checkMcp, resetMcpDefaults }) {
  if (integration.kind === "gemini") {
    return (
      <>
        <SettingsSection title="Credentials" status={secretStatus(integration, "api_key")}>
          <SecretSetting integration={integration} field="api_key" label="Gemini API key" updateIntegration={updateIntegration} />
        </SettingsSection>
        <SettingsSection title="Models">
          <ModelSetting
            integration={integration}
            field="default_realtime_model"
            label="Live model"
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            capability="realtime"
          />
          <ModelSetting
            integration={integration}
            field="default_model"
            label="Text model"
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            capability="llm"
          />
          <TextSetting integration={integration} field="default_voice" label="Voice" updateIntegration={updateIntegration} />
        </SettingsSection>
      </>
    );
  }

  if (integration.kind === "openai") {
    return (
      <>
        <SettingsSection title="Credentials" status={secretStatus(integration, "api_key")}>
          <SecretSetting integration={integration} field="api_key" label="OpenAI API key" updateIntegration={updateIntegration} />
        </SettingsSection>
        <SettingsSection title="Models">
          <ModelSetting
            integration={integration}
            field="default_realtime_model"
            label="Realtime model"
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            capability="realtime"
          />
          <ModelSetting
            integration={integration}
            field="default_model"
            label="Text model"
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            capability="llm"
          />
          <TextSetting integration={integration} field="default_voice" label="Voice" updateIntegration={updateIntegration} />
        </SettingsSection>
      </>
    );
  }

  if (integration.kind === "home_assistant_mcp") {
    const mode = mcpMode(config);
    return (
      <SettingsSection title="Home Assistant MCP" status={mode.label}>
        <div className={`mcp-mode ${mode.tone}`}>
          <strong>{mode.label}</strong>
          <span>
            {mode.label === "Automatic"
              ? "Using Home Assistant Supervisor MCP and token."
              : mode.label === "Manual"
                ? "Manual URL or token override is configured."
                : "MCP token is not available."}
          </span>
        </div>
        <div className="runtime-facts wide">
          <span>{config.effective_mcp_url}</span>
          <strong>{config.mcp_token_source || "no token"}</strong>
        </div>
        <TextSetting integration={integration} field="base_url" label="Manual MCP URL" updateIntegration={updateIntegration} wide />
        <SecretSetting integration={integration} field="token" label="Manual access token" updateIntegration={updateIntegration} wide />
        <div className="button-row wide">
          <Button icon={RefreshCw} variant="secondary" onClick={checkMcp}>
            Test MCP
          </Button>
          <Button icon={RotateCcw} variant="secondary" onClick={resetMcpDefaults}>
            Automatic defaults
          </Button>
        </div>
      </SettingsSection>
    );
  }

  if (["soniox", "deepgram", "gradium", "speechmatics"].includes(integration.kind)) {
    return (
      <SettingsSection title={kindLabel(integration.kind)} status={secretStatus(integration, "api_key")}>
        <SecretSetting integration={integration} field="api_key" label="API key" updateIntegration={updateIntegration} />
        <TextSetting integration={integration} field="default_model" label="STT model" updateIntegration={updateIntegration} />
        {integration.kind === "soniox" && (
          <TextSetting integration={integration} field="default_voice" label="TTS voice" updateIntegration={updateIntegration} />
        )}
      </SettingsSection>
    );
  }

  if (["cartesia", "elevenlabs"].includes(integration.kind)) {
    return (
      <SettingsSection title={kindLabel(integration.kind)} status={secretStatus(integration, "api_key")}>
        <SecretSetting integration={integration} field="api_key" label="API key" updateIntegration={updateIntegration} />
        <TextSetting integration={integration} field="default_model" label="TTS model" updateIntegration={updateIntegration} />
        <TextSetting integration={integration} field="default_voice" label="Voice" updateIntegration={updateIntegration} />
      </SettingsSection>
    );
  }

  if (integration.kind === "google_cloud_tts") {
    return (
      <>
        <SettingsSection title="Google Cloud TTS" status={secretStatus(integration, "credentials_json")}>
          <TextSetting integration={integration} field="credentials_path" label="Credentials path" updateIntegration={updateIntegration} wide />
          <SecretSetting integration={integration} field="credentials_json" label="Credentials JSON" updateIntegration={updateIntegration} wide />
          <TextSetting integration={integration} field="location" label="Location" updateIntegration={updateIntegration} />
        </SettingsSection>
        <SettingsSection title="Voice">
          <TextSetting integration={integration} field="default_voice" label="Voice" updateIntegration={updateIntegration} />
        </SettingsSection>
      </>
    );
  }

  if (integration.kind === "aws_nova_sonic") {
    return (
      <>
        <SettingsSection title="AWS Nova Sonic">
          <TextSetting integration={integration} field="region" label="Region" updateIntegration={updateIntegration} />
          <TextSetting integration={integration} field="default_realtime_model" label="Realtime model" updateIntegration={updateIntegration} />
          <TextSetting integration={integration} field="default_voice" label="Voice" updateIntegration={updateIntegration} />
        </SettingsSection>
        <SettingsSection title="Credentials" status={secretStatus(integration, "secret_key")}>
          <SecretSetting integration={integration} field="access_key_id" label="Access key" updateIntegration={updateIntegration} />
          <SecretSetting integration={integration} field="secret_key" label="Secret key" updateIntegration={updateIntegration} />
          <SecretSetting integration={integration} field="token" label="Session token" updateIntegration={updateIntegration} />
        </SettingsSection>
      </>
    );
  }

  if (integration.kind === "openai_compatible") {
    return (
      <>
        <SettingsSection title="Endpoint">
          <TextSetting integration={integration} field="base_url" label="Base URL" updateIntegration={updateIntegration} wide />
          <SecretSetting integration={integration} field="api_key" label="API key" updateIntegration={updateIntegration} />
        </SettingsSection>
        <SettingsSection title="Models">
          <TextSetting integration={integration} field="default_model" label="Text model" updateIntegration={updateIntegration} />
          <TextSetting integration={integration} field="default_realtime_model" label="Realtime model" updateIntegration={updateIntegration} />
        </SettingsSection>
      </>
    );
  }

  if (integration.kind === "ollama") {
    return (
      <SettingsSection title="Local model server">
        <TextSetting integration={integration} field="base_url" label="Base URL" updateIntegration={updateIntegration} wide />
        <TextSetting integration={integration} field="default_model" label="Model" updateIntegration={updateIntegration} />
      </SettingsSection>
    );
  }

  if (integration.kind === "local_runtime") {
    return (
      <SettingsSection title="Local runtime">
        <TextSetting integration={integration} field="base_url" label="Base URL" updateIntegration={updateIntegration} />
        <TextSetting integration={integration} field="endpoint" label="Endpoint" updateIntegration={updateIntegration} />
        <TextSetting integration={integration} field="default_model" label="Model" updateIntegration={updateIntegration} />
        <TextSetting integration={integration} field="default_voice" label="Voice" updateIntegration={updateIntegration} />
      </SettingsSection>
    );
  }

  if (integration.kind === "azure_openai") {
    return (
      <>
        <SettingsSection title="Azure endpoint" status={secretStatus(integration, "api_key")}>
          <TextSetting integration={integration} field="endpoint" label="Endpoint" updateIntegration={updateIntegration} wide />
          <SecretSetting integration={integration} field="api_key" label="API key" updateIntegration={updateIntegration} />
          <TextSetting integration={integration} field="deployment" label="Deployment" updateIntegration={updateIntegration} />
        </SettingsSection>
        <SettingsSection title="Models">
          <TextSetting integration={integration} field="default_realtime_model" label="Realtime model" updateIntegration={updateIntegration} />
          <TextSetting integration={integration} field="default_model" label="Text model" updateIntegration={updateIntegration} />
          <TextSetting integration={integration} field="default_voice" label="Voice" updateIntegration={updateIntegration} />
        </SettingsSection>
      </>
    );
  }

  if (integration.kind === "anthropic") {
    return (
      <SettingsSection title="Anthropic" status={secretStatus(integration, "api_key")}>
        <SecretSetting integration={integration} field="api_key" label="API key" updateIntegration={updateIntegration} />
        <TextSetting integration={integration} field="default_model" label="Model" updateIntegration={updateIntegration} />
      </SettingsSection>
    );
  }

  if (integration.kind === "aws_bedrock") {
    return (
      <>
        <SettingsSection title="AWS">
          <TextSetting integration={integration} field="region" label="Region" updateIntegration={updateIntegration} />
          <TextSetting integration={integration} field="default_model" label="Model" updateIntegration={updateIntegration} />
        </SettingsSection>
        <SettingsSection title="Credentials" status={secretStatus(integration, "secret_key")}>
          <SecretSetting integration={integration} field="access_key_id" label="Access key" updateIntegration={updateIntegration} />
          <SecretSetting integration={integration} field="secret_key" label="Secret key" updateIntegration={updateIntegration} />
        </SettingsSection>
      </>
    );
  }

  return (
    <SettingsSection title={kindLabel(integration.kind)}>
      <TextSetting integration={integration} field="base_url" label="Base URL" updateIntegration={updateIntegration} />
      <SecretSetting integration={integration} field="api_key" label="API key" updateIntegration={updateIntegration} />
      <TextSetting integration={integration} field="default_model" label="Model" updateIntegration={updateIntegration} />
    </SettingsSection>
  );
}

function SettingsSection({ title, status, children }) {
  return (
    <div className="settings-section">
      <div className="section-title">
        <strong>{title}</strong>
        {status && <span>{status}</span>}
      </div>
      <div className="form-grid">{children}</div>
    </div>
  );
}

function TextSetting({ integration, field, label, updateIntegration, wide = false }) {
  return (
    <Field label={label} wide={wide}>
      <input
        autoComplete="off"
        value={integration[field] || ""}
        onChange={(event) => updateIntegration(integration.id, (item) => ({ ...item, [field]: event.target.value }))}
      />
    </Field>
  );
}

function ModelSetting({
  integration,
  field,
  label,
  updateIntegration,
  modelOptions,
  loadModelOptions,
  capability = "llm",
  wide = false,
}) {
  const key = `${integration.id}:${capability}`;
  const options = modelOptions?.[key] || [];
  const listId = `models-${integration.id}-${field}-${capability}`;
  return (
    <Field label={label} wide={wide}>
      <input
        autoComplete="off"
        list={listId}
        value={integration[field] || ""}
        onFocus={() => loadModelOptions?.(integration.id, capability)}
        onChange={(event) => updateIntegration(integration.id, (item) => ({ ...item, [field]: event.target.value }))}
      />
      <datalist id={listId}>
        {options.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </datalist>
    </Field>
  );
}

function SecretSetting({ integration, field, label, updateIntegration, wide = false }) {
  const [editing, setEditing] = useState(secretStatus(integration, field) !== "configured");
  const configured = secretStatus(integration, field) === "configured";

  useEffect(() => {
    setEditing(secretStatus(integration, field) !== "configured");
  }, [integration.id, field, integration[`${field}_configured`]]);

  if (configured && !editing) {
    return (
      <Field label={label} wide={wide}>
        <div className="locked-secret">
          <input value="configured" readOnly />
          <Button icon={RotateCcw} variant="secondary" onClick={() => setEditing(true)}>
            Replace
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} wide={wide}>
      <input
        type="password"
        autoComplete="new-password"
        value={secretValue(integration[field])}
        placeholder={secretPlaceholder(integration, field)}
        onChange={(event) => updateIntegration(integration.id, (item) => ({ ...item, [field]: event.target.value }))}
      />
    </Field>
  );
}

function offerPath(config) {
  if (config.runner_offer_path) return appUrl(config.runner_offer_path);
  try {
    const url = new URL(config.runner_offer_url || "api/offer", window.location.href);
    const token = url.searchParams.get("token");
    return appUrl(`api/offer${token ? `?token=${encodeURIComponent(token)}` : ""}`);
  } catch {
    return appUrl("api/offer");
  }
}

function waitForIceGatheringComplete(peerConnection, timeoutMs = 2500) {
  if (peerConnection.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    let done = false;
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peerConnection.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (peerConnection.iceGatheringState === "complete") finish();
    };
    timer = setTimeout(finish, timeoutMs);
    peerConnection.addEventListener("icegatheringstatechange", onChange);
  });
}

function flowModelIntegration(config, flow) {
  const modelStep = flow.steps?.find((step) => step.kind === "llm" && step.enabled);
  const integrationId = modelStep?.integration_id || flow.provider_id;
  return (
    config.integrations.find((integration) => integration.id === integrationId) ||
    config.integrations.find((integration) => integration.kind === integrationId) ||
    null
  );
}

function voiceReadiness(config, flow) {
  const validation = validatePipeline(config, flow);
  if (!validation.ok) return { ok: false, detail: validation.errors[0] };

  const integration = flowModelIntegration(config, flow);
  if (!integration) {
    return { ok: false, detail: "Selected pipeline has no model integration." };
  }

  if (!integration.enabled) {
    return { ok: false, detail: `${integration.name} is disabled.` };
  }

  const keyStatus = ["gemini", "openai"].includes(integration.kind)
    ? secretStatus(integration, "api_key")
    : "configured";
  if (flow.mode === "realtime" && keyStatus === "missing") {
    return {
      ok: false,
      detail: `${integration.name} API key is missing. Add it in Integrations, save, then retry.`,
    };
  }
  if (flow.mode === "realtime" && keyStatus === "pending") {
    return {
      ok: false,
      detail: `Save configuration before starting the voice test; the add-on cannot use the new ${integration.name} key yet.`,
    };
  }

  const mcp = config.integrations.find((item) => item.kind === "home_assistant_mcp");
  if (flow.mcp_enabled && config.mcp_token_source === "supervisor" && secretStatus(mcp, "token") === "missing") {
    return {
      ok: true,
      detail: "Ready. MCP will use the Home Assistant Supervisor token.",
    };
  }
  if (flow.mcp_enabled && secretStatus(mcp, "token") === "missing" && !config.longlived_token_configured) {
    return {
      ok: true,
      detail: "Ready. Home Assistant MCP token is missing, so device tools may be unavailable.",
    };
  }

  return { ok: true, detail: `Ready for ${flow.name}.` };
}

async function offerErrorMessage(response) {
  const body = await response.text();
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    detail = parsed.detail || parsed.error || body;
  } catch {
    detail = body;
  }

  if (response.status === 401) {
    return "SmallWebRTC offer token was rejected. Reload the panel and retry after saving configuration.";
  }
  return detail || `SmallWebRTC offer failed with HTTP ${response.status}.`;
}

function friendlyWebRtcError(err) {
  const message = err?.message || String(err);
  if (message === "Failed to fetch") {
    return "Could not reach the SmallWebRTC offer endpoint. Check that the add-on is running in Home Assistant Ingress.";
  }
  return message;
}

function mcpStatusLabel(config, status) {
  const source = status?.mcp_token_source || config.mcp_token_source || "";
  if (source === "integration" || source === "long-lived") return "token ready";
  if (source === "supervisor") return "supervisor token";
  return "token pending";
}

function VoiceTest({ config, flow }) {
  const audioRef = useRef(null);
  const channelRef = useRef(null);
  const closingRef = useRef(false);
  const pingRef = useRef(null);
  const peerRef = useRef(null);
  const readySentRef = useRef(false);
  const streamRef = useRef(null);
  const trackReadyRef = useRef(false);
  const [state, setState] = useState("idle");
  const [detail, setDetail] = useState("Ready");
  const readiness = voiceReadiness(config, flow);

  useEffect(() => () => disposeSession(), []);

  useEffect(() => {
    if (state === "error" && readiness.ok) {
      setState("idle");
      setDetail("Ready");
    }
  }, [readiness.ok, state]);

  function disposeSession() {
    closingRef.current = true;
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
    if (channelRef.current?.readyState === "open") {
      channelRef.current.send(
        JSON.stringify({
          label: "rtvi-ai",
          id: crypto.randomUUID().slice(0, 8),
          type: "disconnect-bot",
          data: {},
        }),
      );
    }
    channelRef.current?.close();
    channelRef.current = null;
    readySentRef.current = false;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    trackReadyRef.current = false;
    if (audioRef.current) audioRef.current.srcObject = null;
  }

  function clearSession(nextState = "idle", nextDetail = "Ready") {
    disposeSession();
    setState(nextState);
    setDetail(nextDetail);
    window.setTimeout(() => {
      closingRef.current = false;
    }, 0);
  }

  function stopVoiceTest(updateState = true) {
    clearSession(updateState ? "idle" : state, updateState ? "Stopped" : detail);
  }

  async function startVoiceTest() {
    const currentReadiness = voiceReadiness(config, flow);
    if (!currentReadiness.ok) {
      setState("error");
      setDetail(currentReadiness.detail);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setDetail("This browser cannot access a microphone from the current context.");
      return;
    }

    clearSession("requesting", "Waiting for microphone permission");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      streamRef.current = stream;

      const peerConnection = new RTCPeerConnection();
      peerRef.current = peerConnection;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        peerConnection.addTransceiver(audioTrack, { direction: "sendrecv" });
      } else {
        peerConnection.addTransceiver("audio", { direction: "sendrecv" });
      }

      const channel = peerConnection.createDataChannel("signalling");
      channelRef.current = channel;
      const sendClientReady = () => {
        if (!trackReadyRef.current || readySentRef.current || channel.readyState !== "open") return;
        channel.send(
          JSON.stringify({
            label: "rtvi-ai",
            id: crypto.randomUUID().slice(0, 8),
            type: "client-ready",
            data: {
              version: "1.4.0",
              about: {
                library: "pipecat-assist-ui",
                library_version: "0.1.18",
                platform: "browser",
              },
            },
          }),
        );
        readySentRef.current = true;
      };
      channel.onopen = () => {
        pingRef.current = window.setInterval(() => {
          if (channel.readyState === "open") channel.send(`ping ${Date.now()}`);
        }, 1000);
        sendClientReady();
      };

      peerConnection.ontrack = (event) => {
        if (event.track.kind !== "audio") return;
        if (!audioRef.current) return;
        audioRef.current.srcObject = event.streams[0] || new MediaStream([event.track]);
        audioRef.current.play().catch(() => {});
        trackReadyRef.current = true;
        sendClientReady();
      };

      peerConnection.onconnectionstatechange = () => {
        const next = peerConnection.connectionState;
        if (next === "connected") {
          setState("connected");
          setDetail("Connected. Speak to the selected assistant.");
        }
        if (["failed", "disconnected", "closed"].includes(next) && !closingRef.current) {
          clearSession(
            next === "failed" ? "error" : "idle",
            next === "failed"
              ? "WebRTC failed after the offer was accepted. Check the add-on logs for provider or model errors."
              : `WebRTC ${next}`,
          );
        }
      };

      setState("connecting");
      setDetail("Creating WebRTC offer");
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);

      const response = await fetch(offerPath(config), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: peerConnection.localDescription.sdp,
          type: peerConnection.localDescription.type,
          request_data: {
            flow_id: flow.id,
            source: "ui_voice_test",
          },
        }),
      });

      if (!response.ok) {
        throw new Error(await offerErrorMessage(response));
      }

      const answer = await response.json();
      await peerConnection.setRemoteDescription({
        sdp: answer.sdp,
        type: answer.type,
      });
      setDetail("Connecting audio");
    } catch (err) {
      clearSession("error", friendlyWebRtcError(err));
    }
  }

  const running = ["requesting", "connecting", "connected"].includes(state);
  const stateLabel = state === "idle" && !readiness.ok ? "Setup needed" : {
    connected: "Connected",
    connecting: "Connecting",
    error: "Needs attention",
    idle: "Idle",
    requesting: "Microphone",
  }[state];
  const displayDetail = state === "idle" ? readiness.detail : detail;
  const startDisabled = state === "idle" && !readiness.ok;

  return (
    <div className="voice-test voice-kit">
      <div className="voice-visualizer" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map((item) => (
          <span key={item} className={running ? "active" : ""} style={{ "--delay": `${item * 90}ms` }} />
        ))}
      </div>
      <div className="voice-copy">
        <strong>{stateLabel}</strong>
        <span>{displayDetail}</span>
        <audio ref={audioRef} autoPlay controls />
      </div>
      <div className="voice-controlbar">
        <Button
          icon={running ? X : Mic2}
          variant={running ? "danger" : "primary"}
          onClick={running ? () => stopVoiceTest() : startVoiceTest}
          disabled={startDisabled}
        >
          {running ? "Stop voice test" : "Start voice test"}
        </Button>
      </div>
    </div>
  );
}

function AudioDebugPanel({
  config,
  audioDebug,
  refreshAudioDebug,
  clearAudioDebug,
  updateConfig,
}) {
  const recordings = audioDebug?.recordings || [];

  return (
    <>
      <div className="panel-head">
        <div>
          <h3>Audio debug</h3>
          <span>{audioDebug?.enabled ? "enabled" : `${recordings.length} sessions`}</span>
        </div>
        <div className="button-row">
          <Button icon={RefreshCw} variant="secondary" onClick={refreshAudioDebug}>
            Refresh
          </Button>
          <Button icon={Trash2} variant="danger" onClick={clearAudioDebug} disabled={!recordings.length}>
            Clear
          </Button>
        </div>
      </div>
      <div className="form-grid">
        <Toggle
          checked={config.audio_debug_enabled}
          onChange={(value) => updateConfig((draft) => ({ ...draft, audio_debug_enabled: value }))}
          label="Record audio in/out"
        />
        <Field label="Keep sessions">
          <input
            type="number"
            min="1"
            max="100"
            value={config.audio_debug_keep_sessions || 10}
            onChange={(event) =>
              updateConfig((draft) => ({
                ...draft,
                audio_debug_keep_sessions: Math.min(100, Math.max(1, Number(event.target.value || 1))),
              }))
            }
          />
        </Field>
      </div>
      <div className="recording-list">
        {recordings.length ? (
          recordings.map((recording) => (
            <div className="recording-row" key={recording.id}>
              <div className="recording-meta">
                <strong>{formatTimestamp(recording.started_at)}</strong>
                <span>
                  {[recording.flow_name || recording.flow_id, recording.provider, recording.model]
                    .filter(Boolean)
                    .join(" / ")}
                </span>
              </div>
              <div className="recording-actions">
                <AudioDebugDownload file={recording.input} label="Input" />
                <AudioDebugDownload file={recording.output} label="Output" />
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">No audio captures</div>
        )}
      </div>
    </>
  );
}

function AudioDebugDownload({ file, label }) {
  if (!file) {
    return <span className="recording-empty">{label}: pending</span>;
  }
  return (
    <a className="button secondary" href={appUrl(file.url)} download={file.filename}>
      <Download size={16} strokeWidth={2} />
      <span>
        {label} ({formatBytes(file.size)})
      </span>
    </a>
  );
}

function RuntimeView({
  config,
  audioDebug,
  refreshAudioDebug,
  clearAudioDebug,
  updateConfig,
  save,
  saving,
}) {
  return (
    <div className="workspace-grid">
      <section className="panel main-panel">
        <AudioDebugPanel
          config={config}
          audioDebug={audioDebug}
          refreshAudioDebug={refreshAudioDebug}
          clearAudioDebug={clearAudioDebug}
          updateConfig={updateConfig}
        />
        <div className="editor-actions">
          <Button icon={Save} onClick={save} disabled={saving}>
            Save runtime
          </Button>
        </div>
      </section>

      <section className="panel inspector">
        <div className="panel-head">
          <div>
            <h3>Add-on runtime</h3>
            <span>Managed by Home Assistant</span>
          </div>
        </div>
        <div className="runtime-facts stacked">
          <span>Runner port is configured in Home Assistant add-on options.</span>
          <strong>{config.runner_port || 7860}</strong>
          <span>ESP32 mode is also managed by Home Assistant add-on options.</span>
          <strong>{config.esp32_mode ? "enabled" : "disabled"}</strong>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
