ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm
FROM ${BUILD_FROM}

ARG BUILD_VERSION=0.1.0
ARG BUILD_ARCH=amd64
ARG LEGACY_AMD64_NUMPY=false

ENV PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        build-essential \
        ca-certificates \
        ffmpeg \
        libffi-dev \
        libopus0 \
        libsndfile1 \
        libssl-dev \
        libvpx7 \
        python3 \
        python3-dev \
        python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /tmp/pipecat_assist/pyproject.toml
COPY constraints-legacy-amd64.txt /tmp/pipecat_assist/constraints-legacy-amd64.txt
COPY app/ /tmp/pipecat_assist/app/
RUN if [ "${LEGACY_AMD64_NUMPY}" = "true" ]; then \
        pip3 install --constraint /tmp/pipecat_assist/constraints-legacy-amd64.txt /tmp/pipecat_assist; \
    else \
        pip3 install /tmp/pipecat_assist; \
    fi \
    && rm -rf /tmp/pipecat_assist

COPY app/ /app/
COPY root/ /
RUN chmod a+x /run.sh

LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="app" \
    io.hass.arch="${BUILD_ARCH}" \
    org.opencontainers.image.title="Pipecat Assist" \
    org.opencontainers.image.source="https://github.com/kyvaith/pipecat-homeassistant"

WORKDIR /
CMD ["/run.sh"]
