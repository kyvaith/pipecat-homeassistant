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
  Database,
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
  Search,
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

const UI_TRANSLATIONS = {
  pl: {
    "Assistant": "Asystent",
    "Pipelines": "Pipeline'y",
    "Integrations": "Integracje",
    "Runtime": "Runtime",
    "ready": "gotowy",
    "setup needed": "wymagana konfiguracja",
    "Back to pipeline": "Wróć do pipeline",
    "Back to pipelines": "Wróć do pipeline'ów",
    "Back to integrations": "Wróć do integracji",
    "Light mode": "Tryb jasny",
    "Dark mode": "Tryb ciemny",
    "Loading": "Ładowanie",
    "Interface did not load": "Interfejs się nie załadował",
    "Retry": "Ponów",
    "Add pipeline": "Dodaj pipeline",
    "Set active": "Ustaw aktywny",
    "Active": "Aktywny",
    "Duplicate": "Duplikuj",
    "Delete": "Usuń",
    "Save": "Zapisz",
    "Save pipeline": "Zapisz pipeline",
    "Save integration": "Zapisz integrację",
    "Save runtime": "Zapisz runtime",
    "Reset defaults": "Przywróć domyślne",
    "Pipeline is valid.": "Pipeline jest poprawny.",
    "Ready": "Gotowy",
    "Setup needed": "Wymagana konfiguracja",
    "Connected": "Połączono",
    "Connecting": "Łączenie",
    "Needs attention": "Wymaga uwagi",
    "Idle": "Bezczynny",
    "Microphone": "Mikrofon",
    "Start voice test": "Rozpocznij test głosu",
    "Stop voice test": "Zatrzymaj test głosu",
    "Edit active pipeline": "Edytuj aktywny pipeline",
    "The easiest way to get started is with Gemini Live.": "Najłatwiej zacząć od Gemini Live.",
    "Google AI Studio": "Google AI Studio",
    "Integration": "Integracja",
    "Step enabled": "Krok aktywny",
    "Instructions": "Instrukcje",
    "No greeting": "Bez powitania",
    "Greeting": "Powitanie",
    "Announce web search": "Zapowiadaj web search",
    "Enabled": "Włączone",
    "Name": "Nazwa",
    "Cloud LLM provider": "Provider Cloud LLM",
    "Search model": "Model wyszukiwania",
    "Home Assistant actions": "Akcje Home Assistant",
    "Audio debug": "Debug audio",
    "Refresh": "Odśwież",
    "Clear": "Wyczyść",
    "Record audio in/out": "Nagrywaj audio wej./wyj.",
    "Session memory": "Pamięć sesji",
    "Memory reuse": "Ponowne użycie pamięci",
    "Memory messages": "Wiadomości pamięci",
    "MCP tools cache": "Cache narzędzi MCP",
    "MCP cache TTL": "TTL cache MCP",
  },
};

function detectLocale() {
  const candidates = [
    document.documentElement.lang,
    window.localStorage.getItem("selectedLanguage"),
    window.localStorage.getItem("language"),
    navigator.language,
    ...(navigator.languages || []),
  ].filter(Boolean);
  return candidates.some((value) => String(value).toLowerCase().startsWith("pl")) ? "pl" : "en";
}

const UI_LOCALE = detectLocale();

function t(value) {
  return UI_TRANSLATIONS[UI_LOCALE]?.[value] || value;
}

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
  mcpHistory: appUrl("api/assist/mcp/history"),
  mcpReset: appUrl("api/assist/mcp/reset"),
  audioDebug: appUrl("api/assist/debug/audio"),
  integrationReset: (integrationId) =>
    appUrl(`api/assist/integrations/${encodeURIComponent(integrationId)}/reset`),
  models: (integrationId, capability = "llm") =>
    appUrl(`api/assist/integrations/${encodeURIComponent(integrationId)}/models?capability=${encodeURIComponent(capability)}`),
};

const REDACTED = "__redacted__";
const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const GEMINI_LIVE_MODEL = "models/gemini-3.1-flash-live-preview";
const GEMINI_LIVE_VOICE = "Charon";
const OPENAI_TEXT_MODEL = "gpt-5.4-mini";
const OPENAI_REALTIME_MODEL = "gpt-realtime-2";
const OPENAI_REALTIME_VOICE = "marin";
const OPENAI_STT_MODEL = "gpt-4o-mini-transcribe";
const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const OPENAI_TTS_VOICE = "marin";
const CARTESIA_MODEL = "sonic-3.5";
const CARTESIA_VOICE = "f786b574-daa5-4673-aa0c-cbe3e8534c02";
const ELEVENLABS_MODEL = "eleven_flash_v2_5";
const ELEVENLABS_VOICE = "Xb7hH8MSUJpSbSDYk0k2";
const GOOGLE_TTS_VOICE = "en-US-Chirp3-HD-Charon";
const AWS_NOVA_SONIC_MODEL = "amazon.nova-2-sonic-v1:0";
const AWS_NOVA_SONIC_VOICE = "matthew";
const AWS_BEDROCK_MODEL = "amazon.nova-pro-v1:0";
const DEEPGRAM_MODEL = "nova-3";
const SONIOX_MODEL = "stt-rt-v5";
const SPEECHMATICS_MODEL = "enhanced";
const WEB_SEARCH_MODEL = "gpt-5.5";
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
  ["openai", "OpenAI Realtime", Radio],
  ["openai_cloud", "OpenAI Cloud", Cloud],
  ["gemini", "Google Gemini Live", Radio],
  ["gemini_cloud", "Google Gemini Cloud", Cloud],
  ["google_cloud_tts", "Google Cloud TTS HTTP fallback", Cloud],
  ["google_streaming_tts", "Google Cloud TTS Streaming", Radio],
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
  ["web_search", "Web Search", Search],
  ["home_assistant_mcp", "Home Assistant MCP", Home],
];

const protectedIntegrationIds = ["gemini", "gemini-cloud", "openai", "openai-cloud", "ha-mcp", "web-search"];

const languageIntegrationKinds = [
  "gemini",
  "gemini_cloud",
  "openai",
  "openai_cloud",
  "soniox",
  "deepgram",
  "gradium",
  "speechmatics",
  "openai_compatible",
  "ollama",
  "local_runtime",
];

const speedIntegrationKinds = ["openai", "openai_cloud", "google_cloud_tts", "elevenlabs"];
const ttsStreamingIntegrationKinds = ["cartesia", "elevenlabs", "soniox", "gradium", "google_streaming_tts"];
const webSearchProviderKinds = ["openai_cloud", "gemini_cloud", "openai_compatible"];

const stepTypes = [
  ["transport", "Transport", Radio, "neutral"],
  ["memory", "Memory", Database, "green"],
  ["vad", "Turn", Mic2, "amber"],
  ["stt", "STT", Mic2, "blue"],
  ["llm", "Model", Bot, "violet"],
  ["web_search", "Web Search", Search, "blue"],
  ["tools", "Tools", Wrench, "green"],
  ["flow", "Pipecat Flow", Workflow, "rose"],
  ["tts", "TTS", Volume2, "mint"],
  ["output", "Output", Volume2, "neutral"],
];

const addableStepTypes = stepTypes.filter(([kind]) => !["transport", "output"].includes(kind));

const stepProviders = {
  stt: ["soniox", "deepgram", "speechmatics", "gradium", "openai_cloud"],
  llm: ["openai_cloud", "gemini_cloud", "aws_bedrock", "openai_compatible", "ollama"],
  tts: ["cartesia", "gradium", "google_cloud_tts", "google_streaming_tts", "elevenlabs", "openai_cloud", "soniox"],
  tools: ["home_assistant_mcp"],
  web_search: ["web_search"],
  output: ["gemini", "openai", "aws_nova_sonic"],
};
const runtimeStepOrder = ["transport", "memory", "vad", "stt", "llm", "web_search", "tools", "flow", "tts", "output"];

function allowedProvidersForStep(kind, mode) {
  if (kind === "llm" && mode === "realtime") return ["gemini", "openai", "aws_nova_sonic"];
  if (kind === "output" && mode === "composed") return [];
  return stepProviders[kind] || null;
}

function canUseIntegrationForStep(kind, integration, mode) {
  const allowed = allowedProvidersForStep(kind, mode);
  return !allowed || allowed.includes(integration.kind);
}

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
      ["memory", "memory", "Session memory", ""],
      ["vad", "vad", "Gemini VAD", ""],
      ["llm", "llm", "Live model", "gemini"],
      ["web_search", "web_search", "Web Search", "web-search"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
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
      ["memory", "memory", "Session memory", ""],
      ["vad", "vad", "Semantic VAD", ""],
      ["llm", "llm", "Realtime model", "openai"],
      ["web_search", "web_search", "Web Search", "web-search"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
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
      ["memory", "memory", "Session memory", ""],
      ["vad", "vad", "Nova Sonic VAD", ""],
      ["llm", "llm", "Nova Sonic", "aws-nova-sonic"],
      ["web_search", "web_search", "Web Search", "web-search"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["output", "output", "Native audio", "aws-nova-sonic"],
    ],
  },
  {
    id: "soniox_openai_cartesia",
    label: "Soniox + OpenAI + Cartesia",
    icon: Workflow,
    group: "Composed realtime",
    mode: "composed",
    provider: "openai-cloud",
    accent: "mint",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["memory", "memory", "Session memory", ""],
      ["vad", "vad", "Turn detection", ""],
      ["stt", "stt", "Soniox STT", "soniox"],
      ["llm", "llm", "OpenAI LLM", "openai-cloud"],
      ["web_search", "web_search", "Web Search", "web-search"],
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
    provider: "openai-cloud",
    accent: "mint",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["memory", "memory", "Session memory", ""],
      ["vad", "vad", "Turn detection", ""],
      ["stt", "stt", "Soniox STT", "soniox"],
      ["llm", "llm", "OpenAI LLM", "openai-cloud"],
      ["web_search", "web_search", "Web Search", "web-search"],
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
    provider: "gemini-cloud",
    accent: "blue",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["memory", "memory", "Session memory", ""],
      ["vad", "vad", "Turn detection", ""],
      ["stt", "stt", "Deepgram STT", "deepgram"],
      ["llm", "llm", "Gemini Cloud LLM", "gemini-cloud"],
      ["web_search", "web_search", "Web Search", "web-search"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["tts", "tts", "Google TTS Streaming", "google-streaming-tts"],
      ["output", "output", "Audio output", ""],
    ],
  },
  {
    id: "deepgram_google_google_tts",
    label: "Deepgram + Google + Google TTS",
    icon: Workflow,
    group: "Composed realtime",
    mode: "composed",
    provider: "gemini-cloud",
    accent: "blue",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["memory", "memory", "Session memory", ""],
      ["vad", "vad", "Turn detection", ""],
      ["stt", "stt", "Deepgram STT", "deepgram"],
      ["llm", "llm", "Gemini Cloud LLM", "gemini-cloud"],
      ["web_search", "web_search", "Web Search", "web-search"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["tts", "tts", "Google TTS Streaming", "google-streaming-tts"],
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
      ["memory", "memory", "Session memory", ""],
      ["vad", "vad", "Turn detection", ""],
      ["stt", "stt", "Speechmatics STT", "speechmatics"],
      ["llm", "llm", "AWS Nova Pro", "bedrock"],
      ["web_search", "web_search", "Web Search", "web-search"],
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
    provider: "gemini-cloud",
    accent: "blue",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["memory", "memory", "Session memory", ""],
      ["vad", "vad", "Turn detection", ""],
      ["stt", "stt", "Cloud STT", "deepgram"],
      ["llm", "llm", "Cloud LLM", "gemini-cloud"],
      ["web_search", "web_search", "Web Search", "web-search"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["flow", "flow", "Pipecat Flow", ""],
      ["tts", "tts", "Cloud TTS", "google-streaming-tts"],
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
      ["memory", "memory", "Session memory", ""],
      ["vad", "vad", "Local VAD", "local-runtime"],
      ["stt", "stt", "Local STT", "local-runtime"],
      ["llm", "llm", "Local LLM", "ollama"],
      ["web_search", "web_search", "Web Search", "web-search"],
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
  language: "en",
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
  memory_enabled: true,
  web_search_enabled: false,
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

const FLOW_SCHEMA_ID = "https://flows.pipecat.ai/schema/flow.json";

const officialMinimalFlow = {
  $id: FLOW_SCHEMA_ID,
  meta: { name: "Minimal", version: "0.1.0", description: "Minimal initial to end flow" },
  nodes: [
    {
      id: "initial",
      type: "initial",
      position: { x: 80, y: 120 },
      data: {
        label: "Initial",
        task_messages: [{ role: "system", content: "Hello! This is a minimal flow." }],
        functions: [{ name: "done", description: "Continue to end", next_node_id: "end" }],
      },
    },
    {
      id: "end",
      type: "end",
      position: { x: 390, y: 120 },
      data: {
        label: "End",
        task_messages: [{ role: "system", content: "Thank you and goodbye." }],
        post_actions: [{ type: "end_conversation" }],
      },
    },
  ],
  edges: [{ id: "func-initial-done-end", source: "initial", target: "end", label: "done" }],
};

const officialFoodOrderingFlow = {
  $id: FLOW_SCHEMA_ID,
  meta: {
    name: "Food Ordering",
    version: "0.1.0",
    description: "Initial to Pizza/Sushi branch, confirm, and end",
  },
  nodes: [
    {
      id: "initial",
      type: "initial",
      position: { x: 80, y: 150 },
      data: {
        label: "Initial",
        role_messages: [
          {
            role: "system",
            content:
              "You are a helpful food ordering assistant. You must always use the available functions to progress the conversation.",
          },
        ],
        task_messages: [
          {
            role: "system",
            content: "Welcome the user warmly and ask if they would like to order pizza or sushi today.",
          },
        ],
        functions: [
          { name: "choose_pizza", description: "User wants to order pizza", next_node_id: "pizza_task" },
          { name: "choose_sushi", description: "User wants to order sushi", next_node_id: "sushi_task" },
        ],
      },
    },
    {
      id: "pizza_task",
      type: "node",
      position: { x: 390, y: 70 },
      data: {
        label: "Pizza Task",
        task_messages: [
          {
            role: "system",
            content:
              "Ask what size and type of pizza the user wants. Use select_pizza_order when they provide both size and type. Pricing: small $10, medium $15, large $20.",
          },
        ],
        functions: [
          {
            name: "select_pizza_order",
            description: "Record pizza order details",
            properties: {
              size: { type: "string", enum: ["small", "medium", "large"], description: "Pizza size" },
              type: {
                type: "string",
                enum: ["pepperoni", "cheese", "supreme", "vegetarian"],
                description: "Pizza type",
              },
            },
            required: ["size", "type"],
            next_node_id: "confirm",
          },
        ],
      },
    },
    {
      id: "sushi_task",
      type: "node",
      position: { x: 390, y: 230 },
      data: {
        label: "Sushi Task",
        task_messages: [
          {
            role: "system",
            content:
              "Ask how many rolls and what type of sushi the user wants. Use select_sushi_order when they provide both count and type. Pricing: $8 per roll.",
          },
        ],
        functions: [
          {
            name: "select_sushi_order",
            description: "Record sushi order details",
            properties: {
              count: { type: "integer", minimum: 1, maximum: 10, description: "Number of rolls" },
              type: {
                type: "string",
                enum: ["california", "spicy tuna", "rainbow", "dragon"],
                description: "Sushi type",
              },
            },
            required: ["count", "type"],
            next_node_id: "confirm",
          },
        ],
      },
    },
    {
      id: "confirm",
      type: "node",
      position: { x: 710, y: 150 },
      data: {
        label: "Confirm",
        task_messages: [
          {
            role: "system",
            content:
              "Read the order details back to the user. Use complete_order if they confirm, or revise_order if they want to make changes.",
          },
        ],
        functions: [
          { name: "complete_order", description: "User confirms the order is correct", next_node_id: "end" },
          { name: "revise_order", description: "User wants to change the order", next_node_id: "initial" },
        ],
      },
    },
    {
      id: "end",
      type: "end",
      position: { x: 1030, y: 150 },
      data: {
        label: "End",
        task_messages: [{ role: "system", content: "Thank the user for their order and end politely." }],
        post_actions: [{ type: "end_conversation" }],
      },
    },
  ],
  edges: [],
};

const officialHomePizzaFlow = {
  $id: FLOW_SCHEMA_ID,
  meta: {
    name: "Home Pizza via MCP",
    version: "0.1.0",
    description: "Guided pizza order that can finish by calling a Home Assistant MCP tool",
  },
  nodes: [
    {
      id: "home_router",
      type: "initial",
      position: { x: 80, y: 140 },
      data: {
        label: "Home Router",
        role_messages: [
          {
            role: "system",
            content:
              "You are a realtime Home Assistant voice agent. Speak naturally and briefly. Use Home Assistant MCP tools only when the user clearly asks to control, inspect, or automate the home.",
          },
        ],
        task_messages: [
          {
            role: "system",
            content:
              "Handle normal smart-home requests. If the user wants pizza, call start_pizza_order and guide the dedicated ordering flow.",
          },
        ],
        functions: [
          {
            name: "start_pizza_order",
            description: "Start a guided pizza ordering conversation",
            next_node_id: "pizza_order",
          },
        ],
        respond_immediately: true,
      },
    },
    {
      id: "pizza_order",
      type: "node",
      position: { x: 420, y: 140 },
      data: {
        label: "Pizza Order",
        task_messages: [
          {
            role: "system",
            content:
              "Collect pizza size, toppings, delivery details, and explicit confirmation. After confirmation, call place_pizza_order.",
          },
        ],
        functions: [
          {
            name: "place_pizza_order",
            description: "Place the pizza order through Home Assistant MCP after confirmation",
            properties: {
              size: { type: "string", enum: ["small", "medium", "large"], description: "Pizza size" },
              toppings: { type: "array", description: "Requested toppings" },
              address: { type: "string", description: "Delivery address" },
              notes: { type: "string", description: "Optional order notes" },
            },
            required: ["size", "toppings"],
            mcp_tool: "",
            next_node_id: "done",
          },
        ],
      },
    },
    {
      id: "done",
      type: "end",
      position: { x: 780, y: 140 },
      data: {
        label: "Done",
        task_messages: [{ role: "system", content: "Confirm the result briefly and end the conversation." }],
        post_actions: [{ type: "end_conversation" }],
      },
    },
  ],
  edges: [],
};

const flowExampleTemplates = [
  { id: "passthrough", name: "Pass-through", description: "Transparent flow with no routing", flow: null },
  { id: "minimal", name: "Minimal", description: "Official minimal initial to end example", flow: officialMinimalFlow },
  {
    id: "food_ordering",
    name: "Food Ordering",
    description: "Official branching food ordering example",
    flow: officialFoodOrderingFlow,
  },
  {
    id: "home_pizza_mcp",
    name: "Home Pizza via MCP",
    description: "HA-oriented pizza flow with a final MCP tool call",
    flow: officialHomePizzaFlow,
  },
];

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

function messagesToText(messages, fallback = "") {
  if (typeof messages === "string") return messages || fallback;
  if (!Array.isArray(messages)) return fallback;
  return messages
    .map((item) => (item && typeof item === "object" ? item.content : ""))
    .filter(Boolean)
    .join("\n") || fallback;
}

function textToMessages(value) {
  const content = String(value || "").trim();
  return content ? [{ role: "system", content }] : [];
}

function deriveEditorNodeType(node, index = 0) {
  const data = node?.data && typeof node.data === "object" ? node.data : node || {};
  if (["initial", "node", "end"].includes(node?.type)) return node.type;
  if ((data.post_actions || []).some((action) => action?.type === "end_conversation")) return "end";
  if (index === 0 || data.role_messages || data.role_message) return "initial";
  return "node";
}

function deriveFlowEdges(nodes) {
  return nodes.flatMap((node) => {
    const functions = Array.isArray(node.data?.functions) ? node.data.functions : [];
    return functions.flatMap((fn) => {
      if (fn?.decision?.default_next_node_id) {
        return [
          {
            id: `func-${node.id}-${fn.name || "decision"}-${fn.decision.default_next_node_id}`,
            source: node.id,
            target: fn.decision.default_next_node_id,
            label: `${fn.name || "decision"} default`,
          },
        ];
      }
      if (!fn?.next_node_id) return [];
      return [
        {
          id: `func-${node.id}-${fn.name || "next"}-${fn.next_node_id}`,
          source: node.id,
          target: fn.next_node_id,
          label: fn.name || "next",
        },
      ];
    });
  });
}

function isOfficialFlowJson(value) {
  return Array.isArray(value?.nodes) && value.nodes.some((node) => node?.data || node?.position || node?.type);
}

function legacyConversationToEditorFlow(value, name = "Conversation Flow") {
  const nodes = Array.isArray(value?.nodes) && value.nodes.length ? value.nodes : defaultFlow.conversation_flow.nodes;
  return {
    $id: FLOW_SCHEMA_ID,
    meta: { name, version: "0.1.0", description: "Converted Home Assistant conversation flow" },
    nodes: nodes.map((node, index) => ({
      id: String(node.id || slugify(node.label || `node-${index + 1}`)),
      type: deriveEditorNodeType(node, index),
      position: node.position || { x: 80 + index * 300, y: 130 + (index % 2) * 130 },
      data: {
        label: node.label || node.id || `Node ${index + 1}`,
        role_messages: textToMessages(node.role_message),
        task_messages: textToMessages(node.task || "Continue the conversation."),
        functions: Array.isArray(node.functions) ? clone(node.functions) : [],
        pre_actions: Array.isArray(node.pre_actions) ? clone(node.pre_actions) : undefined,
        post_actions: Array.isArray(node.post_actions) ? clone(node.post_actions) : undefined,
        context_strategy: node.context_strategy,
        respond_immediately: node.respond_immediately ?? true,
      },
    })),
    edges: [],
  };
}

function normalizeEditorFlow(value, name = "Conversation Flow") {
  const source = value?.nodes?.length ? value : defaultFlow.conversation_flow;
  const flow = isOfficialFlowJson(source) ? clone(source) : legacyConversationToEditorFlow(source, name);
  flow.$id = flow.$id || FLOW_SCHEMA_ID;
  flow.meta = {
    name: flow.meta?.name || name,
    version: flow.meta?.version || "0.1.0",
    description: flow.meta?.description || "",
  };
  flow.nodes = (flow.nodes || []).map((node, index) => {
    const data = node.data && typeof node.data === "object" ? clone(node.data) : {};
    return {
      id: String(node.id || slugify(data.label || `node-${index + 1}`)),
      type: deriveEditorNodeType({ ...node, data }, index),
      position: node.position || { x: 80 + index * 300, y: 130 + (index % 2) * 130 },
      data: {
        label: data.label || node.label || node.id || `Node ${index + 1}`,
        role_messages: Array.isArray(data.role_messages) ? data.role_messages : textToMessages(data.role_message),
        task_messages: Array.isArray(data.task_messages)
          ? data.task_messages
          : textToMessages(data.task || "Continue the conversation."),
        functions: Array.isArray(data.functions) ? data.functions : [],
        pre_actions: Array.isArray(data.pre_actions) ? data.pre_actions : undefined,
        post_actions: Array.isArray(data.post_actions) ? data.post_actions : undefined,
        context_strategy: data.context_strategy,
        respond_immediately: data.respond_immediately ?? true,
      },
    };
  });
  if (!flow.nodes.some((node) => node.type === "initial") && flow.nodes[0]) {
    flow.nodes[0].type = "initial";
  }
  flow.edges = deriveFlowEdges(flow.nodes);
  return flow;
}

function editorFlowToConversationFlow(editorFlow, enabled = true) {
  const flow = normalizeEditorFlow(editorFlow, editorFlow?.meta?.name || "Conversation Flow");
  const initial = flow.nodes.find((node) => node.type === "initial") || flow.nodes[0];
  return {
    ...flow,
    enabled,
    initial_node_id: initial?.id || "",
    edges: deriveFlowEdges(flow.nodes),
  };
}

function createPassThroughEditorFlow(flow) {
  return normalizeEditorFlow(
    {
      $id: FLOW_SCHEMA_ID,
      meta: {
        name: flow?.name || "Pass-through",
        version: "0.1.0",
        description: "Transparent flow with no routing",
      },
      nodes: [
        {
          id: "passthrough",
          type: "initial",
          position: { x: 90, y: 150 },
          data: {
            label: "Pass-through",
            role_messages: textToMessages(flow?.instructions || defaultFlow.instructions),
            task_messages: textToMessages("Continue the conversation normally without changing pipeline behavior."),
            functions: [],
            respond_immediately: false,
          },
        },
      ],
      edges: [],
    },
    flow?.name || "Pass-through",
  );
}

function makeFlowNodeId(label, nodes) {
  const base = slugify(label || "node") || "node";
  let candidate = base;
  let index = 2;
  const used = new Set(nodes.map((node) => node.id));
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function makeStep(kind, label, integrationId = "", suffix = "") {
  return {
    id: `${kind}-${suffix || crypto.randomUUID().slice(0, 8)}`,
    kind,
    label,
    enabled: kind !== "flow",
    integration_id: kind === "web_search" ? integrationId || "web-search" : integrationId,
    model: "",
    voice: "",
    settings: kind === "web_search" ? { announce: true } : {},
  };
}

function providerDefaults(provider) {
  if (provider === "gemini") {
    return {
      model: GEMINI_LIVE_MODEL,
      voice: GEMINI_LIVE_VOICE,
    };
  }
  if (provider === "gemini_cloud" || provider === "gemini-cloud") {
    return {
      model: GEMINI_TEXT_MODEL,
      text_model: GEMINI_TEXT_MODEL,
      voice: "",
    };
  }
  if (provider === "openai") {
    return {
      model: OPENAI_REALTIME_MODEL,
      voice: OPENAI_REALTIME_VOICE,
    };
  }
  if (provider === "openai_cloud" || provider === "openai-cloud") {
    return {
      model: OPENAI_TEXT_MODEL,
      text_model: OPENAI_TEXT_MODEL,
      stt_model: OPENAI_STT_MODEL,
      tts_model: OPENAI_TTS_MODEL,
      voice: OPENAI_TTS_VOICE,
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
  if (provider === "google-streaming-tts" || provider === "google_streaming_tts") {
    return { model: "google-streaming-tts", text_model: "", voice: GOOGLE_TTS_VOICE };
  }
  if (provider === "speechmatics") return { model: SPEECHMATICS_MODEL, text_model: "", voice: "" };
  if (provider === "web_search" || provider === "web-search") return { model: WEB_SEARCH_MODEL, text_model: WEB_SEARCH_MODEL, voice: "" };
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
    stt_model: integration?.default_stt_model || fallback.stt_model || "",
    tts_model: integration?.default_tts_model || fallback.tts_model || "",
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
  if (kind === "stt") {
    return {
      model: integration.default_stt_model || fallback.stt_model || integration.default_model || fallback.model || "",
      text_model: integration.default_model || fallback.text_model || "",
      voice: integration.default_voice || fallback.voice || "",
    };
  }
  if (kind === "tts") {
    return {
      model: integration.default_tts_model || fallback.tts_model || integration.default_model || fallback.model || "",
      text_model: integration.default_model || fallback.text_model || "",
      voice: integration.default_voice || fallback.voice || "",
    };
  }
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
      enabled: !["flow", "web_search"].includes(kind) || template.mode === "composed",
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
    language: flow.language || "en",
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
  shaped.integrations = (shaped.integrations || []).map((integration) => ({
    ...integration,
    language: integration.language || "en",
    speed: Number(integration.speed || 1),
    tts_streaming_mode: integration.tts_streaming_mode || "sentence",
    provider_id: integration.provider_id || (integration.kind === "web_search" ? "openai-cloud" : ""),
  }));
  shaped.audio_debug_enabled = Boolean(shaped.audio_debug_enabled);
  shaped.audio_debug_keep_sessions = Math.min(
    100,
    Math.max(1, Number(shaped.audio_debug_keep_sessions || 10)),
  );
  shaped.session_memory_enabled = shaped.session_memory_enabled !== false;
  shaped.session_memory_reuse_seconds = Math.min(
    86400,
    Math.max(0, Number(shaped.session_memory_reuse_seconds ?? 300)),
  );
  shaped.session_memory_max_messages = Math.min(
    100,
    Math.max(0, Number(shaped.session_memory_max_messages ?? 12)),
  );
  shaped.mcp_tools_cache_enabled = shaped.mcp_tools_cache_enabled !== false;
  shaped.mcp_tools_cache_ttl_seconds = Math.min(
    86400,
    Math.max(0, Number(shaped.mcp_tools_cache_ttl_seconds ?? 300)),
  );
  shaped.flows = (shaped.flows?.length ? shaped.flows : [clone(defaultFlow)]).map((flow) => {
    const merged = { ...clone(defaultFlow), ...flow };
    if (!merged.conversation_flow?.nodes?.length) merged.conversation_flow = clone(defaultFlow.conversation_flow);
    const normalized = merged.steps?.length
      ? merged
      : applyTemplate(merged, merged.pipeline_template || "gemini_live_home", shaped);
    if (deriveFlowMode(normalized, shaped) === "realtime") {
      normalized.steps = (normalized.steps || []).filter((step) => step.kind !== "flow");
      normalized.conversation_flow = { ...normalized.conversation_flow, enabled: false };
    }
    return normalized;
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
  const steps = (flow.steps || [])
    .filter((step) => !(isRealtime && step.kind === "flow"))
    .map((step) => ({
    ...step,
    model: "",
    voice: "",
  }));
  const hasTools = steps.some((step) => step.kind === "tools" && step.enabled);
  const hasMemory = steps.some((step) => step.kind === "memory" && step.enabled);
  const hasWebSearch = steps.some((step) => step.kind === "web_search" && step.enabled);
  return {
    ...flow,
    mode,
    steps,
    provider_id: providerId,
    model: flowModel || defaults.model || "",
    voice: flowVoice || defaults.voice || "",
    conversation_flow: isRealtime
      ? { ...(flow.conversation_flow || clone(defaultFlow.conversation_flow)), enabled: false }
      : flow.conversation_flow,
    mcp_enabled: hasTools,
    memory_enabled: hasMemory,
    web_search_enabled: hasWebSearch,
    language: flow.language || "en",
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

function integrationSummary(integration, config = null) {
  if (!integration.enabled) return "disabled";
  if (integration.kind === "home_assistant_mcp") {
    return config ? mcpMode(config).label : "Automatic";
  }
  if (integration.kind === "web_search") {
    const provider = config?.integrations?.find((item) => item.id === integration.provider_id);
    return provider ? `via ${provider.name}` : "provider missing";
  }
  if (
    [
      "gemini",
      "gemini_cloud",
      "openai",
      "openai_cloud",
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
  if (["google_cloud_tts", "google_streaming_tts"].includes(integration.kind)) {
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
  const [mcpHistory, setMcpHistory] = useState({ calls: [] });
  const [tab, setTab] = useState("assistant");
  const [pipelineStage, setPipelineStage] = useState("list");
  const [editingFlowId, setEditingFlowId] = useState("");
  const [integrationStage, setIntegrationStage] = useState("list");
  const [selectedStepId, setSelectedStepId] = useState("");
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("gemini");
  const [modelOptions, setModelOptions] = useState({});
  const [mcpResult, setMcpResult] = useState(null);
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

  const activeFlow = useMemo(() => {
    if (!config) return null;
    return config.flows.find((flow) => flow.id === config.selected_flow_id) || config.flows[0];
  }, [config]);

  const selectedFlow = useMemo(() => {
    if (!config) return null;
    if (tab === "pipelines" && editingFlowId) {
      return config.flows.find((flow) => flow.id === editingFlowId) || activeFlow || config.flows[0];
    }
    return activeFlow || config.flows[0];
  }, [activeFlow, config, editingFlowId, tab]);

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
    if (!config || !activeFlow) return { ok: false, errors: ["Configuration is loading"], warnings: [] };
    return validatePipeline(config, activeFlow);
  }, [activeFlow, config]);

  async function load() {
    setFatalError("");
    const [configResponse, statusResponse, audioResponse, mcpHistoryResponse] = await Promise.all([
      fetch(API.config),
      fetch(API.status),
      fetch(API.audioDebug).catch(() => null),
      fetch(API.mcpHistory).catch(() => null),
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
    if (mcpHistoryResponse?.ok) {
      setMcpHistory(await mcpHistoryResponse.json());
    }
    const flow = nextConfig.flows.find((item) => item.id === nextConfig.selected_flow_id) || nextConfig.flows[0];
    setEditingFlowId((current) => (current && nextConfig.flows.some((item) => item.id === current) ? current : flow.id));
    setSelectedStepId(flow.steps.find((step) => step.kind === "llm")?.id || flow.steps[0]?.id || "");
  }

  function openTab(id) {
    setTab(id);
    if (id === "pipelines") setPipelineStage("list");
    if (id === "integrations") setIntegrationStage("list");
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

  async function refreshMcpHistory() {
    const response = await fetch(API.mcpHistory);
    if (response.ok) {
      setMcpHistory(await response.json());
    }
  }

  async function clearMcpHistory() {
    const response = await fetch(API.mcpHistory, { method: "DELETE" });
    if (response.ok) {
      setMcpHistory(await response.json());
      setMessage({ text: "MCP history cleared", tone: "ok" });
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

  function openFlow(flowId) {
    const flow = config.flows.find((item) => item.id === flowId);
    setEditingFlowId(flowId);
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
      return draft;
    });
    setEditingFlowId(id);
    setSelectedStepId("llm");
    setPipelineStage("editor");
  }

  function duplicateFlow() {
    const copy = clone(selectedFlow);
    copy.id = slugify(`${selectedFlow.id}-copy-${config.flows.length + 1}`);
    copy.name = `${selectedFlow.name} copy`;
    updateConfig((draft) => {
      draft.flows.push(copy);
      return draft;
    });
    setEditingFlowId(copy.id);
  }

  function deleteFlow() {
    if (config.flows.length <= 1) return;
    const nextFlow = config.flows.find((item) => item.id !== selectedFlow.id);
    updateConfig((draft) => {
      draft.flows = draft.flows.filter((flow) => flow.id !== selectedFlow.id);
      if (draft.selected_flow_id === selectedFlow.id) draft.selected_flow_id = draft.flows[0].id;
      return draft;
    });
    setEditingFlowId(nextFlow?.id || "");
    setPipelineStage("list");
  }

  function addStep(kind = "llm") {
    const [, label] = stepTypes.find(([id]) => id === kind) || stepTypes[3];
    const step = makeStep(
      kind,
      label,
      kind === "tools" ? "ha-mcp" : kind === "web_search" ? "web-search" : selectedFlow.provider_id,
    );
    updateSelectedFlow((flow) => {
      flow.pipeline_template = "custom";
      flow.steps.push(step);
      if (kind === "web_search") flow.web_search_enabled = true;
      if (kind === "memory") flow.memory_enabled = true;
      return flow;
    });
    setSelectedStepId(step.id);
  }

  function deleteStep(stepId) {
    if (selectedFlow.steps.length <= 1) return;
    const removedStep = selectedFlow.steps.find((step) => step.id === stepId);
    updateSelectedFlow((flow) => {
      flow.pipeline_template = "custom";
      flow.steps = flow.steps.filter((step) => step.id !== stepId);
      if (removedStep?.kind === "flow") {
        flow.conversation_flow = { ...(flow.conversation_flow || clone(defaultFlow.conversation_flow)), enabled: false };
      }
      if (removedStep?.kind === "web_search") flow.web_search_enabled = false;
      if (removedStep?.kind === "memory") flow.memory_enabled = false;
      return flow;
    });
    setSelectedStepId(selectedFlow.steps.find((step) => step.id !== stepId)?.id || "");
  }

  function insertStep(kind, index = selectedFlow.steps.length) {
    if (kind === "flow" && deriveFlowMode(selectedFlow, config) === "realtime") {
      setMessage({ text: "Pipecat Flow can only be added to composed realtime pipelines.", tone: "error" });
      return;
    }
    const [, label] = stepTypes.find(([id]) => id === kind) || stepTypes[3];
    const integrationId = kind === "tools" ? "ha-mcp" : kind === "web_search" ? "web-search" : "";
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
      if (kind === "web_search") flow.web_search_enabled = true;
      if (kind === "memory") flow.memory_enabled = true;
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
      language: "en",
      speed: 1,
      tts_streaming_mode: "sentence",
      default_model: providerDefaults(kind).text_model || "",
      default_realtime_model: providerDefaults(kind).model || "",
      default_stt_model: providerDefaults(kind).stt_model || "",
      default_tts_model: providerDefaults(kind).tts_model || "",
      default_voice: providerDefaults(kind).voice || "",
      organization: "",
      project: "",
      location: "",
      credentials_json: "",
      credentials_path: "",
      access_key_id: "",
      secret_key: "",
      provider_id: kind === "web_search" ? "openai-cloud" : "",
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
    setIntegrationStage("list");
  }

  async function persistConfig(payload, successText = "Saved") {
    setSaving(true);
    setMessage({ text: "Saving", tone: "" });
    const normalized = {
      ...payload,
      flows: payload.flows.map((flow) => syncFlow(flow, payload)),
    };
    const response = await fetch(API.config, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalized),
    });
    setSaving(false);
    if (!response.ok) {
      setMessage({ text: await response.text(), tone: "error" });
      return null;
    }
    const nextConfig = ensureShape(await response.json());
    setConfig(nextConfig);
    await refreshStatus();
    setAudioDebug((current) => ({
      ...current,
      enabled: nextConfig.audio_debug_enabled,
      keep_sessions: nextConfig.audio_debug_keep_sessions,
    }));
    setMessage({ text: successText, tone: "ok" });
    return nextConfig;
  }

  async function save() {
    await persistConfig(config);
  }

  async function activateFlow(flowId) {
    const nextConfig = ensureShape({ ...clone(config), selected_flow_id: flowId });
    setConfig(nextConfig);
    setEditingFlowId(flowId);
    await persistConfig(nextConfig, "Active pipeline saved");
  }

  async function checkMcp() {
    setMessage({ text: "Checking MCP", tone: "" });
    const response = await fetch(API.mcp, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow_id: selectedFlow.id, refresh: true }),
    });
    const result = await response.json();
    setMcpResult(result);
    setMessage(
      result.ok
        ? { text: `MCP connected: ${result.tool_count} tools`, tone: "ok" }
        : { text: result.error || "MCP check failed", tone: "error" },
    );
    await refreshMcpHistory();
  }

  async function resetMcpDefaults() {
    setMessage({ text: "Resetting MCP", tone: "" });
    const response = await fetch(API.mcpReset, { method: "POST" });
    if (!response.ok) {
      setMessage({ text: await response.text(), tone: "error" });
      return;
    }
    setConfig(ensureShape(await response.json()));
    setMcpResult(null);
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
    if (integrationId === "ha-mcp") setMcpResult(null);
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
            <strong>{t("Interface did not load")}</strong>
            <span>{fatalError}</span>
            <Button icon={RefreshCw} variant="secondary" onClick={() => load().catch((err) => setFatalError(String(err)))}>
              {t("Retry")}
            </Button>
          </>
        ) : (
          <span>{t("Loading")}</span>
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
              {activeValidation.ok ? t("ready") : t("setup needed")}
            </span>
          </div>
        </div>

        <nav className="tabs" aria-label="Pipecat Assist">
          {[
            ["assistant", t("Assistant"), Bot],
            ["pipelines", t("Pipelines"), Workflow],
            ["integrations", t("Integrations"), SlidersHorizontal],
            ["runtime", t("Runtime"), Settings],
          ].map(([id, label, Icon]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => openTab(id)}>
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h2>
              {tab === "assistant"
                ? t("Assistant")
                : tab === "pipelines"
                  ? t("Pipelines")
                  : tab === "integrations"
                    ? t("Integrations")
                    : t("Runtime")}
            </h2>
            <span>{activeValidation.ok ? `${activeFlow.mode} pipeline` : activeValidation.errors[0]}</span>
          </div>
          <div className="actions">
            <button
              className="theme-toggle icon-only"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? t("Light mode") : t("Dark mode")}
              aria-label={theme === "dark" ? t("Light mode") : t("Dark mode")}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {tab === "pipelines" && pipelineStage !== "list" && (
              <Button
                icon={ChevronLeft}
                variant="secondary"
                onClick={() => setPipelineStage(pipelineStage === "flow" ? "editor" : "list")}
              >
                {pipelineStage === "flow" ? t("Back to pipeline") : t("Back to pipelines")}
              </Button>
            )}
            {tab === "integrations" && integrationStage !== "list" && (
              <Button icon={ChevronLeft} variant="secondary" onClick={() => setIntegrationStage("list")}>
                {t("Back to integrations")}
              </Button>
            )}
          </div>
        </header>

        {tab === "assistant" && (
          <AssistantView
            config={config}
            flow={activeFlow}
            status={status}
            setTab={openTab}
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
            openFlow={openFlow}
            addFlow={addFlow}
            pipelineStage={pipelineStage}
            setPipelineStage={setPipelineStage}
            save={save}
            saving={saving}
            activeFlowId={config.selected_flow_id}
            activateFlow={activateFlow}
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
            mcpResult={mcpResult}
            integrationStage={integrationStage}
            setIntegrationStage={setIntegrationStage}
          />
        )}

        {tab === "runtime" && (
          <RuntimeView
            config={config}
            flow={activeFlow}
            status={status}
            copyOfferUrl={copyOfferUrl}
            audioDebug={audioDebug}
            refreshAudioDebug={refreshAudioDebug}
            clearAudioDebug={clearAudioDebug}
            mcpHistory={mcpHistory}
            refreshMcpHistory={refreshMcpHistory}
            clearMcpHistory={clearMcpHistory}
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
      ![
        "home_assistant_mcp",
        "google_cloud_tts",
        "google_streaming_tts",
        "aws_bedrock",
        "aws_nova_sonic",
        "ollama",
        "local_runtime",
      ].includes(
        integration.kind,
      ) &&
      secretStatus(integration, "api_key") === "missing"
    ) {
      missing.push(integration.name);
    }
    if (
      ["google_cloud_tts", "google_streaming_tts"].includes(integration.kind) &&
      !integration.credentials_path &&
      secretStatus(integration, "credentials_json") === "missing"
    ) {
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
  for (const kind of runtimeStepOrder) {
    const count = enabledSteps.filter((step) => step.kind === kind).length;
    if (count > 1) errors.push(`Pipeline can only have one enabled ${kind.toUpperCase()} step.`);
  }
  let previousOrder = -1;
  for (const step of enabledSteps) {
    const order = runtimeStepOrder.indexOf(step.kind);
    if (order === -1) continue;
    if (order < previousOrder) {
      errors.push("Pipeline step order is invalid.");
      break;
    }
    previousOrder = order;
  }

  if (derivedMode === "realtime" && hasFlow) {
    errors.push("Pipecat Flow is only available for composed realtime pipelines.");
  }
  if (derivedMode === "realtime" && (hasStt || hasTts)) {
    errors.push("Speech-to-speech pipelines cannot also use separate STT or TTS steps.");
  }
  if (derivedMode === "composed" && (!hasStt || !hasTts)) {
    errors.push("Composed pipelines need both STT and TTS steps.");
  }
  if (flow.web_search_enabled) {
    const searchIntegration = config.integrations.find((item) => item.id === "web-search" || item.kind === "web_search");
    if (!searchIntegration || !searchIntegration.enabled) {
      errors.push("Web Search integration is disabled.");
    } else {
      const searchProvider = config.integrations.find((item) => item.id === searchIntegration.provider_id);
      if (!searchProvider) {
        errors.push("Web Search needs a cloud LLM provider.");
      } else if (!webSearchProviderKinds.includes(searchProvider.kind)) {
        errors.push(`${searchProvider.name} cannot be used for Web Search.`);
      } else if (!searchProvider.enabled) {
        errors.push(`${searchProvider.name} is disabled.`);
      } else if (searchProvider.kind !== "openai_compatible" && secretStatus(searchProvider, "api_key") === "missing") {
        errors.push(`${searchProvider.name} API key is missing.`);
      }
    }
  }

  for (const step of enabledSteps) {
    if (!["stt", "llm", "web_search", "tts", "tools", "output"].includes(step.kind)) continue;
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
    const allowed = allowedProvidersForStep(step.kind, derivedMode);
    if (allowed && !allowed.includes(integration.kind)) {
      errors.push(`${integration.name} cannot be used as ${step.kind.toUpperCase()}.`);
    }
    if (
      ["gemini", "gemini_cloud", "openai", "openai_cloud", "soniox", "deepgram", "cartesia", "gradium", "speechmatics", "elevenlabs"].includes(
        integration.kind,
      ) &&
      secretStatus(integration, "api_key") === "missing"
    ) {
      errors.push(`${integration.name} API key is missing.`);
    }
    if (
      ["google_cloud_tts", "google_streaming_tts"].includes(integration.kind) &&
      !integration.credentials_path &&
      secretStatus(integration, "credentials_json") === "missing"
    ) {
      errors.push(`${integration.name} credentials are missing.`);
    }
    if (["aws_bedrock", "aws_nova_sonic"].includes(integration.kind)) {
      if (secretStatus(integration, "access_key_id") === "missing" || secretStatus(integration, "secret_key") === "missing") {
        errors.push(`${integration.name} AWS credentials are missing.`);
      }
    }
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

function AssistantView({ config, flow, status, setTab }) {
  const template = pipelineTemplate(flow);
  const Icon = template.icon || Bot;
  const validation = validatePipeline(config, flow);
  const showGeminiLiveHint = !hasReadyAssistantSetup(config);
  return (
    <div className="assistant-grid">
      <section className={`assistant-hero ${template.accent || "blue"}`}>
        <div className="assistant-badge">
          <Icon size={34} />
        </div>
        <div className="assistant-title">
          <span>{template.group || flow.mode}</span>
          <h3>{flow.name}</h3>
          <strong>{validation.ok ? t("Ready") : validation.errors[0]}</strong>
        </div>
        {showGeminiLiveHint && (
          <div className="setup-callout">
            <AlertCircle size={20} />
            <div>
              <strong>{t("The easiest way to get started is with Gemini Live.")}</strong>
              <span>
                Go to{" "}
                <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">
                  {t("Google AI Studio")}
                </a>{" "}
                and generate an API key. Then open Integrations and paste it into Google Gemini Live.
              </span>
            </div>
          </div>
        )}
        <VoiceTest config={config} flow={flow} />
        <div className="assistant-actions">
          <Button icon={Workflow} variant="secondary" onClick={() => setTab("pipelines")}>
            {t("Edit active pipeline")}
          </Button>
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
  openFlow,
  addFlow,
  pipelineStage,
  setPipelineStage,
  save,
  saving,
  activeFlowId,
  activateFlow,
}) {
  const validation = validatePipeline(config, flow);

  if (pipelineStage === "flow") {
    return (
      <section className="panel flow-page">
        <div className="panel-head">
          <div>
            <h3>Pipecat Flow</h3>
            <span>{flow.name}</span>
          </div>
          <div className="button-row">
            <Button icon={Save} onClick={save} disabled={saving}>
              Save
            </Button>
          </div>
        </div>
        <OfficialFlowComposer flow={flow} updateFlow={updateFlow} />
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
            </div>
            <select
              className="add-select compact"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) addFlow(event.target.value);
                event.target.value = "";
              }}
            >
              <option value="">{t("Add pipeline")}</option>
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
                  className={`pipeline-card ${runtimeTone(item)} ${item.id === activeFlowId ? "active" : ""}`}
                  onClick={() => openFlow(item.id)}
                >
                  {item.id === activeFlowId && (
                    <span className="active-check" title="Active pipeline">
                      <CheckCircle2 size={15} />
                    </span>
                  )}
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
      </div>
    );
  }

  const derivedMode = deriveFlowMode(flow, config);
  const flowSupported = derivedMode === "composed";
  const selectedTone = selectedStep ? stepTone(selectedStep.kind) : "neutral";
  const modelIntegration = flowModelIntegration(config, flow);
  const showOpenAiBargeIn = derivedMode === "realtime" && modelIntegration?.kind === "openai";

  return (
    <div className="pipeline-editor-grid">
      <section className="panel main-panel">
        <div className="panel-head">
          <div>
            <h3>{flow.name}</h3>
            <span>{flow.mode === "realtime" ? "speech-to-speech" : "composed realtime"}</span>
          </div>
          <div className="button-row">
            {flow.id === activeFlowId ? (
              <span className="active-badge">
                <CheckCircle2 size={15} />
                <span>{t("Active")}</span>
              </span>
            ) : (
              <Button icon={CheckCircle2} variant="secondary" onClick={() => activateFlow(flow.id)} disabled={saving}>
                {t("Set active")}
              </Button>
            )}
            <Button icon={Copy} variant="secondary" onClick={duplicateFlow}>
              {t("Duplicate")}
            </Button>
            <Button icon={Trash2} variant="danger" onClick={deleteFlow} disabled={config.flows.length <= 1}>
              {t("Delete")}
            </Button>
          </div>
        </div>

        <div className={validation.ok ? "validation-card ok" : "validation-card error"}>
          {validation.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{validation.ok ? t("Pipeline is valid.") : validation.errors[0]}</span>
        </div>

        <StepPalette insertStep={insertStep} flowSupported={flowSupported} />
        <div className="pipeline-canvas">
          <DropSlot index={0} insertStep={insertStep} />
          {flow.steps.map((step, index) => {
            const Icon = stepIcon(step.kind);
            const disabledFlow = step.kind === "flow" && !flowSupported;
            const canDeleteThisStep = flow.steps.length > 1;
            return (
              <React.Fragment key={step.id}>
                <div
                  className={
                    selectedStep?.id === step.id
                      ? `node selected tone-${stepTone(step.kind)} ${disabledFlow ? "unsupported" : ""}`
                      : `node tone-${stepTone(step.kind)} ${disabledFlow ? "unsupported" : ""}`
                  }
                >
                  <button
                    className="node-body"
                    onClick={() => {
                      setSelectedStepId(step.id);
                      if (step.kind === "flow" && flowSupported) setPipelineStage("flow");
                    }}
                  >
                    <Icon size={19} />
                    <strong>{step.label}</strong>
                    <span>{disabledFlow ? "not available for S2S" : step.integration_id || step.kind}</span>
                  </button>
                  {canDeleteThisStep && (
                    <button
                      className="node-delete"
                      title={`Remove ${step.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteStep(step.id);
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
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
            {t("Save pipeline")}
          </Button>
        </div>
      </section>

      <section className={`panel inspector tone-panel-${selectedTone}`}>
        {selectedStep?.kind === "flow" ? (
          <>
            <div className="flow-inline">
              <strong>{flowSupported ? "Pipecat Flow editor" : "Unavailable"}</strong>
              <span>
                {flowSupported
                  ? "Open the visual Pipecat Flow composer for this pipeline."
                  : "Official Pipecat Flows are not available for speech-to-speech models."}
              </span>
              <Button icon={Workflow} onClick={() => setPipelineStage("flow")} disabled={!flowSupported}>
                Open composer
              </Button>
            </div>
          </>
        ) : selectedStep ? (
          <>
            <div className="form-grid">
              {["stt", "llm", "web_search", "tools", "tts", "output"].includes(selectedStep.kind) && (
                <Field label={t("Integration")}>
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
                      .filter((integration) => canUseIntegrationForStep(selectedStep.kind, integration, derivedMode))
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
                label={t("Step enabled")}
              />
            </div>
          </>
        ) : null}

        {selectedStep?.kind === "vad" && (
          <>
            <div className="divider" />
            <div className="form-grid">
              {showOpenAiBargeIn && (
                <>
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
                </>
              )}
              <Field label="VAD eagerness">
                <select value={flow.vad_eagerness} onChange={(event) => updateFlow((draft) => ({ ...draft, vad_eagerness: event.target.value }))}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="auto">auto</option>
                </select>
              </Field>
              {showOpenAiBargeIn && (
                <Toggle
                  checked={flow.interrupt_response}
                  onChange={(value) => updateFlow((draft) => ({ ...draft, interrupt_response: value }))}
                  label="Interrupt response"
                />
              )}
            </div>
          </>
        )}

        {selectedStep?.kind === "llm" && (
          <>
            <div className="divider" />
            <div className="form-grid">
              <Field label={t("Instructions")} wide>
                <textarea rows={8} value={flow.instructions} onChange={(event) => updateFlow((draft) => ({ ...draft, instructions: event.target.value }))} />
              </Field>
              <Toggle
                checked={!flow.greeting}
                onChange={(value) => updateFlow((draft) => ({ ...draft, greeting: value ? "" : defaultFlow.greeting }))}
                label={t("No greeting")}
              />
              <Field label={t("Greeting")} wide>
                <input
                  value={flow.greeting}
                  disabled={!flow.greeting}
                  onChange={(event) => updateFlow((draft) => ({ ...draft, greeting: event.target.value }))}
                />
              </Field>
            </div>
          </>
        )}

        {selectedStep?.kind === "memory" && (
          <>
            <div className="divider" />
            <div className="empty-state">
              Session memory keeps recent turns for this pipeline when the same browser, card, or satellite reconnects. Retention limits are configured in Runtime.
            </div>
          </>
        )}

        {selectedStep?.kind === "web_search" && (
          <>
            <div className="divider" />
            <div className="form-grid">
              <Toggle
                checked={selectedStep.settings?.announce !== false}
                onChange={(value) =>
                  updateStep(selectedStep.id, (step) => ({
                    ...step,
                    settings: { ...(step.settings || {}), announce: value },
                  }))
                }
                label={t("Announce web search")}
              />
              <div className="empty-state wide">
                When enabled, the system prompt asks the assistant to say "Please hold, I'm checking." before it uses web search.
              </div>
            </div>
          </>
        )}
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

function OfficialFlowComposer({ flow, updateFlow }) {
  const [editorFlow, setEditorFlow] = useState(() => normalizeEditorFlow(flow.conversation_flow, flow.name));
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [exampleQuery, setExampleQuery] = useState("");
  const [exampleId, setExampleId] = useState("home_pizza_mcp");
  const dragRef = useRef(null);
  const enabled = Boolean(flow.conversation_flow?.enabled);

  useEffect(() => {
    const next = normalizeEditorFlow(flow.conversation_flow, flow.name);
    setEditorFlow(next);
    setSelectedNodeId(next.nodes.find((node) => node.type === "initial")?.id || next.nodes[0]?.id || "");
  }, [flow.id]);

  const nodes = editorFlow.nodes || [];
  const edges = deriveFlowEdges(nodes);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0];
  const canvasSize = {
    width: Math.max(960, ...nodes.map((node) => (node.position?.x || 0) + 280)),
    height: Math.max(520, ...nodes.map((node) => (node.position?.y || 0) + 190)),
  };
  const filteredExamples = flowExampleTemplates.filter((item) => {
    const query = exampleQuery.trim().toLowerCase();
    if (!query) return true;
    return `${item.name} ${item.description}`.toLowerCase().includes(query);
  });

  function commit(nextFlow, nextEnabled = enabled) {
    const normalized = normalizeEditorFlow(nextFlow, flow.name);
    setEditorFlow(normalized);
    updateFlow((current) => ({
      ...current,
      conversation_flow: editorFlowToConversationFlow(normalized, nextEnabled),
    }));
  }

  function updateNode(nodeId, updater) {
    commit({
      ...editorFlow,
      nodes: nodes.map((node) => (node.id === nodeId ? updater(clone(node)) : node)),
    });
  }

  function updateSelectedData(updater) {
    if (!selectedNode) return;
    updateNode(selectedNode.id, (node) => {
      node.data = updater({ ...(node.data || {}) });
      return node;
    });
  }

  function updateFunction(index, updater) {
    updateSelectedData((data) => {
      const functions = Array.isArray(data.functions) ? clone(data.functions) : [];
      functions[index] = updater(functions[index] || {});
      return { ...data, functions };
    });
  }

  function addFunction() {
    updateSelectedData((data) => {
      const functions = Array.isArray(data.functions) ? clone(data.functions) : [];
      functions.push({
        name: `next_${functions.length + 1}`,
        description: "Continue to the selected node",
        properties: {},
        required: [],
        next_node_id: nodes.find((node) => node.id !== selectedNode?.id)?.id || "",
      });
      return { ...data, functions };
    });
  }

  function removeFunction(index) {
    updateSelectedData((data) => ({
      ...data,
      functions: (Array.isArray(data.functions) ? data.functions : []).filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function addNode(type = "node") {
    const label = type === "end" ? "End" : type === "initial" ? "Initial" : "Node";
    const id = makeFlowNodeId(label, nodes);
    const node = {
      id,
      type,
      position: { x: 120 + nodes.length * 70, y: 120 + nodes.length * 36 },
      data: {
        label,
        role_messages: type === "initial" ? textToMessages(flow.instructions || defaultFlow.instructions) : [],
        task_messages: textToMessages(type === "end" ? "Confirm the result and end the conversation." : "Continue the conversation."),
        functions: [],
        post_actions: type === "end" ? [{ type: "end_conversation" }] : undefined,
        respond_immediately: type !== "end",
      },
    };
    commit({ ...editorFlow, nodes: [...nodes, node] });
    setSelectedNodeId(id);
  }

  function removeNode(nodeId) {
    const nextNodes = nodes
      .filter((node) => node.id !== nodeId)
      .map((node) => ({
        ...node,
        data: {
          ...(node.data || {}),
          functions: (node.data?.functions || []).map((fn) =>
            fn.next_node_id === nodeId ? { ...fn, next_node_id: "" } : fn,
          ),
        },
      }));
    commit({ ...editorFlow, nodes: nextNodes });
    setSelectedNodeId(nextNodes[0]?.id || "");
  }

  function setNodeType(type) {
    if (!selectedNode) return;
    updateNode(selectedNode.id, (node) => {
      node.type = type;
      const data = { ...(node.data || {}) };
      if (type === "end") {
        data.post_actions = [{ type: "end_conversation" }];
        data.functions = [];
      } else {
        data.post_actions = (data.post_actions || []).filter((action) => action.type !== "end_conversation");
      }
      if (type === "initial" && !messagesToText(data.role_messages)) {
        data.role_messages = textToMessages(flow.instructions || defaultFlow.instructions);
      }
      node.data = data;
      return node;
    });
  }

  function loadExample() {
    const item = flowExampleTemplates.find((example) => example.id === exampleId) || flowExampleTemplates[0];
    const next = item.flow ? normalizeEditorFlow(item.flow, item.name) : createPassThroughEditorFlow(flow);
    commit(next, item.id !== "passthrough");
    setSelectedNodeId(next.nodes.find((node) => node.type === "initial")?.id || next.nodes[0]?.id || "");
  }

  function toggleEnabled(value) {
    updateFlow((current) => ({
      ...current,
      conversation_flow: editorFlowToConversationFlow(editorFlow, value),
    }));
  }

  function updateNodePosition(nodeId, position) {
    const next = {
      ...editorFlow,
      nodes: nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
    };
    setEditorFlow(next);
    updateFlow((current) => ({
      ...current,
      conversation_flow: editorFlowToConversationFlow(next, enabled),
    }));
  }

  function startDrag(event, node) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      position: { ...(node.position || { x: 0, y: 0 }) },
    };
    setSelectedNodeId(node.id);
  }

  function moveDrag(event, node) {
    const drag = dragRef.current;
    if (!drag || drag.nodeId !== node.id) return;
    event.preventDefault();
    updateNodePosition(node.id, {
      x: Math.max(20, drag.position.x + event.clientX - drag.startX),
      y: Math.max(20, drag.position.y + event.clientY - drag.startY),
    });
  }

  function stopDrag(event) {
    if (dragRef.current) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
    }
    dragRef.current = null;
  }

  function editProperty(functionIndex, oldName, nextName, updater = (value) => value) {
    updateFunction(functionIndex, (fn) => {
      const properties = { ...(fn.properties || {}) };
      const current = properties[oldName] || { type: "string", description: "" };
      delete properties[oldName];
      const key = slugify(nextName || oldName).replace(/-/g, "_") || oldName;
      properties[key] = updater(current);
      const required = (fn.required || []).map((item) => (item === oldName ? key : item));
      return { ...fn, properties, required };
    });
  }

  function removeProperty(functionIndex, propertyName) {
    updateFunction(functionIndex, (fn) => {
      const properties = { ...(fn.properties || {}) };
      delete properties[propertyName];
      return {
        ...fn,
        properties,
        required: (fn.required || []).filter((item) => item !== propertyName),
      };
    });
  }

  function addProperty(functionIndex) {
    updateFunction(functionIndex, (fn) => {
      const properties = { ...(fn.properties || {}) };
      const key = makeFlowNodeId("property", Object.keys(properties).map((id) => ({ id }))).replace(/-/g, "_");
      properties[key] = { type: "string", description: "" };
      return { ...fn, properties };
    });
  }

  return (
    <div className="official-flow-composer">
      <div className="flow-toolbar">
        <Toggle checked={enabled} onChange={toggleEnabled} label={enabled ? "Flow enabled" : "Pass-through"} />
        <div className="example-picker">
          <input
            value={exampleQuery}
            onChange={(event) => setExampleQuery(event.target.value)}
            placeholder="Filter examples"
            aria-label="Filter flow examples"
          />
          <select value={exampleId} onChange={(event) => setExampleId(event.target.value)}>
            {filteredExamples.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <Button icon={Download} variant="secondary" onClick={loadExample}>
            Load example
          </Button>
        </div>
      </div>

      <div className="flow-designer">
        <div className="flow-canvas-wrap">
          <div className="flow-canvas-inner" style={{ width: canvasSize.width, height: canvasSize.height }}>
            <svg className="flow-edges" width={canvasSize.width} height={canvasSize.height}>
              <defs>
                <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              {edges.map((edge) => {
                const source = nodes.find((node) => node.id === edge.source);
                const target = nodes.find((node) => node.id === edge.target);
                if (!source || !target) return null;
                const x1 = (source.position?.x || 0) + 210;
                const y1 = (source.position?.y || 0) + 58;
                const x2 = target.position?.x || 0;
                const y2 = (target.position?.y || 0) + 58;
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2 - 8;
                return (
                  <g key={edge.id}>
                    <path d={`M ${x1} ${y1} C ${x1 + 80} ${y1}, ${x2 - 80} ${y2}, ${x2} ${y2}`} />
                    <text x={midX} y={midY}>
                      {edge.label}
                    </text>
                  </g>
                );
              })}
            </svg>
            {nodes.map((node) => {
              const nodeType = deriveEditorNodeType(node);
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`flow-canvas-node ${nodeType} ${selectedNode?.id === node.id ? "selected" : ""}`}
                  style={{ left: node.position?.x || 0, top: node.position?.y || 0 }}
                  onPointerDown={(event) => startDrag(event, node)}
                  onPointerMove={(event) => moveDrag(event, node)}
                  onPointerUp={stopDrag}
                  onPointerCancel={stopDrag}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <span>{nodeType}</span>
                  <strong>{node.data?.label || node.id}</strong>
                  <small>{(node.data?.functions || []).length} functions</small>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="flow-inspector">
          <div className="section-title">
            <strong>Pipecat Flow</strong>
            <span>{nodes.length} nodes</span>
          </div>
          <div className="flow-node-palette">
            <Button icon={Plus} variant="secondary" onClick={() => addNode("node")}>
              Node
            </Button>
            <Button icon={Plus} variant="secondary" onClick={() => addNode("initial")} disabled={nodes.some((node) => node.type === "initial")}>
              Initial
            </Button>
            <Button icon={Plus} variant="secondary" onClick={() => addNode("end")}>
              End
            </Button>
          </div>

          {selectedNode ? (
            <div className="flow-node-form">
              <Field label="Node label">
                <input
                  value={selectedNode.data?.label || ""}
                  onChange={(event) => updateSelectedData((data) => ({ ...data, label: event.target.value }))}
                />
              </Field>
              <Field label="Type">
                <select value={selectedNode.type} onChange={(event) => setNodeType(event.target.value)}>
                  <option value="initial">Initial</option>
                  <option value="node">Node</option>
                  <option value="end">End</option>
                </select>
              </Field>
              <Field label="Role messages" wide>
                <textarea
                  rows={4}
                  value={messagesToText(selectedNode.data?.role_messages)}
                  onChange={(event) => updateSelectedData((data) => ({ ...data, role_messages: textToMessages(event.target.value) }))}
                />
              </Field>
              <Field label="Task messages" wide>
                <textarea
                  rows={4}
                  value={messagesToText(selectedNode.data?.task_messages)}
                  onChange={(event) => updateSelectedData((data) => ({ ...data, task_messages: textToMessages(event.target.value) }))}
                />
              </Field>
              {selectedNode.type !== "end" && (
                <Toggle
                  checked={selectedNode.data?.respond_immediately !== false}
                  onChange={(value) => updateSelectedData((data) => ({ ...data, respond_immediately: value }))}
                  label="Respond immediately"
                />
              )}

              {selectedNode.type !== "end" && (
                <>
                  <div className="section-title">
                    <strong>Functions</strong>
                    <span>{(selectedNode.data?.functions || []).length}</span>
                  </div>
                  {(selectedNode.data?.functions || []).map((fn, index) => (
                    <div className="function-row flow-function-row" key={`${selectedNode.id}-${index}`}>
                      <Field label="Name">
                        <input
                          value={fn.name || ""}
                          onChange={(event) => updateFunction(index, (item) => ({ ...item, name: event.target.value }))}
                        />
                      </Field>
                      <Field label="Description">
                        <input
                          value={fn.description || ""}
                          onChange={(event) => updateFunction(index, (item) => ({ ...item, description: event.target.value }))}
                        />
                      </Field>
                      <Field label="Next node">
                        <select value={fn.next_node_id || ""} onChange={(event) => updateFunction(index, (item) => ({ ...item, next_node_id: event.target.value }))}>
                          <option value="">Stay here</option>
                          {nodes.map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.data?.label || node.id}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="MCP tool">
                        <input
                          value={fn.mcp_tool || ""}
                          placeholder="Optional HA MCP tool"
                          onChange={(event) => updateFunction(index, (item) => ({ ...item, mcp_tool: event.target.value }))}
                        />
                      </Field>
                      <Field label="Required properties" wide>
                        <input
                          value={(fn.required || []).join(", ")}
                          placeholder="size, toppings"
                          onChange={(event) =>
                            updateFunction(index, (item) => ({
                              ...item,
                              required: event.target.value
                                .split(",")
                                .map((part) => part.trim())
                                .filter(Boolean),
                            }))
                          }
                        />
                      </Field>
                      <div className="flow-properties">
                        <div className="section-title">
                          <strong>Properties</strong>
                          <Button icon={Plus} variant="ghost" title="Add property" onClick={() => addProperty(index)} />
                        </div>
                        {Object.entries(fn.properties || {}).map(([propertyName, property]) => (
                          <div className="flow-property-row" key={propertyName}>
                            <input value={propertyName} onChange={(event) => editProperty(index, propertyName, event.target.value)} />
                            <select
                              value={property.type || "string"}
                              onChange={(event) =>
                                editProperty(index, propertyName, propertyName, (current) => ({ ...current, type: event.target.value }))
                              }
                            >
                              <option value="string">string</option>
                              <option value="integer">integer</option>
                              <option value="number">number</option>
                              <option value="boolean">boolean</option>
                              <option value="array">array</option>
                            </select>
                            <input
                              value={property.description || ""}
                              placeholder="Description"
                              onChange={(event) =>
                                editProperty(index, propertyName, propertyName, (current) => ({
                                  ...current,
                                  description: event.target.value,
                                }))
                              }
                            />
                            <Button icon={X} variant="ghost" title="Remove property" onClick={() => removeProperty(index, propertyName)} />
                          </div>
                        ))}
                      </div>
                      <Button icon={Trash2} variant="danger" onClick={() => removeFunction(index)}>
                        Remove function
                      </Button>
                    </div>
                  ))}
                  <Button icon={Plus} variant="secondary" onClick={addFunction}>
                    Add function
                  </Button>
                </>
              )}

              <Button icon={Trash2} variant="danger" onClick={() => removeNode(selectedNode.id)} disabled={nodes.length <= 1}>
                Delete node
              </Button>
            </div>
          ) : (
            <div className="empty-state">Select a node to edit its Pipecat Flow configuration.</div>
          )}
        </aside>
      </div>
    </div>
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
  mcpResult,
  integrationStage,
  setIntegrationStage,
}) {
  if (integrationStage === "list") {
    return (
      <div className="integrations-home">
        <section className="panel main-panel">
          <div className="panel-head">
            <div>
              <h3>Integrations</h3>
              <span>{config.integrations.length} providers</span>
            </div>
            <div className="button-row">
              <select
                className="add-select compact"
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value) {
                    addIntegration(event.target.value);
                    setIntegrationStage("detail");
                  }
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
                  className={`integration-card ${integration.enabled ? "enabled" : "disabled"}`}
                  onClick={() => {
                    setSelectedIntegrationId(integration.id);
                    setIntegrationStage("detail");
                  }}
                >
                  <Icon size={20} />
                  <span>
                    <strong>{integration.name}</strong>
                    <small>{integrationSummary(integration, config)}</small>
                  </span>
                  <span className={integration.enabled ? "dot on" : "dot"} />
                </button>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  if (!selectedIntegration) {
    return <div className="empty-state">Select an integration from the list.</div>;
  }

  return (
    <div className="integration-detail">
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
          mcpResult={mcpResult}
        />
        <IntegrationRuntimeDefaults integration={selectedIntegration} updateIntegration={updateIntegration} />
        <div className="editor-actions">
          <Button icon={RotateCcw} variant="secondary" onClick={() => resetIntegrationDefaults(selectedIntegration.id)}>
            {t("Reset defaults")}
          </Button>
          <Button icon={Save} onClick={save} disabled={saving}>
            {t("Save integration")}
          </Button>
        </div>
      </section>
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
            label={t("Enabled")}
          />
        </div>
        <Field label={t("Name")}>
          <input
            value={integration.name}
            onChange={(event) => updateIntegration(integration.id, (item) => ({ ...item, name: event.target.value }))}
          />
        </Field>
      </div>
    </div>
  );
}

function IntegrationRuntimeDefaults({ integration, updateIntegration }) {
  const showLanguage = languageIntegrationKinds.includes(integration.kind);
  const showSpeed = speedIntegrationKinds.includes(integration.kind);
  const showTtsStreaming = ttsStreamingIntegrationKinds.includes(integration.kind);
  if (!showLanguage && !showSpeed && !showTtsStreaming) return null;
  return (
    <SettingsSection title="Runtime defaults">
      {showLanguage && <LanguageSetting integration={integration} updateIntegration={updateIntegration} />}
      {showSpeed && <SpeedSetting integration={integration} updateIntegration={updateIntegration} />}
      {showTtsStreaming && <TtsStreamingSetting integration={integration} updateIntegration={updateIntegration} />}
    </SettingsSection>
  );
}

function WebSearchSettings({ integration, config, updateIntegration, modelOptions, loadModelOptions }) {
  const providers = config.integrations.filter((item) => webSearchProviderKinds.includes(item.kind));
  const selectedProvider =
    providers.find((item) => item.id === integration.provider_id) ||
    providers.find((item) => item.id === "openai-cloud") ||
    providers[0];
  const providerKey = selectedProvider ? `${selectedProvider.id}:llm` : "";
  const options = providerKey ? modelOptions?.[providerKey] || [] : [];
  const listId = `web-search-models-${integration.id}`;

  return (
    <SettingsSection title="Web Search" status={selectedProvider ? `via ${selectedProvider.name}` : "provider missing"}>
      <Field label={t("Cloud LLM provider")}>
        <select
          value={selectedProvider?.id || ""}
          onChange={(event) => {
            const provider = providers.find((item) => item.id === event.target.value);
            updateIntegration(integration.id, (item) => ({
              ...item,
              provider_id: provider?.id || "",
              default_model: provider?.default_model || item.default_model || "",
            }));
          }}
        >
          {!providers.length && <option value="">No compatible provider</option>}
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Search model")}>
        <input
          autoComplete="off"
          list={listId}
          value={integration.default_model || selectedProvider?.default_model || ""}
          onFocus={() => selectedProvider && loadModelOptions?.(selectedProvider.id, "llm")}
          onChange={(event) => updateIntegration(integration.id, (item) => ({ ...item, default_model: event.target.value }))}
        />
        <datalist id={listId}>
          {options.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </datalist>
      </Field>
      <div className="empty-state wide">
        OpenAI uses the Responses web search tool. Gemini uses Google Search grounding. Credentials stay in the selected provider integration.
      </div>
    </SettingsSection>
  );
}

function IntegrationSettings({ integration, config, updateIntegration, modelOptions, loadModelOptions, checkMcp, resetMcpDefaults, mcpResult }) {
  const [manualMcpOpen, setManualMcpOpen] = useState(false);

  useEffect(() => {
    if (integration.kind === "home_assistant_mcp") {
      setManualMcpOpen(Boolean(integration.base_url || integration.token_configured || integration.token === REDACTED));
    }
  }, [integration.base_url, integration.id, integration.kind, integration.token, integration.token_configured]);

  if (integration.kind === "gemini") {
    return (
      <>
        <SettingsSection title="Credentials" status={secretStatus(integration, "api_key")}>
          <SecretSetting integration={integration} field="api_key" label="Gemini API key" updateIntegration={updateIntegration} />
        </SettingsSection>
        <SettingsSection title="Realtime">
          <ModelSetting
            integration={integration}
            field="default_realtime_model"
            label="Live model"
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            capability="realtime"
          />
          <TextSetting integration={integration} field="default_voice" label="Voice" updateIntegration={updateIntegration} />
        </SettingsSection>
      </>
    );
  }

  if (integration.kind === "gemini_cloud") {
    return (
      <>
        <SettingsSection title="Credentials" status={secretStatus(integration, "api_key")}>
          <SecretSetting integration={integration} field="api_key" label="Gemini API key" updateIntegration={updateIntegration} />
        </SettingsSection>
        <SettingsSection title="Language model">
          <ModelSetting
            integration={integration}
            field="default_model"
            label="Text model"
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            capability="llm"
          />
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
        <SettingsSection title="Realtime">
          <ModelSetting
            integration={integration}
            field="default_realtime_model"
            label="Realtime model"
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            capability="realtime"
          />
          <TextSetting integration={integration} field="default_voice" label="Voice" updateIntegration={updateIntegration} />
        </SettingsSection>
      </>
    );
  }

  if (integration.kind === "openai_cloud") {
    return (
      <>
        <SettingsSection title="Credentials" status={secretStatus(integration, "api_key")}>
          <SecretSetting integration={integration} field="api_key" label="OpenAI API key" updateIntegration={updateIntegration} />
          <TextSetting integration={integration} field="organization" label="Organization" updateIntegration={updateIntegration} />
          <TextSetting integration={integration} field="project" label="Project" updateIntegration={updateIntegration} />
        </SettingsSection>
        <SettingsSection title="Speech to text">
          <ModelSetting
            integration={integration}
            field="default_stt_model"
            label="Transcription model"
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            capability="stt"
          />
        </SettingsSection>
        <SettingsSection title="Language model">
          <ModelSetting
            integration={integration}
            field="default_model"
            label="Text model"
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            capability="llm"
          />
        </SettingsSection>
        <SettingsSection title="Text to speech">
          <ModelSetting
            integration={integration}
            field="default_tts_model"
            label="TTS model"
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            capability="tts"
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
        <div className={`mcp-mode ${mode.tone} wide`}>
          <strong>{mode.label}</strong>
          <span>
            {mode.label === "Automatic"
              ? "Using Home Assistant Supervisor MCP and token."
              : mode.label === "Manual"
                ? "Manual URL or token override is configured."
                : "MCP token is not available."}
          </span>
        </div>
        {mcpResult && (
          <div className={mcpResult.ok ? "mcp-result ok wide" : "mcp-result error wide"}>
            <strong>{mcpResult.ok ? `${mcpResult.tool_count} tools available` : "MCP test failed"}</strong>
            <span>{mcpResult.ok ? (mcpResult.tools || []).slice(0, 8).join(", ") : mcpResult.error}</span>
          </div>
        )}
        {manualMcpOpen && (
          <>
            <TextSetting integration={integration} field="base_url" label="Manual MCP URL" updateIntegration={updateIntegration} wide />
            <SecretSetting integration={integration} field="token" label="Manual access token" updateIntegration={updateIntegration} wide />
          </>
        )}
        <div className="button-row wide">
          <Button icon={RefreshCw} variant="secondary" onClick={checkMcp}>
            Test MCP
          </Button>
          <Button icon={Settings} variant="secondary" onClick={() => setManualMcpOpen((value) => !value)}>
            {manualMcpOpen ? "Hide manual" : "Manual override"}
          </Button>
          <Button icon={RotateCcw} variant="secondary" onClick={resetMcpDefaults}>
            Automatic defaults
          </Button>
        </div>
      </SettingsSection>
    );
  }

  if (integration.kind === "web_search") {
    return <WebSearchSettings integration={integration} config={config} updateIntegration={updateIntegration} modelOptions={modelOptions} loadModelOptions={loadModelOptions} />;
  }

  if (["soniox", "deepgram", "gradium", "speechmatics"].includes(integration.kind)) {
    return (
      <SettingsSection title={kindLabel(integration.kind)} status={secretStatus(integration, "api_key")}>
        <SecretSetting integration={integration} field="api_key" label="API key" updateIntegration={updateIntegration} />
        <TextSetting integration={integration} field="default_model" label="STT model" updateIntegration={updateIntegration} />
        {["soniox", "gradium"].includes(integration.kind) && (
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

  if (["google_cloud_tts", "google_streaming_tts"].includes(integration.kind)) {
    return (
      <>
        <SettingsSection title={kindLabel(integration.kind)} status={secretStatus(integration, "credentials_json")}>
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

function LanguageSetting({ integration, updateIntegration }) {
  return (
    <Field label="Language">
      <input
        autoComplete="off"
        value={integration.language || "en"}
        onChange={(event) => updateIntegration(integration.id, (item) => ({ ...item, language: event.target.value || "en" }))}
      />
    </Field>
  );
}

function SpeedSetting({ integration, updateIntegration }) {
  return (
    <Field label="Speed">
      <select
        value={String(integration.speed || 1)}
        onChange={(event) => updateIntegration(integration.id, (item) => ({ ...item, speed: Number(event.target.value || 1) }))}
      >
        <option value="0.75">0.75x</option>
        <option value="0.9">0.9x</option>
        <option value="1">1.0x</option>
        <option value="1.1">1.1x</option>
        <option value="1.25">1.25x</option>
      </select>
    </Field>
  );
}

function TtsStreamingSetting({ integration, updateIntegration }) {
  return (
    <Field label="TTS streaming">
      <select
        value={integration.tts_streaming_mode || "sentence"}
        onChange={(event) => updateIntegration(integration.id, (item) => ({ ...item, tts_streaming_mode: event.target.value }))}
      >
        <option value="sentence">Sentence chunks</option>
        <option value="token">Token chunks</option>
      </select>
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

function browserClientId() {
  const key = "pipecat-assist-client-id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return `browser-${Math.random().toString(16).slice(2)}`;
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

  const keyStatus = ["gemini", "gemini_cloud", "openai", "openai_cloud"].includes(integration.kind)
    ? secretStatus(integration, "api_key")
    : "configured";
  if (keyStatus === "missing") {
    return {
      ok: false,
      detail: `${integration.name} API key is missing. Add it in Integrations, save, then retry.`,
    };
  }
  if (keyStatus === "pending") {
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

function hasReadyAssistantSetup(config) {
  return (config.flows || []).some((candidate) => voiceReadiness(config, candidate).ok);
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
  if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
    return "Microphone access is blocked. Allow microphone access in the browser and start the voice test again.";
  }
  if (err?.name === "NotFoundError") {
    return "No microphone was found for this browser session.";
  }
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
  const connectTimeoutRef = useRef(null);
  const pingRef = useRef(null);
  const peerRef = useRef(null);
  const readySentRef = useRef(false);
  const streamRef = useRef(null);
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
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
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
        if (readySentRef.current || channel.readyState !== "open") return;
        channel.send(
          JSON.stringify({
            label: "rtvi-ai",
            id: crypto.randomUUID().slice(0, 8),
            type: "client-ready",
            data: {
              version: "1.4.0",
                about: {
                  library: "pipecat-assist-ui",
                  library_version: "0.1.43",
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
      };

      const markConnected = () => {
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        setState("connected");
        setDetail("Connected. Speak to the selected assistant.");
      };

      const failWebRtc = (message) => {
        if (closingRef.current || peerRef.current !== peerConnection) return;
        clearSession("error", message);
      };

      peerConnection.onconnectionstatechange = () => {
        const next = peerConnection.connectionState;
        if (next === "connected") {
          markConnected();
        }
        if (["failed", "disconnected", "closed"].includes(next) && !closingRef.current) {
          failWebRtc(
            next === "failed"
              ? "WebRTC failed after the offer was accepted. Check the add-on logs for provider or model errors."
              : `WebRTC ${next}`,
          );
        }
      };
      peerConnection.oniceconnectionstatechange = () => {
        const next = peerConnection.iceConnectionState;
        if (["connected", "completed"].includes(next)) {
          markConnected();
        }
        if (["failed", "disconnected", "closed"].includes(next)) {
          failWebRtc(`WebRTC ICE ${next}. Check that the browser can reach the add-on network endpoint.`);
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
            client_id: browserClientId(),
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
      if (
        peerConnection.connectionState === "connected" ||
        ["connected", "completed"].includes(peerConnection.iceConnectionState)
      ) {
        markConnected();
      } else {
        connectTimeoutRef.current = window.setTimeout(() => {
          failWebRtc("WebRTC audio did not connect after the offer was accepted. Restart the add-on after updating and check the add-on logs for ICE errors.");
        }, 15000);
      }
    } catch (err) {
      clearSession("error", friendlyWebRtcError(err));
    }
  }

  const running = ["requesting", "connecting", "connected"].includes(state);
  const stateLabel = state === "idle" && !readiness.ok ? t("Setup needed") : {
    connected: t("Connected"),
    connecting: t("Connecting"),
    error: t("Needs attention"),
    idle: t("Idle"),
    requesting: t("Microphone"),
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
        <audio ref={audioRef} autoPlay playsInline />
      </div>
      <div className="voice-controlbar">
        <Button
          icon={running ? X : Mic2}
          variant={running ? "danger" : "primary"}
          onClick={running ? () => stopVoiceTest() : startVoiceTest}
          disabled={startDisabled}
        >
          {running ? t("Stop voice test") : t("Start voice test")}
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
          <h3>{t("Audio debug")}</h3>
          <span>{audioDebug?.enabled ? "enabled" : `${recordings.length} sessions`}</span>
        </div>
        <div className="button-row">
          <Button icon={RefreshCw} variant="secondary" onClick={refreshAudioDebug}>
            {t("Refresh")}
          </Button>
          <Button icon={Trash2} variant="danger" onClick={clearAudioDebug} disabled={!recordings.length}>
            {t("Clear")}
          </Button>
        </div>
      </div>
      <div className="form-grid">
        <Toggle
          checked={config.audio_debug_enabled}
          onChange={(value) => updateConfig((draft) => ({ ...draft, audio_debug_enabled: value }))}
          label={t("Record audio in/out")}
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

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!value) return "";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function McpHistoryPanel({ mcpHistory, refreshMcpHistory, clearMcpHistory }) {
  const calls = mcpHistory?.calls || [];
  return (
    <section className="mcp-history-panel">
      <div className="panel-head">
        <div>
          <h3>{t("Home Assistant actions")}</h3>
          <span>{calls.length ? `${calls.length} recent MCP calls` : "no MCP calls yet"}</span>
        </div>
        <div className="button-row">
          <Button icon={RefreshCw} variant="secondary" onClick={refreshMcpHistory}>
            {t("Refresh")}
          </Button>
          <Button icon={Trash2} variant="danger" onClick={clearMcpHistory} disabled={!calls.length}>
            {t("Clear")}
          </Button>
        </div>
      </div>
      <div className="mcp-history-list">
        {calls.length ? (
          calls.map((call) => (
            <div key={call.id} className={call.ok ? "mcp-call ok" : "mcp-call error"}>
              <div className="mcp-call-head">
                <strong>{call.tool || "unknown tool"}</strong>
                <span>{[formatTimestamp(call.started_at), formatDuration(call.duration_ms)].filter(Boolean).join(" / ")}</span>
              </div>
              {call.arguments && <pre>{call.arguments}</pre>}
              <small>{call.ok ? call.result || "Tool completed" : call.error || "Tool failed"}</small>
            </div>
          ))
        ) : (
          <div className="empty-state">No Home Assistant MCP calls recorded yet.</div>
        )}
      </div>
    </section>
  );
}

function RuntimeSettingsPanel({ config, updateConfig }) {
  return (
    <>
      <div className="panel-head">
        <div>
          <h3>Runtime behavior</h3>
          <span>session memory and MCP schema cache</span>
        </div>
      </div>
      <div className="form-grid">
        <Toggle
          checked={config.session_memory_enabled}
          onChange={(value) => updateConfig((draft) => ({ ...draft, session_memory_enabled: value }))}
          label={t("Session memory")}
        />
        <Field label={t("Memory reuse")}>
          <select
            value={String(config.session_memory_reuse_seconds ?? 300)}
            onChange={(event) => updateConfig((draft) => ({ ...draft, session_memory_reuse_seconds: Number(event.target.value) }))}
          >
            <option value="0">Off</option>
            <option value="120">2 minutes</option>
            <option value="300">5 minutes</option>
            <option value="900">15 minutes</option>
            <option value="3600">1 hour</option>
          </select>
        </Field>
        <Field label={t("Memory messages")}>
          <input
            type="number"
            min="0"
            max="100"
            value={config.session_memory_max_messages ?? 12}
            onChange={(event) => updateConfig((draft) => ({ ...draft, session_memory_max_messages: Number(event.target.value || 0) }))}
          />
        </Field>
        <Toggle
          checked={config.mcp_tools_cache_enabled}
          onChange={(value) => updateConfig((draft) => ({ ...draft, mcp_tools_cache_enabled: value }))}
          label={t("MCP tools cache")}
        />
        <Field label={t("MCP cache TTL")}>
          <select
            value={String(config.mcp_tools_cache_ttl_seconds ?? 300)}
            onChange={(event) => updateConfig((draft) => ({ ...draft, mcp_tools_cache_ttl_seconds: Number(event.target.value) }))}
          >
            <option value="0">No cache</option>
            <option value="60">1 minute</option>
            <option value="300">5 minutes</option>
            <option value="900">15 minutes</option>
          </select>
        </Field>
      </div>
    </>
  );
}

function RuntimeView({
  config,
  audioDebug,
  refreshAudioDebug,
  clearAudioDebug,
  mcpHistory,
  refreshMcpHistory,
  clearMcpHistory,
  updateConfig,
  save,
  saving,
}) {
  return (
    <div className="runtime-home">
      <section className="panel main-panel">
        <RuntimeSettingsPanel config={config} updateConfig={updateConfig} />
        <div className="divider" />
        <AudioDebugPanel
          config={config}
          audioDebug={audioDebug}
          refreshAudioDebug={refreshAudioDebug}
          clearAudioDebug={clearAudioDebug}
          updateConfig={updateConfig}
        />
        <div className="editor-actions">
          <Button icon={Save} onClick={save} disabled={saving}>
            {t("Save runtime")}
          </Button>
        </div>
        <div className="divider" />
        <McpHistoryPanel
          mcpHistory={mcpHistory}
          refreshMcpHistory={refreshMcpHistory}
          clearMcpHistory={clearMcpHistory}
        />
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
