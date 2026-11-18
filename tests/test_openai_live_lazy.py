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


if __name__ == "__main__":
    unittest.main()
