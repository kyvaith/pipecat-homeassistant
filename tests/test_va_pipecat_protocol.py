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
            self.rtvi("bot-output", {"text": "Dzie\u0144 dobry."})
        )
        duplicate = self.protocol.on_rtvi_message(
            self.rtvi("bot-tts-text", {"text": "Dzie\u0144 dobry."})
        )

        self.assertIsNotNone(first)
        self.assertIsNone(duplicate)
        self.assertEqual(self.protocol.assistant_segments, ["Dzie\u0144 dobry."])

    def test_higher_priority_observer_replaces_instead_of_appending(self):
        self.assertIsNotNone(
            self.protocol.on_rtvi_message(
                self.rtvi(
                    "bot-tts-text",
                    {"text": "Dzie\u0144 dobry, w czym mog\u0119 pom\u00f3c?"},
                )
            )
        )

        replacement = self.protocol.on_rtvi_message(
            self.rtvi(
                "bot-output",
                {"text": "Dzie\u0144 dobry. W czym mog\u0119 pom\u00f3c?"},
            )
        )

        self.assertIsNotNone(replacement)
        wire = json.loads(replacement)
        decoded = base64.b64decode(wire["text_b64"]).decode("utf-8")
        self.assertEqual(decoded, "Dzie\u0144 dobry. W czym mog\u0119 pom\u00f3c?")
        self.assertNotIn("pom\u00f3c? Dzie\u0144", decoded)

    def test_punctuation_rewrite_extends_same_assistant_phrase(self):
        first = self.protocol.on_rtvi_message(
            self.rtvi("bot-output", {"text": "Cze\u015b\u0107!"})
        )
        extended = self.protocol.on_rtvi_message(
            self.rtvi("bot-output", {"text": "Cze\u015b\u0107, jak mog\u0119 pom\u00f3c?"})
        )

        self.assertIsNotNone(first)
        self.assertIsNotNone(extended)
        decoded = base64.b64decode(json.loads(extended)["text_b64"]).decode("utf-8")
        self.assertEqual(decoded, "Cze\u015b\u0107, jak mog\u0119 pom\u00f3c?")
        self.assertNotIn("Cze\u015b\u0107! Cze\u015b\u0107", decoded)

    def test_punctuation_only_final_change_is_not_emitted_twice(self):
        self.assertIsNotNone(
            self.protocol.on_rtvi_message(
                self.rtvi("bot-output", {"text": "Dzi\u0119kuj\u0119."})
            )
        )
        self.assertIsNone(
            self.protocol.on_rtvi_message(
                self.rtvi("bot-output", {"text": "Dzi\u0119kuj\u0119!"})
            )
        )
        stopped = json.loads(
            self.protocol.on_rtvi_message(self.rtvi("bot-stopped-speaking"))
        )
        self.assertEqual(stopped["type"], "phase")
        self.assertEqual(stopped["phase"], "listening")

    def test_lower_priority_late_fragment_cannot_duplicate_selected_reply(self):
        first = self.protocol.on_rtvi_message(
            self.rtvi("bot-output", {"text": "To jest pe\u0142na odpowied\u017a."})
        )
        late = self.protocol.on_rtvi_message(
            self.rtvi("bot-tts-text", {"text": "To jest pe\u0142na"})
        )

        self.assertIsNotNone(first)
        self.assertIsNone(late)
        self.assertEqual(self.protocol.assistant_text, "To jest pe\u0142na odpowied\u017a.")

    def test_priority_upgrade_waits_for_cumulative_source_to_catch_up(self):
        self.assertIsNotNone(
            self.protocol.on_rtvi_message(
                self.rtvi("bot-tts-text", {"text": "To jest d\u0142uga odpowied\u017a testowa."})
            )
        )
        self.assertIsNone(
            self.protocol.on_rtvi_message(self.rtvi("bot-output", {"text": "To"}))
        )
        self.assertEqual(self.protocol.assistant_text, "To jest d\u0142uga odpowied\u017a testowa.")

        replacement = self.protocol.on_rtvi_message(
            self.rtvi(
                "bot-output",
                {"text": "To jest d\u0142uga odpowied\u017a testowa, poprawiona."},
            )
        )
        self.assertIsNotNone(replacement)
        self.assertEqual(
            self.protocol.assistant_text,
            "To jest d\u0142uga odpowied\u017a testowa, poprawiona.",
        )

    def test_assistant_word_stream_is_emitted_as_a_cumulative_phrase(self):
        words = ["To", "jest", "odpowied\u017a", "wysy\u0142ana", "pe\u0142nymi", "frazami"]
        for word in words[:-1]:
            self.assertIsNone(
                self.protocol.on_rtvi_message(self.rtvi("bot-output", {"text": word}))
            )

        message = json.loads(
            self.protocol.on_rtvi_message(
                self.rtvi("bot-output", {"text": words[-1]})
            )
        )
        decoded = base64.b64decode(message["text_b64"]).decode("utf-8")
        self.assertEqual(decoded, " ".join(words))
        self.assertFalse(message["final"])

    def test_short_final_assistant_phrase_shares_message_with_follow_up(self):
        self.protocol.client_action('{"type":"wake"}')
        self.assertIsNone(
            self.protocol.on_rtvi_message(
                self.rtvi("bot-output", {"text": "Jasne, pomog\u0119"})
            )
        )

        message = json.loads(
            self.protocol.on_rtvi_message(self.rtvi("bot-stopped-speaking"))
        )
        decoded = base64.b64decode(message["text_b64"]).decode("utf-8")
        self.assertEqual(decoded, "Jasne, pomog\u0119")
        self.assertTrue(message["final"])
        self.assertEqual(message["phase"], "listening")
        self.assertTrue(message["follow_up"])

    def test_user_partial_transcripts_are_coalesced_until_a_phrase_boundary(self):
        self.assertIsNone(
            self.protocol.on_rtvi_message(
                self.rtvi(
                    "user-transcription",
                    {"text": "Jak b\u0119dzie", "final": False},
                )
            )
        )
        partial = json.loads(
            self.protocol.on_rtvi_message(
                self.rtvi(
                    "user-transcription",
                    {"text": "Jak b\u0119dzie dzi\u015b wieczorem", "final": False},
                )
            )
        )
        decoded = base64.b64decode(partial["text_b64"]).decode("utf-8")
        self.assertEqual(decoded, "Jak b\u0119dzie dzi\u015b wieczorem")

        final = json.loads(
            self.protocol.on_rtvi_message(
                self.rtvi(
                    "user-transcription",
                    {"text": "Jak b\u0119dzie dzi\u015b wieczorem?", "final": True},
                )
            )
        )
        decoded = base64.b64decode(final["text_b64"]).decode("utf-8")
        self.assertEqual(decoded, "Jak b\u0119dzie dzi\u015b wieczorem?")
        self.assertTrue(final["final"])

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
