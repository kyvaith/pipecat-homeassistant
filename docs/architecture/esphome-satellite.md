# ESPHome satellite architecture

Pipecat Assist supports ESPHome satellites through an authenticated,
versioned raw-PCM WebSocket transport at:

```text
ws://<home-assistant-lan-host>:7860/api/assist/esphome
```

The complete URL shown in **Runtime > ESPHome satellite** includes the active
pipeline and satellite secret.

## Why a dedicated ESPHome transport

The official `pipecat-esp32` project is useful reference code for
SmallWebRTC, Opus, and selected ESP-IDF boards, but it owns the board audio
stack. An ESPHome component must instead coexist with configured microphones,
speaker graphs, wake-word engines, AEC, UI automations, media playback, and
ESPHome lifecycle management.

For a LAN satellite, raw PCM also avoids Opus encode/decode and WebRTC state on
the microcontroller. Pipecat continues to own model transports and response
pacing on the Home Assistant host.

## Data plane

```mermaid
flowchart LR
    Mic["ESPHome microphone source\nPCM16 mono 16 kHz"] --> Tx["Non-blocking uplink ring"]
    Tx --> WS["Authenticated WebSocket"]
    WS --> Transport["Pipecat FastAPI transport"]
    Transport --> Pipeline["Selected Pipecat pipeline"]
    Pipeline --> Transport
    Transport -->|"Paced PCM16 mono 24 kHz"| WS
    WS --> Jitter["PSRAM playback buffer"]
    Jitter --> Drain["Dedicated playback task"]
    Drain --> Speaker["ESPHome speaker graph"]
```

- The microphone callback only copies samples into a bounded staging ring. A
  separate task performs WebSocket writes, so Wi-Fi locks cannot block capture.
- Pipecat packetizes output into 40 ms frames and paces it in realtime.
- The device uses a configurable PSRAM jitter buffer and drains it outside the
  ESPHome main loop, isolating audio from display or artwork stalls.
- Interrupt frames flush queued assistant PCM before the next user utterance.

## Control plane

Text WebSocket messages are compact JSON. Protocol version 1 defines:

| Direction | Type | Purpose |
| --- | --- | --- |
| server to device | `hello` | Protocol, PCM format, capabilities, and timing |
| device to server | `wake` | Begin a new wake-word turn |
| device to server | `interrupt` | Barge in and cancel current output |
| device to server | `stop` | End the conversation |
| device to server | `flush` | Drop incomplete microphone input |
| server to device | `phase` | Canonical UI state |
| server to device | `transcript` | Live user or assistant text |
| server to device | `interrupt` | Flush locally queued assistant PCM |
| server to device | `error` | Stable error code and safe display message |

The component accepts `replying` as a compatibility alias but emits
`speaking`.

## State ownership

Pipecat owns semantic conversation state. The device owns physical playback
completion:

1. Wake word opens `listening` immediately.
2. Server VAD moves the turn to `thinking`.
3. First bot speech moves it to `speaking`.
4. A server follow-up transition is held locally until the final PCM and
   downstream speaker buffers drain.
5. Barge-in flushes the playback queue and returns immediately to `listening`.
6. A terminal response shows `thanks` briefly and then returns to `idle`.

This division keeps the interface synchronized with what the user can actually
hear while avoiding device-side guesses about model or tool progress.

## Security and provisioning

- The endpoint is host-network `ws://` by default. Use it only on a trusted LAN
  or behind a TLS reverse proxy that terminates `wss://`.
- The query token is a secret. Store it in ESPHome `secrets.yaml`, do not commit
  it, and rotate it if exposed.
- The active pipeline may be selected in the URL. Invalid pipeline IDs or
  tokens are rejected before a Pipecat worker starts.

