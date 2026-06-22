const PIPECAT_ASSIST_CARD_VERSION = "0.1.59";
const HA_ASSIST_SAMPLE_RATE_FALLBACK = 48000;
const OPUS_AUDIO_QUALITY_PARAMS = {
  minptime: "20",
  useinbandfec: "1",
  maxplaybackrate: "48000",
  maxaveragebitrate: "96000",
  usedtx: "0",
};
const OPUS_AUDIO_REMOVE_PARAMS = new Set(["stereo", "sprop-stereo"]);
const END_CONVERSATION_PHRASES = [
  "to wszystko",
  "koniec rozmowy",
  "ok koniec",
  "okej koniec",
  "that is all",
  "that's all",
  "end conversation",
  "stop listening",
  "we are done",
  "goodbye",
];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  if (incoming.length <= 3 && /\p{L}$/u.test(existing) && /^\p{L}/u.test(incoming)) return "";
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

function shouldEndConversation(text) {
  const clean = String(text || "").toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  return END_CONVERSATION_PHRASES.some((phrase) => clean.includes(phrase));
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
    this.detail = "Ready";
    this.remoteStream = undefined;
    this.audioBlocked = false;
    this.localSpeechEnding = false;
    this.userTranscript = "";
    this.assistantTranscript = "";
    this.partialTranscript = "";
    this.render();
  }

  set hass(value) {
    this._hass = value;
  }

  getCardSize() {
    return 3;
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
      const time = performance.now() / 1000;
      const localEnergy = this.visualizerEnergyFor("local");
      const remoteEnergy = this.visualizerEnergyFor("remote");
      const targetEnergy = Math.max(localEnergy, remoteEnergy, running ? 0.06 : 0.025);
      this.visualizerEnergy = (this.visualizerEnergy || 0) * 0.82 + targetEnergy * 0.18;
      const energy = this.visualizerEnergy;

      ctx.clearRect(0, 0, width, height);
      const horizon = height * 0.68;
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "rgba(96, 173, 255, 0.02)");
      gradient.addColorStop(0.62, "rgba(45, 119, 255, 0.16)");
      gradient.addColorStop(1, "rgba(64, 132, 255, 0.52)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(width / 2, horizon + height * 0.68);
      ctx.scale(1, 0.32);
      ctx.beginPath();
      ctx.arc(0, 0, width * (0.5 + energy * 0.07), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(146, 198, 255, ${0.34 + energy * 0.28})`;
      ctx.lineWidth = Math.max(1, 1.4 * dpr);
      ctx.shadowColor = "rgba(69, 139, 255, 0.88)";
      ctx.shadowBlur = 18 * dpr + energy * 30 * dpr;
      ctx.stroke();
      ctx.restore();

      const drawWave = (color, offset, amplitude, widthScale, alpha) => {
        ctx.beginPath();
        for (let x = 0; x <= width; x += Math.max(2, width / 120)) {
          const progress = x / width;
          const envelope = Math.sin(progress * Math.PI);
          const y = height * 0.45
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
      drawWave("rgba(93, 169, 255, ALPHA)", 1.7, 16 * dpr + energy * 46 * dpr, 1.1, 0.42 + energy * 0.32);
      drawWave("rgba(32, 108, 255, ALPHA)", 3.1, 20 * dpr + energy * 58 * dpr, 0.9, 0.28 + energy * 0.28);

      ctx.shadowBlur = 0;
      const barCount = 34;
      for (let index = 0; index < barCount; index += 1) {
        const progress = index / Math.max(1, barCount - 1);
        const envelope = Math.sin(progress * Math.PI);
        const pulse = 0.5 + 0.5 * Math.sin(time * 3.4 + index * 0.72);
        const barHeight = (4 + pulse * 20 * energy) * dpr * envelope;
        const x = progress * width;
        ctx.fillStyle = `rgba(160, 211, 255, ${0.08 + energy * 0.26})`;
        ctx.fillRect(x, horizon - barHeight, Math.max(1, 2 * dpr), barHeight);
      }
    }
    this.visualizerFrame = requestAnimationFrame(() => this.drawVisualizer());
  }

  startLocalSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    this.stopLocalSpeechRecognition();
    try {
      const recognition = new SpeechRecognition();
      this.localSpeechEnding = false;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = String(this.sessionLanguage() || navigator.language || "en").replace("_", "-");
      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result?.[0]?.transcript || "";
          if (!text) continue;
          if (result.isFinal) finalText = mergeTranscript(finalText, text);
          else interimText = mergeTranscript(interimText, text);
        }
        if (finalText) this.userTranscript = mergeTranscript(this.userTranscript, finalText);
        this.partialTranscript = normalizeTranscriptText(interimText);
        this.render();
        if (shouldEndConversation(`${this.userTranscript} ${this.partialTranscript}`)) {
          window.setTimeout(() => this.stop(), 250);
        }
      };
      recognition.onerror = () => {
        this.partialTranscript = "";
        this.render();
      };
      recognition.onend = () => {
        this.localSpeechRecognition = undefined;
        if (this.localSpeechEnding || !["requesting", "connecting", "connected"].includes(this.state)) return;
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

  async waitForAudioSessionRelease() {
    const elapsed = Date.now() - (this.lastStoppedAt || 0);
    const remaining = Math.max(0, 450 - elapsed);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  stop() {
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
    this.stopVisualizer();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.remoteStream?.getTracks().forEach((track) => track.stop());
    this.resetAudioElement();
    this.remoteStream = undefined;
    this.audioBlocked = false;
    this.lastStoppedAt = Date.now();
    this.state = "idle";
    this.detail = "Stopped";
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
      this.fail("Microphone access is not available from this browser context.");
      return;
    }

    try {
      this.state = "requesting";
      this.detail = "Waiting for microphone permission";
      this.userTranscript = "";
      this.assistantTranscript = "";
      this.partialTranscript = "";
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
        this.remoteStream = event.streams[0] || new MediaStream([event.track]);
        this.ensureVisualizer();
        this.attachAudio();
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          this.state = "connected";
          this.detail = "Connected. Speak to Pipecat Assist.";
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
      if (!response.ok) throw new Error(await response.text());
      const answer = await response.json();
      await peer.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
      this.detail = "Connecting audio";
      this.render();
      this.attachAudio();
    } catch (err) {
      const name = err?.name || "";
      const message = name === "NotAllowedError"
        ? "Microphone access is blocked. Allow microphone access and retry."
        : err?.message || String(err);
      this.fail(message);
    }
  }

  textFromEvent(data) {
    if (!data || typeof data !== "object") return "";
    const nested = data.data && typeof data.data === "object" ? data.data : {};
    return String(
      data.text
      || data.transcript
      || data.message
      || data.content
      || data.delta
      || nested.text
      || nested.transcript
      || nested.message
      || nested.content
      || nested.delta
      || "",
    );
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
    const text = this.textFromEvent(message);
    if (!text) return;

    const userEvent =
      type.includes("user") ||
      type.includes("input") ||
      type.includes("transcription") && !type.includes("bot") && !type.includes("assistant");
    const assistantEvent =
      type.includes("assistant") ||
      type.includes("bot") ||
      type.includes("output") ||
      type.includes("llm") ||
      label.includes("bot");
    const finalEvent = type.includes("final") || message.data?.final || message.is_final || message.final;

    if (userEvent && !assistantEvent) {
      this.userTranscript = finalEvent ? mergeTranscript(this.userTranscript, text) : this.userTranscript;
      this.partialTranscript = finalEvent ? "" : normalizeTranscriptText(text);
      this.render();
      if (shouldEndConversation(`${this.userTranscript} ${this.partialTranscript}`)) {
        window.setTimeout(() => this.stop(), 450);
      }
      return;
    }

    if (assistantEvent) {
      this.assistantTranscript = mergeTranscript(this.assistantTranscript, text);
      this.render();
      if (shouldEndConversation(this.assistantTranscript)) {
        window.setTimeout(() => this.stop(), 650);
      }
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
        this.detail = "Audio is connected, but the browser blocked playback.";
        this.render();
      });
    }
  }

  render() {
    if (!this.shadowRoot) return;
    const running = ["requesting", "connecting", "connected"].includes(this.state);
    const needsAudioTap = running && this.audioBlocked;
    const userText = mergeTranscript(this.userTranscript, this.partialTranscript) || "Say something to Pipecat Assist.";
    const assistantText = this.assistantTranscript || (running ? "Listening..." : "Ready when you are.");
    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          display: block;
          overflow: hidden;
          border-radius: 20px;
          background:
            linear-gradient(180deg, rgba(10, 36, 67, 0.96) 0%, rgba(5, 15, 29, 0.98) 54%, rgba(4, 10, 19, 1) 100%);
          color: #f7fbff;
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
          border: 1px solid rgba(91, 157, 255, 0.34);
        }
        .wrap {
          display: grid;
          grid-template-rows: auto minmax(100px, 1fr) 142px;
          min-height: 360px;
          gap: 16px;
          padding: 24px 24px 0;
          position: relative;
          overflow: hidden;
        }
        .head, .actions, .transcript, .visualizer-shell, .version {
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
        h3 {
          margin: 0;
          font-size: 18px;
          line-height: 1.2;
          color: #ffffff;
        }
        .status {
          display: grid;
          gap: 4px;
          color: rgba(226, 239, 255, 0.74);
          font-size: 13px;
        }
        .transcript {
          display: grid;
          align-content: start;
          gap: 10px;
          min-height: 112px;
          max-width: 100%;
          font-size: 17px;
          line-height: 1.38;
          text-shadow: 0 1px 16px rgba(0, 0, 0, 0.35);
          overflow-wrap: anywhere;
        }
        .message {
          border-radius: 16px;
          padding: 10px 12px;
          backdrop-filter: blur(10px);
        }
        .message.user {
          justify-self: start;
          max-width: min(92%, 560px);
          color: rgba(226, 239, 255, 0.68);
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .message.assistant {
          justify-self: stretch;
          color: #ffffff;
          font-weight: 700;
          background: linear-gradient(135deg, rgba(47, 119, 255, 0.16), rgba(255, 255, 255, 0.07));
          border: 1px solid rgba(129, 189, 255, 0.16);
        }
        .visualizer-shell {
          min-height: 142px;
          margin: 0 -24px;
          overflow: hidden;
          align-self: end;
        }
        .visualizer-shell::before {
          content: "";
          position: absolute;
          left: 50%;
          bottom: -92px;
          width: 118%;
          height: 190px;
          transform: translateX(-50%);
          border-radius: 50% 50% 0 0;
          border-top: 1px solid rgba(168, 209, 255, 0.58);
          box-shadow:
            0 -18px 46px rgba(49, 117, 255, 0.36),
            inset 0 28px 70px rgba(51, 126, 255, 0.36);
          pointer-events: none;
        }
        .visualizer-shell::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, transparent 0%, rgba(39, 110, 255, 0.15) 55%, rgba(49, 118, 255, 0.48) 100%);
          pointer-events: none;
        }
        .visualizer {
          display: block;
          width: 100%;
          height: 142px;
          position: relative;
          z-index: 1;
        }
        button {
          min-height: 52px;
          min-width: 52px;
          border: 0;
          border-radius: 999px;
          padding: 0 18px;
          color: ${running ? "#ffffff" : "#07111f"};
          background: ${running ? "#d94b40" : "#ffffff"};
          font: inherit;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
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
        <div class="wrap">
          <div class="head">
            <div>
              <h3>${this.config.name || "Pipecat Assist"}</h3>
              <div class="status">
                <strong>${this.state === "idle" ? "Ready" : this.state}</strong>
                <span>${this.detail}</span>
              </div>
            </div>
            <div class="actions">
              ${needsAudioTap ? "<button class=\"secondary audio-button\">Enable audio</button>" : ""}
              <button class="main-button">${running ? "Stop" : "Talk"}</button>
            </div>
          </div>
          <div class="transcript" aria-live="polite">
            <div class="message user">${escapeHtml(userText)}</div>
            <div class="message assistant">${escapeHtml(assistantText)}</div>
          </div>
          <div class="visualizer-shell" aria-hidden="true">
            <canvas class="visualizer"></canvas>
          </div>
          <span class="version">v${PIPECAT_ASSIST_CARD_VERSION}</span>
          <audio autoplay playsinline></audio>
        </div>
      </ha-card>
    `;
    this.audio = this.shadowRoot.querySelector("audio");
    this.ensureVisualizer();
    this.attachAudio();
    const audioButton = this.shadowRoot.querySelector(".audio-button");
    if (audioButton) {
      audioButton.onclick = () => {
        this.audioBlocked = false;
        this.detail = "Connected. Speak to Pipecat Assist.";
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
  card.detail = card.detail || "Ready";
  card.userTranscript = card.userTranscript || "";
  card.partialTranscript = card.partialTranscript || "";
  card.assistantTranscript = card.assistantTranscript || "";
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
