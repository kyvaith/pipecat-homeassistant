# Changelog

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
