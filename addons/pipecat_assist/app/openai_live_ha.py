"""Adapt one GPT-Live audio session to a turn-based HA Assist request."""

from __future__ import annotations

import asyncio
import audioop
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass

from pipecat.frames.frames import InputAudioRawFrame, LLMRunFrame, SpeechOutputAudioRawFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.services.openai.live import events
from pipecat.services.openai.live.llm import OpenAILiveLLMService
from pipecat.turns.user_turn_strategies import ExternalUserTurnStrategies
from pipecat.workers.runner import WorkerRunner


TURN_QUIET_SECONDS = 1.2
START_TIMEOUT_SECONDS = 12
SILENCE_FRAME_SECONDS = 0.04
VOICE_RMS = 128


@dataclass
class LiveTurnResult:
    transcript: str
    speech: str
    audio_chunks: list[bytes]
    sample_rate: int


class HAOpenAILiveLLMService(OpenAILiveLLMService):
    """Observe Live turn progress without replacing Pipecat's delegation handling."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.assist_transcript = ""
        self.assist_speech = ""
        self.assist_activity_at = 0.0
        self.assist_on_transcript: Callable[[str], Awaitable[None]] | None = None
        self._awaiting_responses: set[str] = set()
        self._awaiting_continuation = False

    async def _handle_server_event(self, event):
        if isinstance(event, events.TranscriptDeltaEvent) and event.delta:
            self.assist_activity_at = asyncio.get_running_loop().time()
            if event.role == "user":
                self.assist_transcript += event.delta
                if self.assist_on_transcript:
                    await self.assist_on_transcript(self.assist_transcript.strip())
            else:
                self.assist_speech += event.delta
        elif isinstance(event, events.SessionDelegationCreatedEvent):
            self.assist_activity_at = asyncio.get_running_loop().time()
            if event.delegation.target == "responses":
                self._awaiting_responses.add(event.delegation.id)
        elif isinstance(event, events.ResponseEventEnvelope):
            self.assist_activity_at = asyncio.get_running_loop().time()
            if event.delegation_id:
                self._awaiting_responses.discard(event.delegation_id)
            elif event.inner_type == "response.created" and len(self._awaiting_responses) == 1:
                self._awaiting_responses.clear()
            if event.inner_type == "response.created":
                self._awaiting_continuation = False
        await super()._handle_server_event(event)

    async def send_client_event(self, event):
        if isinstance(event, events.ResponseCreateEvent):
            self._awaiting_continuation = True
        await super().send_client_event(event)

    async def _finish_delegation(self):
        self.assist_activity_at = asyncio.get_running_loop().time()
        await super()._finish_delegation()

    @property
    def assist_delegating(self) -> bool:
        return bool(
            self._awaiting_responses
            or self._awaiting_continuation
            or self._current_delegation
            or self._queued_delegations
            or self._open_function_calls
            or any(not response.finished for response in self._pending_responses.values())
        )

    @property
    def assist_connected(self) -> bool:
        return bool(self._session_started and self._receive_task and not self._receive_task.done())


class _AudioCapture(FrameProcessor):
    def __init__(self):
        super().__init__()
        self.chunks: list[bytes] = []
        self.last_voice_at = 0.0
        self.last_voiced_chunk = 0
        self.sample_rate = 24000

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, SpeechOutputAudioRawFrame) and frame.audio:
            voiced = audioop.rms(frame.audio, 2) >= VOICE_RMS
            if voiced or self.chunks:
                self.chunks.append(frame.audio)
            if voiced:
                self.last_voice_at = asyncio.get_running_loop().time()
                self.last_voiced_chunk = len(self.chunks)
                self.sample_rate = frame.sample_rate
        await self.push_frame(frame, direction)


async def collect_openai_live_turn(
    llm: HAOpenAILiveLLMService,
    context: LLMContext,
    queue: asyncio.Queue[bytes | None],
    *,
    sample_rate: int,
    on_transcript: Callable[[str], Awaitable[None]] | None,
    timeout: float,
) -> LiveTurnResult:
    """Feed captured audio, then collect native speech until the Live turn settles."""
    loop = asyncio.get_running_loop()
    ready = asyncio.Event()
    failure = asyncio.Event()
    error = ""
    input_ended_at: float | None = None
    heard_input = False
    capture = _AudioCapture()
    llm.assist_on_transcript = on_transcript
    user, assistant = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            user_turn_strategies=ExternalUserTurnStrategies(enable_interruptions=False)
        ),
    )
    worker = PipelineWorker(Pipeline([user, llm, capture, assistant]), enable_rtvi=False)
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)

    @worker.event_handler("on_pipeline_started")
    async def start(worker, frame):
        await worker.queue_frame(LLMRunFrame())

    @worker.event_handler("on_pipeline_error")
    async def failed(worker, frame):
        nonlocal error
        error = frame.error
        failure.set()

    @llm.event_handler("on_session_started")
    async def started(service, session):
        ready.set()

    async def feed_audio():
        nonlocal input_ended_at, heard_input
        carry = b""
        async with asyncio.timeout(START_TIMEOUT_SECONDS):
            await ready.wait()
        while (audio := await queue.get()) is not None:
            audio = carry + audio
            end = len(audio) & ~1
            carry = audio[end:]
            if end:
                audio = audio[:end]
                heard_input |= audioop.rms(audio, 2) >= VOICE_RMS
                await worker.queue_frame(InputAudioRawFrame(audio, sample_rate, 1))
        if carry:
            raise ValueError("Incomplete PCM sample at the end of the HA audio stream")
        input_ended_at = loop.time()
        # Live has no audio commit event. Keep feeding silence so the model hears
        # the end of the user's turn after the HA microphone stream has stopped.
        silence = b"\x00" * (2 * int(sample_rate * SILENCE_FRAME_SECONDS))
        while True:
            await worker.queue_frame(InputAudioRawFrame(silence, sample_rate, 1))
            await asyncio.sleep(SILENCE_FRAME_SECONDS)

    async def wait_for_output():
        while True:
            if failure.is_set():
                raise RuntimeError(error)
            if ready.is_set() and not llm.assist_connected:
                raise RuntimeError("GPT-Live disconnected before completing the turn")
            if input_ended_at is not None and not llm.assist_delegating:
                last_activity = max(input_ended_at, llm.assist_activity_at, capture.last_voice_at)
                if loop.time() - last_activity >= TURN_QUIET_SECONDS:
                    if llm.assist_transcript.strip() and llm.assist_speech.strip() and capture.last_voiced_chunk:
                        return
                    if not heard_input and not llm.assist_transcript.strip():
                        return
            await asyncio.sleep(SILENCE_FRAME_SECONDS)

    running = asyncio.create_task(runner.run())
    feeding = asyncio.create_task(feed_audio())
    output = asyncio.create_task(wait_for_output())
    try:
        async with asyncio.timeout(timeout):
            done, _ = await asyncio.wait((running, feeding, output), return_when=asyncio.FIRST_COMPLETED)
            if failure.is_set():
                raise RuntimeError(error)
            for task in done:
                task.result()
            if output not in done:
                raise RuntimeError("GPT-Live stopped before completing the turn")
            feeding.cancel()
            with suppress(asyncio.CancelledError):
                await feeding
            await worker.stop_when_done()
            await running
            if failure.is_set():
                raise RuntimeError(error)
    finally:
        for task in (feeding, output):
            task.cancel()
        if not running.done():
            await runner.cancel()
        await asyncio.gather(feeding, output, running, return_exceptions=True)

    return LiveTurnResult(
        llm.assist_transcript.strip(),
        llm.assist_speech.strip(),
        capture.chunks[:capture.last_voiced_chunk],
        capture.sample_rate,
    )
