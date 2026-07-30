"""Automatic endpoint provisioning for ESPHome ``va_pipecat`` satellites."""

from __future__ import annotations

import asyncio
import ipaddress
import time
from contextlib import suppress
from typing import Any, Callable
from urllib.parse import urlencode, urlsplit

import httpx
from loguru import logger

CORE_API_PATH = "/core/api"
PROVISION_ACTION_SUFFIX = "_provision_pipecat"


def _host_from_value(value: str) -> str:
    """Extract a host from either a bare hostname/IP or a complete URL."""

    value = (value or "").strip()
    if not value or value in {"0.0.0.0", "::"}:
        return ""
    parsed = urlsplit(value if "://" in value else f"//{value}")
    return parsed.hostname or ""


def _format_host(host: str) -> str:
    """Bracket IPv6 hosts for use in a WebSocket URL."""

    try:
        if ipaddress.ip_address(host).version == 6:
            return f"[{host}]"
    except ValueError:
        pass
    return host


def build_esphome_endpoint(config: Any, ha_config: dict[str, Any] | None = None) -> str:
    """Build the authenticated device endpoint without exposing it in status."""

    host = _host_from_value(getattr(config, "runner_host", ""))
    if not host:
        ha_config = ha_config or {}
        for key in ("internal_url", "external_url"):
            host = _host_from_value(str(ha_config.get(key) or ""))
            if host:
                break
    host = _format_host(host or "homeassistant.local")

    query = urlencode(
        {
            key: value
            for key, value in {
                "token": getattr(config, "satellite_shared_secret", ""),
                "flow_id": getattr(config, "selected_flow_id", ""),
            }.items()
            if value
        }
    )
    suffix = f"?{query}" if query else ""
    return (
        f"ws://{host}:{int(getattr(config, 'runner_port', 7860))}"
        f"/api/assist/esphome{suffix}"
    )


def find_provision_actions(services: Any) -> list[str]:
    """Return ESPHome action names implementing the provisioning contract."""

    if not isinstance(services, list):
        return []

    actions: list[str] = []
    for domain in services:
        if not isinstance(domain, dict) or domain.get("domain") != "esphome":
            continue
        domain_services = domain.get("services")
        if not isinstance(domain_services, dict):
            continue
        for name, description in domain_services.items():
            if not isinstance(name, str):
                continue
            if name != "provision_pipecat" and not name.endswith(
                PROVISION_ACTION_SUFFIX
            ):
                continue
            fields = description.get("fields", {}) if isinstance(description, dict) else {}
            if fields and "endpoint" not in fields:
                continue
            actions.append(name)
    return sorted(set(actions))


class ESPHomeProvisioner:
    """Discover and provision ESPHome satellites through Home Assistant Core."""

    def __init__(
        self,
        config_provider: Callable[[], Any],
        *,
        supervisor_url: str,
        supervisor_token: str,
        interval_seconds: float = 15.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._config_provider = config_provider
        self._core_api_url = f"{supervisor_url.rstrip('/')}{CORE_API_PATH}"
        self._token = supervisor_token
        self._interval_seconds = interval_seconds
        self._transport = transport
        self._wake = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._status: dict[str, Any] = {
            "enabled": bool(supervisor_token),
            "service_count": 0,
            "provisioned_count": 0,
            "last_success_at": None,
            "last_scan_at": None,
            "last_error": (
                None
                if supervisor_token
                else "Supervisor token is unavailable; use the manual endpoint fallback."
            ),
        }
        self._last_log_state: tuple[int, int, str | None] | None = None

    def status(self) -> dict[str, Any]:
        return dict(self._status)

    def request_scan(self) -> None:
        self._wake.set()

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._wake.set()
        self._task = asyncio.create_task(
            self._run(), name="esphome-pipecat-provisioner"
        )

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _run(self) -> None:
        while True:
            await self._wake.wait()
            self._wake.clear()
            await self.provision_once()
            try:
                await asyncio.wait_for(
                    self._wake.wait(), timeout=self._interval_seconds
                )
            except TimeoutError:
                self._wake.set()

    async def provision_once(self) -> dict[str, Any]:
        if not self._token:
            return self.status()

        headers = {"Authorization": f"Bearer {self._token}"}
        self._status["last_scan_at"] = int(time.time())
        try:
            async with httpx.AsyncClient(
                base_url=self._core_api_url,
                headers=headers,
                timeout=10.0,
                transport=self._transport,
            ) as client:
                services_response = await client.get("/services")
                services_response.raise_for_status()
                actions = find_provision_actions(services_response.json())

                ha_config: dict[str, Any] = {}
                config = self._config_provider()
                if not _host_from_value(getattr(config, "runner_host", "")):
                    config_response = await client.get("/config")
                    config_response.raise_for_status()
                    payload = config_response.json()
                    if isinstance(payload, dict):
                        ha_config = payload

                endpoint = build_esphome_endpoint(config, ha_config)
                provisioned = 0
                for action in actions:
                    response = await client.post(
                        f"/services/esphome/{action}",
                        json={"endpoint": endpoint},
                    )
                    response.raise_for_status()
                    provisioned += 1

            self._status.update(
                {
                    "service_count": len(actions),
                    "provisioned_count": provisioned,
                    "last_success_at": (
                        int(time.time()) if provisioned else self._status["last_success_at"]
                    ),
                    "last_error": None,
                }
            )
        except httpx.HTTPStatusError as err:
            self._status.update(
                {
                    "provisioned_count": 0,
                    "last_error": (
                        "Home Assistant Core API returned "
                        f"HTTP {err.response.status_code} during ESPHome provisioning."
                    ),
                }
            )
        except (httpx.HTTPError, ValueError, TypeError) as err:
            self._status.update(
                {
                    "provisioned_count": 0,
                    "last_error": (
                        "ESPHome provisioning failed: "
                        f"{err.__class__.__name__}"
                    ),
                }
            )

        log_state = (
            int(self._status["service_count"]),
            int(self._status["provisioned_count"]),
            self._status["last_error"],
        )
        if log_state != self._last_log_state:
            if self._status["last_error"]:
                logger.warning("ESPHome provisioning: {}", self._status["last_error"])
            elif self._status["service_count"]:
                logger.info(
                    "Provisioned {} ESPHome Pipecat satellite(s)",
                    self._status["provisioned_count"],
                )
            else:
                logger.info("ESPHome provisioning is waiting for a compatible satellite")
            self._last_log_state = log_state

        return self.status()
