"""GPT-Live service that opens its WebSocket on the first mic audio and closes it when idle."""

from __future__ import annotations

import asyncio

from loguru import logger
from pipecat.services.openai.live import events

from app.openai_live_ha import HAOpenAILiveLLMService

IDLE_CLOSE_SECS = 15.0
MAX_BUFFER_FRAMES = 1000  # ~10 s of 10-20 ms frames; older audio is dropped first
TURN_GAP_SECS = 2.0  # mic silence after which the next audio counts as a new turn


class LazyOpenAILiveLLMService(HAOpenAILiveLLMService):
    """Connect on demand; also logs per-turn latency in both modes for A/B tests."""

    def __init__(self, *, lazy: bool = True, **kwargs):
        super().__init__(**kwargs)
        self._lazy = lazy
        self._live_wanted = not lazy
        self._audio_buffer: list = []
        self._idle_task: asyncio.Task | None = None
        self._lifecycle_lock = asyncio.Lock()
        self._opened_at = 0.0
        self._last_input_at = 0.0
        self._turn_started_at = 0.0
        self._last_user_text_at = 0.0
        self._turn_answered = True

    def _now(self) -> float:
        return asyncio.get_running_loop().time()

    async def _connect(self):
        if self._live_wanted:
            await super()._connect()
        else:
            await self._attach_backend()

    async def _open_live(self):
        self._live_wanted = True
        self._opened_at = self._now()
        logger.info("GPT-Live lazy: opening connection on mic audio")
        await super()._connect()
        if self._context is not None:
            self._needs_session_config = True
            await self._send_session_config()
        self._idle_task = self.create_task(self._idle_watch(), f"{self}::lazy_idle")

    async def _close_live(self):
        async with self._lifecycle_lock:
            logger.info("GPT-Live lazy: closing idle connection")
            self._live_wanted = False
            self._audio_buffer.clear()
            await self._close_open_turns()
            await self._close_session()
            await self._disconnect()
            self._needs_session_config = True

    async def _idle_watch(self):
        try:
            while True:
                await asyncio.sleep(1.0)
                last = max(self._last_input_at, self.assist_activity_at)
                if self._now() - last >= IDLE_CLOSE_SECS and not self.assist_delegating:
                    break
        finally:
            self._idle_task = None
        await self._close_live()

    async def _send_user_audio(self, frame):
        now = self._now()
        if now - self._last_input_at > TURN_GAP_SECS:
            self._turn_started_at, self._turn_answered = now, False
        self._last_input_at = now
        if not self._live_wanted:
            async with self._lifecycle_lock:  # waits for a close in progress
                if not self._live_wanted:
                    await self._open_live()
        if self._lazy and (self._audio_buffer or not self._session_started):
            self._audio_buffer.append(frame)
            del self._audio_buffer[:-MAX_BUFFER_FRAMES]
            return
        await super()._send_user_audio(frame)

    async def _handle_evt_session_started(self, evt):
        await super()._handle_evt_session_started(evt)
        if self._lazy and self._opened_at:
            logger.info(
                "GPT-Live latency: session ready {:.0f} ms after wake, flushing {} buffered frames",
                (self._now() - self._opened_at) * 1000, len(self._audio_buffer),
            )
        while self._audio_buffer:
            await super()._send_user_audio(self._audio_buffer.pop(0))

    async def _handle_server_event(self, evt):
        if isinstance(evt, events.TranscriptDeltaEvent) and evt.role == "user" and evt.delta:
            self._last_user_text_at = self._now()
        elif isinstance(evt, events.OutputAudioDeltaEvent) and not self._turn_answered:
            self._turn_answered = True
            now = self._now()
            logger.info(
                "GPT-Live latency ({}): mic->first audio {:.0f} ms, last user transcript->first audio {:.0f} ms",
                "lazy" if self._lazy else "eager",
                (now - self._turn_started_at) * 1000,
                (now - self._last_user_text_at) * 1000 if self._last_user_text_at > self._turn_started_at else -1,
            )
        await super()._handle_server_event(evt)

    async def cleanup(self):
        if self._idle_task:
            await self.cancel_task(self._idle_task)
        await super().cleanup()
