"""Text-to-speech entity for Pipecat Assist."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import aiohttp

from homeassistant.components.tts import (
    ATTR_PREFERRED_FORMAT,
    ATTR_VOICE,
    TextToSpeechEntity,
    TtsAudioType,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_FLOW_ID,
    CONF_TOKEN,
    CONF_URL,
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
)

TURN_CACHE_OPTION = "pipecat_audio_request_id"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Pipecat Assist TTS entity."""

    async_add_entities([PipecatAssistTextToSpeechEntity(hass, entry)])


class PipecatAssistTextToSpeechEntity(TextToSpeechEntity):
    """Text-to-speech bridge backed by the Pipecat Assist add-on."""

    _attr_has_entity_name = True
    _attr_name = "Pipecat Assist"
    _attr_default_language = DEFAULT_LANGUAGE
    _attr_supported_languages = SUPPORTED_LANGUAGES
    _attr_supported_options = [ATTR_PREFERRED_FORMAT, ATTR_VOICE]

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_tts"
        self._session = async_get_clientsession(hass)

    @property
    def default_options(self) -> dict[str, Any]:
        """Prevent HA from replaying another turn's audio for identical text."""
        return {TURN_CACHE_OPTION: uuid4().hex}

    async def async_get_tts_audio(
        self,
        message: str,
        language: str,
        options: dict[str, Any],
    ) -> TtsAudioType:
        """Load TTS audio from the add-on."""

        url = self._entry.data[CONF_URL].rstrip("/")
        token = self._entry.data.get(CONF_TOKEN)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        payload: dict[str, Any] = {
            "text": message,
            "language": language,
            "options": {key: value for key, value in options.items() if key != TURN_CACHE_OPTION},
        }
        if flow_id := self._entry.data.get(CONF_FLOW_ID):
            payload["flow_id"] = flow_id

        try:
            async with self._session.post(
                f"{url}/api/assist/tts",
                json=payload,
                headers=headers,
            ) as response:
                if response.status >= 400:
                    return None, None
                extension = response.headers.get("X-Audio-Extension", "mp3")
                return extension, await response.read()
        except aiohttp.ClientError:
            return None, None
