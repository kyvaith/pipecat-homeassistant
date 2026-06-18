# Changelog

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
