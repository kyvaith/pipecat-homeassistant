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

`runner_port`
: Pipecat runner port. Keep the default unless you also know how Home
Assistant ingress and direct clients reach the add-on.

`log_level`
: Application log level.

## Web UI

`Assistant`
: Start or stop the browser voice test for the selected pipeline.

`Pipelines`
: Choose, add, duplicate, delete, and open complete Pipecat runtime profiles.
After opening a pipeline, edit its colored steps from the canvas. Drag
supported step types into the pipeline and open Pipecat Flow in the nested
composer.

`Integrations`
: Configure cloud providers and local AI endpoints, including Gemini, OpenAI,
Soniox, Deepgram, Cartesia, Gradium, Speechmatics, AWS, ElevenLabs, Google
Cloud TTS, Azure/OpenAI-compatible APIs, Ollama, local runtimes, and Home
Assistant MCP. Home Assistant MCP shows Automatic, Manual, or Error state and
contains the MCP test/reset controls.

`Runtime`
: Enable audio debug captures and view add-on-managed runtime facts.

### Home Assistant MCP

In a normal Home Assistant add-on install, Pipecat Assist uses the Supervisor
token provided by Home Assistant (`homeassistant_api: true`) to reach
`/api/mcp`. Open **Integrations > Home Assistant MCP** and select **Test MCP**.

Select **Automatic defaults** to clear a custom MCP URL or saved access token
and return to the Supervisor-backed defaults. The manual access-token field is
only for custom deployments where the Supervisor token is not available or a
custom MCP URL is used.

### Audio debug captures

Open **Runtime**, enable **Record audio in/out**, save, and run a
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

The add-on should run with `esp32_mode: true`. The direct ESP32 authentication
path will move to the standard Home Assistant token flow as the ESPHome
integration work lands.

## Home Assistant Conversation entity

Copy or install `custom_components/pipecat_assist` from this repository, then
add the integration in Home Assistant. Set the add-on URL to
`http://127.0.0.1:7860` or the Home Assistant LAN URL if the integration cannot
reach loopback in your installation.

## Branding assets

Home Assistant uses `icon.png` and `logo.png` from this add-on directory in the
Supervisor app listing. Home Assistant 2026.3 and newer also read the local
integration brand files from `custom_components/pipecat_assist/brand`.
