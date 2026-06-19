# Gemini Live in Home Assistant

This guide shows how to configure Pipecat Assist with Google Gemini Live and
test it from Home Assistant.

There are two useful test paths:

- Home Assistant Assist / Conversation: Home Assistant sends a text turn to
  Pipecat Assist. For Gemini, the add-on uses Google's OpenAI-compatible API
  for the text model and Home Assistant MCP for tools.
- Realtime voice: the browser voice tester, Pipecat ESP32, or another
  SmallWebRTC client connects to Pipecat Assist and talks to Gemini Live
  speech-to-speech.

## Requirements

- Pipecat Assist 0.1.16 or newer.
- Home Assistant with the Model Context Protocol Server integration enabled.
- A Google AI Studio API key with access to the Gemini Live API.
- The `custom_components/pipecat_assist` integration installed if you want to
  test through the standard Home Assistant Assist conversation agent.

Google describes the Live API as a low-latency, stateful WebSocket API for
voice, video, and text. Pipecat exposes it through `GeminiLiveLLMService`, and
the add-on image includes `pipecat-ai[google]`.

## Configure The Add-On

1. Update Pipecat Assist to version 0.1.16 or newer.
2. Start the add-on and open the Pipecat Assist web UI.
3. In Home Assistant, enable **Model Context Protocol Server**.
4. Open **Runtime > Home Assistant**:
   - `MCP URL`: keep `http://supervisor/core/api/mcp` unless your installation
     needs a custom URL.
   - Click **Check MCP**. A healthy result shows the number of tools. In a
     normal add-on install this uses the Home Assistant Supervisor token
     automatically.
   - Click **Reset MCP** if you previously saved a custom MCP URL or token and
     want to return to the Supervisor-backed defaults.
5. Open **Integrations > Google Gemini**:
   - `API key`: paste the key from Google AI Studio.
   - `Default model`: use `gemini-3.5-flash` for Home Assistant Assist text
     tests.
   - `Realtime model`: use `models/gemini-3.1-flash-live-preview`.
   - `Voice`: use `Charon` or another Gemini Live voice, for example `Puck`.
6. Open **Pipelines** and select the **Gemini Live** template. New
   installations use it by default.
7. Set:
   - `Language`: `en-US` for English, or another BCP-47 code such as `pl-PL`.
   - `MCP tools`: enabled.
   - `Instructions`: keep the default Home Assistant voice agent instruction or
     adjust it for your household rules.
8. Click **Save**.

## Test Realtime Voice In The Add-On UI

The Runtime page includes a browser-based SmallWebRTC tester. It uses the
currently selected pipeline and the same `/api/offer` route as Pipecat ESP32.

1. Open **Runtime > Voice test**.
2. Click **Start voice test**.
3. Allow microphone access in the browser.
4. Wait until the state changes to **Connected**.
5. Say a short command, for example:
   - `What devices are available in the living room?`
   - `Turn on the living room lamp.`
   - `Set the living room lamp brightness to 30 percent.`
6. Listen for the assistant response in the embedded audio control.
7. Click **Stop voice test** when finished.

If the browser cannot access the microphone, open the add-on UI over HTTPS or
from a trusted local origin. If the connection fails immediately, check the
Gemini API key, selected pipeline, and add-on logs.

## Test Through Home Assistant Assist

This checks the HA Conversation bridge, flow selection, and Home Assistant MCP
tool calls. It is a text-path test, not a streaming Gemini Live audio test.

1. Copy or install `custom_components/pipecat_assist` to
   `/config/custom_components/pipecat_assist` and restart Home Assistant if the
   integration is not installed yet.
2. Go to **Settings > Devices & services > Add integration** and add
   **Pipecat Assist**.
3. Configure:
   - `Add-on URL`: usually `http://127.0.0.1:7860`. If Home Assistant Core
     cannot reach the add-on loopback address, use the Home Assistant LAN URL.
   - `Bearer token`: leave empty unless you add your own endpoint protection.
   - `Flow ID`: leave empty to use the currently selected pipeline, or enter a
     specific flow ID from the pipeline inspector.
4. Go to **Settings > Voice assistants**, select your assistant, and set the
   conversation agent to **Pipecat Realtime**.
5. In Home Assistant Assist, type:
   - `What devices are available in the living room?`
   - `Turn on the living room lamp.`
   - `Set the living room lamp brightness to 30 percent.`
6. Check the add-on logs. You should see the MCP connection and a Gemini
   response without model or authorization errors.

## Test With Pipecat ESP32

1. In Pipecat Assist, open **Runtime > Satellite**.
2. Set `Public host` to the Home Assistant LAN address, for example
   `192.168.1.20`.
3. Copy `Offer URL`.
4. Configure Pipecat ESP32 or another SmallWebRTC client:

```bash
export PIPECAT_SMALLWEBRTC_URL="http://<ha-lan-ip>:7860/api/offer?token=<satellite-secret>"
```

5. Start the satellite and say:
   - `Turn on the living room lamp.`
   - `Is the garage door open?`

If MCP is connected, Gemini Live should call Home Assistant tools and answer
with voice.

## Troubleshooting

- `Missing module: google.genai`: the add-on image is older than 0.1.3.
- `model not found`: check Live API access in Google AI Studio. You can also
  test `models/gemini-2.5-flash-native-audio-preview-12-2025`.
- MCP or `401`: select **Reset MCP**, restart the add-on, and then select
  **Check MCP** again so it can use the Supervisor token. Use a Home Assistant
  long-lived access token only for custom MCP URLs or non-Supervisor
  deployments.
- HA Assist does not respond: make sure the custom integration points to
  `http://127.0.0.1:7860` or to the correct Home Assistant LAN URL.
- The browser voice test has no microphone: use HTTPS or a browser trusted
  local origin.
- The assistant answers a different question than the one you asked: open
  **Runtime > Audio debug**, enable **Record audio in/out**, save, repeat the
  voice test, and download the input/output WAV files from the Runtime panel.
- Voice `marin` does not work with Gemini: set the Gemini integration voice to
  `Charon` or `Puck`.
- OpenAI `invalid_model`: select the **Realtime Home** template again or set
  the OpenAI realtime model to `gpt-realtime-2`, then save. Version 0.1.14 also
  repairs stale Gemini model IDs when an OpenAI voice session starts.
- OpenAI `session.audio.output.voice`: select the **Realtime Home** template
  again or set the OpenAI voice to `marin`. Version 0.1.15 repairs stale Gemini
  voices such as `Charon` when an OpenAI voice session starts.

## Sources

- Pipecat Gemini Live: https://docs.pipecat.ai/api-reference/server/services/s2s/gemini-live
- Pipecat Client Web: https://github.com/pipecat-ai/pipecat-client-web
- Google Gemini Live API: https://ai.google.dev/gemini-api/docs/live-api
- Gemini 3.1 Flash Live model: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview
- Gemini OpenAI-compatible API: https://ai.google.dev/gemini-api/docs/openai
- Home Assistant MCP Server: https://www.home-assistant.io/integrations/mcp_server/
- Home Assistant Auth API: https://developers.home-assistant.io/docs/auth_api/
