const PIPECAT_ASSIST_CARD_VERSION = "0.1.76";
const DEFAULT_ACCENT_HEX = "#206cff";
const DEFAULT_AUDIO_BUFFER_MS = 120;
const STREAM_FADE_GROUPS = 4;
const STREAM_CHARS_PER_GROUP = 2;
const STREAM_FADE_LEN = STREAM_FADE_GROUPS * STREAM_CHARS_PER_GROUP;
const HA_ASSIST_SAMPLE_RATE_FALLBACK = 48000;
const OPUS_AUDIO_QUALITY_PARAMS = {
  minptime: "20",
  useinbandfec: "1",
  maxplaybackrate: "48000",
  maxaveragebitrate: "96000",
  usedtx: "0",
};
const OPUS_AUDIO_REMOVE_PARAMS = new Set(["stereo", "sprop-stereo"]);
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
const CARD_TRANSLATIONS = {
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
  },
  pl: {
    ready: "Gotowy",
    connecting: "Łączenie",
    connected: "Połączono",
    error: "Błąd",
    greeting: "Co chciałbyś dzisiaj zrobić?",
    talk: "Mów",
    stop: "Zatrzymaj",
    enableAudio: "Włącz dźwięk",
    audioBlocked: "Dźwięk jest połączony, ale przeglądarka zablokowała odtwarzanie.",
    waitingForMicrophone: "Oczekiwanie na zgodę użycia mikrofonu",
    microphoneUnavailable: "Dostęp do mikrofonu nie jest dostępny w tej przeglądarce.",
    microphoneBlocked: "Dostęp do mikrofonu jest zablokowany. Zezwól na mikrofon i spróbuj ponownie.",
    connectedDetail: "Połączono. Powiedz coś do Pipecat Assist.",
    connectingAudio: "Łączenie audio",
  },
};

function languageBase(value) {
  return String(value || "").toLowerCase().split(/[-_]/)[0] || "en";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value, fallback = DEFAULT_ACCENT_HEX) {
  const raw = String(value || "").trim();
  const short = /^#?([0-9a-f]{3})$/i.exec(raw);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = /^#?([0-9a-f]{6})$/i.exec(raw);
  return full ? `#${full[1].toLowerCase()}` : fallback;
}

function hexToRgb(value) {
  const hex = normalizeHexColor(value).slice(1);
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

  const joiner = transcriptJoiner(current, text, rawText);
  return normalizeTranscriptText(`${current}${joiner}${text}`);
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

function hasTerminalTranscriptPunctuation(text) {
  return /[.!?]\s*$/.test(normalizeTranscriptText(text));
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
  return type === "user-transcription"
    || type === "user-llm-text"
    || type.startsWith("user-");
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

function rememberAudioSampleRate(value) {
  const sampleRate = Number(value || 0);
  if (sampleRate > 0) window.__pipecatAssistLastSampleRate = sampleRate;
}

function haAssistSampleRateFallback() {
  const remembered = Number(window.__pipecatAssistLastSampleRate || 0);
  return remembered > 0 ? remembered : HA_ASSIST_SAMPLE_RATE_FALLBACK;
}

function installHaAssistSampleRateGuard() {
  if (window.__pipecatAssistSampleRateGuardInstalled || !window.WebSocket?.prototype?.send) return;
  window.__pipecatAssistSampleRateGuardInstalled = true;
  const originalSend = window.WebSocket.prototype.send;
  window.WebSocket.prototype.send = function pipecatAssistSend(data) {
    if (typeof data !== "string" || !data.includes("assist_pipeline/run")) {
      return originalSend.call(this, data);
    }
    try {
      const payload = JSON.parse(data);
      const input = payload?.input;
      if (
        payload?.type === "assist_pipeline/run"
        && payload?.start_stage === "stt"
        && input
        && Number(input.sample_rate || 0) <= 0
      ) {
        input.sample_rate = haAssistSampleRateFallback();
        data = JSON.stringify(payload);
      }
    } catch {
      // Leave non-JSON websocket payloads untouched.
    }
    return originalSend.call(this, data);
  };
}

installHaAssistSampleRateGuard();

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

  return lines.map((line) => {
    const fmtp = /^a=fmtp:(\d+)\s*(.*)$/i.exec(line);
    if (fmtp && opusPayloads.has(fmtp[1])) {
      return `a=fmtp:${fmtp[1]} ${mergeOpusFmtp(fmtp[2] || "")}`;
    }
    const rtpmap = /^a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?/i.exec(line);
    if (rtpmap && !fmtpPayloads.has(rtpmap[1])) {
      return `${line}${separator}a=fmtp:${rtpmap[1]} ${mergeOpusFmtp("")}`;
    }
    return line;
  }).join(separator);
}

class PipecatAssistCard extends HTMLElement {
  constructor() {
    super();
    this.stopOnPageExit = () => this.stop();
  }

  static getStubConfig() {
    return { name: "Pipecat Assist" };
  }

  connectedCallback() {
    window.addEventListener("pagehide", this.stopOnPageExit);
    window.addEventListener("beforeunload", this.stopOnPageExit);
  }

  disconnectedCallback() {
    window.removeEventListener("pagehide", this.stopOnPageExit);
    window.removeEventListener("beforeunload", this.stopOnPageExit);
    this.stop();
  }

  setConfig(config) {
    this.config = config || {};
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.state = "idle";
    this.detail = this.t("ready");
    this.remoteStream = undefined;
    this.audioBlocked = false;
    this.localSpeechEnding = false;
    this.localSpeechPausedForAssistant = false;
    this.localSpeechResumeTimer = undefined;
    this.endConversationPending = false;
    this.endConversationTimer = undefined;
    this.endConversationStopping = false;
    this.userTranscript = "";
    this.assistantTranscript = "";
    this.partialTranscript = "";
    this.currentUserText = "";
    this.currentUserUpdatedAt = 0;
    this.chatMessages = [];
    this.chatMessageSeq = 0;
    this.currentUserMessageId = "";
    this.currentAssistantMessageId = "";
    this.streamAssistantMessageId = "";
    this.streamEl = null;
    this.streamFadeSpans = null;
    this.streamSolidNode = null;
    this.streamFadeMessageId = "";
    this.pendingStreamText = null;
    this.streamRafId = null;
    this.vScrollRaf = null;
    this.vScrollPos = 0;
    this.vScrollSpeed = 0;
    this.vScrollLastTs = 0;
    this.vScrollTarget = 0;
    this.ttsEstimatedDuration = 0;
    this.assistantTurnBase = "";
    this.assistantTurnText = "";
    this.assistantTurnPriority = 0;
    this.assistantTurnActive = false;
    this.assistantLastTurnText = "";
    this.assistantLastTurnPriority = 0;
    this.assistantLastTurnFinishedAt = 0;
    this.lastAssistantTextAt = 0;
    this.lastUserTextAt = 0;
    this.botSpeaking = false;
    this.ignoreLocalSpeechUntil = 0;
    this.render();
  }

  set hass(value) {
    const previousLanguage = this.uiLanguage();
    this._hass = value;
    const nextLanguage = this.uiLanguage();
    if (previousLanguage !== nextLanguage && this.shadowRoot) this.render();
  }

  getCardSize() {
    return this.compactMode() ? 2 : 3;
  }

  compactMode() {
    return this.config.compact_mode === true;
  }

  animationOnIdle() {
    return this.config.animation_on_idle !== false;
  }

  uiLanguage() {
    return languageBase(
      this._hass?.language
        || this._hass?.locale?.language
        || this.config?.language
        || navigator.language,
    );
  }

  t(key) {
    const language = this.uiLanguage();
    return CARD_TRANSLATIONS[language]?.[key] || CARD_TRANSLATIONS.en[key] || key;
  }

  accentHex() {
    return normalizeHexColor(this.config.accent_color || this.config.color);
  }

  accentRgb() {
    return hexToRgb(this.accentHex());
  }

  audioBufferMs() {
    const configured = this.config.audio_buffer_ms ?? this.config.buffer_ms ?? DEFAULT_AUDIO_BUFFER_MS;
    const value = Number(configured);
    if (!Number.isFinite(value)) return DEFAULT_AUDIO_BUFFER_MS;
    return clamp(Math.round(value), 0, 4000);
  }

  statusLabel() {
    return {
      connected: this.t("connected"),
      connecting: this.t("connecting"),
      error: this.t("error"),
      idle: this.t("ready"),
      requesting: this.t("connecting"),
    }[this.state] || this.state || this.t("ready");
  }

  statusDetail(label = this.statusLabel()) {
    const detail = String(this.detail || "").trim();
    if (!detail || detail.toLowerCase() === label.toLowerCase()) return "";
    return detail.replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?\\s*`, "i"), "");
  }

  statusBadgeClass() {
    if (this.state === "error") return "error";
    if (this.state === "connected") return "connected";
    if (this.state === "requesting" || this.state === "connecting") return "connecting";
    return "ready";
  }

  resetTranscriptState() {
    this.chatMessages = [];
    this.chatMessageSeq = 0;
    this.currentUserMessageId = "";
    this.currentAssistantMessageId = "";
    this.streamAssistantMessageId = "";
    this.streamEl = null;
    this.streamFadeSpans = null;
    this.streamSolidNode = null;
    this.streamFadeMessageId = "";
    this.pendingStreamText = null;
    this.ttsEstimatedDuration = 0;
    this.vScrollPos = 0;
    this.vScrollSpeed = 0;
    this.vScrollLastTs = 0;
    this.vScrollTarget = 0;
    if (this.streamRafId) {
      cancelAnimationFrame(this.streamRafId);
      this.streamRafId = null;
    }
    this.stopTranscriptScroll();
    this.syncTranscriptDom();
  }

  clearTranscriptData() {
    this.userTranscript = "";
    this.assistantTranscript = "";
    this.partialTranscript = "";
    this.currentUserText = "";
    this.currentUserUpdatedAt = 0;
    this.assistantTurnBase = "";
    this.assistantTurnText = "";
    this.assistantTurnPriority = 0;
    this.assistantTurnActive = false;
    this.assistantLastTurnText = "";
    this.assistantLastTurnPriority = 0;
    this.assistantLastTurnFinishedAt = 0;
    this.lastAssistantTextAt = 0;
    this.lastUserTextAt = 0;
    this.botSpeaking = false;
    this.ignoreLocalSpeechUntil = 0;
    this.clearEndConversationRequest();
    this.resetTranscriptState();
  }

  chatMessageById(id) {
    return this.chatMessages.find((message) => message.id === id) || null;
  }

  transcriptContainer() {
    return this.shadowRoot?.querySelector(".transcript-flow") || null;
  }

  transcriptTextElement(id) {
    const root = this.shadowRoot;
    if (!root) return null;
    return [...root.querySelectorAll(".transcript-msg")]
      .find((element) => element.dataset.chatId === id)
      ?.querySelector(".transcript-text") || null;
  }

  appendChatMessage(type, text) {
    const id = `m${++this.chatMessageSeq}`;
    this.chatMessages.push({ id, type, text: normalizeTranscriptText(text), entered: false });
    while (this.chatMessages.length > 12) {
      const removed = this.chatMessages.shift();
      if (removed?.id === this.currentUserMessageId) this.currentUserMessageId = "";
      if (removed?.id === this.currentAssistantMessageId) this.currentAssistantMessageId = "";
      if (removed?.id === this.streamAssistantMessageId) this.resetStreamFade();
    }
    this.syncTranscriptDom();
    return id;
  }

  updateChatMessage(id, text, options = {}) {
    const message = this.chatMessageById(id);
    if (!message) return;
    message.text = normalizeTranscriptText(text);
    if (options.stream) {
      this.scheduleStreamingText(id, message.text);
      return;
    }
    if (id === this.streamFadeMessageId) this.resetStreamFade();
    const el = this.transcriptTextElement(id);
    if (el) {
      el.textContent = message.text;
      this.scrollTranscriptToEnd();
    } else {
      this.syncTranscriptDom();
    }
  }

  syncTranscriptDom() {
    const container = this.transcriptContainer();
    if (!container) return;
    const placeholder = container.querySelector(".transcript-placeholder");
    if (!this.chatMessages.length) {
      container.querySelectorAll(".transcript-msg").forEach((element) => element.remove());
      if (!placeholder) {
        const empty = document.createElement("div");
        empty.className = "transcript-placeholder";
        empty.textContent = this.t("greeting");
        container.appendChild(empty);
      }
      this.scrollTranscriptToEnd();
      return;
    }
    if (placeholder) placeholder.remove();
    const existing = new Map(
      [...container.querySelectorAll(".transcript-msg")]
        .map((element) => [element.dataset.chatId, element]),
    );
    const activeIds = new Set(this.chatMessages.map((message) => message.id));
    for (const [id, element] of existing) {
      if (!activeIds.has(id)) element.remove();
    }
    for (const message of this.chatMessages) {
      let element = existing.get(message.id);
      if (!element) {
        element = document.createElement("div");
        const isNew = !message.entered;
        element.className = `transcript-msg ${message.type}${isNew ? " new-message" : ""}`;
        element.dataset.chatId = message.id;
        const text = document.createElement("span");
        text.className = "transcript-text";
        element.appendChild(text);
        if (isNew) {
          message.entered = true;
          requestAnimationFrame(() => {
            element.className = element.className.replace(/\s*new-message\b/g, "");
          });
        }
      } else {
        element.className = `transcript-msg ${message.type}`;
      }
      const textEl = element.querySelector(".transcript-text");
      if (textEl && message.id !== this.streamFadeMessageId) textEl.textContent = message.text;
      container.appendChild(element);
    }
    this.streamEl = this.streamAssistantMessageId ? this.transcriptTextElement(this.streamAssistantMessageId) : null;
    this.scrollTranscriptToEnd();
  }

  resetStreamFade() {
    this.streamFadeSpans = null;
    this.streamSolidNode = null;
    this.streamFadeMessageId = "";
    this.pendingStreamText = null;
    if (this.streamRafId) {
      cancelAnimationFrame(this.streamRafId);
      this.streamRafId = null;
    }
  }

  scheduleStreamingText(id, text) {
    this.streamAssistantMessageId = id;
    this.streamEl = this.transcriptTextElement(id);
    if (!this.streamEl) this.syncTranscriptDom();
    this.pendingStreamText = { id, text };
    if (!this.streamRafId) {
      this.streamRafId = requestAnimationFrame(() => {
        this.streamRafId = null;
        const pending = this.pendingStreamText;
        this.pendingStreamText = null;
        if (pending) this.updateStreamingText(pending.id, pending.text);
      });
    }
  }

  updateStreamingText(id, text) {
    const el = this.transcriptTextElement(id);
    if (!el) {
      this.syncTranscriptDom();
      return;
    }
    if (text.length <= STREAM_FADE_LEN) {
      this.resetStreamFade();
      el.textContent = text;
      this.scrollTranscriptToEnd();
      return;
    }
    if (this.streamFadeMessageId !== id || !this.streamFadeSpans) {
      this.initStreamFadeNodes(id, el);
    }
    const solid = text.slice(0, text.length - STREAM_FADE_LEN);
    const tail = text.slice(text.length - STREAM_FADE_LEN);
    this.streamSolidNode.textContent = solid;
    for (let index = 0; index < STREAM_FADE_GROUPS; index += 1) {
      const start = index * STREAM_CHARS_PER_GROUP;
      this.streamFadeSpans[index].textContent = tail.slice(start, start + STREAM_CHARS_PER_GROUP);
    }
    this.scrollTranscriptToEnd();
  }

  initStreamFadeNodes(id, el) {
    el.textContent = "";
    this.streamFadeMessageId = id;
    this.streamSolidNode = document.createTextNode("");
    el.appendChild(this.streamSolidNode);
    this.streamFadeSpans = [];
    for (let index = 0; index < STREAM_FADE_GROUPS; index += 1) {
      const span = document.createElement("span");
      span.style.opacity = ((STREAM_FADE_GROUPS - index) / STREAM_FADE_GROUPS).toFixed(2);
      this.streamFadeSpans.push(span);
      el.appendChild(span);
    }
  }

  setCurrentUserCaption(text, startsNewTurn) {
    const clean = normalizeTranscriptText(text);
    if (!clean) return;
    if (startsNewTurn || !this.currentUserMessageId || !this.chatMessageById(this.currentUserMessageId)) {
      this.currentUserMessageId = this.appendChatMessage("user", clean);
    } else {
      this.updateChatMessage(this.currentUserMessageId, clean);
    }
  }

  setCurrentAssistantCaption(text) {
    const clean = normalizeTranscriptText(text);
    if (!clean) return;
    if (!this.currentAssistantMessageId || !this.chatMessageById(this.currentAssistantMessageId)) {
      this.currentAssistantMessageId = this.appendChatMessage("assistant", clean);
    }
    this.streamAssistantMessageId = this.currentAssistantMessageId;
    this.updateChatMessage(this.currentAssistantMessageId, clean, { stream: true });
    this.ttsEstimatedDuration = this.estimateSpeechDuration(clean);
  }

  finalizeAssistantCaption() {
    if (!this.currentAssistantMessageId || !this.assistantTurnText) return;
    this.updateChatMessage(this.currentAssistantMessageId, this.assistantTurnText);
    this.streamAssistantMessageId = "";
    this.resetStreamFade();
  }

  estimateSpeechDuration(text) {
    const words = normalizeTranscriptText(text).split(/\s+/).filter(Boolean).length;
    const numbers = (String(text || "").match(/\d[\d,.]*%?/g) || []).length;
    return Math.max(1.8, (words / 2.8) + (numbers * 0.7));
  }

  scrollTranscriptToEnd() {
    const el = this.transcriptContainer();
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    this.vScrollTarget = max;
    this.startTranscriptScroll();
  }

  startTranscriptScroll() {
    if (this.vScrollRaf) return;
    const el = this.transcriptContainer();
    if (el) this.vScrollPos = el.scrollTop;
    this.vScrollTarget = Math.max(this.vScrollTarget || 0, el ? el.scrollHeight - el.clientHeight : 0);
    this.vScrollLastTs = 0;
    this.vScrollRaf = requestAnimationFrame((timestamp) => this.transcriptScrollTick(timestamp));
  }

  stopTranscriptScroll() {
    if (this.vScrollRaf) {
      cancelAnimationFrame(this.vScrollRaf);
      this.vScrollRaf = null;
    }
    this.vScrollLastTs = 0;
    this.vScrollSpeed = 0;
  }

  transcriptScrollTick(timestamp) {
    const el = this.transcriptContainer();
    if (!el) {
      this.stopTranscriptScroll();
      return;
    }
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) {
      this.stopTranscriptScroll();
      return;
    }
    if (!this.vScrollLastTs) this.vScrollLastTs = timestamp;
    const deltaMs = timestamp - this.vScrollLastTs;
    this.vScrollLastTs = timestamp;
    const target = Math.min(max, Math.max(this.vScrollTarget || 0, max));
    const distance = target - this.vScrollPos;
    const absDistance = Math.abs(distance);
    if (absDistance <= 0.5) {
      el.scrollTop = target;
      this.stopTranscriptScroll();
      return;
    }
    const easing = Math.max(0.08, Math.min(0.32, deltaMs / 160));
    const minStep = Math.min(absDistance, Math.max(0.7, deltaMs * 0.06));
    const step = Math.sign(distance) * Math.max(minStep, absDistance * easing);
    this.vScrollPos = Math.min(max, Math.max(0, this.vScrollPos + step));
    el.scrollTop = this.vScrollPos;
    this.vScrollRaf = requestAnimationFrame((nextTimestamp) => this.transcriptScrollTick(nextTimestamp));
  }

  baseUrl() {
    return (this.config.url || "").replace(/\/$/, "");
  }

  proxyMode() {
    return !this.baseUrl();
  }

  apiUrl(path) {
    const base = this.baseUrl();
    if (!base) return path;
    return `${base}/${path.replace(/^\//, "")}`;
  }

  authHeaders() {
    if (!this.proxyMode()) return {};
    const token = this._hass?.auth?.data?.access_token
      || this._hass?.connection?.options?.auth?.data?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  entryQuery() {
    return this.config.entry_id ? `?entry_id=${encodeURIComponent(this.config.entry_id)}` : "";
  }

  async loadAddonConfig() {
    const path = this.proxyMode()
      ? `/api/pipecat_assist/config${this.entryQuery()}`
      : "/api/assist/config";
    const response = await fetch(this.apiUrl(path), { headers: this.authHeaders() });
    if (!response.ok) throw new Error(`Config failed with HTTP ${response.status}`);
    return response.json();
  }

  async offerErrorMessage(response) {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body);
      return parsed.detail || parsed.error || body || `SmallWebRTC offer failed with HTTP ${response.status}`;
    } catch {
      return body || `SmallWebRTC offer failed with HTTP ${response.status}`;
    }
  }

  async waitForIce(peerConnection, timeoutMs = 2500) {
    if (peerConnection.iceGatheringState === "complete") return;
    await new Promise((resolve) => {
      let timer;
      const done = () => {
        clearTimeout(timer);
        peerConnection.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      };
      const onChange = () => {
        if (peerConnection.iceGatheringState === "complete") done();
      };
      timer = setTimeout(done, timeoutMs);
      peerConnection.addEventListener("icegatheringstatechange", onChange);
    });
  }

  clientId() {
    const key = "pipecat-assist-lovelace-client-id";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  }

  sessionLanguage() {
    return this.config.language
      || this._hass?.language
      || this._hass?.locale?.language
      || navigator.language
      || "en";
  }

  resetAudioElement() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.srcObject = null;
    this.audio.removeAttribute("src");
    try {
      this.audio.load();
    } catch {
      // Some mobile WebViews throw while tearing down a live MediaStream.
    }
  }

  applyRemoteAudioBuffer(receiver) {
    const targetMs = this.audioBufferMs();
    if (!receiver || !targetMs) return;
    try {
      if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = targetMs;
    } catch {
      // Browser support for jitterBufferTarget is still uneven.
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

  applyRemoteAudioBuffers(peer = this.peer) {
    peer?.getReceivers?.()
      .filter((receiver) => receiver.track?.kind === "audio")
      .forEach((receiver) => this.applyRemoteAudioBuffer(receiver));
  }

  ensureVisualizerInput(name, stream) {
    if (!stream?.getAudioTracks?.().length) return;
    const trackIds = stream.getAudioTracks().map((track) => track.id).join(",");
    if (this.visualizerInputs?.[name]?.trackIds === trackIds) return;
    this.disconnectVisualizerInput(name);

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;
    try {
      if (!this.visualizerContext || this.visualizerContext.state === "closed") {
        this.visualizerContext = new AudioContextConstructor();
      }
      if (this.visualizerContext.state === "suspended") {
        this.visualizerContext.resume().catch(() => {});
      }
      const source = this.visualizerContext.createMediaStreamSource(stream);
      const analyser = this.visualizerContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = name === "remote" ? 0.72 : 0.82;
      source.connect(analyser);
      this.visualizerInputs = this.visualizerInputs || {};
      this.visualizerInputs[name] = {
        analyser,
        data: new Uint8Array(analyser.frequencyBinCount),
        source,
        trackIds,
      };
    } catch {
      this.disconnectVisualizerInput(name);
    }
  }

  disconnectVisualizerInput(name) {
    const input = this.visualizerInputs?.[name];
    if (!input) return;
    try {
      input.source.disconnect();
    } catch {
      // Ignore already-disconnected visualizer nodes.
    }
    delete this.visualizerInputs[name];
  }

  ensureVisualizer() {
    this.visualizerCanvas = this.shadowRoot?.querySelector(".visualizer");
    if (this.stream) this.ensureVisualizerInput("local", this.stream);
    if (this.remoteStream) this.ensureVisualizerInput("remote", this.remoteStream);
    if (!this.visualizerFrame) this.drawVisualizer();
  }

  stopVisualizer() {
    if (this.visualizerFrame) {
      cancelAnimationFrame(this.visualizerFrame);
      this.visualizerFrame = undefined;
    }
    for (const name of Object.keys(this.visualizerInputs || {})) {
      this.disconnectVisualizerInput(name);
    }
    this.visualizerInputs = {};
    if (this.visualizerContext && this.visualizerContext.state !== "closed") {
      this.visualizerContext.close().catch(() => {});
    }
    this.visualizerContext = undefined;
    this.visualizerCanvas = undefined;
    this.visualizerEnergy = 0;
  }

  visualizerEnergyFor(name) {
    const input = this.visualizerInputs?.[name];
    if (!input?.analyser) return 0;
    input.analyser.getByteFrequencyData(input.data);
    const limit = Math.min(input.data.length, 96);
    let sum = 0;
    for (let index = 0; index < limit; index += 1) sum += input.data[index];
    return Math.min(1, sum / Math.max(1, limit) / 150);
  }

  drawVisualizer() {
    const canvas = this.visualizerCanvas;
    const running = ["requesting", "connecting", "connected"].includes(this.state);
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
      const accent = this.accentRgb();
      const localEnergy = this.visualizerEnergyFor("local");
      const remoteEnergy = this.visualizerEnergyFor("remote");
      const audioActive = Math.max(localEnergy, remoteEnergy) > 0.018
        || this.botSpeaking
        || this.assistantTurnActive
        || Boolean(this.partialTranscript);
      const idleEnergy = this.animationOnIdle() ? (running ? 0.06 : 0.025) : 0;
      const targetEnergy = Math.max(localEnergy, remoteEnergy, idleEnergy);
      this.visualizerEnergy = (this.visualizerEnergy || 0) * 0.82 + targetEnergy * 0.18;
      const energy = this.visualizerEnergy;
      const time = (this.animationOnIdle() || audioActive) ? performance.now() / 1000 : 0;

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
    this.visualizerFrame = requestAnimationFrame(() => this.drawVisualizer());
  }

  startLocalSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (this.localSpeechPausedForAssistant || this.assistantTurnActive || this.botSpeaking) return;
    this.stopLocalSpeechRecognition();
    try {
      const recognition = new SpeechRecognition();
      this.localSpeechEnding = false;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = String(this.sessionLanguage() || navigator.language || "en").replace("_", "-");
      recognition.onresult = (event) => {
        if (this.localSpeechPausedForAssistant || this.assistantTurnActive || this.botSpeaking) return;
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
        if (this.shouldIgnoreLocalSpeech(spokenText)) return;
        if (finalText) this.applyUserText(finalText, true);
        else if (interimText) this.applyUserText(interimText, false);
      };
      recognition.onerror = () => {
        this.partialTranscript = "";
        this.render();
      };
      recognition.onend = () => {
        this.localSpeechRecognition = undefined;
        if (
          this.localSpeechEnding
          || this.localSpeechPausedForAssistant
          || this.assistantTurnActive
          || this.botSpeaking
          || !["requesting", "connecting", "connected"].includes(this.state)
        ) return;
        window.setTimeout(() => this.startLocalSpeechRecognition(), 250);
      };
      this.localSpeechRecognition = recognition;
      recognition.start();
    } catch {
      this.localSpeechRecognition = undefined;
    }
  }

  stopLocalSpeechRecognition() {
    const recognition = this.localSpeechRecognition;
    this.localSpeechRecognition = undefined;
    this.localSpeechEnding = true;
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

  cancelLocalSpeechResume() {
    if (this.localSpeechResumeTimer) {
      clearTimeout(this.localSpeechResumeTimer);
      this.localSpeechResumeTimer = undefined;
    }
    this.localSpeechPausedForAssistant = false;
  }

  pauseLocalSpeechForAssistant() {
    if (this.localSpeechResumeTimer) {
      clearTimeout(this.localSpeechResumeTimer);
      this.localSpeechResumeTimer = undefined;
    }
    this.localSpeechPausedForAssistant = true;
    this.partialTranscript = "";
    if (this.shadowRoot) this.render();
    const recognition = this.localSpeechRecognition;
    this.localSpeechRecognition = undefined;
    this.localSpeechEnding = true;
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

  resumeLocalSpeechAfterAssistant(delayMs = 450) {
    if (!this.localSpeechPausedForAssistant) return;
    if (this.localSpeechResumeTimer) clearTimeout(this.localSpeechResumeTimer);
    this.localSpeechResumeTimer = window.setTimeout(() => {
      this.localSpeechResumeTimer = undefined;
      if (!this.localSpeechPausedForAssistant) return;
      this.localSpeechPausedForAssistant = false;
      if (["requesting", "connecting", "connected"].includes(this.state) && !this.localSpeechRecognition) {
        this.startLocalSpeechRecognition();
      }
    }, delayMs);
  }

  async waitForAudioSessionRelease() {
    const elapsed = Date.now() - (this.lastStoppedAt || 0);
    const remaining = Math.max(0, 450 - elapsed);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  clearEndConversationRequest() {
    if (this.endConversationTimer) {
      clearTimeout(this.endConversationTimer);
      this.endConversationTimer = undefined;
    }
    this.endConversationPending = false;
  }

  finishConversationAfterAssistant(delayMs = 350) {
    if (this.endConversationStopping) return;
    this.endConversationStopping = true;
    this.clearEndConversationRequest();
    window.setTimeout(() => {
      this.stop();
      this.endConversationStopping = false;
    }, delayMs);
  }

  requestConversationEnd(fallbackMs = 8000) {
    this.endConversationPending = true;
    if (this.endConversationTimer) clearTimeout(this.endConversationTimer);
    this.endConversationTimer = window.setTimeout(() => {
      this.finishConversationAfterAssistant(0);
    }, fallbackMs);
  }

  stop() {
    this.endConversationStopping = true;
    this.clearEndConversationRequest();
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
    this.channel?.readyState === "open" && this.channel.send(JSON.stringify({
      label: "rtvi-ai",
      id: crypto.randomUUID().slice(0, 8),
      type: "disconnect-bot",
      data: {},
    }));
    this.channel?.close();
    this.channel = undefined;
    this.peer?.getSenders?.().forEach((sender) => sender.track?.stop());
    this.peer?.getReceivers?.().forEach((receiver) => receiver.track?.stop());
    this.peer?.getTransceivers?.().forEach((transceiver) => {
      try {
        transceiver.stop();
      } catch {
        // Older WebViews may not allow stopping closed transceivers.
      }
    });
    this.peer?.close();
    this.peer = undefined;
    this.stopLocalSpeechRecognition();
    this.cancelLocalSpeechResume();
    this.stopVisualizer();
    this.finishAssistantTurn(false);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.remoteStream?.getTracks().forEach((track) => track.stop());
    this.resetAudioElement();
    this.remoteStream = undefined;
    this.audioBlocked = false;
    this.lastStoppedAt = Date.now();
    this.clearTranscriptData();
    this.state = "idle";
    this.detail = this.t("ready");
    this.endConversationStopping = false;
    this.render();
  }

  fail(message) {
    this.stop();
    this.state = "error";
    this.detail = message;
    this.render();
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail(this.t("microphoneUnavailable"));
      return;
    }

    try {
      this.state = "requesting";
      this.detail = this.t("waitingForMicrophone");
      this.clearTranscriptData();
      this.cancelLocalSpeechResume();
      this.render();
      this.resetAudioElement();
      await this.waitForAudioSessionRelease();
      const addonConfig = await this.loadAddonConfig();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      this.ensureVisualizer();
      this.startLocalSpeechRecognition();

      const peer = new RTCPeerConnection();
      this.peer = peer;
      const track = this.stream.getAudioTracks()[0];
      rememberAudioSampleRate(track?.getSettings?.().sampleRate);
      if (track) peer.addTransceiver(track, { direction: "sendrecv" });
      else peer.addTransceiver("audio", { direction: "sendrecv" });

      this.channel = peer.createDataChannel("signalling");
      this.channel.onmessage = (event) => this.handleRealtimeMessage(event.data);
      this.channel.onopen = () => {
        this.channel.send(JSON.stringify({
          label: "rtvi-ai",
          id: crypto.randomUUID().slice(0, 8),
          type: "client-ready",
          data: {
            version: "1.4.0",
            about: {
              library: "pipecat-assist-lovelace-card",
              library_version: PIPECAT_ASSIST_CARD_VERSION,
              platform: "home-assistant",
            },
          },
        }));
        this.pingTimer = window.setInterval(() => {
          if (this.channel?.readyState === "open") this.channel.send(`ping ${Date.now()}`);
        }, 1000);
      };

      peer.ontrack = (event) => {
        if (event.track.kind !== "audio") return;
        this.applyRemoteAudioBuffer(event.receiver);
        this.remoteStream = event.streams[0] || new MediaStream([event.track]);
        this.ensureVisualizer();
        this.attachAudio();
      };
      peer.onconnectionstatechange = () => {
          if (peer.connectionState === "connected") {
            this.state = "connected";
            this.detail = this.t("connectedDetail");
            this.render();
          }
        if (["failed", "disconnected"].includes(peer.connectionState)) {
          this.fail(`WebRTC ${peer.connectionState}`);
        }
      };

      this.state = "connecting";
      this.detail = "Creating WebRTC offer";
      this.render();
      const offer = await peer.createOffer({ voiceActivityDetection: false });
      await peer.setLocalDescription({ type: offer.type, sdp: preferFullbandOpus(offer.sdp) });
      await this.waitForIce(peer);

      const offerPath = this.proxyMode()
        ? `/api/pipecat_assist/offer${this.entryQuery()}`
        : addonConfig.runner_offer_path || "api/offer";
      const requestData = {
        source: "lovelace_card",
        client_id: this.clientId(),
        language: this.sessionLanguage(),
      };
      if (this.config.flow_id) requestData.flow_id = this.config.flow_id;
      const response = await fetch(this.apiUrl(offerPath), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({
          sdp: peer.localDescription.sdp,
          type: peer.localDescription.type,
          request_data: requestData,
        }),
      });
      if (!response.ok) throw new Error(await this.offerErrorMessage(response));
      const answer = await response.json();
      await peer.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
      this.applyRemoteAudioBuffers(peer);
      this.detail = this.t("connectingAudio");
      this.render();
      this.attachAudio();
    } catch (err) {
      const name = err?.name || "";
      const message = name === "NotAllowedError"
        ? this.t("microphoneBlocked")
        : err?.message || String(err);
      this.fail(message);
    }
  }

  textFromEvent(data) {
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

  beginAssistantTurn() {
    if (this.assistantTurnFinishTimer) {
      clearTimeout(this.assistantTurnFinishTimer);
      this.assistantTurnFinishTimer = undefined;
    }
    this.pauseLocalSpeechForAssistant();
    if (this.assistantTurnActive) {
      this.botSpeaking = true;
      this.ignoreLocalSpeechUntil = Date.now() + 1200;
      return;
    }
    this.assistantTurnBase = normalizeTranscriptText(this.assistantTranscript);
    this.assistantTurnText = "";
    this.assistantTurnPriority = 0;
    this.assistantTurnActive = true;
    this.currentAssistantMessageId = "";
    this.streamAssistantMessageId = "";
    this.resetStreamFade();
    this.botSpeaking = true;
    this.ignoreLocalSpeechUntil = Date.now() + 1200;
  }

  finishAssistantTurn(resumeLocalSpeech = true) {
    if (this.assistantTurnFinishTimer) {
      clearTimeout(this.assistantTurnFinishTimer);
      this.assistantTurnFinishTimer = undefined;
    }
    this.assistantTranscript = normalizeTranscriptText(this.assistantTranscript);
    this.assistantTurnBase = this.assistantTranscript;
    if (this.assistantTurnText) {
      this.finalizeAssistantCaption();
      this.assistantLastTurnText = this.assistantTurnText;
      this.assistantLastTurnPriority = this.assistantTurnPriority;
      this.assistantLastTurnFinishedAt = Date.now();
      this.lastAssistantTextAt = this.assistantLastTurnFinishedAt;
    }
    this.assistantTurnText = "";
    this.assistantTurnPriority = 0;
    this.assistantTurnActive = false;
    this.botSpeaking = false;
    this.streamAssistantMessageId = "";
    this.ttsEstimatedDuration = 0;
    this.ignoreLocalSpeechUntil = Date.now() + 900;
    if (this.endConversationPending) {
      this.finishConversationAfterAssistant(350);
      return;
    }
    if (resumeLocalSpeech && ["requesting", "connecting", "connected"].includes(this.state)) {
      this.resumeLocalSpeechAfterAssistant(450);
    }
  }

  scheduleAssistantTurnFinish(delayMs = 1000) {
    if (this.assistantTurnFinishTimer) clearTimeout(this.assistantTurnFinishTimer);
    this.botSpeaking = false;
    this.ignoreLocalSpeechUntil = Date.now() + delayMs;
    this.assistantTurnFinishTimer = window.setTimeout(() => this.finishAssistantTurn(), delayMs);
  }

  ensureAssistantTurn() {
    if (!this.assistantTurnActive) this.beginAssistantTurn();
  }

  assistantEchoReferences() {
    return [
      this.assistantTurnText,
      this.assistantLastTurnText,
      this.assistantTranscript,
    ].filter(Boolean);
  }

  cleanUserSpeechText(text) {
    let cleaned = normalizeTranscriptText(text);
    for (const reference of this.assistantEchoReferences()) {
      cleaned = removeTranscriptEchoSpan(cleaned, reference);
    }
    return cleaned;
  }

  shouldIgnoreLocalSpeech(text) {
    if (!text) return false;
    const assistantReference = mergeTranscript(this.assistantTranscript, this.assistantTurnText);
    if (!assistantReference) return false;
    return (this.botSpeaking || Date.now() < (this.ignoreLocalSpeechUntil || 0))
      && isLikelyTranscriptEcho(text, assistantReference);
  }

  applyUserText(text, finalEvent) {
    const cleanedText = this.cleanUserSpeechText(text);
    if (!cleanedText) return;
    if (this.assistantEchoReferences().some((reference) => isLikelyTranscriptEcho(cleanedText, reference))) return;
    const now = Date.now();
    this.lastUserTextAt = now;
    const startsNewUserTurn = this.lastAssistantTextAt > this.currentUserUpdatedAt
      || (!this.partialTranscript && this.currentUserUpdatedAt && now - this.currentUserUpdatedAt > 8000);
    if (finalEvent) {
      this.currentUserText = startsNewUserTurn
        ? cleanedText
        : mergeDisplayTurnText(this.currentUserText, cleanedText);
      this.currentUserUpdatedAt = now;
      this.userTranscript = mergeTranscript(this.userTranscript, cleanedText);
      this.partialTranscript = "";
    } else {
      this.partialTranscript = cleanedText;
      this.currentUserText = startsNewUserTurn
        ? cleanedText
        : mergeDisplayTurnText(this.currentUserText, cleanedText);
      this.currentUserUpdatedAt = now;
    }
    this.setCurrentUserCaption(this.currentUserText, startsNewUserTurn);
    if (shouldEndConversation(`${this.currentUserText} ${this.partialTranscript}`)) {
      this.requestConversationEnd(9000);
    }
  }

  shouldIgnoreServerUserTranscription(finalEvent) {
    const hasBrowserSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    if (hasBrowserSpeech) return true;
    return !finalEvent;
  }

  applyAssistantText(text, priority) {
    if (isLikelyTranscriptEcho(text, mergeTranscript(this.currentUserText, this.partialTranscript))) return;
    const normalizedText = normalizeTranscriptText(text);
    if (!normalizedText) return;
    const now = Date.now();
    const recentAssistantReplayWindow = this.assistantLastTurnFinishedAt
      && this.lastUserTextAt < this.assistantLastTurnFinishedAt
      && now - this.assistantLastTurnFinishedAt < 4500;
    const assistantReference = mergeTranscript(this.assistantTranscript, this.assistantTurnText);
    if (
      (hasTerminalTranscriptPunctuation(this.assistantTurnText)
        && isTranscriptFragment(normalizedText, this.assistantTurnText))
      || (recentAssistantReplayWindow && isTranscriptFragment(normalizedText, this.assistantLastTurnText))
      || (recentAssistantReplayWindow && priority <= (this.assistantLastTurnPriority || 0)
        && isTranscriptFragment(normalizedText, assistantReference))
    ) return;
    this.ensureAssistantTurn();
    if (this.assistantTurnFinishTimer) {
      clearTimeout(this.assistantTurnFinishTimer);
      this.assistantTurnFinishTimer = undefined;
    }
    const previousTurnPriority = this.assistantTurnPriority || 0;
    if (priority > previousTurnPriority) {
      this.assistantTurnPriority = priority;
      this.assistantTurnText = mergeAssistantTurnText(
        this.assistantTurnText,
        normalizedText,
        priority,
        previousTurnPriority,
      );
    } else if (priority === this.assistantTurnPriority) {
      this.assistantTurnText = mergeAssistantTurnText(
        this.assistantTurnText,
        normalizedText,
        priority,
        this.assistantTurnPriority,
      );
    } else {
      return;
    }
    this.assistantTranscript = mergeTranscript(this.assistantTurnBase, this.assistantTurnText);
    this.lastAssistantTextAt = Date.now();
    this.ignoreLocalSpeechUntil = Date.now() + 1200;
    this.setCurrentAssistantCaption(this.assistantTurnText);
    if (shouldEndConversation(this.assistantTranscript)) {
      this.requestConversationEnd(5000);
    }
  }

  handleRealtimeMessage(raw) {
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
      this.requestConversationEnd(1200);
      return;
    }
    if (type === "bot-llm-started" || type === "bot-tts-started" || type === "bot-started-speaking") {
      this.beginAssistantTurn();
    }
    if (type === "bot-llm-stopped" || type === "bot-tts-stopped" || type === "bot-stopped-speaking") {
      this.scheduleAssistantTurnFinish();
    }

    const text = this.textFromEvent(message);
    if (!text) return;

    const finalEvent = type === "user-llm-text"
      || type.includes("final")
      || Boolean(message.data?.final || message.is_final || message.final);

    if (isRtviUserTextType(type)) {
      if (type === "user-transcription" && this.shouldIgnoreServerUserTranscription(finalEvent)) return;
      this.applyUserText(text, finalEvent);
      return;
    }

    if (type === "bot-llm-text" && !finalEvent) return;
    if (isRtviAssistantTextType(type) || (label.includes("bot") && !type.startsWith("user-"))) {
      this.applyAssistantText(text, rtviAssistantTextPriority(type) || 1);
    }
  }

  attachAudio() {
    if (!this.audio || !this.remoteStream) return;
    if (this.audio.srcObject !== this.remoteStream) this.audio.srcObject = this.remoteStream;
    this.audio.autoplay = true;
    this.audio.playsInline = true;
    this.audio.muted = false;
    this.audio.volume = 1;
    const playPromise = this.audio.play();
    if (playPromise?.catch) {
      playPromise.catch((err) => {
        if (err?.name !== "NotAllowedError" || this.audioBlocked) return;
        this.audioBlocked = true;
        this.detail = this.t("audioBlocked");
        this.render();
      });
    }
  }

  render() {
    if (!this.shadowRoot) return;
    const running = ["requesting", "connecting", "connected"].includes(this.state);
    const needsAudioTap = running && this.audioBlocked;
    const compact = this.compactMode();
    const accentHex = this.accentHex();
    const accent = this.accentRgb();
    const accentRgb = `${accent.r}, ${accent.g}, ${accent.b}`;
    const statusLabel = this.statusLabel();
    const statusClass = this.statusBadgeClass();
    const transcriptHtml = compact ? "" : `
          <div class="transcript-layer" aria-live="polite">
            <div class="transcript-flow">
              <div class="transcript-placeholder">${escapeHtml(this.t("greeting"))}</div>
            </div>
          </div>`;
    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          display: block;
          height: ${compact ? "286px" : "410px"};
          max-height: ${compact ? "286px" : "410px"};
          box-sizing: border-box;
          overflow: hidden;
          border-radius: 20px;
          background:
            linear-gradient(180deg, rgba(10, 36, 67, 0.96) 0%, rgba(5, 15, 29, 0.98) 54%, rgba(4, 10, 19, 1) 100%);
          color: #f7fbff;
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
          border: 1px solid rgba(${accentRgb}, 0.34);
          --pipecat-accent: ${accentHex};
          --pipecat-accent-rgb: ${accentRgb};
        }
        .wrap {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          height: 100%;
          max-height: 410px;
          box-sizing: border-box;
          gap: 0;
          padding: 20px 24px 0;
          position: relative;
          overflow: hidden;
        }
        .wrap.compact {
          grid-template-rows: auto minmax(0, 1fr);
          max-height: 286px;
        }
        .head, .actions, .transcript-layer, .visualizer-shell, .version {
          position: relative;
          z-index: 1;
        }
        .version {
          position: absolute;
          right: 14px;
          bottom: 12px;
          color: rgba(226, 239, 255, 0.48);
          font-size: 10px;
          line-height: 1;
          letter-spacing: 0;
          pointer-events: none;
        }
        .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .title {
          min-width: 0;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        h3 {
          margin: 0;
          font-size: 18px;
          line-height: 1.2;
          color: #ffffff;
        }
        .status-pill {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 3px 9px;
          border-radius: 999px;
          color: #ffffff;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0;
          background: rgba(${accentRgb}, 0.18);
          border: 1px solid rgba(${accentRgb}, 0.38);
          box-shadow: 0 0 22px rgba(${accentRgb}, 0.18);
        }
        .status-pill.ready {
          color: rgba(232, 242, 255, 0.92);
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.24);
          box-shadow: none;
        }
        .status-pill.connected {
          color: #caffdf;
          background: rgba(34, 197, 94, 0.18);
          border-color: rgba(34, 197, 94, 0.48);
          box-shadow: 0 0 18px rgba(34, 197, 94, 0.18);
        }
        .status-pill.connecting::after {
          content: "...";
          display: inline-block;
          width: 18px;
          overflow: hidden;
          vertical-align: bottom;
          animation: pipecat-dots 1.1s steps(4, end) infinite;
        }
        .status-pill.error {
          color: #ffe1de;
          background: rgba(217, 75, 64, 0.22);
          border-color: rgba(217, 75, 64, 0.5);
        }
        @keyframes pipecat-dots {
          0% { width: 0; }
          100% { width: 18px; }
        }
        .transcript-layer {
          position: absolute;
          left: 24px;
          right: 24px;
          top: 76px;
          bottom: 28px;
          z-index: 3;
          pointer-events: none;
          overflow: hidden;
          display: flex;
          align-items: stretch;
          justify-content: flex-end;
          -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 16px, #000 calc(100% - 30px), transparent 100%);
          mask-image: linear-gradient(180deg, transparent 0, #000 16px, #000 calc(100% - 30px), transparent 100%);
        }
        .transcript-flow {
          width: 100%;
          max-height: 100%;
          overflow-y: auto;
          overflow-x: hidden;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: flex-start;
          padding: 10px 4px 30px 0;
          box-sizing: border-box;
          scroll-behavior: auto;
          scrollbar-width: none;
        }
        .transcript-flow::-webkit-scrollbar { display: none; }
        .transcript-placeholder {
          margin-top: 6px;
          color: rgba(226, 239, 255, 0.62);
          font-size: 18px;
          line-height: 1.3;
          font-weight: 700;
          text-shadow: 0 1px 18px rgba(0, 0, 0, 0.45);
        }
        .transcript-msg {
          max-width: 92%;
          opacity: 1;
          word-wrap: break-word;
          white-space: pre-line;
          background: none;
          border: none;
          box-shadow: none;
          padding: 4px 0;
          border-radius: 0;
          text-shadow: 0 1px 18px rgba(0, 0, 0, 0.45);
          overflow-wrap: anywhere;
        }
        .transcript-msg.new-message {
          opacity: 0;
          animation: transcript-fade-in 0.28s ease forwards;
        }
        .transcript-msg.user {
          color: rgba(226, 239, 255, 0.56);
          font-size: 16px;
          line-height: 1.35;
          font-weight: 500;
          align-self: flex-start;
          text-align: left;
        }
        .transcript-msg.assistant {
          color: #ffffff;
          font-size: 19px;
          line-height: 1.35;
          font-weight: 700;
          align-self: flex-start;
          text-align: left;
        }
        @keyframes transcript-fade-in {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .visualizer-shell {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 190px;
          min-height: 190px;
          margin: 0;
          overflow: hidden;
          -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 30px, #000 100%);
          mask-image: linear-gradient(180deg, transparent 0, #000 30px, #000 100%);
        }
        .visualizer-shell::before {
          content: "";
          position: absolute;
          left: 50%;
          bottom: -98px;
          width: 118%;
          height: 190px;
          transform: translateX(-50%);
          border-radius: 50% 50% 0 0;
          border-top: 1px solid rgba(168, 209, 255, 0.58);
          box-shadow:
            0 -18px 46px rgba(${accentRgb}, 0.36),
            inset 0 28px 70px rgba(${accentRgb}, 0.36);
          pointer-events: none;
        }
        .visualizer-shell::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, transparent 0%, rgba(${accentRgb}, 0.12) 58%, rgba(${accentRgb}, 0.48) 100%);
          pointer-events: none;
        }
        .visualizer {
          display: block;
          width: 100%;
          height: 100%;
          min-height: 190px;
          position: relative;
          z-index: 1;
        }
        button {
          min-height: 52px;
          min-width: 52px;
          border: 0;
          border-radius: 999px;
          padding: 0 18px;
          color: #ffffff;
          background: ${running ? "#d94b40" : accentHex};
          font: inherit;
          font-weight: 700;
          cursor: pointer;
          box-shadow: ${running ? "0 12px 28px rgba(0, 0, 0, 0.28)" : `0 12px 30px rgba(${accentRgb}, 0.36)`};
          transition: transform 140ms ease, filter 140ms ease, box-shadow 140ms ease;
        }
        .actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
          align-self: end;
        }
        button.secondary {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.13);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
        }
        button:hover { transform: translateY(-1px); filter: brightness(1.04); box-shadow: 0 16px 34px rgba(0, 0, 0, 0.32); }
        button:active { transform: scale(0.98); }
        audio { display: none; }
      </style>
      <ha-card>
        <div class="${compact ? "wrap compact" : "wrap"}">
          <div class="head">
            <div class="title">
              <h3>${this.config.name || "Pipecat Assist"}</h3>
              <span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="actions">
              ${needsAudioTap ? `<button class="secondary audio-button">${escapeHtml(this.t("enableAudio"))}</button>` : ""}
              <button class="main-button">${escapeHtml(running ? this.t("stop") : this.t("talk"))}</button>
            </div>
          </div>
          ${transcriptHtml}
          <div class="visualizer-shell" aria-hidden="true">
            <canvas class="visualizer"></canvas>
          </div>
          <span class="version">v${PIPECAT_ASSIST_CARD_VERSION}</span>
          <audio autoplay playsinline></audio>
        </div>
      </ha-card>
    `;
    this.audio = this.shadowRoot.querySelector("audio");
    this.streamEl = this.streamAssistantMessageId ? this.transcriptTextElement(this.streamAssistantMessageId) : null;
    this.streamFadeSpans = null;
    this.streamSolidNode = null;
    this.streamFadeMessageId = "";
    this.syncTranscriptDom();
    this.ensureVisualizer();
    this.attachAudio();
    const audioButton = this.shadowRoot.querySelector(".audio-button");
    if (audioButton) {
      audioButton.onclick = () => {
        this.audioBlocked = false;
        this.detail = this.t("connectedDetail");
        this.render();
        this.attachAudio();
      };
    }
    this.shadowRoot.querySelector(".main-button").onclick = () => running ? this.stop() : this.start();
  }
}

function patchPipecatAssistCard(existingCard) {
  for (const name of Object.getOwnPropertyNames(PipecatAssistCard.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(
      existingCard.prototype,
      name,
      Object.getOwnPropertyDescriptor(PipecatAssistCard.prototype, name),
    );
  }
  existingCard.getStubConfig = PipecatAssistCard.getStubConfig;
  existingCard.__pipecatAssistVersion = PIPECAT_ASSIST_CARD_VERSION;
}

function collectPipecatAssistCards(root, cards = new Set(), seen = new Set()) {
  if (!root || seen.has(root)) return cards;
  seen.add(root);
  if (root.localName === "pipecat-assist-card") cards.add(root);
  if (!root.querySelectorAll) return cards;

  root.querySelectorAll("pipecat-assist-card").forEach((card) => cards.add(card));
  root.querySelectorAll("*").forEach((element) => {
    if (element.shadowRoot) collectPipecatAssistCards(element.shadowRoot, cards, seen);
  });
  return cards;
}

function refreshPipecatAssistCard(card) {
  if (!card || card.__pipecatAssistVersion === PIPECAT_ASSIST_CARD_VERSION) return;
  card.__pipecatAssistVersion = PIPECAT_ASSIST_CARD_VERSION;
  card.config = card.config || { name: "Pipecat Assist" };
  card.state = card.state || "idle";
  card.detail = card.detail || card.t?.("ready") || "Ready";
  card.userTranscript = card.userTranscript || "";
  card.partialTranscript = card.partialTranscript || "";
  card.assistantTranscript = card.assistantTranscript || "";
  card.currentUserText = card.currentUserText || "";
  card.currentUserUpdatedAt = card.currentUserUpdatedAt || 0;
  card.assistantTurnText = card.assistantTurnText || "";
  card.assistantLastTurnText = card.assistantLastTurnText || "";
  card.lastAssistantTextAt = card.lastAssistantTextAt || 0;
  card.chatMessages = Array.isArray(card.chatMessages) ? card.chatMessages : [];
  card.chatMessageSeq = card.chatMessageSeq || card.chatMessages.length || 0;
  card.currentUserMessageId = card.currentUserMessageId || "";
  card.currentAssistantMessageId = card.currentAssistantMessageId || "";
  card.streamAssistantMessageId = card.streamAssistantMessageId || "";
  card.streamEl = null;
  card.streamFadeSpans = null;
  card.streamSolidNode = null;
  card.streamFadeMessageId = "";
  card.pendingStreamText = null;
  card.streamRafId = null;
  card.vScrollRaf = null;
  card.vScrollPos = card.vScrollPos || 0;
  card.vScrollSpeed = card.vScrollSpeed || 0;
  card.vScrollLastTs = 0;
  card.vScrollTarget = card.vScrollTarget || 0;
  card.ttsEstimatedDuration = card.ttsEstimatedDuration || 0;
  card.audioBlocked = Boolean(card.audioBlocked);
  if (!card.shadowRoot && card.attachShadow) {
    try {
      card.attachShadow({ mode: "open" });
    } catch {
      // The element may already have a closed shadow root from an older card.
    }
  }
  if (typeof card.render === "function") card.render();
}

function refreshPipecatAssistCards() {
  collectPipecatAssistCards(document).forEach(refreshPipecatAssistCard);
}

function installPipecatAssistCardRefresher() {
  if (window.__pipecatAssistCardRefresherInstalled) return;
  window.__pipecatAssistCardRefresherInstalled = true;
  let pending = false;
  const observedRoots = new WeakSet();
  let observer;
  const observeRoots = (root, seen = new Set()) => {
    if (!root || seen.has(root)) return;
    seen.add(root);
    if (!observedRoots.has(root)) {
      observedRoots.add(root);
      observer.observe(root, { childList: true, subtree: true });
    }
    if (!root.querySelectorAll) return;
    root.querySelectorAll("*").forEach((element) => {
      if (element.shadowRoot) observeRoots(element.shadowRoot, seen);
    });
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      observeRoots(document);
      refreshPipecatAssistCards();
    });
  };
  observer = new MutationObserver(schedule);
  observeRoots(document);
  [0, 250, 1000, 3000].forEach((delay) => setTimeout(schedule, delay));
}

const existingPipecatAssistCard = customElements.get("pipecat-assist-card");
if (existingPipecatAssistCard) {
  patchPipecatAssistCard(existingPipecatAssistCard);
} else {
  customElements.define("pipecat-assist-card", PipecatAssistCard);
}
installPipecatAssistCardRefresher();
refreshPipecatAssistCards();

window.customCards = Array.isArray(window.customCards) ? window.customCards : [];
const existingCardIndex = window.customCards.findIndex((card) => card.type === "pipecat-assist-card");
if (existingCardIndex >= 0) window.customCards.splice(existingCardIndex, 1);
window.customCards.push({
  type: "pipecat-assist-card",
  name: "Pipecat Assist",
  description: "Realtime Pipecat Assist voice card.",
  preview: true,
});
