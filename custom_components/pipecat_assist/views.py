"""HTTP proxy views for the Pipecat Assist Lovelace card."""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp
from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import CONF_TOKEN, CONF_URL, DOMAIN

PROXY_CONFIG_PATH = "/api/pipecat_assist/config"
PROXY_OFFER_PATH = "/api/pipecat_assist/offer"


def register_proxy_views(hass: HomeAssistant) -> None:
    """Register authenticated proxy views used by the Lovelace card."""

    data = hass.data.setdefault(DOMAIN, {})
    if data.get("proxy_views_registered"):
        return
    hass.http.register_view(PipecatAssistConfigView())
    hass.http.register_view(PipecatAssistOfferView())
    data["proxy_views_registered"] = True


def _entry_from_request(hass: HomeAssistant, request: web.Request) -> ConfigEntry:
    entry_id = request.query.get("entry_id", "")
    return _entry_for_id(hass, entry_id)


def _entry_for_id(hass: HomeAssistant, entry_id: str = "") -> ConfigEntry:
    entries = hass.config_entries.async_entries(DOMAIN)
    if entry_id:
        entry = next((item for item in entries if item.entry_id == entry_id), None)
        if entry:
            return entry
        raise web.HTTPNotFound(text="Pipecat Assist entry was not found.")
    if entries:
        return entries[0]
    raise web.HTTPNotFound(text="Pipecat Assist is not configured.")


def _addon_url(entry: ConfigEntry, path: str) -> str:
    if path.startswith(("http://", "https://")):
        return path
    return f"{entry.data[CONF_URL].rstrip('/')}/{path.lstrip('/')}"


def _addon_headers(entry: ConfigEntry) -> dict[str, str]:
    token = str(entry.data.get(CONF_TOKEN, "")).strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


async def _load_addon_config(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> dict[str, Any]:
    session = async_get_clientsession(hass)
    try:
        async with asyncio.timeout(30):
            async with session.get(
                _addon_url(entry, "/api/assist/config"),
                headers=_addon_headers(entry),
            ) as response:
                if response.status >= 400:
                    raise web.HTTPBadGateway(text=await response.text())
                data = await response.json()
    except (TimeoutError, aiohttp.ClientError) as err:
        raise web.HTTPBadGateway(text=f"Pipecat Assist add-on is not reachable: {err}") from err
    return data if isinstance(data, dict) else {}


class PipecatAssistConfigView(HomeAssistantView):
    """Return add-on config through Home Assistant auth."""

    url = PROXY_CONFIG_PATH
    name = "api:pipecat_assist:config"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        entry = _entry_from_request(hass, request)
        data = await _load_addon_config(hass, entry)
        entry_query = f"?entry_id={entry.entry_id}" if request.query.get("entry_id") else ""
        data["runner_offer_path"] = f"{PROXY_OFFER_PATH}{entry_query}"
        data["runner_offer_url"] = data["runner_offer_path"]
        data["ha_audio_streaming"] = bool(data.pop("browser_ws_path", None))
        return web.json_response(data)


class PipecatAssistOfferView(HomeAssistantView):
    """Proxy a SmallWebRTC offer to the add-on without exposing add-on tokens."""

    url = PROXY_OFFER_PATH
    name = "api:pipecat_assist:offer"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        entry = _entry_from_request(hass, request)
        payload = await request.json()
        addon_config = await _load_addon_config(hass, entry)
        offer_path = str(addon_config.get("runner_offer_path") or "api/offer")
        session = async_get_clientsession(hass)
        try:
            async with asyncio.timeout(75):
                async with session.post(
                    _addon_url(entry, offer_path),
                    json=payload,
                    headers=_addon_headers(entry),
                ) as response:
                    body = await response.read()
                    return web.Response(
                        body=body,
                        status=response.status,
                        headers={"Content-Type": response.headers.get("Content-Type", "application/json")},
                    )
        except (TimeoutError, aiohttp.ClientError) as err:
            raise web.HTTPBadGateway(text=f"Pipecat Assist offer failed: {err}") from err
