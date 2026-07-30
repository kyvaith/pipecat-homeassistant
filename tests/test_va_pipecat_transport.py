"""Runtime contract tests using Pipecat's real frame classes."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ADDON_ROOT = Path(__file__).resolve().parents[1] / "addons" / "pipecat_assist"
sys.path.insert(0, str(ADDON_ROOT))

from app.va_pipecat import (  # noqa: E402
    CHANNELS,
    INPUT_SAMPLE_RATE,
    OUTPUT_PACKET_BYTES,
    OUTPUT_SAMPLE_RATE,
    VaPipecatFrameSerializer,
    websocket_transport_params,
)
from pipecat.frames.frames import (  # noqa: E402
    InputAudioRawFrame,
    InterruptionWorkerFrame,
    OutputAudioRawFrame,
    OutputTransportMessageUrgentFrame,
)


def _never_terminal(*_texts: str) -> bool:
    return False


class VaPipecatTransportTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.serializer = VaPipecatFrameSerializer(_never_terminal)

    async def test_binary_input_becomes_pcm16_input_frame(self):
        audio = bytes(range(64))
        frame = await self.serializer.deserialize(audio)
        self.assertIsInstance(frame, InputAudioRawFrame)
        self.assertEqual(frame.audio, audio)
        self.assertEqual(frame.sample_rate, INPUT_SAMPLE_RATE)
        self.assertEqual(frame.num_channels, CHANNELS)

    async def test_odd_length_pcm_input_is_rejected(self):
        self.assertIsNone(await self.serializer.deserialize(b"\x00"))

    async def test_output_audio_is_sent_without_reencoding(self):
        audio = bytes(range(128))
        frame = OutputAudioRawFrame(
            audio=audio,
            sample_rate=OUTPUT_SAMPLE_RATE,
            num_channels=CHANNELS,
        )
        self.assertEqual(await self.serializer.serialize(frame), audio)

    async def test_rtvi_phase_is_translated_to_compact_json(self):
        frame = OutputTransportMessageUrgentFrame(
            message={"label": "rtvi-ai", "type": "bot-started-speaking", "data": {}}
        )
        wire = await self.serializer.serialize(frame)
        self.assertEqual(json.loads(wire)["phase"], "speaking")

    async def test_device_interrupt_becomes_pipeline_interruption(self):
        frame = await self.serializer.deserialize('{"type":"interrupt"}')
        self.assertIsInstance(frame, InterruptionWorkerFrame)

    def test_websocket_parameters_match_the_device_contract(self):
        params = websocket_transport_params(
            _never_terminal,
            follow_up_ms=12000,
            follow_up_open_delay_ms=150,
            wake_open_delay_ms=50,
            playback_prebuffer_ms=180,
        )
        self.assertEqual(params.audio_in_sample_rate, INPUT_SAMPLE_RATE)
        self.assertEqual(params.audio_out_sample_rate, OUTPUT_SAMPLE_RATE)
        self.assertEqual(params.audio_in_channels, CHANNELS)
        self.assertEqual(params.audio_out_channels, CHANNELS)
        self.assertEqual(params.fixed_audio_packet_size, OUTPUT_PACKET_BYTES)
        hello = json.loads(params.serializer.protocol.hello())
        self.assertEqual(hello["follow_up_ms"], 12000)
        self.assertEqual(hello["follow_up_open_delay_ms"], 150)
        self.assertEqual(hello["wake_open_delay_ms"], 50)
        self.assertEqual(hello["playback_prebuffer_ms"], 180)


if __name__ == "__main__":
    unittest.main()
