"""Home Assistant Conversation entity for Pipecat Assist."""

from __future__ import annotations

import asyncio
import aiohttp

from homeassistant.components import conversation
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import intent
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_FLOW_ID, CONF_TOKEN, CONF_URL, LANGUAGE


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Pipecat Assist conversation entity."""

    async_add_entities([PipecatAssistConversationEntity(hass, entry)])


class PipecatAssistConversationEntity(conversation.ConversationEntity):
    """Conversation entity backed by the Pipecat Assist add-on."""

    _attr_has_entity_name = True
    _attr_name = "Pipecat Assist"
    _attr_supported_features = conversation.ConversationEntityFeature.CONTROL

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self._entry = entry
        self._attr_unique_id = entry.entry_id
        self._session = async_get_clientsession(hass)

    @property
    def supported_languages(self) -> list[str]:
        """Return supported languages."""

        return [LANGUAGE]

    async def async_process(
        self, user_input: conversation.ConversationInput
    ) -> conversation.ConversationResult:
        """Process a text conversation turn."""

        url = self._entry.data[CONF_URL].rstrip("/")
        token = self._entry.data.get(CONF_TOKEN)
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        payload = {
            "text": user_input.text,
            "language": user_input.language,
            "conversation_id": user_input.conversation_id,
            "device_id": user_input.device_id,
            "satellite_id": user_input.satellite_id,
            "flow_id": self._entry.data.get(CONF_FLOW_ID) or None,
        }
        response = intent.IntentResponse(language=user_input.language)

        try:
            async with asyncio.timeout(75):
                async with self._session.post(
                    f"{url}/api/assist/conversation",
                    json=payload,
                    headers=headers,
                ) as http_response:
                    data = await http_response.json()
                    if http_response.status >= 400:
                        response.async_set_error(
                            intent.IntentResponseErrorCode.UNKNOWN,
                            data.get("detail", "Pipecat Assist returned an error."),
                        )
                    elif data.get("error"):
                        response.async_set_error(
                            intent.IntentResponseErrorCode.UNKNOWN,
                            data.get("speech", data["error"]),
                        )
                    else:
                        response.async_set_speech(data.get("speech", ""))
        except (TimeoutError, aiohttp.ClientError) as err:
            response.async_set_error(
                intent.IntentResponseErrorCode.UNKNOWN,
                f"Pipecat Assist is not reachable: {err}",
            )
            data = {}

        return conversation.ConversationResult(
            response=response,
            conversation_id=data.get("conversation_id") or user_input.conversation_id,
            continue_conversation=bool(data.get("continue_conversation", False)),
        )
