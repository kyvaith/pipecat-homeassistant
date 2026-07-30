"""Tests for automatic ESPHome endpoint provisioning."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import httpx

ADDON_ROOT = Path(__file__).resolve().parents[1] / "addons" / "pipecat_assist"
if ADDON_ROOT.is_dir():
    sys.path.insert(0, str(ADDON_ROOT))

from app.esphome_provisioner import (  # noqa: E402
    ESPHomeProvisioner,
    build_esphome_endpoint,
    find_provision_actions,
)


def _config(**overrides):
    values = {
        "runner_host": "",
        "runner_port": 7860,
        "satellite_shared_secret": "device-secret",
        "selected_flow_id": "default",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class ESPHomeProvisionerUnitTests(unittest.TestCase):
    def test_endpoint_uses_home_assistant_internal_host(self):
        endpoint = build_esphome_endpoint(
            _config(),
            {"internal_url": "http://homeassistant.local:8123"},
        )
        self.assertEqual(
            endpoint,
            "ws://homeassistant.local:7860/api/assist/esphome"
            "?token=device-secret&flow_id=default",
        )

    def test_explicit_runner_host_wins_and_ipv6_is_bracketed(self):
        endpoint = build_esphome_endpoint(
            _config(runner_host="https://[fd00::1234]:8123"),
            {"internal_url": "http://ignored.local:8123"},
        )
        self.assertTrue(endpoint.startswith("ws://[fd00::1234]:7860/"))

    def test_only_compatible_esphome_actions_are_selected(self):
        services = [
            {
                "domain": "esphome",
                "services": {
                    "echo_hub_provision_pipecat": {
                        "fields": {"endpoint": {"required": True}}
                    },
                    "echo_hub_other": {"fields": {}},
                    "broken_provision_pipecat": {"fields": {"url": {}}},
                },
            },
            {
                "domain": "script",
                "services": {
                    "provision_pipecat": {"fields": {"endpoint": {}}},
                },
            },
        ]
        self.assertEqual(
            find_provision_actions(services),
            ["echo_hub_provision_pipecat"],
        )


class ESPHomeProvisionerRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_provisions_all_discovered_devices_without_exposing_secret(self):
        posts: list[tuple[str, dict]] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/core/api/services":
                return httpx.Response(
                    200,
                    json=[
                        {
                            "domain": "esphome",
                            "services": {
                                "hub_provision_pipecat": {
                                    "fields": {"endpoint": {"required": True}}
                                },
                                "bedroom_provision_pipecat": {
                                    "fields": {"endpoint": {"required": True}}
                                },
                            },
                        }
                    ],
                )
            if request.url.path == "/core/api/config":
                return httpx.Response(
                    200, json={"internal_url": "http://192.168.1.20:8123"}
                )
            if request.method == "POST":
                posts.append(
                    (request.url.path, json.loads(request.content.decode("utf-8")))
                )
                return httpx.Response(200, json=[])
            return httpx.Response(404)

        provisioner = ESPHomeProvisioner(
            _config,
            supervisor_url="http://supervisor",
            supervisor_token="supervisor-secret",
            transport=httpx.MockTransport(handler),
        )
        status = await provisioner.provision_once()

        self.assertEqual(status["service_count"], 2)
        self.assertEqual(status["provisioned_count"], 2)
        self.assertIsNone(status["last_error"])
        self.assertEqual(
            {path for path, _payload in posts},
            {
                "/core/api/services/esphome/hub_provision_pipecat",
                "/core/api/services/esphome/bedroom_provision_pipecat",
            },
        )
        for _path, payload in posts:
            self.assertEqual(
                payload["endpoint"],
                "ws://192.168.1.20:7860/api/assist/esphome"
                "?token=device-secret&flow_id=default",
            )
        self.assertNotIn("device-secret", repr(status))
        self.assertNotIn("supervisor-secret", repr(status))

    async def test_waits_cleanly_when_no_satellite_is_registered(self):
        async def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/core/api/services":
                return httpx.Response(200, json=[])
            if request.url.path == "/core/api/config":
                return httpx.Response(
                    200, json={"internal_url": "http://homeassistant.local:8123"}
                )
            return httpx.Response(404)

        provisioner = ESPHomeProvisioner(
            _config,
            supervisor_url="http://supervisor",
            supervisor_token="supervisor-secret",
            transport=httpx.MockTransport(handler),
        )
        status = await provisioner.provision_once()
        self.assertEqual(status["service_count"], 0)
        self.assertEqual(status["provisioned_count"], 0)
        self.assertIsNone(status["last_error"])
