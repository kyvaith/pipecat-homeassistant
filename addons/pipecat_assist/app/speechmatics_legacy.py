"""Keep saved Speechmatics Realtime models on their original public API.

Pipecat 1.10+ targets Agent STT, which only accepts Linden. Enhanced, Standard,
and Melia remain separate Realtime products, not aliases for that model.
"""

import asyncio
from contextlib import suppress

from pipecat.frames.frames import (
    InterimTranscriptionFrame,
    TranscriptionFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.services.settings import STTSettings
from pipecat.services.stt_service import STTService
from pipecat.utils.time import time_now_iso8601
from speechmatics.rt import (
    AsyncClient,
    AudioEncoding,
    AudioError,
    AudioFormat,
    AuthenticationError,
    ConfigurationError,
    ServerMessageType,
    SessionError,
    TranscriptionConfig,
    TranscriptionError,
    TransportError,
)
from speechmatics.rt import ConnectionError as SpeechmaticsConnectionError
from speechmatics.rt import TimeoutError as SpeechmaticsTimeoutError

_SERVICE_ERRORS = (
    AudioError,
    AuthenticationError,
    ConfigurationError,
    SpeechmaticsConnectionError,
    SessionError,
    SpeechmaticsTimeoutError,
    TranscriptionError,
    TransportError,
    OSError,
)


class SpeechmaticsRealtimeSTTService(STTService):
    def __init__(self, *, api_key, model, language):
        super().__init__(
            settings=STTSettings(model=model, language=language), ttfs_p99_latency=0.5
        )
        self._api_key = api_key
        self._client = None
        self._events = asyncio.Queue()
        self._event_task = None

    async def start(self, frame):
        await super().start(frame)
        self._client = AsyncClient(
            api_key=self._api_key, url="wss://eu.rt.speechmatics.com/v2"
        )
        for event in (
            ServerMessageType.ADD_TRANSCRIPT,
            ServerMessageType.ADD_PARTIAL_TRANSCRIPT,
            ServerMessageType.ERROR,
        ):
            self._client.on(event, self._events.put_nowait)
        try:
            await self._client.start_session(
                audio_format=AudioFormat(
                    encoding=AudioEncoding.PCM_S16LE, sample_rate=self.sample_rate
                ),
                transcription_config=TranscriptionConfig(
                    model=self._settings.model,
                    language=self._settings.language,
                    enable_partials=True,
                    max_delay=0.7,
                    max_delay_mode="fixed",
                ),
            )
        except _SERVICE_ERRORS as error:
            await self._disconnect()
            await self.push_error(
                "Speechmatics Realtime rejected the session",
                exception=error,
                force_treat_as_permanent=True,
            )
            return
        self._event_task = self.create_task(self._receive_transcripts())

    async def _receive_transcripts(self):
        while True:
            message = await self._events.get()
            if message.get("message") == "Error":
                await self.push_error(
                    str(message.get("reason") or "Speechmatics Realtime failed"),
                    force_treat_as_permanent=True,
                )
                return
            text = str((message.get("metadata") or {}).get("transcript") or "").strip()
            if not text:
                continue
            frame_type = (
                TranscriptionFrame
                if message.get("message") == "AddTranscript"
                else InterimTranscriptionFrame
            )
            if frame_type is TranscriptionFrame and self._finalize_requested:
                self.confirm_finalize()
            await self.push_frame(
                frame_type(
                    text,
                    self._user_id,
                    time_now_iso8601(),
                    language=self._settings.language,
                )
            )

    async def run_stt(self, audio):
        if self._client:
            try:
                await self._client.send_audio(audio)
            except _SERVICE_ERRORS as error:
                await self.push_error(
                    "Speechmatics Realtime audio stream failed",
                    exception=error,
                    force_treat_as_permanent=True,
                )
        yield None

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, VADUserStoppedSpeakingFrame) and self._client:
            self.request_finalize()
            await self._client.force_end_of_utterance()

    async def _disconnect(self):
        client, self._client = self._client, None
        if client:
            with suppress(Exception):
                await client.close()
        task, self._event_task = self._event_task, None
        if task:
            await self.cancel_task(task)

    async def stop(self, frame):
        await self._disconnect()
        await super().stop(frame)

    async def cancel(self, frame):
        await self._disconnect()
        await super().cancel(frame)

    async def cleanup(self):
        await self._disconnect()
        await super().cleanup()
