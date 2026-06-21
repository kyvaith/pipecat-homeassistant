# Changelog

## 0.1.53

- Added a Home Assistant frontend compatibility guard that fills a missing
  `assist_pipeline/run` STT sample rate when the web Assist dialog sends
  `sample_rate: null`, preventing the Core validation error before Pipecat
  Assist STT is called.
- The Lovelace card now tears down active WebRTC audio on page unload or when
  the card is removed from the dashboard DOM, reducing the chance that a stale
  microphone session interferes with Home Assistant Assist in the same browser.

## 0.1.52

- Stabilized mobile Lovelace audio by switching the WebRTC Opus offer back to
  mono fullband voice settings with a lower bitrate and stronger audio-session
  cleanup between calls.
- Disabled token-level TTS aggregation for ElevenLabs because it can feed the
  provider tiny text fragments and cause choppy playback; existing ElevenLabs
  integrations are repaired back to sentence aggregation.

## 0.1.51

- Tuned Lovelace card and add-on voice test WebRTC offers for fuller Opus
  playback by advertising fullband/high-bitrate Opus parameters.
- Added a background Home Assistant Assist warmup after add-on startup and
  configuration saves to pre-cache MCP tools and pre-open the Gemini Live setup
  path before the first Assist turn.

## 0.1.50

- Fixed composed WebRTC sessions with Speechmatics STT by passing the active
  session language into the Pipecat Speechmatics service instead of leaving it
  at the provider default English setting.
- Lovelace card and the add-on voice test now send a session language with the
  WebRTC offer, using the card config, Home Assistant language, or browser
  language as available.

## 0.1.49

- Fixed composed Home Assistant Assist STT selection so OpenAI Cloud
  transcription models such as `gpt-4o-mini-transcribe` use the stable buffered
  transcription endpoint instead of being incorrectly routed through the
  realtime STT bridge.
- Added Home Assistant Assist STT stream logs with selected provider, mode,
  received audio size, and transcript fingerprint to make composed pipeline
  audio issues visible in add-on logs.

## 0.1.48

- Home Assistant Assist conversation responses now keep
  `continue_conversation=true` for successful turns across all Pipecat Assist
  conversation bridge paths, so the HA frontend can resume listening after TTS
  playback ends.
- The custom component now keeps continuous conversation enabled for successful
  add-on responses and disables it only when the add-on returns an error.

## 0.1.47

- Reduced Home Assistant Assist latency for Gemini Live bridge turns by
  completing the bridge on Gemini Live `generationComplete` instead of waiting
  for `turnComplete`, which can include the model's simulated realtime playback
  delay.
- Gemini Live HA Assist bridge responses now set `continue_conversation=true`
  so Home Assistant frontends that support continuous conversation can resume
  listening after the answer.
- Added the Gemini Live completion reason to HA Assist bridge logs.

## 0.1.46

- Fixed the raw Gemini Live WebSocket setup payload used by the Home Assistant
  Assist bridge. `responseModalities`, `speechConfig`, and `maxOutputTokens`
  are now sent under `generationConfig`, matching the Live API schema.
- Omitted unsupported raw Live `thinkingConfig` fields from the HA Assist
  bridge setup to avoid `Unknown name` setup failures.

## 0.1.45

- Added a Gemini Live turn bridge for Home Assistant Assist audio sessions.
  When the active pipeline is Gemini Live and Home Assistant sends mono 16-bit
  PCM audio, STT starts a Gemini Live turn and caches the resulting transcript,
  assistant text, and Live audio for the following Conversation and TTS calls.
- Added Gemini Live MCP tool-call forwarding in the HA Assist bridge so smart
  home requests can still use Home Assistant MCP instead of dropping to a
  tool-less audio-only path.
- HA Assist TTS now reuses Gemini Live audio for bridged turns instead of
  synthesizing a second response through Gemini Cloud TTS.
- The Home Assistant STT entity now advertises WAV/PCM only, so HA Assist
  consistently provides a stream format that can be forwarded to Live APIs.

## 0.1.44

- Fixed provider-specific default TTS voices so Gemini Cloud uses the Gemini
  voice fallback instead of the OpenAI `marin` fallback when no voice is set.
- Added TTS synthesis logs with provider, model, voice, and synthesis duration
  to make slow HA Assist voice responses easier to diagnose.

## 0.1.43

- Reuse HA Assist TTS prefetches even when Home Assistant requests a different
  preferred audio format than the prefetch task used.
- Add timing logs for HA Assist Conversation and TTS so add-on logs show cache
  hits, prefetch age, TTS wait time, and total request time.

## 0.1.42

- Updated the default Gemini TTS model to `gemini-3.1-flash-tts-preview`
  and migrate saved default Gemini TTS settings to the current model.
- Added Gemini TTS retry and model fallback handling so HA Assist TTS prefetch
  does not fall back to a second slow on-demand synthesis after transient
  `Gemini did not return audio` responses.

## 0.1.41

- Added a WebSocket-based Home Assistant STT bridge so HA Assist microphone
  audio is forwarded to the add-on while it is still being captured.
- Added streaming STT paths for OpenAI realtime transcription and Deepgram,
  with buffered fallback for other configured pipelines such as Gemini Live or
  Gemini Cloud.
- Added best-effort TTS prefetch after HA Assist conversation responses so the
  following HA TTS request can reuse already-started synthesis when possible.

## 0.1.40

- Added early silence detection to the Home Assistant STT bridge so classic HA
  Assist audio requests do not wait for Home Assistant to close a long stream
  before transcription starts.
- Fixed HA Assist text conversations for OpenAI Cloud composed pipelines by
  choosing a provider-compatible model from the active LLM integration instead
  of reusing stale Gemini flow defaults.
- Replaced the default Gemini text fallback with `gemini-2.5-flash` and
  migrated saved `gemini-3.5-flash` defaults.

## 0.1.39

- Fixed Lovelace WebRTC card playback by preserving the remote audio stream
  across status rerenders and adding the same RTVI keepalive ping used by the
  add-on voice test.
- Added a browser-blocked playback recovery button for cases where the browser
  requires an extra tap before audio can play.

## 0.1.38

- Added safe provider error handling for HA Assist STT, TTS, and conversation
  calls so transient provider failures such as Gemini 503 no longer crash the
  add-on or leak request URLs into tracebacks.
- Added retries for HA Assist STT/TTS provider calls.
- Improved the Home Assistant conversation entity to read text error responses
  from the add-on instead of reporting them as unreachable JSON decode errors.

## 0.1.37

- Fixed HA Assist STT/TTS failures when the active pipeline is speech-to-speech
  and has no separate STT or TTS steps.
- Added automatic HA Assist bridge fallbacks for enabled compatible
  integrations, including Gemini STT/TTS using the existing Google API key.
- Replaced unhandled add-on RuntimeErrors for missing HA Assist bridge
  integrations with clear HTTP errors.

## 0.1.36

- Fixed the classic Home Assistant Assist bridge by wrapping raw PCM microphone
  audio into a valid WAV file before sending it to cloud STT providers.
- Changed HA Assist TTS output to default to MP3 and honor Home Assistant's
  preferred output format, avoiding unnecessary playback conversion failures.

## 0.1.35

- Automatically register the Lovelace card as a dashboard resource in storage
  mode so it appears in the card picker under custom cards.
- Added cache-busting for the Lovelace card module and made the card module
  safe to load more than once.

## 0.1.34

- Fixed Home Assistant Assist language filtering by advertising all languages
  for the conversation entity and broad STT/TTS language support including
  Polish, so Pipecat Assist can be selected for Polish and other HA assistant
  languages.

## 0.1.33

- Fixed Lovelace card static asset registration on Home Assistant versions
  where `async_register_static_paths` is exposed on `hass.http` instead of as a
  module-level helper.

## 0.1.32

- Auto-detect the Pipecat Assist add-on through the Home Assistant Supervisor
  API and prefill the add-on URL in the custom component setup form while
  keeping the field editable.

## 0.1.31

- Added authenticated Home Assistant proxy endpoints for the Lovelace card, so
  dashboard YAML no longer needs an add-on Ingress token.
- Changed the Lovelace card to use the active add-on pipeline by default
  instead of sending a flow ID.
- Simplified new custom component setup to only ask for the add-on URL.

## 0.1.30

- Automatically load the Lovelace card module when the Pipecat Assist custom
  component is installed, so users no longer need to add a dashboard resource
  manually.

## 0.1.29

- Added visible pipeline steps for Session Memory and Web Search, including a
  Web Search announcement switch.
- Let Web Search choose a cloud LLM provider instead of assuming OpenAI; OpenAI
  Responses web search and Gemini Google Search grounding are supported.
- Added Polish UI translations with automatic locale detection and moved the
  dark-mode control to an icon button in the top bar.
- Added Home Assistant STT and TTS entities plus a Lovelace WebRTC card for
  Pipecat Assist.
- Fixed the active pipeline badge CSS and relabeled Google Cloud TTS HTTP as a
  fallback provider.

## 0.1.28

- Added Web Search as a separate integration and optional LLM tool for
  pipelines.
- Added short-lived per-client session memory and configurable MCP tool schema
  caching in Runtime settings.
- Split Google Cloud TTS into HTTP and Streaming integrations, with chunking
  controls for compatible streaming TTS providers.
- Wired composed pipelines to support local Web Search tools together with Home
  Assistant MCP tools.
- Tightened VAD semantics so removing the VAD step disables local/provider turn
  detection configuration instead of leaving a hidden pipeline behavior.
- Updated docs for Gemini Live, composed realtime latency, Web Search, MCP
  cache, and session memory.

## 0.1.27

- Cleaned the pipeline editor inspector so step-specific controls are shown
  only for the selected step.
- Moved language and speech speed defaults from pipeline editing into
  integration runtime defaults and wired them into provider setup.
- Added hover delete controls to pipeline step tiles and fixed the active
  pipeline badge layout.

## 0.1.26

- Added first-run Gemini Live setup guidance above the assistant voice test
  when no configured pipeline is ready to run.
- Changed the default ElevenLabs voice to `Xb7hH8MSUJpSbSDYk0k2` and migrated
  saved defaults that still used the old built-in voice.

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
