const PIPECAT_ASSIST_CARD_VERSION = "0.1.53";
const HA_ASSIST_SAMPLE_RATE_FALLBACK = 48000;
const OPUS_AUDIO_QUALITY_PARAMS = {
  minptime: "20",
  useinbandfec: "1",
  maxplaybackrate: "48000",
  maxaveragebitrate: "96000",
  usedtx: "0",
};
const OPUS_AUDIO_REMOVE_PARAMS = new Set(["stereo", "sprop-stereo"]);

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
      this.render();
      this.resetAudioElement();
      await this.waitForAudioSessionRelease();
      const addonConfig = await this.loadAddonConfig();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      const peer = new RTCPeerConnection();
      this.peer = peer;
      const track = this.stream.getAudioTracks()[0];
      rememberAudioSampleRate(track?.getSettings?.().sampleRate);
      if (track) peer.addTransceiver(track, { direction: "sendrecv" });
      else peer.addTransceiver("audio", { direction: "sendrecv" });

      this.channel = peer.createDataChannel("signalling");
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
    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          display: block;
          padding: 18px;
          overflow: hidden;
        }
        .wrap {
          display: grid;
          gap: 14px;
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
        }
        .status {
          display: grid;
          gap: 4px;
          color: var(--secondary-text-color);
          font-size: 13px;
        }
        .bars {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          align-items: end;
          height: 54px;
          gap: 5px;
          padding: 12px;
          border-radius: 10px;
          background: var(--secondary-background-color);
        }
        .bars span {
          display: block;
          height: 18px;
          border-radius: 999px;
          background: var(--primary-color);
          opacity: 0.45;
          animation: ${running ? "pulse 900ms ease-in-out infinite" : "none"};
          animation-delay: var(--delay);
        }
        @keyframes pulse {
          0%, 100% { height: 14px; opacity: 0.35; }
          50% { height: 42px; opacity: 0.95; }
        }
        button {
          min-height: 40px;
          border: 0;
          border-radius: 8px;
          padding: 0 14px;
          color: var(--text-primary-color, white);
          background: ${running ? "var(--error-color)" : "var(--primary-color)"};
          font: inherit;
          font-weight: 700;
          cursor: pointer;
          transition: transform 140ms ease, filter 140ms ease;
        }
        .actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        button.secondary {
          color: var(--primary-text-color);
          background: var(--secondary-background-color);
          box-shadow: inset 0 0 0 1px var(--divider-color);
        }
        button:hover { transform: translateY(-1px); filter: brightness(1.03); }
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
          <div class="bars" aria-hidden="true">
            ${[0, 1, 2, 3, 4, 5, 6].map((item) => `<span style="--delay:${item * 90}ms"></span>`).join("")}
          </div>
          <audio autoplay playsinline></audio>
        </div>
      </ha-card>
    `;
    this.audio = this.shadowRoot.querySelector("audio");
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

if (!customElements.get("pipecat-assist-card")) {
  customElements.define("pipecat-assist-card", PipecatAssistCard);
}

window.customCards = Array.isArray(window.customCards) ? window.customCards : [];
const existingCardIndex = window.customCards.findIndex((card) => card.type === "pipecat-assist-card");
if (existingCardIndex >= 0) window.customCards.splice(existingCardIndex, 1);
window.customCards.push({
  type: "pipecat-assist-card",
  name: "Pipecat Assist",
  description: "Realtime Pipecat Assist voice card.",
  preview: true,
});
