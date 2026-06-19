# Changelog

## 0.1.25

- Moved composed realtime turn detection into an explicit VAD processor before
  STT so cloud STT providers receive end-of-speech signals and can finalize
  transcripts.
- Replaced the deprecated incomplete-turn LLM filter in composed pipelines with
  a cascade speech-timeout turn strategy.
- Added the Turn detection step to composed presets and migrated existing
  composed pipelines that were missing it.

## 0.1.24

- Split Gemini configuration into Google Gemini Live for speech-to-speech
  pipelines and Google Gemini Cloud for composed LLM and Pipecat Flow
  pipelines.
- Migrated existing composed Gemini LLM steps to Google Gemini Cloud and
  replaced invalid Gemini STT/TTS steps with supported cloud defaults.
- Fixed composed pipeline presets so they no longer assign Gemini Live to STT
  or TTS steps.

## 0.1.23

- Fixed pipeline validation and integration dropdowns so OpenAI Realtime is
  valid for speech-to-speech pipelines and OpenAI Cloud is used for composed
  STT, LLM, TTS, and Pipecat Flow pipelines.
- Migrated existing saved "OpenAI" integrations to the "OpenAI Realtime" name
  and kept the separate OpenAI Cloud profile for non-realtime model settings.
- Fixed the active pipeline badge alignment in the pipeline editor.

## 0.1.22

- Split OpenAI configuration into OpenAI Realtime for speech-to-speech
  pipelines and OpenAI Cloud for composed STT, LLM, and TTS pipelines.
- Added capability-specific OpenAI defaults for transcription, text models,
  TTS models, and voices, with migration for existing composed pipelines.
- Fixed OpenAI composed runtime failures caused by sending text models to STT
  and by passing `max_tokens: null` to OpenAI chat completions.

## 0.1.21

- Replaced the Pipecat Flows iframe/JSON workflow with an embedded visual
  composer that stores Pipecat Flows Editor-compatible nodes, edges, messages,
  functions, post-actions, and MCP tool bindings.
- Added built-in filtered flow examples, including the official minimal and
  food ordering examples plus a Home Assistant MCP pizza-ordering starter.
- Fixed pipeline action button alignment, improved danger-button contrast in
  dark mode, and defaulted pipeline language fields to `en`.
- Taught the runtime to execute the official Pipecat Flows JSON shape in
  addition to the earlier Home Assistant flow shape.

## 0.1.20

- Fixed browser voice tests hanging on "Connecting audio" after the add-on
  started applying Pipecat's ESP32 SDP munging globally.
- Added WebRTC ICE connection state handling and a visible connection timeout
  so failed audio setup is reported in the Assistant panel instead of spinning
  indefinitely.

## 0.1.19

- Separated active pipeline selection from opening a pipeline for editing, with
  an explicit Set active action and active checkmark on pipeline cards.
- Reworked Pipelines, Integrations, Assistant, and Runtime navigation into
  contextual list/detail screens and removed redundant right columns.
- Removed unsupported Pipecat Flow steps from speech-to-speech presets while
  keeping a disabled palette tile to explain availability.
- Added an official Pipecat Flows Editor surface with JSON import/export and a
  pizza example loader for composed realtime pipelines.
- Added visible MCP test results, a readable Home Assistant MCP call history,
  and simplified automatic Supervisor MCP status.
- Removed the exposed ESP32 mode add-on option; the runner now starts with ESP32
  SmallWebRTC compatibility enabled.
- Improved dark mode contrast, microphone-permission errors, and the assistant
  voice test surface.

## 0.1.18

- Reworked the add-on UI into a product-style flow with Assistant-first
  validation, a pipeline list before pipeline editing, contextual step
  inspectors, and a nested Pipecat Flow composer.
- Moved Home Assistant MCP testing and reset controls into the Home Assistant
  MCP integration, with Automatic, Manual, and Error status labels.
- Added per-integration reset-to-default actions, removed technical ID/kind
  fields from integration forms, and moved save buttons under the edited
  settings.
- Removed duplicated MCP, voice test, and satellite-secret controls from
  Runtime. Runtime now focuses on audio debug and add-on-managed facts.
- Added dark mode, step/pipeline color coding, pipeline validation, drag/drop
  step insertion, hover/click button motion, optional no-greeting behavior, and
  a Voice UI Kit-inspired assistant test surface.

## 0.1.17

- Added composed realtime Pipecat runtime support for STT -> LLM -> TTS
  pipelines alongside Gemini Live, OpenAI Realtime, and AWS Nova Sonic
  speech-to-speech profiles.
- Added pipeline presets inspired by the Pipecat demo, including Soniox,
  Deepgram, Speechmatics, OpenAI, Gemini, AWS Bedrock, Cartesia, Gradium,
  Google Cloud TTS, and ElevenLabs combinations.
- Added Pipecat Flow configuration for composed realtime pipelines with visual
  nodes, transition functions, JSON schemas, and optional Home Assistant MCP
  tool calls.
- Reworked the web UI around an Assistant-first screen, contextual pipeline
  editing, grouped preset cards, integration-specific settings, locked saved
  secrets, and provider model dropdowns where model APIs are available.

## 0.1.16

- Added optional audio debug capture for realtime voice sessions, writing
  separate input and output WAV files under `/data/audio-debug`.
- Added Runtime controls to enable audio capture, set retention, download
  captured WAV files, and clear stored debug sessions.

## 0.1.15

- Fixed OpenAI Realtime sessions inheriting Gemini voices such as `Charon`,
  which caused `session.audio.output.voice` validation errors.
- Clear invalid MCP URL overrides so the add-on falls back to the Supervisor
  MCP URL instead of trying values without `http://` or `https://`.

## 0.1.14

- Fixed OpenAI Realtime pipelines that could inherit a Gemini Live model after
  switching templates or integrations in the UI.
- Added runtime fallback and startup logging for the selected realtime
  provider/model before a voice session starts.

## 0.1.13

- Removed the Home Assistant MCP OAuth flow from the add-on backend and UI.
- Added a Runtime button that resets Home Assistant MCP settings to the
  Supervisor-backed defaults.
- Migrated saved runtime configuration to drop stale OAuth token fields.

## 0.1.12

- Prefer the Home Assistant Supervisor token for MCP access inside the add-on.
  OAuth is now only a fallback for custom/out-of-Supervisor setups.
- Updated Runtime copy so OAuth is no longer presented as required when the
  Supervisor token is available.

## 0.1.11

- Fixed Home Assistant OAuth token exchange by using the normal Home Assistant
  `/auth/token` endpoint instead of the Supervisor proxy endpoint.
- Added fallback handling for Supervisor `401/403` token endpoint responses.

## 0.1.10

- Changed Home Assistant OAuth to redirect back to the stable add-on panel URL
  instead of the temporary Ingress API path.
- Added in-panel OAuth completion so the browser can pass the authorization
  code back to the add-on API after Home Assistant redirects to `/app/...`.
- Added UI asset cache-busting for the bundled React entrypoint and stylesheet.

## 0.1.9

- Moved Home Assistant OAuth client ID generation to a dedicated add-on
  endpoint (`/api/assist/oauth/client`) with an IndieAuth redirect link.
- Generated OAuth callback URLs from the actual add-on API base path instead
  of the Home Assistant frontend app path.

## 0.1.8

- Fixed Home Assistant OAuth redirect URL generation for app/Ingress paths
  such as `/app/<app_slug>`.

## 0.1.7

- Added Home Assistant MCP OAuth login from the Runtime panel.
- Added OAuth access-token refresh before MCP checks, text conversations, and
  realtime voice sessions.
- Kept manual long-lived access tokens as a fallback for environments where
  OAuth cannot complete.
- Updated Runtime MCP status, readiness checks, and docs to prefer OAuth over
  Supervisor-token fallback.

## 0.1.6

- Prevented Home Assistant MCP authentication failures from crashing realtime
  voice sessions.
- Added MCP HTTP preflight so 401/403 errors become actionable configuration
  messages instead of AnyIO/ASGI cancellation traces.
- Made the Runtime panel distinguish Supervisor-token fallback from a saved
  long-lived MCP token.

## 0.1.5

- Reworked the integrations editor so each provider shows only contextual
  settings for that integration type.
- Added voice-test preflight checks for the selected realtime provider, saved
  API key state, unsupported providers, and missing MCP token warnings.
- Improved SmallWebRTC error messages in the browser voice test.

## 0.1.4

- Made Gemini Live the first-run default pipeline and provider configuration.
- Added a Runtime voice test that connects from the browser through
  SmallWebRTC and exercises the selected pipeline.
- Added an Ingress-friendly relative offer endpoint for browser voice tests.
- Rewrote the Gemini Live Home Assistant setup and test guide in English.

## 0.1.3

- Added Gemini Live realtime runtime support through Pipecat's Google service.
- Added Google dependencies to the add-on image.
- Added Gemini defaults and a dedicated Gemini Live pipeline template in the UI.
- Added Gemini text bridge support for Home Assistant Conversation through
  Google's OpenAI-compatible endpoint.
- Added a Gemini Live setup and test guide for Home Assistant.

## 0.1.2

- Fixed the React UI asset and API paths for Home Assistant Ingress.
- Added explicit routes for the React entrypoint assets used by the Ingress
  relative bundle.
- Added a visible loading error state instead of leaving the UI blank when
  config/status requests fail.
- Replaced `structuredClone` usage in the UI with a broader browser-compatible
  clone helper.

## 0.1.1

- Replaced the original static settings page with a React pipeline editor.
- Added graphical pipeline templates for realtime, cloud cascade, local-first,
  and custom flows.
- Added UI-managed integrations for OpenAI, Gemini, Anthropic, Bedrock, Azure,
  OpenAI-compatible endpoints, Ollama, local runtimes, and Home Assistant MCP.
- Moved model, provider, MCP, satellite, and flow settings out of Home
  Assistant add-on options and into the app UI.
- Added semver image publishing fixes for Home Assistant Supervisor.

## 0.1.0

- Initial Pipecat Assist add-on.
- Added SmallWebRTC `/api/offer` support for Pipecat ESP32 clients.
- Added Home Assistant MCP bridge using `SUPERVISOR_TOKEN` or a long-lived token.
- Added Ingress web UI for model and flow configuration.
- Added companion Home Assistant conversation integration.
- Added Pipecat branding assets for README, Home Assistant app metadata, the
  custom integration brand directory, and the Ingress UI.
- Fixed multi-architecture image publishing to select the matching Home
  Assistant base image for each target architecture.
- Fixed image publishing tags so Home Assistant can pull the semver tag that
  matches `version: "0.1.0"`.
