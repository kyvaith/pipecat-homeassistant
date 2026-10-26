"""Pipecat Assist custom integration."""

from __future__ import annotations

from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_URL, Platform
from homeassistant.core import HomeAssistant

from .const import VERSION
from .views import register_proxy_views
from .voice_stream import register_voice_stream

PLATFORMS = [Platform.CONVERSATION, Platform.STT, Platform.TTS]
if hasattr(Platform, "AI_TASK"):
    PLATFORMS.append(Platform.AI_TASK)
CARD_RESOURCE_PATH = "/pipecat_assist/pipecat-assist-card.js"
CARD_MODULE_URL = f"{CARD_RESOURCE_PATH}?v={VERSION}"


def _is_pipecat_card_resource_url(url: str) -> bool:
    """Return true for old or current Pipecat Assist Lovelace card resources."""

    path = url.split("?")[0]
    return path == CARD_RESOURCE_PATH or (
        path.endswith("/pipecat-assist-card.js") and "pipecat" in path
    )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Pipecat Assist from a config entry."""

    await _async_register_static_path(hass)
    register_proxy_views(hass)
    register_voice_stream(hass)
    _async_register_frontend_module(hass)
    await _async_register_lovelace_resource(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Pipecat Assist."""

    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        for relay in list(hass.data.get("pipecat_assist", {}).get("voice_streams", {}).values()):
            if relay and relay.entry_id == entry.entry_id:
                relay.stop()
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


async def _async_register_lovelace_resource(hass: HomeAssistant) -> None:
    """Make the Lovelace card visible in the dashboard card picker."""

    try:
        from homeassistant.components.lovelace.const import (
            CONF_RESOURCE_TYPE_WS,
            LOVELACE_DATA,
            MODE_STORAGE,
        )
    except ImportError:
        return

    lovelace_data = hass.data.get(LOVELACE_DATA)
    if not lovelace_data or lovelace_data.resource_mode != MODE_STORAGE:
        return

    resources = lovelace_data.resources
    if hasattr(resources, "async_get_info"):
        await resources.async_get_info()
    elif not getattr(resources, "loaded", True):
        await resources.async_load()
        resources.loaded = True

    card_resources = [
        item
        for item in resources.async_items() or []
        if _is_pipecat_card_resource_url(str(item.get(CONF_URL, "")))
    ]
    for item in card_resources:
        if (
            str(item.get(CONF_URL, "")) != CARD_MODULE_URL
            and hasattr(resources, "async_update_item")
        ):
            await resources.async_update_item(
                item["id"],
                {CONF_RESOURCE_TYPE_WS: "module", CONF_URL: CARD_MODULE_URL},
            )

    for item in card_resources[1:]:
        if hasattr(resources, "async_delete_item"):
            await resources.async_delete_item(item["id"])

    if card_resources:
        return

    await resources.async_create_item(
        {CONF_RESOURCE_TYPE_WS: "module", CONF_URL: CARD_MODULE_URL}
    )


async def _async_register_static_path(hass: HomeAssistant) -> None:
    """Expose Lovelace card assets from the integration."""

    www_path = Path(__file__).parent / "www"
    route = "/pipecat_assist"
    try:
        from homeassistant.components.http import StaticPathConfig
    except ImportError:
        StaticPathConfig = None  # type: ignore[assignment]

    if StaticPathConfig and hasattr(hass.http, "async_register_static_paths"):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(route, str(www_path), True)]
        )
        return

    try:
        from homeassistant.components.http import async_register_static_paths
    except ImportError:
        async_register_static_paths = None  # type: ignore[assignment]

    if StaticPathConfig and async_register_static_paths:
        await async_register_static_paths(
            hass,
            [StaticPathConfig(route, str(www_path), True)],
        )
        return

    if hasattr(hass.http, "register_static_path"):
        hass.http.register_static_path(route, str(www_path), True)
        return

    raise RuntimeError("Home Assistant HTTP static path registration is unavailable")
