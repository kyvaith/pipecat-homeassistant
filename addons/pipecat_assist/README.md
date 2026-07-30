<p align="center">
  <img src="https://raw.githubusercontent.com/kyvaith/pipecat-homeassistant/main/addons/pipecat_assist/logo.png" alt="Pipecat Assist" width="320">
</p>

# Pipecat Assist

Pipecat Assist runs a realtime Pipecat voice agent inside Home Assistant. It
connects to Home Assistant MCP for device control, serves a web UI through
Ingress, exposes WebRTC and ESPHome satellite transports, and backs Home
Assistant AI Tasks for generated data and image generation.

Open the web UI after starting the add-on. The first screen is the voice
assistant test surface. Pipelines are complete runtime profiles used by the UI,
ESPHome and standalone Pipecat ESP32 satellites, and Home Assistant cards.

Gemini Live is preconfigured as the default speech-to-speech profile. The UI
also includes composed realtime profiles such as `Soniox + OpenAI + Cartesia`,
`Deepgram + Gemini + Google TTS Streaming`, and `Speechmatics + AWS Nova Pro +
ElevenLabs`. Provider settings are configured in **Integrations**: realtime
providers, cloud STT/LLM/TTS providers, Web Search, and Home Assistant MCP are
kept separate. Google Imagen and fal Image Generation integrations can be used
for Home Assistant image-generation tasks. Session Memory and Web Search are
visible pipeline steps, and official Pipecat Flows can be enabled inside
composed realtime pipelines.

The built-in Home Assistant MCP integration uses the Supervisor connection
automatically. The optional HA MCP Server Add-on integration is also detected
automatically from the add-on's generated secret URL and does not need a Bearer
token.

For setup, testing, and troubleshooting, see `DOCS.md`.
