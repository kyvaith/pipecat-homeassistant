"""Lazy GPT-Live: connect on first mic audio, buffer until session start, close when idle."""

import asyncio
import functools
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from websockets.asyncio.server import serve

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "addons/pipecat_assist"))

from pipecat.frames.frames import EndFrame, InputAudioRawFrame, LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.workers.runner import WorkerRunner
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair

from app import main
from app.openai_live_lazy import LazyOpenAILiveLLMService
from tests.test_openai_live_ha import gpt_config


class LazyOpenAILiveTests(unittest.IsolatedAsyncioTestCase):
    async def test_connects_on_audio_buffers_and_closes_when_idle(self):
        connections = []

        async def provider(socket):
            seen = []
            connections.append(seen)
            seen.append(json.loads(await socket.recv()))
            await asyncio.sleep(0.2)  # slow session start: audio must be buffered meanwhile
            await socket.send(json.dumps({"type": "session.started", "session": {"id": "s"}}))
            async for raw in socket:
                message = json.loads(raw)
                seen.append(message)
                if message["type"] == "session.close":
                    await socket.send(json.dumps({"type": "session.closed", "reason": "close_requested"}))

        async def wait_for(predicate, timeout=5.0):
            async with asyncio.timeout(timeout):
                while not predicate():
                    await asyncio.sleep(0.05)

        def appends(seen):
            return [m for m in seen if m["type"] == "session.input_audio.append"]

        async with serve(provider, "127.0.0.1", 0) as server:
            url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/v1/live/sessions"
            config, flow, integration = gpt_config(url)
            with patch("app.openai_live_lazy.IDLE_CLOSE_SECS", 1.0):
                llm, _ = main._openai_live_service(
                    config, flow, integration, None,
                    service_class=functools.partial(LazyOpenAILiveLLMService, lazy=True),
                )
                user, assistant = LLMContextAggregatorPair(LLMContext())
                worker = PipelineWorker(Pipeline([user, llm, assistant]), enable_rtvi=False)
                runner = WorkerRunner(handle_sigint=False)
                run = asyncio.create_task(runner.run(worker))
                await worker.queue_frame(LLMRunFrame())
                await asyncio.sleep(0.5)
                self.assertEqual(connections, [], "must not connect before mic audio")

                frame = InputAudioRawFrame(b"\x01\x00" * 1600, 16000, 1)  # 100 ms
                for _ in range(3):
                    await worker.queue_frame(frame)
                await wait_for(lambda: connections and len(appends(connections[0])) >= 2)  # pre-start audio was buffered, not dropped
                self.assertEqual(connections[0][0]["type"], "session.start")

                await wait_for(lambda: any(m["type"] == "session.close" for m in connections[0]))

                await worker.queue_frame(frame)
                await wait_for(lambda: len(connections) == 2 and appends(connections[1]))
                self.assertEqual(connections[1][0]["type"], "session.start")

                await worker.queue_frame(EndFrame())
                await asyncio.wait_for(run, 5)


    async def test_rejected_connect_is_retried_on_later_audio(self):
        attempts, sessions = [], []

        def reject_first(connection, request):
            attempts.append(1)
            if len(attempts) == 1:
                return connection.respond(401, "Unauthorized")
            return None

        async def provider(socket):
            sessions.append(json.loads(await socket.recv()))
            await socket.send(json.dumps({"type": "session.started", "session": {"id": "s"}}))
            async for raw in socket:
                if json.loads(raw)["type"] == "session.close":
                    await socket.send(json.dumps({"type": "session.closed", "reason": "close_requested"}))

        async with serve(provider, "127.0.0.1", 0, process_request=reject_first) as server:
            url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/v1/live/sessions"
            config, flow, integration = gpt_config(url)
            with patch("app.openai_live_lazy.RETRY_AFTER_FAIL_SECS", 0.3):
                llm, _ = main._openai_live_service(
                    config, flow, integration, None,
                    service_class=functools.partial(LazyOpenAILiveLLMService, lazy=True),
                )
                user, assistant = LLMContextAggregatorPair(LLMContext())
                worker = PipelineWorker(Pipeline([user, llm, assistant]), enable_rtvi=False)
                run = asyncio.create_task(WorkerRunner(handle_sigint=False).run(worker))
                await worker.queue_frame(LLMRunFrame())
                frame = InputAudioRawFrame(b"\x01\x00" * 1600, 16000, 1)
                await worker.queue_frame(frame)
                async with asyncio.timeout(5):
                    while not attempts:
                        await asyncio.sleep(0.05)
                    await asyncio.sleep(0.5)
                    while not sessions:
                        await worker.queue_frame(frame)
                        await asyncio.sleep(0.1)
                self.assertTrue(llm.is_usable)
                self.assertEqual(len(attempts), 2, "one retry after the back-off, not one per frame")
                await worker.queue_frame(EndFrame())
                await asyncio.wait_for(run, 5)

    def test_delegated_backend_uses_lowest_reasoning_unless_flow_sets_one(self):
        config, flow, integration = gpt_config("ws://127.0.0.1:1/v1/live/sessions")
        integration.default_model = "gpt-6-sol"
        llm, _ = main._openai_live_service(config, flow, integration, None)
        self.assertEqual(llm._delegation.settings.reasoning.effort, "none")
        flow.reasoning_effort = "low"
        llm, _ = main._openai_live_service(config, flow, integration, None)
        self.assertEqual(llm._delegation.settings.reasoning.effort, "low")


if __name__ == "__main__":
    unittest.main()
