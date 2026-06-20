"""Pipecat Assist custom integration."""

from __future__ import annotations

from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

PLATFORMS = [Platform.CONVERSATION, Platform.STT, Platform.TTS]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Pipecat Assist from a config entry."""

    await _async_register_static_path(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Pipecat Assist."""

    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


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
