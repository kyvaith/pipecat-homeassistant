# Pipecat Assist Documentation

## Requirements

- Home Assistant with the Model Context Protocol Server integration enabled.
- An API key for the realtime model provider.
- A reachable LAN IP for Home Assistant if ESP32 satellites will connect.

## Configuration

`openai_api_key`
: API key used by OpenAI Realtime and the text bridge.

`runner_host`
: Host/IP passed to Pipecat runner. For `esp32_mode`, use the Home Assistant
LAN IP, not `localhost`.

`runner_port`
: Port used by the Pipecat runner and web UI. Default is `7860`.

`satellite_shared_secret`
: Optional bearer/query token required by `/api/offer`. If set, use
`?token=<value>` in `PIPECAT_SMALLWEBRTC_URL`.

`ha_mcp_url`
: MCP endpoint. Leave empty to use `http://supervisor/core/api/mcp`.

`longlived_token`
: Optional Home Assistant long-lived access token. Leave empty to use the
Supervisor token provided by `homeassistant_api: true`.

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
