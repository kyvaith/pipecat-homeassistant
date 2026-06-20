"""Speech-to-text entity for Pipecat Assist."""

from __future__ import annotations

from collections.abc import AsyncIterable

import aiohttp

from homeassistant.components import stt
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_FLOW_ID, CONF_TOKEN, CONF_URL, LANGUAGE


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Pipecat Assist STT entity."""

    async_add_entities([PipecatAssistSpeechToTextEntity(hass, entry)])


class PipecatAssistSpeechToTextEntity(stt.SpeechToTextEntity):
    """Speech-to-text bridge backed by the Pipecat Assist add-on."""

    _attr_has_entity_name = True
    _attr_name = "Pipecat Assist"

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_stt"
        self._session = async_get_clientsession(hass)

    @property
    def supported_languages(self) -> list[str]:
        """Return supported languages."""

        return [LANGUAGE]

    @property
    def supported_formats(self) -> list[stt.AudioFormats]:
        """Return supported audio formats."""

        return [stt.AudioFormats.WAV, stt.AudioFormats.OGG]

    @property
    def supported_codecs(self) -> list[stt.AudioCodecs]:
        """Return supported audio codecs."""

        return [stt.AudioCodecs.PCM, stt.AudioCodecs.OPUS]

    @property
    def supported_bit_rates(self) -> list[stt.AudioBitRates]:
        """Return supported bit rates."""

        return [stt.AudioBitRates.BITRATE_16]

    @property
    def supported_sample_rates(self) -> list[stt.AudioSampleRates]:
        """Return supported sample rates."""

        return [
            stt.AudioSampleRates.SAMPLERATE_16000,
            stt.AudioSampleRates.SAMPLERATE_48000,
        ]

    @property
    def supported_channels(self) -> list[stt.AudioChannels]:
        """Return supported channels."""

        return [stt.AudioChannels.CHANNEL_MONO]

    async def async_process_audio_stream(
        self,
        metadata: stt.SpeechMetadata,
        stream: AsyncIterable[bytes],
    ) -> stt.SpeechResult:
        """Process an audio stream through the add-on STT bridge."""

        url = self._entry.data[CONF_URL].rstrip("/")
        token = self._entry.data.get(CONF_TOKEN)
        headers = {
            "Content-Type": f"audio/{metadata.format}",
            "X-Speech-Content": (
                f"format={metadata.format}; codec={metadata.codec}; "
                f"sample_rate={int(metadata.sample_rate)}; bit_rate={int(metadata.bit_rate)}; "
                f"channel={int(metadata.channel)}; language={metadata.language}"
            ),
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"

        body = b"".join([chunk async for chunk in stream])
        params = {}
        if flow_id := self._entry.data.get(CONF_FLOW_ID):
            params["flow_id"] = flow_id

        try:
            async with self._session.post(
                f"{url}/api/assist/stt",
                params=params,
                data=body,
                headers=headers,
            ) as response:
                data = await response.json()
                if response.status >= 400:
                    return stt.SpeechResult(
                        text=data.get("detail", "Pipecat Assist STT failed."),
                        result=stt.SpeechResultState.ERROR,
                    )
        except aiohttp.ClientError as err:
            return stt.SpeechResult(text=str(err), result=stt.SpeechResultState.ERROR)

        return stt.SpeechResult(
            text=data.get("text") or "",
            result=stt.SpeechResultState.SUCCESS,
        )
