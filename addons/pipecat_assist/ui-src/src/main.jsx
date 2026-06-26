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
  Image as ImageIcon,
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

UI_TRANSLATIONS.pl["Image task provider"] = "\u0179r\u00f3d\u0142o obraz\u00f3w AI";
UI_TRANSLATIONS.pl["First enabled image provider"] = "Pierwszy w\u0142\u0105czony provider obraz\u00f3w";
UI_TRANSLATIONS.pl["Auto-detect"] = "Wykryj automatycznie";
UI_TRANSLATIONS.pl["Test MCP"] = "Test MCP";
UI_TRANSLATIONS.pl["Automatic"] = "Automatycznie";
UI_TRANSLATIONS.pl["Not detected"] = "Nie wykryto";
UI_TRANSLATIONS.pl["Detected endpoint"] = "Wykryty endpoint";
UI_TRANSLATIONS.pl["Manual URL"] = "R\u0119czny URL";
UI_TRANSLATIONS.pl["Hide manual"] = "Ukryj r\u0119czne";
UI_TRANSLATIONS.pl["MCP server URL"] = "URL serwera MCP";

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

const OPUS_AUDIO_QUALITY_PARAMS = {
  minptime: "20",
  useinbandfec: "1",
  maxplaybackrate: "48000",
  maxaveragebitrate: "96000",
  usedtx: "0",
};
const OPUS_AUDIO_REMOVE_PARAMS = new Set(["stereo", "sprop-stereo"]);
const ASSISTANT_CARD_VERSION = "0.1.75";
const ASSISTANT_CARD_ACCENT_HEX = "#206cff";
const ASSISTANT_CARD_AUDIO_BUFFER_MS = 120;
const STREAM_FADE_GROUPS = 4;
const STREAM_CHARS_PER_GROUP = 2;
const STREAM_FADE_LEN = STREAM_FADE_GROUPS * STREAM_CHARS_PER_GROUP;
const END_CONVERSATION_PATTERNS = [
  /\b(to wszystko|wystarczy|dziekuje to wszystko|dzieki to wszystko)\b/,
  /\b(dziekuje koniec|dzieki koniec|ok koniec|okej koniec|dobra koniec)\b/,
  /\b(koniec rozmowy|konczymy rozmowe|zakoncz rozmowe|zakonczmy rozmowe)\b/,
  /\b(przestan sluchac|nie sluchaj|nie nasluchuj)\b/,
  /\b(that is all|that's all|thanks that's all|thank you that's all)\b/,
  /\b(end conversation|stop listening|we are done|goodbye|bye for now)\b/,
  /\b(milego dnia|do uslyszenia|do zobaczenia|na razie)\b/,
  /\b(have a nice day|talk to you later|see you later)\b/,
];
const SHORT_END_CONVERSATION_PATTERN =
  /^(?:ok|okej|dobra|no|dziekuje|dzieki|thanks|thank you)?\s*(?:koniec|wystarczy|goodbye|bye)\s*$/;

const ASSISTANT_CARD_TRANSLATIONS = {
  en: {
    ready: "Ready",
    connecting: "Connecting",
    connected: "Connected",
    error: "Error",
    greeting: "What would you like to do today?",
    talk: "Talk",
    stop: "Stop",
    enableAudio: "Enable audio",
    audioBlocked: "Audio is connected, but the browser blocked playback.",
    waitingForMicrophone: "Waiting for microphone permission",
    microphoneUnavailable: "Microphone access is not available from this browser context.",
    microphoneBlocked: "Microphone access is blocked. Allow microphone access and retry.",
    connectedDetail: "Connected. Speak to Pipecat Assist.",
    connectingAudio: "Connecting audio",
    setupNeeded: "Setup needed",
  },
  pl: {
    ready: "Gotowy",
    connecting: "\u0141\u0105czenie",
    connected: "Po\u0142\u0105czono",
    error: "B\u0142\u0105d",
    greeting: "Co chcia\u0142by\u015b dzisiaj zrobi\u0107?",
    talk: "M\u00f3w",
    stop: "Zatrzymaj",
    enableAudio: "W\u0142\u0105cz d\u017awi\u0119k",
    audioBlocked: "D\u017awi\u0119k jest po\u0142\u0105czony, ale przegl\u0105darka zablokowa\u0142a odtwarzanie.",
    waitingForMicrophone: "Oczekiwanie na zgod\u0119 u\u017cycia mikrofonu",
    microphoneUnavailable: "Dost\u0119p do mikrofonu nie jest dost\u0119pny w tej przegl\u0105darce.",
    microphoneBlocked: "Dost\u0119p do mikrofonu jest zablokowany. Zezw\u00f3l na mikrofon i spr\u00f3buj ponownie.",
    connectedDetail: "Po\u0142\u0105czono. Powiedz co\u015b do Pipecat Assist.",
    connectingAudio: "\u0141\u0105czenie audio",
    setupNeeded: "Wymagana konfiguracja",
  },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(value) {
  const fallback = ASSISTANT_CARD_ACCENT_HEX;
  const raw = String(value || "").trim();
  const short = /^#?([0-9a-f]{3})$/i.exec(raw);
  const full = /^#?([0-9a-f]{6})$/i.exec(raw);
  const hex = short
    ? short[1].split("").map((part) => `${part}${part}`).join("")
    : full
      ? full[1]
      : fallback.slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function normalizeTranscriptText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?%…)\]}])/g, "$1")
    .replace(/([,.;:!?])(?=\p{L}|\p{N})/gu, "$1 ")
    .replace(/([([{])\s+/g, "$1")
    .trim();
}

function compactTranscript(value) {
  return normalizeTranscriptText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function transcriptOverlapSize(existing, incoming) {
  const max = Math.min(existing.length, incoming.length, 160);
  const existingLower = existing.toLocaleLowerCase();
  const incomingLower = incoming.toLocaleLowerCase();
  for (let length = max; length > 0; length -= 1) {
    if (existingLower.slice(-length) === incomingLower.slice(0, length)) return length;
  }
  return 0;
}

function transcriptJoiner(existing, incoming, rawIncoming) {
  if (!existing || !incoming) return "";
  if (/^\s/.test(String(rawIncoming || ""))) return " ";
  if (/^[,.;:!?%…)\]}]/.test(incoming)) return "";
  if (/[(\[{]$/.test(existing)) return "";
  if (/[-/–—]$/.test(existing) || /^[-/–—]/.test(incoming)) return "";
  return " ";
}

function mergeTranscript(existing, chunk) {
  const current = normalizeTranscriptText(existing);
  const rawText = String(chunk || "");
  const text = normalizeTranscriptText(rawText);
  if (!text) return current;
  if (!current) return text;

  const currentCompact = compactTranscript(current);
  const textCompact = compactTranscript(text);
  if (!textCompact) return current;
  if (textCompact === currentCompact) return current;
  if (textCompact.startsWith(currentCompact) && text.length >= current.length) return text;

  const currentTail = compactTranscript(current.slice(-320));
  if (textCompact.length > 3 && currentTail.includes(textCompact)) return current;

  const overlap = transcriptOverlapSize(current, text);
  if (overlap > 0) {
    return normalizeTranscriptText(`${current}${text.slice(overlap)}`);
  }

  return normalizeTranscriptText(`${current}${transcriptJoiner(current, text, rawText)}${text}`);
}

function transcriptWords(value) {
  return normalizeTranscriptText(value)
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
}

function transcriptTokenParts(value) {
  const text = normalizeTranscriptText(value);
  return [...text.matchAll(/\p{L}[\p{L}\p{N}]*/gu)]
    .map((match) => ({
      text: match[0],
      compact: compactTranscript(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    }))
    .filter((token) => token.compact);
}

function transcriptWordSimilarity(left, right) {
  const leftWords = new Set(transcriptWords(left));
  const rightWords = new Set(transcriptWords(right));
  if (!leftWords.size || !rightWords.size) return 0;
  let matched = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) matched += 1;
  }
  return matched / Math.min(leftWords.size, rightWords.size);
}

function fragmentedTranscriptScore(value) {
  return normalizeTranscriptText(value)
    .split(/\s+/)
    .filter((part) => /^\p{L}$/u.test(part))
    .length;
}

function hasTerminalTranscriptPunctuation(text) {
  return /[.!?]\s*$/.test(normalizeTranscriptText(text));
}

function isLikelyTranscriptReplacement(existing, incoming) {
  const current = normalizeTranscriptText(existing);
  const text = normalizeTranscriptText(incoming);
  if (!current || !text) return false;
  const currentCompact = compactTranscript(current);
  const textCompact = compactTranscript(text);
  if (textCompact === currentCompact) return true;
  if (textCompact.startsWith(currentCompact) && text.length >= current.length) return true;
  if (currentCompact.includes(textCompact) && textCompact.length < currentCompact.length * 0.72) return false;

  const similarity = transcriptWordSimilarity(current, text);
  const currentFragmented = fragmentedTranscriptScore(current);
  const incomingFragmented = fragmentedTranscriptScore(text);
  if (hasTerminalTranscriptPunctuation(text) && similarity >= 0.52 && text.length >= current.length * 0.55) return true;
  if (currentFragmented >= incomingFragmented + 2 && similarity >= 0.4) return true;
  return similarity >= 0.72 && text.length >= current.length * 0.75 && incomingFragmented <= currentFragmented;
}

function isTranscriptFragment(text, reference) {
  const incoming = compactTranscript(text);
  const existing = compactTranscript(reference);
  if (!incoming || !existing || incoming.length > existing.length) return false;
  if (existing.includes(incoming)) return true;
  const incomingWords = transcriptWords(text);
  if (incoming.length > 12 || incomingWords.length !== 1) return false;
  return transcriptWords(reference)
    .map((word) => compactTranscript(word))
    .some((word) => word && (word.startsWith(incoming) || incoming.startsWith(word)));
}

function mergeDisplayTurnText(existing, incoming) {
  const current = normalizeTranscriptText(existing);
  const text = normalizeTranscriptText(incoming);
  if (!text) return current;
  if (!current || isLikelyTranscriptReplacement(current, text)) return text;
  if (isTranscriptFragment(text, current)) return current;
  return mergeTranscript(current, text);
}

function removeTranscriptEchoSpan(text, reference) {
  const cleanText = normalizeTranscriptText(text);
  const refTokens = transcriptTokenParts(reference);
  const tokens = transcriptTokenParts(cleanText);
  if (refTokens.length < 2 || tokens.length < 2) return cleanText;

  let best = null;
  for (let start = 0; start < tokens.length; start += 1) {
    let length = 0;
    while (
      start + length < tokens.length
      && length < refTokens.length
      && tokens[start + length].compact === refTokens[length].compact
    ) {
      length += 1;
    }
    const enough = length >= Math.min(3, refTokens.length) || (refTokens.length === 2 && length === 2);
    if (enough && length / refTokens.length >= 0.62 && (!best || length > best.length)) {
      best = { start, length };
    }
  }

  if (!best) return cleanText;
  const first = tokens[best.start];
  const last = tokens[best.start + best.length - 1];
  return normalizeTranscriptText(`${cleanText.slice(0, first.start)} ${cleanText.slice(last.end)}`);
}

function isLikelyTranscriptEcho(text, reference) {
  const incoming = compactTranscript(text);
  const existing = compactTranscript(reference);
  if (incoming.length < 6 || existing.length < 6) return false;
  if (existing.includes(incoming)) return true;

  const incomingWords = transcriptWords(text);
  if (incomingWords.length < 2) return false;
  const existingWords = new Set(transcriptWords(reference));
  const matched = incomingWords.filter((word) => existingWords.has(word)).length;
  return matched >= 2 && matched / incomingWords.length >= 0.75;
}

function mergeAssistantTurnText(existing, incoming, priority, currentPriority) {
  const current = normalizeTranscriptText(existing);
  const text = normalizeTranscriptText(incoming);
  if (!text) return current;
  if (!current) return text;

  if (hasTerminalTranscriptPunctuation(current) && isTranscriptFragment(text, current)) return current;
  if (priority > currentPriority) {
    if (isTranscriptFragment(text, current) && !isLikelyTranscriptReplacement(current, text)) return current;
    return text;
  }
  if (isLikelyTranscriptReplacement(current, text)) return text;
  return mergeTranscript(current, text);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function rtviAssistantTextPriority(type) {
  if (type === "bot-output") return 4;
  if (type === "bot-transcription") return 3;
  if (type === "bot-tts-text") return 2;
  if (type === "bot-llm-text") return 1;
  if (type.startsWith("assistant-")) return 2;
  return 0;
}

function isRtviUserTextType(type) {
  return type === "user-transcription" || type === "user-llm-text" || type.startsWith("user-");
}

function isRtviAssistantTextType(type) {
  return rtviAssistantTextPriority(type) > 0;
}

function shouldEndConversation(text) {
  const clean = String(text || "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return false;
  return SHORT_END_CONVERSATION_PATTERN.test(clean)
    || END_CONVERSATION_PATTERNS.some((pattern) => pattern.test(clean));
}

function assistantCardT(key) {
  return ASSISTANT_CARD_TRANSLATIONS[UI_LOCALE]?.[key] || ASSISTANT_CARD_TRANSLATIONS.en[key] || key;
}

function mergeOpusFmtp(existing) {
  const params = new Map();
  for (const part of existing.split(";").map((item) => item.trim()).filter(Boolean)) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey.trim().toLowerCase();
    if (!key || OPUS_AUDIO_REMOVE_PARAMS.has(key)) continue;
    params.set(key, rest.length ? rest.join("=").trim() : "");
  }
  for (const [key, value] of Object.entries(OPUS_AUDIO_QUALITY_PARAMS)) params.set(key, value);
  return [...params.entries()].map(([key, value]) => (value ? `${key}=${value}` : key)).join(";");
}

function preferFullbandOpus(sdp) {
  if (!sdp) return sdp;
  const separator = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(/\r?\n/);
  const opusPayloads = new Set();
  const fmtpPayloads = new Set();

  for (const line of lines) {
    const rtpmap = /^a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?/i.exec(line);
    if (rtpmap) opusPayloads.add(rtpmap[1]);
    const fmtp = /^a=fmtp:(\d+)\s+/i.exec(line);
    if (fmtp) fmtpPayloads.add(fmtp[1]);
  }

  return lines
    .map((line) => {
      const fmtp = /^a=fmtp:(\d+)\s*(.*)$/i.exec(line);
      if (fmtp && opusPayloads.has(fmtp[1])) {
        return `a=fmtp:${fmtp[1]} ${mergeOpusFmtp(fmtp[2] || "")}`;
      }
      const rtpmap = /^a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?/i.exec(line);
      if (rtpmap && !fmtpPayloads.has(rtpmap[1])) {
        return `${line}${separator}a=fmtp:${rtpmap[1]} ${mergeOpusFmtp("")}`;
      }
      return line;
    })
    .join(separator);
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
  integrationDetect: (integrationId) =>
    appUrl(`api/assist/integrations/${encodeURIComponent(integrationId)}/detect`),
  integrationMcp: (integrationId) =>
    appUrl(`api/assist/integrations/${encodeURIComponent(integrationId)}/mcp/check`),
  models: (integrationId, capability = "llm") =>
    appUrl(`api/assist/integrations/${encodeURIComponent(integrationId)}/models?capability=${encodeURIComponent(capability)}`),
};

const REDACTED = "__redacted__";
const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";
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
const GOOGLE_IMAGEN_MODEL = "imagen-4.0-generate-001";
const FAL_IMAGE_MODEL = "fal-ai/fast-sdxl";
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
  ["google_cloud_tts", "Google Cloud TTS HTTP", Cloud],
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
  ["google_imagen", "Google Imagen", ImageIcon],
  ["fal_image", "fal Image Generation", ImageIcon],
  ["home_assistant_mcp", "Home Assistant MCP", Home],
  ["ha_mcp", "HA MCP Server Add-on", Home],
  ["mcp_server", "Custom MCP Server", Server],
];

const protectedIntegrationIds = [
  "gemini",
  "gemini-cloud",
  "openai",
  "openai-cloud",
  "ha-mcp",
  "ha-mcp-server",
  "web-search",
  "google-imagen",
  "fal-image",
];

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
const ttsStreamingIntegrationKinds = ["cartesia", "soniox", "gradium", "google_streaming_tts"];
const webSearchProviderKinds = ["openai_cloud", "gemini_cloud"];
const imageGenerationProviderKinds = ["google_imagen", "fal_image"];

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
  tools: ["home_assistant_mcp", "ha_mcp", "mcp_server"],
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
  if (provider === "google_imagen" || provider === "google-imagen") return { model: GOOGLE_IMAGEN_MODEL, text_model: GOOGLE_IMAGEN_MODEL, voice: "" };
  if (provider === "fal_image" || provider === "fal-image") return { model: FAL_IMAGE_MODEL, text_model: FAL_IMAGE_MODEL, voice: "" };
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
  shaped.ai_image_provider_id = shaped.ai_image_provider_id || "";
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
  if (integration.kind === "ha_mcp") {
    return integration.base_url || integration.endpoint ? "Automatic" : "Not detected";
  }
  if (integration.kind === "mcp_server") {
    return integration.base_url || integration.endpoint || "URL missing";
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
      "google_imagen",
      "fal_image",
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
  const autoDetectedIntegrations = useRef(new Set());
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

  useEffect(() => {
    if (
      integrationStage !== "detail" ||
      selectedIntegration?.kind !== "ha_mcp" ||
      selectedIntegration.base_url ||
      autoDetectedIntegrations.current.has(selectedIntegration.id)
    ) {
      return;
    }
    autoDetectedIntegrations.current.add(selectedIntegration.id);
    detectIntegration(selectedIntegration.id, { silent: true });
  }, [integrationStage, selectedIntegration?.base_url, selectedIntegration?.id, selectedIntegration?.kind]);

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

  function editActivePipeline() {
    if (!activeFlow) return;
    setTab("pipelines");
    openFlow(activeFlow.id);
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
    setMcpResult({ ...result, integration_id: "ha-mcp" });
    setMessage(
      result.ok
        ? { text: `MCP connected: ${result.tool_count} tools`, tone: "ok" }
        : { text: result.error || "MCP check failed", tone: "error" },
    );
    await refreshMcpHistory();
  }

  async function detectIntegration(integrationId, { silent = false } = {}) {
    if (!silent) setMessage({ text: "Detecting integration", tone: "" });
    const response = await fetch(API.integrationDetect(integrationId), { method: "POST" });
    if (!response.ok) {
      const detail = await response.text();
      if (!silent) setMessage({ text: detail || "Auto-detect failed", tone: "error" });
      return false;
    }
    const result = await response.json();
    const { detection, ...configPayload } = result;
    setConfig(ensureShape(configPayload));
    await refreshStatus();
    if (detection?.ok) {
      if (!silent) {
        setMessage({ text: `Detected ${detection.url}`, tone: "ok" });
      }
      return true;
    }
    if (!silent) {
      setMessage({ text: detection?.error || "Auto-detect failed", tone: "error" });
    }
    return false;
  }

  async function checkIntegrationMcp(integrationId) {
    setMessage({ text: "Checking MCP", tone: "" });
    const response = await fetch(API.integrationMcp(integrationId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow_id: selectedFlow.id, refresh: true }),
    });
    const result = await response.json();
    if (result.config) {
      setConfig(ensureShape(result.config));
    }
    setMcpResult({ ...result, integration_id: integrationId });
    setMessage(
      result.ok
        ? { text: `MCP connected: ${result.tool_count} tools`, tone: "ok" }
        : { text: result.error || "MCP check failed", tone: "error" },
    );
    await refreshStatus();
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
    if (["ha-mcp", "ha-mcp-server"].includes(integrationId)) setMcpResult(null);
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
            {tab === "assistant" && (
              <Button icon={Workflow} variant="secondary" onClick={editActivePipeline}>
                {t("Edit active pipeline")}
              </Button>
            )}
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
            detectIntegration={detectIntegration}
            checkIntegrationMcp={checkIntegrationMcp}
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
        "ha_mcp",
        "mcp_server",
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
    if (step.kind === "tools") {
      const hasMcp = config.integrations.some(
        (item) => ["home_assistant_mcp", "ha_mcp", "mcp_server"].includes(item.kind) && item.enabled,
      );
      if (!hasMcp) errors.push("Tools step needs at least one enabled MCP integration.");
      continue;
    }
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

function AssistantView({ config, flow, status }) {
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
              {["stt", "llm", "tts", "output"].includes(selectedStep.kind) && (
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
                    {(() => {
                      const selectedIntegration = config.integrations.find((integration) => integration.id === selectedStep.integration_id);
                      const availableIntegrations = config.integrations.filter((integration) =>
                        canUseIntegrationForStep(selectedStep.kind, integration, derivedMode),
                      );
                      return (
                        <>
                          {selectedIntegration && !availableIntegrations.some((integration) => integration.id === selectedIntegration.id) && (
                            <option value={selectedIntegration.id} disabled>
                              {selectedIntegration.name} (not supported here)
                            </option>
                          )}
                          {availableIntegrations.map((integration) => (
                            <option key={integration.id} value={integration.id}>
                              {integration.name}
                            </option>
                          ))}
                        </>
                      );
                    })()}
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
        {selectedStep?.kind === "tools" && (
          <div className="empty-state">
            MCP servers are configured globally in Integrations. Enable one or more MCP integrations there to expose tools to this pipeline.
          </div>
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
  detectIntegration,
  checkIntegrationMcp,
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
          <div className="integration-head-actions">
            <Toggle
              checked={selectedIntegration.enabled}
              onChange={(value) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, enabled: value }))}
              label={selectedIntegration.enabled ? t("Enabled") : "Disabled"}
            />
            {!protectedIntegrationIds.includes(selectedIntegration.id) && (
              <Button
                icon={Trash2}
                variant="danger"
                onClick={() => deleteIntegration(selectedIntegration.id)}
              />
            )}
          </div>
        </div>

        {!protectedIntegrationIds.includes(selectedIntegration.id) && (
          <SettingsSection>
            <TextSetting integration={selectedIntegration} field="name" label={t("Name")} updateIntegration={updateIntegration} />
          </SettingsSection>
        )}
        <IntegrationSettings
          integration={selectedIntegration}
          config={config}
          updateIntegration={updateIntegration}
          modelOptions={modelOptions}
          loadModelOptions={loadModelOptions}
          checkMcp={checkMcp}
          detectIntegration={detectIntegration}
          checkIntegrationMcp={checkIntegrationMcp}
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

function IntegrationSettings({
  integration,
  config,
  updateIntegration,
  modelOptions,
  loadModelOptions,
  checkMcp,
  detectIntegration,
  checkIntegrationMcp,
  resetMcpDefaults,
  mcpResult,
}) {
  const [manualMcpOpen, setManualMcpOpen] = useState(false);
  const visibleMcpResult =
    !mcpResult?.integration_id || mcpResult.integration_id === integration.id ? mcpResult : null;

  useEffect(() => {
    if (integration.kind === "home_assistant_mcp") {
      setManualMcpOpen(Boolean(integration.base_url || integration.token_configured || integration.token === REDACTED));
      return;
    }
    setManualMcpOpen(false);
  }, [integration.id, integration.kind]);

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
        {visibleMcpResult && (
          <div className={visibleMcpResult.ok ? "mcp-result ok wide" : "mcp-result error wide"}>
            <strong>{visibleMcpResult.ok ? `${visibleMcpResult.tool_count} tools available` : "MCP test failed"}</strong>
            <span>{visibleMcpResult.ok ? (visibleMcpResult.tools || []).slice(0, 8).join(", ") : visibleMcpResult.error}</span>
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

  if (integration.kind === "ha_mcp") {
    const detected = Boolean(integration.base_url || integration.endpoint);
    return (
      <SettingsSection title="HA MCP Server Add-on" status={detected ? t("Automatic") : t("Not detected")}>
        <div className={detected ? "mcp-mode ok wide" : "mcp-mode error wide"}>
          <strong>{detected ? t("Automatic") : t("Not detected")}</strong>
          <span>
            {detected
              ? "Using the secret MCP URL detected from the Home Assistant MCP Server add-on. No Bearer token is required."
              : "Install and start the Home Assistant MCP Server add-on, then run auto-detect."}
          </span>
        </div>
        {detected && (
          <div className="empty-state wide">
            <strong>{t("Detected endpoint")}</strong>
            <span>{integration.base_url || integration.endpoint}</span>
          </div>
        )}
        {visibleMcpResult && (
          <div className={visibleMcpResult.ok ? "mcp-result ok wide" : "mcp-result error wide"}>
            <strong>{visibleMcpResult.ok ? `${visibleMcpResult.tool_count} tools available` : "MCP test failed"}</strong>
            <span>{visibleMcpResult.ok ? (visibleMcpResult.tools || []).slice(0, 8).join(", ") : visibleMcpResult.error}</span>
          </div>
        )}
        {manualMcpOpen && (
          <TextSetting integration={integration} field="base_url" label={t("MCP server URL")} updateIntegration={updateIntegration} wide />
        )}
        <div className="button-row wide">
          <Button icon={Search} variant="secondary" onClick={() => detectIntegration?.(integration.id)}>
            {t("Auto-detect")}
          </Button>
          <Button icon={RefreshCw} variant="secondary" onClick={() => checkIntegrationMcp?.(integration.id)}>
            {t("Test MCP")}
          </Button>
          <Button icon={Settings} variant="secondary" onClick={() => setManualMcpOpen((value) => !value)}>
            {manualMcpOpen ? t("Hide manual") : t("Manual URL")}
          </Button>
        </div>
        <div className="empty-state wide">
          This add-on uses its own generated secret URL and Home Assistant Supervisor authentication. Pipecat Assist only needs the detected HTTP MCP endpoint.
        </div>
      </SettingsSection>
    );
  }

  if (integration.kind === "mcp_server") {
    return (
      <SettingsSection title={kindLabel(integration.kind)}>
        <TextSetting integration={integration} field="base_url" label="MCP server URL" updateIntegration={updateIntegration} wide />
        <SecretSetting integration={integration} field="token" label="Bearer token" updateIntegration={updateIntegration} wide />
        <div className="empty-state wide">
          Enable multiple MCP integrations to expose all of their tools to Pipecat Assist. Home Assistant MCP keeps original tool names; additional servers are prefixed automatically.
        </div>
      </SettingsSection>
    );
  }

  if (integration.kind === "web_search") {
    return <WebSearchSettings integration={integration} config={config} updateIntegration={updateIntegration} modelOptions={modelOptions} loadModelOptions={loadModelOptions} />;
  }

  if (["google_imagen", "fal_image"].includes(integration.kind)) {
    const keyLabel = integration.kind === "google_imagen" ? "Google API key" : "fal API key";
    return (
      <>
        <SettingsSection title="Image generation" status={secretStatus(integration, "api_key")}>
          <SecretSetting integration={integration} field="api_key" label={keyLabel} updateIntegration={updateIntegration} />
          <ModelSetting
            integration={integration}
            field="default_model"
            label="Image model"
            updateIntegration={updateIntegration}
            modelOptions={modelOptions}
            loadModelOptions={loadModelOptions}
            capability="image"
          />
        </SettingsSection>
        <div className="empty-state wide">
          This provider is used by Home Assistant AI Tasks image-generation requests, not by the realtime voice pipeline.
        </div>
      </>
    );
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
      {(title || status) && (
        <div className="section-title">
          {title && <strong>{title}</strong>}
          {status && <span>{status}</span>}
        </div>
      )}
      <div className="form-grid">{children}</div>
    </div>
  );
}

function modelFieldValue(integration, field) {
  const value = integration[field] || "";
  if (integration.kind === "gemini" && field === "default_realtime_model") {
    return value.replace(/^models\//, "");
  }
  return value;
}

function modelFieldUpdateValue(integration, field, value) {
  if (integration.kind === "gemini" && field === "default_realtime_model") {
    return value.replace(/^models\//, "");
  }
  return value;
}

function TextSetting({ integration, field, label, updateIntegration, wide = false }) {
  return (
    <Field label={label} wide={wide}>
      <input
        autoComplete="off"
        value={modelFieldValue(integration, field)}
        onChange={(event) =>
          updateIntegration(integration.id, (item) => ({
            ...item,
            [field]: modelFieldUpdateValue(integration, field, event.target.value),
          }))
        }
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
        value={modelFieldValue(integration, field)}
        onFocus={() => loadModelOptions?.(integration.id, capability)}
        onChange={(event) =>
          updateIntegration(integration.id, (item) => ({
            ...item,
            [field]: modelFieldUpdateValue(integration, field, event.target.value),
          }))
        }
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
  const canvasRef = useRef(null);
  const channelRef = useRef(null);
  const closingRef = useRef(false);
  const connectTimeoutRef = useRef(null);
  const pingRef = useRef(null);
  const peerRef = useRef(null);
  const readySentRef = useRef(false);
  const streamRef = useRef(null);
  const lastStoppedRef = useRef(0);
  const stateRef = useRef("idle");
  const messagesRef = useRef([]);
  const transcriptFlowRef = useRef(null);
  const transcriptSeqRef = useRef(0);
  const currentUserMessageIdRef = useRef("");
  const currentAssistantMessageIdRef = useRef("");
  const streamAssistantMessageIdRef = useRef("");
  const userTranscriptRef = useRef("");
  const assistantTranscriptRef = useRef("");
  const partialTranscriptRef = useRef("");
  const currentUserTextRef = useRef("");
  const currentUserUpdatedAtRef = useRef(0);
  const assistantTurnBaseRef = useRef("");
  const assistantTurnTextRef = useRef("");
  const assistantTurnPriorityRef = useRef(0);
  const assistantTurnActiveRef = useRef(false);
  const assistantLastTurnTextRef = useRef("");
  const assistantLastTurnPriorityRef = useRef(0);
  const assistantLastTurnFinishedAtRef = useRef(0);
  const lastAssistantTextAtRef = useRef(0);
  const lastUserTextAtRef = useRef(0);
  const botSpeakingRef = useRef(false);
  const ignoreLocalSpeechUntilRef = useRef(0);
  const assistantTurnFinishTimerRef = useRef(null);
  const endConversationPendingRef = useRef(false);
  const endConversationTimerRef = useRef(null);
  const endConversationStoppingRef = useRef(false);
  const localSpeechRecognitionRef = useRef(null);
  const localSpeechEndingRef = useRef(false);
  const localSpeechPausedForAssistantRef = useRef(false);
  const localSpeechResumeTimerRef = useRef(null);
  const scrollFrameRef = useRef(null);
  const scrollPosRef = useRef(0);
  const scrollTargetRef = useRef(0);
  const scrollLastTsRef = useRef(0);
  const visualizerContextRef = useRef(null);
  const visualizerEnergyRef = useRef(0);
  const visualizerFrameRef = useRef(null);
  const visualizerInputsRef = useRef({});
  const [state, setState] = useState("idle");
  const [detail, setDetail] = useState(assistantCardT("ready"));
  const [messages, setMessages] = useState([]);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const readiness = voiceReadiness(config, flow);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    visualizerFrameRef.current = requestAnimationFrame(drawVisualizer);
    return () => {
      disposeSession(true, false);
      stopLocalSpeechRecognition();
      cancelLocalSpeechResume();
      clearEndConversationRequest();
      stopTranscriptScroll();
      if (assistantTurnFinishTimerRef.current) clearTimeout(assistantTurnFinishTimerRef.current);
      if (visualizerFrameRef.current) cancelAnimationFrame(visualizerFrameRef.current);
      disconnectVisualizerInputs(true);
    };
  }, []);

  useEffect(() => {
    scrollTranscriptToEnd();
  }, [messages]);

  useEffect(() => {
    if (state === "error" && readiness.ok) {
      setSessionState("idle", assistantCardT("ready"));
    }
  }, [readiness.ok, state]);

  function setSessionState(nextState, nextDetail = detail) {
    stateRef.current = nextState;
    setState(nextState);
    setDetail(nextDetail);
  }

  function clearEndConversationRequest() {
    if (endConversationTimerRef.current) {
      clearTimeout(endConversationTimerRef.current);
      endConversationTimerRef.current = null;
    }
    endConversationPendingRef.current = false;
  }

  function finishConversationAfterAssistant(delayMs = 350) {
    if (endConversationStoppingRef.current) return;
    endConversationStoppingRef.current = true;
    clearEndConversationRequest();
    window.setTimeout(() => {
      stopVoiceTest();
      endConversationStoppingRef.current = false;
    }, delayMs);
  }

  function requestConversationEnd(fallbackMs = 8000) {
    endConversationPendingRef.current = true;
    if (endConversationTimerRef.current) clearTimeout(endConversationTimerRef.current);
    endConversationTimerRef.current = window.setTimeout(() => {
      finishConversationAfterAssistant(0);
    }, fallbackMs);
  }

  function commitMessages(updater) {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
  }

  function chatMessageById(id) {
    return messagesRef.current.find((message) => message.id === id) || null;
  }

  function appendChatMessage(type, text) {
    const id = `m${++transcriptSeqRef.current}`;
    const message = { id, type, text: normalizeTranscriptText(text), entered: false, streaming: false };
    commitMessages((current) => {
      const next = [...current, message];
      while (next.length > 12) {
        const removed = next.shift();
        if (removed?.id === currentUserMessageIdRef.current) currentUserMessageIdRef.current = "";
        if (removed?.id === currentAssistantMessageIdRef.current) currentAssistantMessageIdRef.current = "";
        if (removed?.id === streamAssistantMessageIdRef.current) streamAssistantMessageIdRef.current = "";
      }
      return next;
    });
    requestAnimationFrame(() => {
      commitMessages((current) => current.map((item) => (item.id === id ? { ...item, entered: true } : item)));
    });
    return id;
  }

  function updateChatMessage(id, text, options = {}) {
    const clean = normalizeTranscriptText(text);
    commitMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, text: clean, streaming: Boolean(options.stream) } : message,
      ),
    );
  }

  function setCurrentUserCaption(text, startsNewTurn) {
    const clean = normalizeTranscriptText(text);
    if (!clean) return;
    if (startsNewTurn || !currentUserMessageIdRef.current || !chatMessageById(currentUserMessageIdRef.current)) {
      currentUserMessageIdRef.current = appendChatMessage("user", clean);
    } else {
      updateChatMessage(currentUserMessageIdRef.current, clean);
    }
  }

  function setCurrentAssistantCaption(text) {
    const clean = normalizeTranscriptText(text);
    if (!clean) return;
    if (!currentAssistantMessageIdRef.current || !chatMessageById(currentAssistantMessageIdRef.current)) {
      currentAssistantMessageIdRef.current = appendChatMessage("assistant", clean);
    }
    streamAssistantMessageIdRef.current = currentAssistantMessageIdRef.current;
    updateChatMessage(currentAssistantMessageIdRef.current, clean, { stream: true });
  }

  function finalizeAssistantCaption() {
    if (!currentAssistantMessageIdRef.current || !assistantTurnTextRef.current) return;
    updateChatMessage(currentAssistantMessageIdRef.current, assistantTurnTextRef.current);
    streamAssistantMessageIdRef.current = "";
  }

  function clearTranscriptData() {
    userTranscriptRef.current = "";
    assistantTranscriptRef.current = "";
    partialTranscriptRef.current = "";
    currentUserTextRef.current = "";
    currentUserUpdatedAtRef.current = 0;
    assistantTurnBaseRef.current = "";
    assistantTurnTextRef.current = "";
    assistantTurnPriorityRef.current = 0;
    assistantTurnActiveRef.current = false;
    assistantLastTurnTextRef.current = "";
    assistantLastTurnPriorityRef.current = 0;
    assistantLastTurnFinishedAtRef.current = 0;
    lastAssistantTextAtRef.current = 0;
    lastUserTextAtRef.current = 0;
    botSpeakingRef.current = false;
    ignoreLocalSpeechUntilRef.current = 0;
    clearEndConversationRequest();
    currentUserMessageIdRef.current = "";
    currentAssistantMessageIdRef.current = "";
    streamAssistantMessageIdRef.current = "";
    transcriptSeqRef.current = 0;
    stopTranscriptScroll();
    scrollPosRef.current = 0;
    scrollTargetRef.current = 0;
    messagesRef.current = [];
    setMessages([]);
  }

  function renderTranscriptText(message) {
    if (!message.streaming || message.text.length <= STREAM_FADE_LEN) return message.text;
    const solid = message.text.slice(0, message.text.length - STREAM_FADE_LEN);
    const tail = message.text.slice(message.text.length - STREAM_FADE_LEN);
    return (
      <>
        {solid}
        {Array.from({ length: STREAM_FADE_GROUPS }, (_, index) => (
          <span key={index} style={{ opacity: ((STREAM_FADE_GROUPS - index) / STREAM_FADE_GROUPS).toFixed(2) }}>
            {tail.slice(index * STREAM_CHARS_PER_GROUP, index * STREAM_CHARS_PER_GROUP + STREAM_CHARS_PER_GROUP)}
          </span>
        ))}
      </>
    );
  }

  function scrollTranscriptToEnd() {
    const el = transcriptFlowRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    scrollTargetRef.current = max;
    startTranscriptScroll();
  }

  function startTranscriptScroll() {
    if (scrollFrameRef.current) return;
    const el = transcriptFlowRef.current;
    if (el) scrollPosRef.current = el.scrollTop;
    scrollTargetRef.current = Math.max(scrollTargetRef.current || 0, el ? el.scrollHeight - el.clientHeight : 0);
    scrollLastTsRef.current = 0;
    scrollFrameRef.current = requestAnimationFrame(transcriptScrollTick);
  }

  function stopTranscriptScroll() {
    if (scrollFrameRef.current) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    scrollLastTsRef.current = 0;
  }

  function transcriptScrollTick(timestamp) {
    const el = transcriptFlowRef.current;
    if (!el) {
      stopTranscriptScroll();
      return;
    }
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) {
      stopTranscriptScroll();
      return;
    }
    if (!scrollLastTsRef.current) scrollLastTsRef.current = timestamp;
    const deltaMs = timestamp - scrollLastTsRef.current;
    scrollLastTsRef.current = timestamp;
    const target = Math.min(max, Math.max(scrollTargetRef.current || 0, max));
    const distance = target - scrollPosRef.current;
    const absDistance = Math.abs(distance);
    if (absDistance <= 0.5) {
      el.scrollTop = target;
      stopTranscriptScroll();
      return;
    }
    const easing = Math.max(0.08, Math.min(0.32, deltaMs / 160));
    const minStep = Math.min(absDistance, Math.max(0.7, deltaMs * 0.06));
    const step = Math.sign(distance) * Math.max(minStep, absDistance * easing);
    scrollPosRef.current = Math.min(max, Math.max(0, scrollPosRef.current + step));
    el.scrollTop = scrollPosRef.current;
    scrollFrameRef.current = requestAnimationFrame(transcriptScrollTick);
  }

  function ensureVisualizerInput(name, stream) {
    if (!stream?.getAudioTracks?.().length) return;
    const trackIds = stream.getAudioTracks().map((track) => track.id).join(",");
    if (visualizerInputsRef.current[name]?.trackIds === trackIds) return;
    disconnectVisualizerInput(name);

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;
    try {
      if (!visualizerContextRef.current || visualizerContextRef.current.state === "closed") {
        visualizerContextRef.current = new AudioContextConstructor();
      }
      if (visualizerContextRef.current.state === "suspended") {
        visualizerContextRef.current.resume().catch(() => {});
      }
      const source = visualizerContextRef.current.createMediaStreamSource(stream);
      const analyser = visualizerContextRef.current.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = name === "remote" ? 0.72 : 0.82;
      source.connect(analyser);
      visualizerInputsRef.current[name] = {
        analyser,
        data: new Uint8Array(analyser.frequencyBinCount),
        source,
        trackIds,
      };
    } catch {
      disconnectVisualizerInput(name);
    }
  }

  function disconnectVisualizerInput(name) {
    const input = visualizerInputsRef.current[name];
    if (!input) return;
    try {
      input.source.disconnect();
    } catch {
      // Ignore already disconnected visualizer nodes.
    }
    delete visualizerInputsRef.current[name];
  }

  function disconnectVisualizerInputs(closeContext = false) {
    for (const name of Object.keys(visualizerInputsRef.current)) disconnectVisualizerInput(name);
    if (closeContext && visualizerContextRef.current && visualizerContextRef.current.state !== "closed") {
      visualizerContextRef.current.close().catch(() => {});
      visualizerContextRef.current = null;
    }
    visualizerEnergyRef.current = 0;
  }

  function visualizerEnergyFor(name) {
    const input = visualizerInputsRef.current[name];
    if (!input?.analyser) return 0;
    input.analyser.getByteFrequencyData(input.data);
    const limit = Math.min(input.data.length, 96);
    let sum = 0;
    for (let index = 0; index < limit; index += 1) sum += input.data[index];
    return Math.min(1, sum / Math.max(1, limit) / 150);
  }

  function drawVisualizer() {
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext("2d");
      const accent = hexToRgb(ASSISTANT_CARD_ACCENT_HEX);
      const localEnergy = visualizerEnergyFor("local");
      const remoteEnergy = visualizerEnergyFor("remote");
      const running = ["requesting", "connecting", "connected"].includes(stateRef.current);
      const audioActive = Math.max(localEnergy, remoteEnergy) > 0.018
        || botSpeakingRef.current
        || assistantTurnActiveRef.current
        || Boolean(partialTranscriptRef.current);
      const idleEnergy = running ? 0.06 : 0.025;
      const targetEnergy = Math.max(localEnergy, remoteEnergy, idleEnergy);
      visualizerEnergyRef.current = visualizerEnergyRef.current * 0.82 + targetEnergy * 0.18;
      const energy = visualizerEnergyRef.current;
      const time = audioActive || running ? performance.now() / 1000 : 0;

      ctx.clearRect(0, 0, width, height);
      const horizon = height * 0.68;
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0)`);
      gradient.addColorStop(0.24, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.025)`);
      gradient.addColorStop(0.68, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.18)`);
      gradient.addColorStop(1, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.55)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(width / 2, horizon + height * 0.68);
      ctx.scale(1, 0.32);
      ctx.beginPath();
      ctx.arc(0, 0, width * (0.5 + energy * 0.07), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(190, 220, 255, ${0.34 + energy * 0.28})`;
      ctx.lineWidth = Math.max(1, 1.4 * dpr);
      ctx.shadowColor = `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.88)`;
      ctx.shadowBlur = 18 * dpr + energy * 30 * dpr;
      ctx.stroke();
      ctx.restore();

      const drawWave = (color, offset, amplitude, widthScale, alpha) => {
        ctx.beginPath();
        for (let x = 0; x <= width; x += Math.max(2, width / 120)) {
          const progress = x / width;
          const envelope = Math.sin(progress * Math.PI);
          const y = height * 0.62
            + Math.sin(progress * Math.PI * 4.6 + time * 2.2 + offset) * amplitude * envelope
            + Math.sin(progress * Math.PI * 9.2 - time * 1.4 - offset) * amplitude * 0.28 * envelope;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color.replace("ALPHA", alpha.toFixed(3));
        ctx.lineWidth = Math.max(1, widthScale * dpr);
        ctx.shadowColor = color.replace("ALPHA", "0.85");
        ctx.shadowBlur = 10 * dpr + energy * 18 * dpr;
        ctx.stroke();
      };

      drawWave("rgba(255, 255, 255, ALPHA)", 0, 10 * dpr + energy * 34 * dpr, 1.35, 0.52 + energy * 0.42);
      drawWave(`rgba(${Math.min(255, accent.r + 61)}, ${Math.min(255, accent.g + 61)}, 255, ALPHA)`, 1.7, 16 * dpr + energy * 46 * dpr, 1.1, 0.42 + energy * 0.32);
      drawWave(`rgba(${accent.r}, ${accent.g}, ${accent.b}, ALPHA)`, 3.1, 20 * dpr + energy * 58 * dpr, 0.9, 0.28 + energy * 0.28);
    }
    visualizerFrameRef.current = requestAnimationFrame(drawVisualizer);
  }

  function startLocalSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (localSpeechPausedForAssistantRef.current || assistantTurnActiveRef.current || botSpeakingRef.current) return;
    stopLocalSpeechRecognition();
    try {
      const recognition = new SpeechRecognition();
      localSpeechEndingRef.current = false;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = String(navigator.language || UI_LOCALE || "en").replace("_", "-");
      recognition.onresult = (event) => {
        if (localSpeechPausedForAssistantRef.current || assistantTurnActiveRef.current || botSpeakingRef.current) return;
        let finalText = "";
        let interimText = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result?.[0]?.transcript || "";
          if (!text) continue;
          if (result.isFinal) finalText = mergeTranscript(finalText, text);
          else interimText = mergeTranscript(interimText, text);
        }
        const spokenText = finalText || interimText;
        if (shouldIgnoreLocalSpeech(spokenText)) return;
        if (finalText) applyUserText(finalText, true);
        else if (interimText) applyUserText(interimText, false);
      };
      recognition.onerror = () => {
        partialTranscriptRef.current = "";
      };
      recognition.onend = () => {
        localSpeechRecognitionRef.current = null;
        if (
          localSpeechEndingRef.current
          || localSpeechPausedForAssistantRef.current
          || assistantTurnActiveRef.current
          || botSpeakingRef.current
          || !["requesting", "connecting", "connected"].includes(stateRef.current)
        ) return;
        window.setTimeout(() => startLocalSpeechRecognition(), 250);
      };
      localSpeechRecognitionRef.current = recognition;
      recognition.start();
    } catch {
      localSpeechRecognitionRef.current = null;
    }
  }

  function stopLocalSpeechRecognition() {
    const recognition = localSpeechRecognitionRef.current;
    localSpeechRecognitionRef.current = null;
    localSpeechEndingRef.current = true;
    if (!recognition) return;
    try {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    } catch {
      try {
        recognition.abort();
      } catch {
        // Ignore browser-specific SpeechRecognition teardown errors.
      }
    }
  }

  function cancelLocalSpeechResume() {
    if (localSpeechResumeTimerRef.current) {
      clearTimeout(localSpeechResumeTimerRef.current);
      localSpeechResumeTimerRef.current = null;
    }
    localSpeechPausedForAssistantRef.current = false;
  }

  function pauseLocalSpeechForAssistant() {
    if (localSpeechResumeTimerRef.current) {
      clearTimeout(localSpeechResumeTimerRef.current);
      localSpeechResumeTimerRef.current = null;
    }
    localSpeechPausedForAssistantRef.current = true;
    partialTranscriptRef.current = "";
    stopLocalSpeechRecognition();
  }

  function resumeLocalSpeechAfterAssistant(delayMs = 450) {
    if (!localSpeechPausedForAssistantRef.current) return;
    if (localSpeechResumeTimerRef.current) clearTimeout(localSpeechResumeTimerRef.current);
    localSpeechResumeTimerRef.current = window.setTimeout(() => {
      localSpeechResumeTimerRef.current = null;
      if (!localSpeechPausedForAssistantRef.current) return;
      localSpeechPausedForAssistantRef.current = false;
      if (["requesting", "connecting", "connected"].includes(stateRef.current) && !localSpeechRecognitionRef.current) {
        startLocalSpeechRecognition();
      }
    }, delayMs);
  }

  function assistantEchoReferences() {
    return [
      assistantTurnTextRef.current,
      assistantLastTurnTextRef.current,
      assistantTranscriptRef.current,
    ].filter(Boolean);
  }

  function cleanUserSpeechText(text) {
    let cleaned = normalizeTranscriptText(text);
    for (const reference of assistantEchoReferences()) {
      cleaned = removeTranscriptEchoSpan(cleaned, reference);
    }
    return cleaned;
  }

  function shouldIgnoreLocalSpeech(text) {
    if (!text) return false;
    const assistantReference = mergeTranscript(assistantTranscriptRef.current, assistantTurnTextRef.current);
    if (!assistantReference) return false;
    return (botSpeakingRef.current || Date.now() < (ignoreLocalSpeechUntilRef.current || 0))
      && isLikelyTranscriptEcho(text, assistantReference);
  }

  function applyUserText(text, finalEvent) {
    const cleanedText = cleanUserSpeechText(text);
    if (!cleanedText) return;
    if (assistantEchoReferences().some((reference) => isLikelyTranscriptEcho(cleanedText, reference))) return;
    const now = Date.now();
    lastUserTextAtRef.current = now;
    const startsNewUserTurn = lastAssistantTextAtRef.current > currentUserUpdatedAtRef.current
      || (!partialTranscriptRef.current && currentUserUpdatedAtRef.current && now - currentUserUpdatedAtRef.current > 8000);
    if (finalEvent) {
      currentUserTextRef.current = startsNewUserTurn
        ? cleanedText
        : mergeDisplayTurnText(currentUserTextRef.current, cleanedText);
      currentUserUpdatedAtRef.current = now;
      userTranscriptRef.current = mergeTranscript(userTranscriptRef.current, cleanedText);
      partialTranscriptRef.current = "";
    } else {
      partialTranscriptRef.current = cleanedText;
      currentUserTextRef.current = startsNewUserTurn
        ? cleanedText
        : mergeDisplayTurnText(currentUserTextRef.current, cleanedText);
      currentUserUpdatedAtRef.current = now;
    }
    setCurrentUserCaption(currentUserTextRef.current, startsNewUserTurn);
    if (shouldEndConversation(`${currentUserTextRef.current} ${partialTranscriptRef.current}`)) {
      requestConversationEnd(9000);
    }
  }

  function shouldIgnoreServerUserTranscription(finalEvent) {
    const hasBrowserSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    if (hasBrowserSpeech) return true;
    return !finalEvent;
  }

  function beginAssistantTurn() {
    if (assistantTurnFinishTimerRef.current) {
      clearTimeout(assistantTurnFinishTimerRef.current);
      assistantTurnFinishTimerRef.current = null;
    }
    pauseLocalSpeechForAssistant();
    if (assistantTurnActiveRef.current) {
      botSpeakingRef.current = true;
      ignoreLocalSpeechUntilRef.current = Date.now() + 1200;
      return;
    }
    assistantTurnBaseRef.current = normalizeTranscriptText(assistantTranscriptRef.current);
    assistantTurnTextRef.current = "";
    assistantTurnPriorityRef.current = 0;
    assistantTurnActiveRef.current = true;
    currentAssistantMessageIdRef.current = "";
    streamAssistantMessageIdRef.current = "";
    botSpeakingRef.current = true;
    ignoreLocalSpeechUntilRef.current = Date.now() + 1200;
  }

  function finishAssistantTurn(resumeLocalSpeech = true) {
    if (assistantTurnFinishTimerRef.current) {
      clearTimeout(assistantTurnFinishTimerRef.current);
      assistantTurnFinishTimerRef.current = null;
    }
    assistantTranscriptRef.current = normalizeTranscriptText(assistantTranscriptRef.current);
    assistantTurnBaseRef.current = assistantTranscriptRef.current;
    if (assistantTurnTextRef.current) {
      finalizeAssistantCaption();
      assistantLastTurnTextRef.current = assistantTurnTextRef.current;
      assistantLastTurnPriorityRef.current = assistantTurnPriorityRef.current;
      assistantLastTurnFinishedAtRef.current = Date.now();
      lastAssistantTextAtRef.current = assistantLastTurnFinishedAtRef.current;
    }
    assistantTurnTextRef.current = "";
    assistantTurnPriorityRef.current = 0;
    assistantTurnActiveRef.current = false;
    botSpeakingRef.current = false;
    streamAssistantMessageIdRef.current = "";
    ignoreLocalSpeechUntilRef.current = Date.now() + 900;
    if (endConversationPendingRef.current) {
      finishConversationAfterAssistant(350);
      return;
    }
    if (resumeLocalSpeech && ["requesting", "connecting", "connected"].includes(stateRef.current)) {
      resumeLocalSpeechAfterAssistant(450);
    }
  }

  function scheduleAssistantTurnFinish(delayMs = 1000) {
    if (assistantTurnFinishTimerRef.current) clearTimeout(assistantTurnFinishTimerRef.current);
    botSpeakingRef.current = false;
    ignoreLocalSpeechUntilRef.current = Date.now() + delayMs;
    assistantTurnFinishTimerRef.current = window.setTimeout(() => finishAssistantTurn(), delayMs);
  }

  function ensureAssistantTurn() {
    if (!assistantTurnActiveRef.current) beginAssistantTurn();
  }

  function applyAssistantText(text, priority) {
    if (isLikelyTranscriptEcho(text, mergeTranscript(currentUserTextRef.current, partialTranscriptRef.current))) return;
    const normalizedText = normalizeTranscriptText(text);
    if (!normalizedText) return;
    const now = Date.now();
    const recentAssistantReplayWindow = assistantLastTurnFinishedAtRef.current
      && lastUserTextAtRef.current < assistantLastTurnFinishedAtRef.current
      && now - assistantLastTurnFinishedAtRef.current < 4500;
    const assistantReference = mergeTranscript(assistantTranscriptRef.current, assistantTurnTextRef.current);
    if (
      (hasTerminalTranscriptPunctuation(assistantTurnTextRef.current)
        && isTranscriptFragment(normalizedText, assistantTurnTextRef.current))
      || (recentAssistantReplayWindow && isTranscriptFragment(normalizedText, assistantLastTurnTextRef.current))
      || (recentAssistantReplayWindow && priority <= (assistantLastTurnPriorityRef.current || 0)
        && isTranscriptFragment(normalizedText, assistantReference))
    ) return;
    ensureAssistantTurn();
    if (assistantTurnFinishTimerRef.current) {
      clearTimeout(assistantTurnFinishTimerRef.current);
      assistantTurnFinishTimerRef.current = null;
    }
    const previousTurnPriority = assistantTurnPriorityRef.current || 0;
    if (priority > previousTurnPriority) {
      assistantTurnPriorityRef.current = priority;
      assistantTurnTextRef.current = mergeAssistantTurnText(
        assistantTurnTextRef.current,
        normalizedText,
        priority,
        previousTurnPriority,
      );
    } else if (priority === assistantTurnPriorityRef.current) {
      assistantTurnTextRef.current = mergeAssistantTurnText(
        assistantTurnTextRef.current,
        normalizedText,
        priority,
        assistantTurnPriorityRef.current,
      );
    } else {
      return;
    }
    assistantTranscriptRef.current = mergeTranscript(assistantTurnBaseRef.current, assistantTurnTextRef.current);
    lastAssistantTextAtRef.current = Date.now();
    ignoreLocalSpeechUntilRef.current = Date.now() + 1200;
    setCurrentAssistantCaption(assistantTurnTextRef.current);
    if (shouldEndConversation(assistantTranscriptRef.current)) {
      requestConversationEnd(5000);
    }
  }

  function textFromEvent(data) {
    if (!data || typeof data !== "object") return "";
    const nested = data.data && typeof data.data === "object" ? data.data : {};
    return firstString(
      data.text,
      data.transcript,
      data.message,
      data.content,
      data.delta,
      nested.text,
      nested.transcript,
      nested.message,
      nested.content,
      nested.delta,
    );
  }

  function handleRealtimeMessage(raw) {
    if (typeof raw !== "string" || !raw.trim().startsWith("{")) return;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const type = String(message.type || message.event || message.name || "").toLowerCase();
    const label = String(message.label || "").toLowerCase();
    if (["conversation-ended", "conversation_end", "end-conversation"].includes(type)) {
      requestConversationEnd(1200);
      return;
    }
    if (type === "bot-llm-started" || type === "bot-tts-started" || type === "bot-started-speaking") {
      beginAssistantTurn();
    }
    if (type === "bot-llm-stopped" || type === "bot-tts-stopped" || type === "bot-stopped-speaking") {
      scheduleAssistantTurnFinish();
    }

    const text = textFromEvent(message);
    if (!text) return;

    const finalEvent = type === "user-llm-text"
      || type.includes("final")
      || Boolean(message.data?.final || message.is_final || message.final);

    if (isRtviUserTextType(type)) {
      if (type === "user-transcription" && shouldIgnoreServerUserTranscription(finalEvent)) return;
      applyUserText(text, finalEvent);
      return;
    }

    if (type === "bot-llm-text" && !finalEvent) return;
    if (isRtviAssistantTextType(type) || (label.includes("bot") && !type.startsWith("user-"))) {
      applyAssistantText(text, rtviAssistantTextPriority(type) || 1);
    }
  }

  function audioBufferMs() {
    const value = Number(config?.audio_buffer_ms ?? ASSISTANT_CARD_AUDIO_BUFFER_MS);
    if (!Number.isFinite(value)) return ASSISTANT_CARD_AUDIO_BUFFER_MS;
    return clamp(Math.round(value), 0, 4000);
  }

  function applyRemoteAudioBuffer(receiver) {
    const targetMs = audioBufferMs();
    if (!receiver || !targetMs) return;
    try {
      if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = targetMs;
    } catch {
      // Browser support for jitterBufferTarget is uneven.
    }
    const targetSeconds = targetMs / 1000;
    for (const legacyName of ["playoutDelayHint", "jitterBufferDelayHint"]) {
      try {
        if (legacyName in receiver) receiver[legacyName] = targetSeconds;
      } catch {
        // Ignore unsupported WebRTC delay hints.
      }
    }
  }

  function attachAudio(remoteStream) {
    if (!audioRef.current || !remoteStream) return;
    if (audioRef.current.srcObject !== remoteStream) audioRef.current.srcObject = remoteStream;
    audioRef.current.autoplay = true;
    audioRef.current.playsInline = true;
    audioRef.current.muted = false;
    audioRef.current.volume = 1;
    const playPromise = audioRef.current.play();
    if (playPromise?.catch) {
      playPromise.catch((err) => {
        if (err?.name !== "NotAllowedError" || audioBlocked) return;
        setAudioBlocked(true);
        setDetail(assistantCardT("audioBlocked"));
      });
    }
  }

  function disposeSession(markStopped = true, updateUi = true) {
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
    peerRef.current?.getSenders?.().forEach((sender) => sender.track?.stop());
    peerRef.current?.getReceivers?.().forEach((receiver) => receiver.track?.stop());
    peerRef.current?.getTransceivers?.().forEach((transceiver) => {
      try {
        transceiver.stop();
      } catch {
        // Some WebViews throw while transceivers are already closing.
      }
    });
    peerRef.current?.close();
    peerRef.current = null;
    stopLocalSpeechRecognition();
    cancelLocalSpeechResume();
    if (assistantTurnFinishTimerRef.current) {
      clearTimeout(assistantTurnFinishTimerRef.current);
      assistantTurnFinishTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    disconnectVisualizerInputs();
    if (audioRef.current) {
      const remoteStream = audioRef.current.srcObject;
      if (remoteStream?.getTracks) remoteStream.getTracks().forEach((track) => track.stop());
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current.removeAttribute("src");
      try {
        audioRef.current.load();
      } catch {
        // Mobile WebViews can throw while releasing a live MediaStream.
      }
    }
    if (updateUi) setAudioBlocked(false);
    if (markStopped) lastStoppedRef.current = Date.now();
  }

  function clearSession(nextState = "idle", nextDetail = assistantCardT("ready")) {
    disposeSession();
    clearTranscriptData();
    setSessionState(nextState, nextDetail);
    window.setTimeout(() => {
      closingRef.current = false;
    }, 0);
  }

  function stopVoiceTest(updateState = true) {
    endConversationStoppingRef.current = true;
    clearEndConversationRequest();
    finishAssistantTurn(false);
    endConversationStoppingRef.current = false;
    clearSession(updateState ? "idle" : stateRef.current, updateState ? assistantCardT("ready") : detail);
  }

  async function startVoiceTest() {
    const currentReadiness = voiceReadiness(config, flow);
    if (!currentReadiness.ok) {
      setSessionState("error", currentReadiness.detail);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setSessionState("error", assistantCardT("microphoneUnavailable"));
      return;
    }

    disposeSession(false);
    clearTranscriptData();
    closingRef.current = false;
    setSessionState("requesting", assistantCardT("waitingForMicrophone"));

    try {
      const remainingAudioReleaseMs = Math.max(0, 450 - (Date.now() - lastStoppedRef.current));
      if (remainingAudioReleaseMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingAudioReleaseMs));
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      streamRef.current = stream;
      ensureVisualizerInput("local", stream);
      startLocalSpeechRecognition();

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
      channel.onmessage = (event) => handleRealtimeMessage(event.data);
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
                  library_version: ASSISTANT_CARD_VERSION,
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
        applyRemoteAudioBuffer(event.receiver);
        const remoteStream = event.streams[0] || new MediaStream([event.track]);
        ensureVisualizerInput("remote", remoteStream);
        attachAudio(remoteStream);
      };

      const markConnected = () => {
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        setSessionState("connected", assistantCardT("connectedDetail"));
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

      setSessionState("connecting", "Creating WebRTC offer");
      const offer = await peerConnection.createOffer({ voiceActivityDetection: false });
      await peerConnection.setLocalDescription({ type: offer.type, sdp: preferFullbandOpus(offer.sdp) });
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
            language: navigator.language || UI_LOCALE || "en",
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
      peerConnection.getReceivers?.()
        .filter((receiver) => receiver.track?.kind === "audio")
        .forEach((receiver) => applyRemoteAudioBuffer(receiver));
      setDetail(assistantCardT("connectingAudio"));
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
  const stateLabel = state === "idle" && !readiness.ok ? assistantCardT("setupNeeded") : {
    connected: assistantCardT("connected"),
    connecting: assistantCardT("connecting"),
    error: assistantCardT("error"),
    idle: assistantCardT("ready"),
    requesting: assistantCardT("connecting"),
  }[state];
  const statusClass = state === "idle" && !readiness.ok
    ? "error"
    : state === "connected"
      ? "connected"
      : state === "requesting" || state === "connecting"
        ? "connecting"
        : state === "error"
          ? "error"
          : "ready";
  const startDisabled = state === "idle" && !readiness.ok;

  return (
    <div className="assistant-card-test" style={{ "--assistant-card-accent": ASSISTANT_CARD_ACCENT_HEX }}>
      <div className="assistant-card-head">
        <div className="assistant-card-title">
          <h3>Pipecat Assist</h3>
          <span className={`assistant-card-status ${statusClass}`}>{stateLabel}</span>
        </div>
        <div className="assistant-card-actions">
          {running && audioBlocked && (
            <button className="secondary" type="button" onClick={() => {
              setAudioBlocked(false);
              setDetail(assistantCardT("connectedDetail"));
              attachAudio(audioRef.current?.srcObject);
            }}>
              {assistantCardT("enableAudio")}
            </button>
          )}
          <button
            className={`main-button ${running ? "stop" : "talk"}`}
            type="button"
            onClick={running ? () => stopVoiceTest() : startVoiceTest}
            disabled={startDisabled}
          >
            {running ? assistantCardT("stop") : assistantCardT("talk")}
          </button>
        </div>
      </div>
      <div className="assistant-card-transcript-layer" aria-live="polite">
        <div className="assistant-card-transcript-flow" ref={transcriptFlowRef}>
          {messages.length ? (
            messages.map((message) => (
              <div
                key={message.id}
                className={`assistant-card-transcript-msg ${message.type}${message.entered ? "" : " new-message"}`}
              >
                <span className="assistant-card-transcript-text">{renderTranscriptText(message)}</span>
              </div>
            ))
          ) : (
            <div className="assistant-card-transcript-placeholder">{assistantCardT("greeting")}</div>
          )}
        </div>
      </div>
      <div className="assistant-card-visualizer-shell" aria-hidden="true">
        <canvas className="assistant-card-visualizer" ref={canvasRef} />
      </div>
      <span className="assistant-card-version">v{ASSISTANT_CARD_VERSION}</span>
      <audio ref={audioRef} autoPlay playsInline />
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
        <Field label={t("Image task provider")}>
          <select
            value={config.ai_image_provider_id || ""}
            onChange={(event) => updateConfig((draft) => ({ ...draft, ai_image_provider_id: event.target.value }))}
          >
            <option value="">{t("First enabled image provider")}</option>
            {config.integrations
              .filter((integration) => imageGenerationProviderKinds.includes(integration.kind))
              .map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {integration.name}
                  {integration.enabled ? "" : " (disabled)"}
                </option>
              ))}
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
