<p align="center">
  <img src="logo.png" alt="Pipecat Assist" width="320">
</p>

# Pipecat Assist

Pipecat Assist runs a realtime Pipecat voice agent inside Home Assistant. It
connects to Home Assistant MCP for device control, serves a web UI through
Ingress, and exposes a SmallWebRTC endpoint for Pipecat ESP32 satellites.

Open the web UI after starting the add-on to manage pipelines, cloud/local AI
integrations, MCP settings, the browser voice test, and the satellite URL.

For Google Gemini Live setup and testing through Home Assistant Assist, see
`docs/gemini-live-home-assistant.md` in the repository.

Home Assistant displays this add-on with `icon.png` and `logo.png` from this
directory. The Ingress UI uses the same Pipecat mark in `/assets/logo.svg`.
