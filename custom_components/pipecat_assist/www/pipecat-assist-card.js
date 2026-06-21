class PipecatAssistCard extends HTMLElement {
  static getStubConfig() {
    return { name: "Pipecat Assist" };
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
    this.peer?.close();
    this.peer = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    if (this.audio) this.audio.srcObject = null;
    this.remoteStream = undefined;
    this.audioBlocked = false;
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
      const addonConfig = await this.loadAddonConfig();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      const peer = new RTCPeerConnection();
      this.peer = peer;
      const track = this.stream.getAudioTracks()[0];
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
              library_version: "0.1.43",
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
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await this.waitForIce(peer);

      const offerPath = this.proxyMode()
        ? `/api/pipecat_assist/offer${this.entryQuery()}`
        : addonConfig.runner_offer_path || "api/offer";
      const requestData = {
        source: "lovelace_card",
        client_id: this.clientId(),
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
