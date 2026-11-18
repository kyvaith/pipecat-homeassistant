# GPT-Live: connect after the wake word, faster tool use, reliable conversation end

## Summary
The ESPHome satellite (ReSpeaker XVF3800) kept the GPT-Live WebSocket open permanently. This PR opens it only when mic audio arrives after the wake word and closes it when idle. It also fixes three problems found in real-world testing:
- tool loops in the backend delegation that burned tokens
- high latency per tool step
- conversations that never ended because of background speech (radio)

## Changes

### 1. GPT-Live: connect on demand (`openai_live_lazy.py`, new)
- **What:** `LazyOpenAILiveLLMService` extends `HAOpenAILiveLLMService`.
  - **Connect:** the WebSocket is opened on the first mic frame. Audio received before `session.started` is buffered (max. 1000 frames) and flushed once the session is ready.
  - **Disconnect:** the connection is closed after 15 s without mic audio or activity **and** no tool delegation in progress. A safety net closes it after 120 s.
  - **Failure:** if connecting fails (e.g. HTTP 401), the service is marked usable again and reconnects on the next wake word, at most once every 10 s. Previously the session stayed dead until the satellite reconnected, because Pipecat treats the error as permanent.
  - **Latency logs:** time until the session is ready and time until the first *audible* reply. Measured with an RMS threshold, because the Live API streams silence continuously.
- **How:** new add-on option `gpt_live_lazy_connect` (default `true`), passed through `run.sh` as `GPT_LIVE_LAZY_CONNECT`. Applies to ESPHome satellites only. `false` restores the previous behaviour, e.g. for A/B comparisons.
- **Why:** no open connection to OpenAI while nobody is speaking. Measured cost: ~2 s connection setup after the wake word.

### 2. Tool delegation: fewer bad calls (`openai_live_ha.py`, `mcp_bridge.py`)
- **Drop empty arguments:** Pipecat omits the `strict` flag for Live tools, and the backend model then fills *every* optional parameter with placeholders (`""`, `[]`, `{}`, `null`). `_drop_empty_arguments` removes them before the MCP call is sent.
- **`strict_nullable`:** a boolean `nullable: true` in a tool schema becomes `type: [t, "null"]`, or an extra `{"type": "null"}` in `anyOf`. The model can then set optional fields to `null` instead of inventing values.
- **Why:** in testing, a simple light query took 6 tool steps, one of which scanned all automations and alone took 6.4 s. Afterwards it took 1–3 steps.

### 3. Reasoning effort for the backend delegation (`main.py`)
- **What:** `ResponsesDelegation` now passes a `reasoning.effort`: the value from `flow.reasoning_effort`, otherwise Pipecat's lowest default for the model (`gpt-6-sol` → `none`).
- **Why:** the backend previously ran with OpenAI's default reasoning, about 2.8 s per step. The internal Pipecat table `_THINKING_DEFAULTS` is marked as a `shortcut` and must be rechecked on the next Pipecat upgrade.

### 4. MCP tool allowlist in the UI (`ui-src/src/main.jsx`, built `app/ui/*`)
- **What:** the tools step has an "Allowed MCP tools" field and a "Voice preset" button. The preset contains 6 tools: `ha_search`, `ha_get_state`, `ha_call_service`, `ha_bulk_control`, `ha_list_floors_areas`, `ha_get_history`. The field commits on blur; separators are commas or whitespace.
- **Why:** with all 77 ha-mcp tools, each delegation step sent ~70k tokens; with the preset ~7k. One day of testing cost 3.4M tokens.

### 5. Conversation end (`va_pipecat_protocol.py`, `main.py`)
- **German:** `_should_end_conversation` recognises German farewells, e.g.:
  - "Tschüss", "bis dann", "mach's gut", "das war's", "schönen Tag noch"
  - short forms: "Danke, Ende", "okay, fertig", "stopp"
  - `ß` is normalised to `ss` before matching.
- **Interrupted farewell:** the end was previously checked only on `bot-stopped-speaking`. When background speech interrupted the farewell, that event never came. It is now also checked on the next speaker change; on a farewell the satellite receives `interrupt` with `reason=stopped` and closes the mic.
- **Cap:** at most 3 follow-up turns without a new wake word, then `stopped`. The mic stays closed until the next wake word.
- **Why:** in barge-in mode the mic stays open while the assistant speaks. A radio playing in the room kept triggering new replies, over 6 minutes in a row in the logs, and reset the follow-up timer every time.

### 6. Fork-specific (not for upstream)
- `config.yaml`: `image:` removed so Home Assistant builds the add-on locally. Version `0.2.7-lazy.11`.
- `repository.yaml`: name, URL and maintainer point to the fork.

## Tests
- **New:**
  - `test_openai_live_lazy.py`: connect on audio, buffering until session start, idle close and reconnect, 401 followed by a retry, reasoning effort.
  - `test_mcp_empty_arguments.py`: dropping empty arguments, `strict_nullable`.
  - `test_conversation_end.py`: German, English and Polish farewells.
  - `test_va_pipecat_protocol.py`: follow-up turn cap, interrupted farewell.
- **Result:** 102 tests. Only `test_release_metadata` fails, because of the fork version (expected).
- **On the device (ReSpeaker XVF3800):**
  - Connecting after the wake word and closing when idle verified; the session is ready after 1.7–2.1 s.
  - Light query: previously 22 s, now ~8 s with `gpt-6-sol`.
  - Conversation end verified with a radio playing.
  - Reconnect after a 401 is covered by the unit test only.

## Known limitations
- **Mic briefly reopens:** a follow-up window that is already scheduled can still open for ~4 s after `stopped`. This lives in the satellite firmware and is not fixed here.
- **Free-text search:** `gpt-5.4-mini` as the backend searches by free text, which is very slow in ha-mcp (35–40 s), so `gpt-6-sol` is recommended.
