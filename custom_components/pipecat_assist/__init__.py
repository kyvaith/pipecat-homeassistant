"""Pipecat Assist custom integration."""

from __future__ import annotations

from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

PLATFORMS = [Platform.CONVERSATION, Platform.STT, Platform.TTS]
CARD_MODULE_URL = "/pipecat_assist/pipecat-assist-card.js"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Pipecat Assist from a config entry."""

    await _async_register_static_path(hass)
    _async_register_frontend_module(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Pipecat Assist."""

    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        _async_unregister_frontend_module(hass)
    return unloaded


def _async_register_frontend_module(hass: HomeAssistant) -> None:
    """Load the Lovelace card module automatically with the HA frontend."""

    from homeassistant.components import frontend

    frontend.add_extra_js_url(hass, CARD_MODULE_URL)


def _async_unregister_frontend_module(hass: HomeAssistant) -> None:
    """Unload the Lovelace card module when the integration is unloaded."""

    from homeassistant.components import frontend

    frontend.remove_extra_js_url(hass, CARD_MODULE_URL)


async def _async_register_static_path(hass: HomeAssistant) -> None:
    """Expose Lovelace card assets from the integration."""

    www_path = Path(__file__).parent / "www"
    try:
        from homeassistant.components.http import (  # type: ignore[attr-defined]
            StaticPathConfig,
            async_register_static_paths,
        )

        await async_register_static_paths(
            hass,
            [StaticPathConfig("/pipecat_assist", str(www_path), True)],
        )
    except (ImportError, AttributeError):
        hass.http.register_static_path("/pipecat_assist", str(www_path), True)
