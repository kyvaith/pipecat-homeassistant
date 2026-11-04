"""Config flow for Pipecat Assist."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import aiohttp
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

try:
    from homeassistant.data_entry_flow import probatio as schema
except ImportError:
    import voluptuous as schema

from .const import CONF_URL, DEFAULT_URL, DOMAIN
from .supervisor import (
    APP_ACTIVE_STATES,
    APP_REPOSITORY,
    SupervisorApps,
    SupervisorError,
)

_LOGGER = logging.getLogger(__name__)
APP_NAME = "Pipecat Assist"
DEFAULT_ADDON_PORT = 7860
APP_SETUP_LOCK = f"{DOMAIN}_app_setup_lock"
APP_READY_TIMEOUT = 45
SUPERVISOR_URL = os.getenv("SUPERVISOR", "http://supervisor").rstrip("/")
if not SUPERVISOR_URL.startswith(("http://", "https://")):
    SUPERVISOR_URL = f"http://{SUPERVISOR_URL}"


async def _validate_url(hass: HomeAssistant, url: str, *, timeout: float = 10) -> None:
    session = async_get_clientsession(hass)
    async with asyncio.timeout(timeout):
        async with session.get(f"{url.rstrip('/')}/api/assist/status") as response:
            if not 200 <= response.status < 300:
                raise aiohttp.ClientError(f"Unexpected status {response.status}")
            payload = await response.json()
            if (
                not isinstance(payload, dict)
                or payload.get("ok") is not True
                or "runner" not in payload
            ):
                raise aiohttp.ClientError("Not a Pipecat Assist status response")


def _addon_port(addon: dict[str, Any]) -> int:
    options = addon.get("options") if isinstance(addon.get("options"), dict) else {}
    for value in (
        options.get("runner_port"),
        addon.get("ingress_port"),
        addon.get("port"),
        DEFAULT_ADDON_PORT,
    ):
        try:
            port = int(value)
        except (TypeError, ValueError):
            continue
        if 0 < port <= 65535:
            return port
    return DEFAULT_ADDON_PORT


def _addon_url_candidates(addon: dict[str, Any]) -> list[str]:
    slug = str(addon.get("slug", "")).strip()
    hostname = addon.get("hostname")
    port = _addon_port(addon)
    hosts = [hostname, "127.0.0.1", slug.replace("_", "-"), "localhost"]
    return [f"http://{host}:{port}" for host in dict.fromkeys(hosts) if host]


def _supervisor(hass: HomeAssistant) -> SupervisorApps | None:
    if token := os.getenv("SUPERVISOR_TOKEN"):
        return SupervisorApps(async_get_clientsession(hass), SUPERVISOR_URL, token)
    return None


async def _find_app_url(hass: HomeAssistant, candidates: list[str]) -> str | None:
    for candidate in candidates:
        try:
            await _validate_url(hass, candidate, timeout=2)
        except (TimeoutError, aiohttp.ClientError, ValueError):
            continue
        return candidate
    return None


class PipecatAssistConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a Pipecat Assist config flow."""

    VERSION = 1

    def __init__(self) -> None:
        self._suggested_url = DEFAULT_URL
        self._setup_task: asyncio.Task[str] | None = None
        self._app_url: str | None = None
        self._allow_install = False

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Handle the initial step."""
        supervisor = _supervisor(self.hass)
        if supervisor is not None:
            try:
                addon = await supervisor.installed_app()
                if addon is None:
                    return self.async_show_menu(
                        step_id="user",
                        menu_options=["install_app", "manual"],
                        description_placeholders={"repository": APP_REPOSITORY},
                    )
                addon.update(await supervisor.app_info(addon["slug"]))
            except SupervisorError as err:
                _LOGGER.debug("Pipecat Assist app detection failed: %s", err)
            else:
                candidates = _addon_url_candidates(addon)
                self._suggested_url = candidates[0]
                if addon.get("state") not in APP_ACTIVE_STATES:
                    return await self.async_step_app_stopped()
                self._suggested_url = (
                    await _find_app_url(self.hass, candidates) or candidates[0]
                )
        return await self.async_step_manual(user_input)

    async def async_step_app_stopped(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Offer to start an already-installed app."""
        return self.async_show_menu(
            step_id="app_stopped", menu_options=["start_app", "manual"]
        )

    async def async_step_manual(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Connect to an already-running Pipecat Assist server."""
        errors: dict[str, str] = {}
        if user_input is not None:
            self._suggested_url = user_input[CONF_URL].strip().rstrip("/")
            try:
                await _validate_url(self.hass, self._suggested_url)
            except (TimeoutError, aiohttp.ClientError, ValueError):
                errors["base"] = "cannot_connect"
            else:
                return await self._async_finish(self._suggested_url)
        return self.async_show_form(
            step_id="manual",
            data_schema=schema.Schema(
                {schema.Required(CONF_URL, default=self._suggested_url): str}
            ),
            errors=errors,
        )

    async def async_step_install_app(
        self, user_input=None
    ) -> config_entries.ConfigFlowResult:
        """Install and start the app after the user's confirmation."""
        self._allow_install = True
        return await self.async_step_setup_app()

    async def async_step_start_app(
        self, user_input=None
    ) -> config_entries.ConfigFlowResult:
        """Start the existing app after the user's confirmation."""
        self._allow_install = False
        return await self.async_step_setup_app()

    async def async_step_setup_app(
        self, user_input=None
    ) -> config_entries.ConfigFlowResult:
        """Show progress while Supervisor prepares the app."""
        if self._setup_task is None:
            self._setup_task = self.hass.async_create_task(self._async_setup_app())
        if not self._setup_task.done():
            return self.async_show_progress(
                step_id="setup_app",
                progress_action="install_app" if self._allow_install else "start_app",
                progress_task=self._setup_task,
            )
        try:
            self._app_url = self._setup_task.result()
        except SupervisorError as err:
            _LOGGER.warning("Pipecat Assist app setup failed: %s", err)
            return self.async_show_progress_done(next_step_id="app_setup_failed")
        finally:
            self._setup_task = None
        return self.async_show_progress_done(next_step_id="app_ready")

    async def async_step_app_setup_failed(
        self, user_input=None
    ) -> config_entries.ConfigFlowResult:
        """Allow retry or manual setup after an unsuccessful operation."""
        return self.async_show_menu(
            step_id="app_setup_failed", menu_options=["setup_app", "manual"]
        )

    async def async_step_app_ready(
        self, user_input=None
    ) -> config_entries.ConfigFlowResult:
        """Finish setup with the verified app URL."""
        assert self._app_url is not None
        return await self._async_finish(self._app_url)

    async def _async_finish(self, url: str) -> config_entries.ConfigFlowResult:
        await self.async_set_unique_id(url)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title=APP_NAME, data={CONF_URL: url})

    async def _async_setup_app(self) -> str:
        supervisor = _supervisor(self.hass)
        if supervisor is None:
            raise SupervisorError("Supervisor is unavailable")

        # Recheck inside the lock in case another setup already installed or started the app.
        lock = self.hass.data.setdefault(APP_SETUP_LOCK, asyncio.Lock())
        async with lock:
            addon = await supervisor.installed_app()
            if addon is None:
                if not self._allow_install:
                    raise SupervisorError("Pipecat Assist is no longer installed")
                slug = await supervisor.install_app()
            else:
                slug = addon["slug"]

            info = await supervisor.app_info(slug)
            candidates = _addon_url_candidates(info)
            self._suggested_url = candidates[0]
            if info.get("state") not in APP_ACTIVE_STATES:
                await supervisor.start_app(slug)

            try:
                async with asyncio.timeout(APP_READY_TIMEOUT):
                    while True:
                        if url := await _find_app_url(self.hass, candidates):
                            return url
                        await asyncio.sleep(1)
            except TimeoutError as err:
                raise SupervisorError(
                    "Pipecat Assist did not respond after startup"
                ) from err
