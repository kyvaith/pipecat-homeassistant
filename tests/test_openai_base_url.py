"""OpenAI integrations can point at a self-hosted OpenAI-compatible server."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ADDON_ROOT = Path(__file__).resolve().parents[1] / "addons" / "pipecat_assist"
sys.path.insert(0, str(ADDON_ROOT))

from app.config import IntegrationConfig  # noqa: E402
from app.main import (  # noqa: E402
    LOCAL_API_KEY_PLACEHOLDER,
    OPENAI_REALTIME_URL,
    _openai_api_key,
    _openai_base_url,
    _openai_realtime_url,
)


def _openai(kind: str = "openai", **fields) -> IntegrationConfig:
    return IntegrationConfig(id=f"{kind}-test", name="OpenAI", kind=kind, **fields)


class OpenAIBaseUrlTests(unittest.TestCase):
    def test_blank_base_url_keeps_openai(self):
        integration = _openai(api_key="sk-test")
        self.assertEqual(_openai_base_url(integration), "")
        self.assertEqual(_openai_realtime_url(integration), OPENAI_REALTIME_URL)
        self.assertEqual(_openai_api_key(integration, "STT"), "sk-test")

    def test_http_base_url_maps_to_ws_realtime(self):
        integration = _openai(base_url="http://gpu-box:8000/v1/")
        self.assertEqual(_openai_base_url(integration), "http://gpu-box:8000/v1")
        self.assertEqual(_openai_realtime_url(integration), "ws://gpu-box:8000/v1/realtime")

    def test_https_base_url_maps_to_wss_realtime(self):
        integration = _openai(kind="openai_cloud", base_url="https://voice.example/v1")
        self.assertEqual(_openai_realtime_url(integration), "wss://voice.example/v1/realtime")

    def test_explicit_realtime_url_is_kept(self):
        integration = _openai(base_url="ws://gpu-box:8000/v1/realtime")
        self.assertEqual(_openai_realtime_url(integration), "ws://gpu-box:8000/v1/realtime")

    def test_custom_base_url_needs_no_key_and_never_gets_the_global_key(self):
        integration = _openai(base_url="http://gpu-box:8000/v1")
        self.assertEqual(
            _openai_api_key(integration, "TTS", fallback="sk-global"),
            LOCAL_API_KEY_PLACEHOLDER,
        )
        integration.api_key = "local-key"
        self.assertEqual(_openai_api_key(integration, "TTS", fallback="sk-global"), "local-key")

    def test_missing_key_without_base_url_still_fails(self):
        with self.assertRaises(RuntimeError):
            _openai_api_key(_openai(), "STT")

    def test_other_kinds_ignore_base_url(self):
        integration = IntegrationConfig(
            id="ollama-test",
            name="Ollama",
            kind="ollama",
            base_url="http://localhost:11434/v1",
        )
        self.assertEqual(_openai_base_url(integration), "")


if __name__ == "__main__":
    unittest.main()
