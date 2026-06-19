#!/usr/bin/with-contenv bashio
set -e

RUNNER_HOST="0.0.0.0"
RUNNER_PORT="$(bashio::config 'runner_port')"
ESP32_MODE="$(bashio::config 'esp32_mode')"
LOG_LEVEL="$(bashio::config 'log_level')"

export RUNNER_HOST
export RUNNER_PORT
export ESP32_MODE
export LOG_LEVEL

ARGS=(--host "$RUNNER_HOST" --port "$RUNNER_PORT" -t webrtc)
if bashio::var.true "$ESP32_MODE"; then
    ARGS+=(--esp32)
fi

exec python3 -m app.main "${ARGS[@]}"
