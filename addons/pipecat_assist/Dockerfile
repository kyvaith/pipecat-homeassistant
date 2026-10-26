ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm
FROM python:3.12-slim-bookworm AS python-runtime
FROM ${BUILD_FROM}

ARG BUILD_VERSION=0.1.0
ARG BUILD_ARCH=amd64
ARG LEGACY_AMD64_NUMPY=false

ENV PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

COPY --from=python-runtime /usr/local/ /usr/local/

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        build-essential \
        ca-certificates \
        ffmpeg \
        libffi-dev \
        libbz2-1.0 \
        libexpat1 \
        libgdbm6 \
        liblzma5 \
        libncursesw6 \
        libopus0 \
        libreadline8 \
        libsndfile1 \
        libsqlite3-0 \
        libssl-dev \
        libvpx7 \
        uuid-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /tmp/pipecat_assist/pyproject.toml
COPY constraints-legacy-amd64.txt /tmp/pipecat_assist/constraints-legacy-amd64.txt
COPY requirements*.lock /tmp/pipecat_assist/
RUN if [ "${LEGACY_AMD64_NUMPY}" = "true" ]; then \
        pip3 install --requirement /tmp/pipecat_assist/requirements-legacy-amd64.lock; \
    else \
        pip3 install --requirement /tmp/pipecat_assist/requirements.lock; \
    fi
COPY app/ /tmp/pipecat_assist/app/
RUN pip3 install --no-deps /tmp/pipecat_assist && rm -rf /tmp/pipecat_assist

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
