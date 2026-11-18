#!/usr/bin/with-contenv bashio
set -e

RUNNER_HOST="0.0.0.0"
RUNNER_PORT="$(bashio::config 'runner_port')"
LOG_LEVEL="$(bashio::config 'log_level')"

export RUNNER_HOST
export RUNNER_PORT
export LOG_LEVEL
GPT_LIVE_LAZY_CONNECT="$(bashio::config 'gpt_live_lazy_connect')"
export GPT_LIVE_LAZY_CONNECT

ARGS=(--host "$RUNNER_HOST" --port "$RUNNER_PORT" -t webrtc)

exec python3 -m app.main "${ARGS[@]}"
