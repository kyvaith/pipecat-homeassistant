"""Exercise the integration wizard against a simulated Supervisor HTTP API."""

import asyncio
import importlib
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import aiohttp
from aiohttp import web
from aiohttp.test_utils import TestServer

COMPONENT = Path(__file__).resolve().parents[1] / "custom_components/pipecat_assist"
PACKAGE = "_pipecat_app_setup_test"

if (
    importlib.util.find_spec("voluptuous") is None
    and importlib.util.find_spec("probatio") is None
):
    raise unittest.SkipTest("Wizard tests require a Home Assistant schema library")


class ConfigFlowStub:
    def __init_subclass__(cls, *, domain):
        super().__init_subclass__()


def load_flow():
    """Import the wizard without importing the rest of Home Assistant."""
    package = ModuleType(PACKAGE)
    package.__path__ = [str(COMPONENT)]
    homeassistant = ModuleType("homeassistant")
    homeassistant.config_entries = SimpleNamespace(ConfigFlow=ConfigFlowStub)
    data_entry_flow = ModuleType("homeassistant.data_entry_flow")
    if importlib.util.find_spec("probatio") is not None:
        data_entry_flow.probatio = importlib.import_module("probatio")
    with patch.dict(
        sys.modules,
        {
            PACKAGE: package,
            "homeassistant": homeassistant,
            "homeassistant.core": SimpleNamespace(HomeAssistant=object),
            "homeassistant.data_entry_flow": data_entry_flow,
            "homeassistant.helpers.aiohttp_client": SimpleNamespace(
                async_get_clientsession=lambda hass: hass.session
            ),
        },
    ):
        return importlib.import_module(f"{PACKAGE}.config_flow")


flow_module = load_flow()
REPOSITORY = flow_module.APP_REPOSITORY
REPOSITORY_SLUG = "b2705758"
APP_SLUG = f"{REPOSITORY_SLUG}_pipecat_assist"


class AppSetupTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.state = None
        self.slug = APP_SLUG
        self.repo_added = False
        self.installed_list_status = 200
        self.availability_status = 200
        self.server_ready = True
        self.posts = []
        app = web.Application()
        app.router.add_route("*", "/{path:.*}", self._handle)
        self.server = TestServer(app)
        await self.server.start_server()
        self.addAsyncCleanup(self.server.close)
        self.session = aiohttp.ClientSession()
        self.addAsyncCleanup(self.session.close)
        self.url = str(self.server.make_url("/")).rstrip("/")
        self.enterContext(patch.dict(os.environ, {"SUPERVISOR_TOKEN": "test-token"}))
        self.enterContext(patch.object(flow_module, "SUPERVISOR_URL", self.url))
        self.hass = SimpleNamespace(
            data={}, session=self.session, async_create_task=asyncio.create_task
        )
        self.flow = self._new_flow()

    def _new_flow(self):
        flow = flow_module.PipecatAssistConfigFlow()
        flow.hass = self.hass
        for method in (
            "async_show_menu",
            "async_show_form",
            "async_show_progress",
            "async_show_progress_done",
            "async_create_entry",
        ):
            setattr(flow, method, Mock(side_effect=lambda **result: result))
        flow.async_set_unique_id = AsyncMock()
        flow._abort_if_unique_id_configured = Mock()
        return flow

    async def _handle(self, request):
        path = request.path
        if path == "/api/assist/status":
            if request.headers.get("Authorization"):
                return web.Response(status=403)
            if self.server_ready and (
                self.state == "started" or not os.getenv("SUPERVISOR_TOKEN")
            ):
                return web.json_response({"ok": True, "runner": {}})
            return web.Response(status=503)
        if request.headers.get("Authorization") != "Bearer test-token":
            return web.Response(status=401)

        data = None
        if request.method == "POST":
            self.posts.append(path)
        if path == "/addons":
            if self.installed_list_status != 200:
                return web.Response(status=self.installed_list_status)
            data = {
                "addons": []
                if self.state is None
                else [
                    {
                        "slug": self.slug,
                        "state": self.state,
                        "repository": REPOSITORY_SLUG,
                    }
                ]
            }
        elif path == f"/addons/{self.slug}/info" and self.state is not None:
            data = {
                "state": self.state,
                "hostname": "127.0.0.1",
                "options": {"runner_port": self.server.port},
            }
        elif path == "/store":
            # A different repository with the same app slug suffix must not be installed.
            data = {
                "repositories": [
                    {"slug": "elsewhere", "source": "https://example.com/fork"}
                ],
                "addons": [
                    {"slug": "elsewhere_pipecat_assist", "repository": "elsewhere"}
                ],
            }
            if self.repo_added:
                data["repositories"].append(
                    {"slug": REPOSITORY_SLUG, "source": REPOSITORY}
                )
                data["addons"].append(
                    {
                        "slug": APP_SLUG,
                        "repository": REPOSITORY_SLUG,
                        "installed": self.state is not None,
                    }
                )
        elif path == "/store/repositories" and request.method == "POST":
            if self.repo_added or await request.json() != {"repository": REPOSITORY}:
                return web.Response(status=400)
            self.repo_added = True
        elif path == f"/store/addons/{APP_SLUG}/availability" and self.repo_added:
            if self.availability_status != 200:
                return web.Response(status=self.availability_status)
        elif path == f"/store/addons/{APP_SLUG}/install" and self.repo_added:
            if self.state is not None:
                return web.Response(status=409)
            self.state = "stopped"
        elif path == f"/addons/{self.slug}/start" and self.state == "stopped":
            self.state = "started"
        else:
            return web.Response(status=404)
        return web.json_response({"result": "ok", "data": data})

    async def _finish_progress(self, flow, result):
        task = result["progress_task"]
        await asyncio.gather(task, return_exceptions=True)
        return await flow.async_step_setup_app()

    async def test_install_registers_repository_only_after_confirmation(self):
        result = await self.flow.async_step_user()
        self.assertEqual(result["menu_options"], ["install_app", "manual"])
        self.assertEqual(self.posts, [])
        result = await self.flow.async_step_install_app()
        self.assertEqual(result["progress_action"], "install_app")
        self.assertEqual(await self.flow.async_step_setup_app(), result)
        self.assertEqual(
            await self._finish_progress(self.flow, result),
            {"next_step_id": "app_ready"},
        )
        self.assertEqual(
            (await self.flow.async_step_app_ready())["data"], {"url": self.url}
        )
        self.assertEqual(
            self.posts,
            [
                "/store/repositories",
                f"/store/addons/{APP_SLUG}/install",
                f"/addons/{APP_SLUG}/start",
            ],
        )

    async def test_reuses_repo_and_concurrent_flows_do_not_install_twice(self):
        self.repo_added = True
        second = self._new_flow()
        results = await asyncio.gather(
            self.flow.async_step_install_app(), second.async_step_install_app()
        )
        for flow, result in zip((self.flow, second), results, strict=True):
            self.assertEqual(
                (await self._finish_progress(flow, result))["next_step_id"], "app_ready"
            )
        self.assertEqual(
            self.posts,
            [f"/store/addons/{APP_SLUG}/install", f"/addons/{APP_SLUG}/start"],
        )

    async def test_existing_legacy_app_is_detected_and_can_be_started(self):
        self.slug = f"{APP_SLUG}_legacy_amd64"
        self.state = "stopped"
        menu = await self.flow.async_step_user()
        self.assertEqual(menu["menu_options"], ["start_app", "manual"])
        self.assertEqual(self.posts, [])
        result = await self.flow.async_step_start_app()
        self.assertEqual(
            (await self._finish_progress(self.flow, result))["next_step_id"],
            "app_ready",
        )
        self.assertEqual(self.posts, [f"/addons/{self.slug}/start"])
        form = await self._new_flow().async_step_user()
        self.assertEqual(form["data_schema"]({}), {"url": self.url})

    async def test_supervisor_denied_is_not_an_install_offer(self):
        self.installed_list_status = 403
        self.assertEqual((await self.flow.async_step_user())["step_id"], "manual")
        self.assertEqual(self.posts, [])

    async def test_manual_server_without_supervisor(self):
        with patch.dict(os.environ, {"SUPERVISOR_TOKEN": ""}):
            self.assertEqual((await self.flow.async_step_user())["step_id"], "manual")
            result = await self.flow.async_step_manual({"url": f" {self.url}/ "})
        self.assertEqual(result["data"], {"url": self.url})
        self.assertEqual(self.posts, [])

    async def test_failed_availability_leaves_retry_and_manual_options(self):
        self.availability_status = 400
        result = await self.flow.async_step_install_app()
        with self.assertLogs(flow_module.__name__, level="WARNING") as logs:
            self.assertEqual(
                (await self._finish_progress(self.flow, result))["next_step_id"],
                "app_setup_failed",
            )
        self.assertIn("HTTP 400", logs.output[0])
        self.assertNotIn("test-token", logs.output[0])
        self.assertEqual(self.posts, ["/store/repositories"])
        menu = await self.flow.async_step_app_setup_failed()
        self.assertEqual(menu["menu_options"], ["setup_app", "manual"])
        self.availability_status = 200
        result = await self.flow.async_step_setup_app()
        self.assertEqual(
            (await self._finish_progress(self.flow, result))["next_step_id"],
            "app_ready",
        )
        self.assertEqual(self.posts.count("/store/repositories"), 1)

    async def test_does_not_finish_until_server_responds(self):
        self.state = "stopped"
        self.server_ready = False
        with patch.object(flow_module, "APP_READY_TIMEOUT", 0.1):
            result = await self.flow.async_step_start_app()
            with self.assertLogs(flow_module.__name__, level="WARNING"):
                self.assertEqual(
                    (await self._finish_progress(self.flow, result))["next_step_id"],
                    "app_setup_failed",
                )
        self.flow.async_create_entry.assert_not_called()

    def test_wizard_translation_keys_match(self):
        def keys(mapping):
            return {
                key: keys(value) if isinstance(value, dict) else None
                for key, value in mapping.items()
            }

        strings = json.loads((COMPONENT / "strings.json").read_text(encoding="utf-8"))
        en, pl = [
            json.loads(
                (COMPONENT / "translations" / f"{lang}.json").read_text(
                    encoding="utf-8"
                )
            )
            for lang in ("en", "pl")
        ]
        self.assertEqual(en, strings)
        self.assertEqual(keys(en), keys(pl))
