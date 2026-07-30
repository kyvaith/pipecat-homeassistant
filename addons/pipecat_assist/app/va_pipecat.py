"""Pipecat transport adapter for the ESPHome ``va_pipecat`` component."""

from __future__ import annotations

from collections.abc import Callable

from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    Frame,
    InputAudioRawFrame,
    InterruptionFrame,
    InterruptionWorkerFrame,
    OutputAudioRawFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams

from app.va_pipecat_protocol import VaPipecatProtocol

INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 24000
CHANNELS = 1
OUTPUT_PACKET_BYTES = 1920  # 40 ms of mono PCM16 at 24 kHz


class VaPipecatFrameSerializer(FrameSerializer):
    """Serialize raw PCM and compact conversation events for ESPHome."""

    def __init__(
        self,
        should_end_conversation: Callable[..., bool],
        *,
        follow_up_ms: int = 30000,
        follow_up_open_delay_ms: int = 80,
        wake_open_delay_ms: int = 0,
        playback_prebuffer_ms: int = 300,
    ):
        super().__init__(
            params=FrameSerializer.InputParams(ignore_rtvi_messages=False),
            name="VaPipecatFrameSerializer",
        )
        self.protocol = VaPipecatProtocol(
            should_end_conversation=should_end_conversation,
            input_sample_rate=INPUT_SAMPLE_RATE,
            output_sample_rate=OUTPUT_SAMPLE_RATE,
            channels=CHANNELS,
            follow_up_ms=follow_up_ms,
            follow_up_open_delay_ms=follow_up_open_delay_ms,
            wake_open_delay_ms=wake_open_delay_ms,
            playback_prebuffer_ms=playback_prebuffer_ms,
        )

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, OutputAudioRawFrame):
            return frame.audio

        if isinstance(frame, InterruptionFrame):
            return self.protocol.interrupt_message("pipeline")

        if isinstance(frame, (EndFrame, CancelFrame)):
            return self.protocol.phase_message("idle", terminal=True)

        if isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
            return self.protocol.on_rtvi_message(frame.message)

        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, bytes):
            if not data or len(data) % 2:
                return None
            return InputAudioRawFrame(
                audio=data,
                sample_rate=INPUT_SAMPLE_RATE,
                num_channels=CHANNELS,
            )

        action = self.protocol.client_action(data)
        if action in {"interrupt", "stop"}:
            return InterruptionWorkerFrame()
        return None


def websocket_transport_params(
    should_end_conversation: Callable[..., bool],
    *,
    follow_up_ms: int = 30000,
    follow_up_open_delay_ms: int = 80,
    wake_open_delay_ms: int = 0,
    playback_prebuffer_ms: int = 300,
) -> FastAPIWebsocketParams:
    """Build the fixed PCM transport contract used by ESPHome satellites."""

    return FastAPIWebsocketParams(
        audio_in_enabled=True,
        audio_in_sample_rate=INPUT_SAMPLE_RATE,
        audio_in_channels=CHANNELS,
        audio_out_enabled=True,
        audio_out_sample_rate=OUTPUT_SAMPLE_RATE,
        audio_out_channels=CHANNELS,
        audio_out_10ms_chunks=4,
        audio_out_auto_silence=False,
        audio_out_end_silence_secs=0,
        serializer=VaPipecatFrameSerializer(
            should_end_conversation,
            follow_up_ms=follow_up_ms,
            follow_up_open_delay_ms=follow_up_open_delay_ms,
            wake_open_delay_ms=wake_open_delay_ms,
            playback_prebuffer_ms=playback_prebuffer_ms,
        ),
        fixed_audio_packet_size=OUTPUT_PACKET_BYTES,
        allowed_origins=[],
    )
