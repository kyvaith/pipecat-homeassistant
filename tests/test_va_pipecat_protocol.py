"""Contract tests for the ESPHome satellite wire protocol."""

from __future__ import annotations

import base64
import json
import sys
import unittest
from pathlib import Path

ADDON_ROOT = Path(__file__).resolve().parents[1] / "addons" / "pipecat_assist"
if ADDON_ROOT.is_dir():
    sys.path.insert(0, str(ADDON_ROOT))

from app.va_pipecat_protocol import (  # noqa: E402
    PROTOCOL_NAME,
    PROTOCOL_VERSION,
    VaPipecatProtocol,
)


def _never_terminal(*_texts: str) -> bool:
    return False


class VaPipecatProtocolTests(unittest.TestCase):
    def setUp(self):
        self.protocol = VaPipecatProtocol(_never_terminal)

    def rtvi(self, message_type: str, data: dict | None = None) -> dict:
        message = {"label": "rtvi-ai", "type": message_type}
        if data is not None:
            message["data"] = data
        return message

    def test_hello_describes_the_pcm_contract(self):
        hello = json.loads(self.protocol.hello())
        self.assertEqual(hello["protocol"], PROTOCOL_NAME)
        self.assertEqual(hello["version"], PROTOCOL_VERSION)
        self.assertEqual(hello["audio"]["input_sample_rate"], 16000)
        self.assertEqual(hello["audio"]["output_sample_rate"], 24000)
        self.assertEqual(hello["follow_up_ms"], 30000)
        self.assertEqual(hello["playback_prebuffer_ms"], 300)

    def test_wake_starts_a_new_listening_turn(self):
        self.assertEqual(self.protocol.client_action('{"type":"wake"}'), "wake")
        self.assertTrue(self.protocol.active)
        self.assertEqual(self.protocol.turn_id, 1)
        self.assertEqual(self.protocol.current_phase, "listening")

    def test_pipeline_events_drive_deterministic_phases(self):
        self.protocol.client_action('{"type":"wake"}')
        thinking = json.loads(
            self.protocol.on_rtvi_message(self.rtvi("user-stopped-speaking"))
        )
        speaking = json.loads(
            self.protocol.on_rtvi_message(self.rtvi("bot-started-speaking"))
        )
        follow_up = json.loads(
            self.protocol.on_rtvi_message(self.rtvi("bot-stopped-speaking"))
        )
        self.assertEqual(thinking["phase"], "thinking")
        self.assertEqual(speaking["phase"], "speaking")
        self.assertEqual(follow_up["phase"], "listening")
        self.assertTrue(follow_up["follow_up"])

    def test_transcripts_are_utf8_safe(self):
        polish_text = "Za\u017c\u00f3\u0142\u0107 g\u0119\u015bl\u0105"
        wire = json.loads(
            self.protocol.on_rtvi_message(
                self.rtvi(
                    "user-transcription",
                    {"text": polish_text, "final": True},
                )
            )
        )
        decoded = base64.b64decode(wire["text_b64"]).decode("utf-8")
        self.assertEqual(decoded, polish_text)
        self.assertEqual(wire["role"], "user")
        self.assertTrue(wire["final"])

    def test_duplicate_assistant_text_from_rtvi_observers_is_suppressed(self):
        first = self.protocol.on_rtvi_message(
            self.rtvi("bot-output", {"text": "Dzie\u0144 dobry"})
        )
        duplicate = self.protocol.on_rtvi_message(
            self.rtvi("bot-tts-text", {"text": "Dzie\u0144 dobry"})
        )

        self.assertIsNotNone(first)
        self.assertIsNone(duplicate)
        self.assertEqual(self.protocol.assistant_segments, ["Dzie\u0144 dobry"])

    def test_terminal_reply_enters_thanks_instead_of_follow_up(self):
        protocol = VaPipecatProtocol(lambda *_texts: True)
        protocol.client_action('{"type":"wake"}')
        protocol.on_rtvi_message(
            self.rtvi(
                "user-transcription",
                {"text": "Dzi\u0119kuj\u0119, koniec", "final": True},
            )
        )
        protocol.on_rtvi_message(
            self.rtvi("bot-output", {"text": "Do us\u0142yszenia."})
        )
        terminal = json.loads(
            protocol.on_rtvi_message(self.rtvi("bot-stopped-speaking"))
        )
        self.assertEqual(terminal["phase"], "thanks")
        self.assertTrue(terminal["terminal"])
        self.assertFalse(protocol.active)

    def test_stop_converts_pipeline_interrupt_to_terminal_idle(self):
        self.protocol.client_action('{"type":"wake"}')
        self.assertEqual(self.protocol.client_action('{"type":"stop"}'), "stop")
        message = json.loads(
            self.protocol.on_rtvi_message(self.rtvi("bot-interrupted"))
        )
        self.assertEqual(message["type"], "interrupt")
        self.assertEqual(message["reason"], "stopped")
        self.assertEqual(self.protocol.current_phase, "idle")

    def test_barge_in_interrupt_reopens_listening(self):
        self.protocol.client_action('{"type":"wake"}')
        self.protocol.on_rtvi_message(self.rtvi("bot-started-speaking"))
        message = json.loads(
            self.protocol.on_rtvi_message(self.rtvi("bot-interrupted"))
        )
        self.assertEqual(message["type"], "interrupt")
        self.assertEqual(message["reason"], "barge_in")
        self.assertEqual(self.protocol.current_phase, "listening")

    def test_tool_call_keeps_thinking_until_the_tool_finishes(self):
        self.protocol.client_action('{"type":"wake"}')
        self.protocol.on_rtvi_message(self.rtvi("user-stopped-speaking"))
        self.protocol.on_rtvi_message(
            self.rtvi(
                "llm-function-call-in-progress",
                {"tool_call_id": "ha-1"},
            )
        )

        self.assertIsNone(
            self.protocol.on_rtvi_message(self.rtvi("bot-stopped-speaking"))
        )
        self.assertEqual(self.protocol.current_phase, "thinking")

        self.protocol.on_rtvi_message(
            self.rtvi(
                "llm-function-call-stopped",
                {"tool_call_id": "ha-1", "cancelled": False},
            )
        )
        follow_up = json.loads(
            self.protocol.on_rtvi_message(self.rtvi("bot-stopped-speaking"))
        )
        self.assertEqual(follow_up["phase"], "listening")
        self.assertTrue(follow_up["follow_up"])

    def test_hello_uses_runtime_timing_settings(self):
        protocol = VaPipecatProtocol(
            _never_terminal,
            follow_up_ms=12000,
            follow_up_open_delay_ms=150,
            wake_open_delay_ms=50,
            playback_prebuffer_ms=180,
        )
        hello = json.loads(protocol.hello())
        self.assertEqual(hello["follow_up_ms"], 12000)
        self.assertEqual(hello["follow_up_open_delay_ms"], 150)
        self.assertEqual(hello["wake_open_delay_ms"], 50)
        self.assertEqual(hello["playback_prebuffer_ms"], 180)


if __name__ == "__main__":
    unittest.main()
