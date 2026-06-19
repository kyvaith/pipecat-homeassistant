# Pipecat Assist Documentation

## Requirements

- Home Assistant with the Model Context Protocol Server integration enabled.
- An API key for the realtime model provider.
- A reachable LAN IP for Home Assistant if ESP32 satellites will connect.

## Configuration

Most settings live in the Pipecat Assist web UI, not in Home Assistant add-on
options.

`esp32_mode`
: Startup-time flag for Pipecat's ESP32 SmallWebRTC SDP handling.

`log_level`
: Application log level.

## Web UI

`Pipelines`
: Choose, add, duplicate, delete, and edit Pipecat pipelines. Templates include
realtime, cloud cascade, local-first, and custom flows.

`Integrations`
: Configure cloud providers and local AI endpoints, including OpenAI, Gemini,
Anthropic, Bedrock, Azure/OpenAI-compatible APIs, Ollama, local runtimes, and
Home Assistant MCP.

`Runtime`
: Check or reset Home Assistant MCP, configure the satellite public host and
shared satellite secret, run a browser voice test, and enable audio debug
captures for the selected pipeline through the same SmallWebRTC offer route
used by satellites.

### Home Assistant MCP

In a normal Home Assistant add-on install, Pipecat Assist uses the Supervisor
token provided by Home Assistant (`homeassistant_api: true`) to reach
`/api/mcp`. Open **Runtime > Home Assistant** and select **Check MCP**.

Select **Reset MCP** to clear a custom MCP URL or saved access token and return
to the Supervisor-backed defaults. The manual access-token field is only for
custom deployments where the Supervisor token is not available or a custom MCP
URL is used.

### Audio debug captures

Open **Runtime > Audio debug**, enable **Record audio in/out**, save, and run a
voice test or satellite session. The add-on stores separate input and output
WAV files under `/data/audio-debug` and shows download links in the Runtime
panel. Clear the captures after troubleshooting if they include private audio.

## Gemini Live

For a Gemini Live setup, browser voice test, and Home Assistant Assist test
path, see
`docs/gemini-live-home-assistant.md` in the repository.

## Pipecat ESP32

Build the ESP32 firmware with:

```bash
export PIPECAT_SMALLWEBRTC_URL="http://<ha-lan-ip>:7860/api/offer?token=<satellite-secret>"
```

The add-on should run with `esp32_mode: true` and `runner_host` set to the same
LAN IP.

## Home Assistant Conversation entity

Copy or install `custom_components/pipecat_assist` from this repository, then
add the integration in Home Assistant. Set the add-on URL to
`http://127.0.0.1:7860` or the Home Assistant LAN URL if the integration cannot
reach loopback in your installation.

## Branding assets

Home Assistant uses `icon.png` and `logo.png` from this add-on directory in the
Supervisor app listing. Home Assistant 2026.3 and newer also read the local
integration brand files from `custom_components/pipecat_assist/brand`.
