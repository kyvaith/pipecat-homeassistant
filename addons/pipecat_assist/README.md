<p align="center">
  <img src="https://raw.githubusercontent.com/kyvaith/pipecat-homeassistant/main/addons/pipecat_assist/logo.png" alt="Pipecat Assist" width="320">
</p>

# Pipecat Assist

Pipecat Assist runs a realtime Pipecat voice agent inside Home Assistant. It
connects to Home Assistant MCP for device control, serves a web UI through
Ingress, and exposes a SmallWebRTC endpoint for Pipecat ESP32 satellites.

Open the web UI after starting the add-on. The first screen is the voice
assistant test surface. Pipelines are complete runtime profiles used by the UI,
Pipecat ESP32 satellites, and future Home Assistant cards.

Gemini Live is preconfigured as the default speech-to-speech profile. The UI
also includes composed realtime profiles such as `Soniox + OpenAI + Cartesia`,
`Deepgram + Gemini + Google TTS`, and `Speechmatics + AWS Nova Pro +
ElevenLabs`. Official Pipecat Flows can be enabled inside composed realtime
pipelines.

For setup, testing, and troubleshooting, see `DOCS.md`.
