"""Classic Assist contracts backed by a simulated GPT-Live WebSocket."""

import asyncio
import base64
import io
import json
import sys
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from websockets.asyncio.server import serve

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "addons/pipecat_assist"))

from app import main
from app.config import FlowConfig, IntegrationConfig, RuntimeConfig


class AssistSocket:
    def __init__(self, chunks, **metadata):
        self.messages = iter([*({"bytes": chunk} for chunk in chunks), {"text": '{"type":"end"}'}])
        self.metadata = {"codec": "pcm", "sample_rate": 16000, "bit_rate": 16, "channel": 1, **metadata}
        self.events = []

    async def accept(self):
        pass

    async def receive_json(self):
        return {"type": "start", "metadata": self.metadata}

    async def receive(self):
        return next(self.messages)

    async def send_json(self, event):
        self.events.append(event)

    async def close(self, code=1000):
        self.close_code = code


def gpt_config(url="", *, enabled=True):
    integration = IntegrationConfig(
        id="openai-live", name="OpenAI GPT-Live", kind="openai_live",
        enabled=enabled, api_key="test-key", base_url=url, default_voice="cedar",
    )
    flow = FlowConfig(provider_id=integration.id, steps=[], mcp_enabled=False)
    config = RuntimeConfig(flows=[flow], integrations=[integration])
    return config, flow, integration


class OpenAILiveAssistTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.enterContext(patch.object(main, "HA_LIVE_TURNS_BY_TRANSCRIPT", {}))
        self.enterContext(patch.object(main, "HA_LIVE_TURNS_BY_SPEECH", {}))
        self.text_fallback = self.enterContext(patch.object(main, "run_text_conversation", new_callable=AsyncMock))
        self.stt_fallback = self.enterContext(patch.object(main, "_transcribe_audio_bytes", new_callable=AsyncMock))
        self.tts_fallback = self.enterContext(patch.object(main, "_synthesize_tts_audio", new_callable=AsyncMock))

    def tearDown(self):
        for fallback in (self.text_fallback, self.stt_fallback, self.tts_fallback):
            fallback.assert_not_awaited()

    async def test_native_turn_waits_for_delegation_and_returns_its_original_wav(self):
        pcm = b"\x01\x06" * 480
        encoded = base64.b64encode(pcm).decode()
        seen = []

        async def provider(socket):
            async def send(event_type, **body):
                await socket.send(json.dumps({"type": event_type, **body}))

            seen.append(json.loads(await socket.recv()))
            await send("session.started", session={"id": "live-ha-test"})
            seen.append(json.loads(await socket.recv()))
            await send("session.input_transcript.delta", delta="Turn it")
            await send("session.input_transcript.delta", delta=" off.")
            await send("session.delegation.created", delegation={"id": "d1", "target": "responses"})
            await send("response.event", event={"type": "response.created"})
            await send("session.output_transcript.delta", delta="One moment. ")
            await send("session.output_audio.delta", delta=encoded)
            await asyncio.sleep(0.25)
            await send("response.event", event={"type": "response.completed"})
            await send("session.output_transcript.delta", delta="It is off.")
            await send("session.output_audio.delta", delta=encoded)
            await send("session.output_audio.delta", delta=base64.b64encode(bytes(len(pcm))).decode())
            async for raw in socket:
                if json.loads(raw)["type"] == "session.close":
                    await send("session.closed", reason="close_requested")
                    return

        async with serve(provider, "127.0.0.1", 0) as provider_server:
            url = f"ws://127.0.0.1:{provider_server.sockets[0].getsockname()[1]}/v1/live/sessions"
            config, flow, integration = gpt_config(url)
            with (
                patch.object(main.STORE, "load", return_value=config),
                patch("app.openai_live_ha.TURN_QUIET_SECONDS", 0.12),
                patch.object(main, "HA_LIVE_TRANSCRIPT_TIMEOUT_SECONDS", 8),
            ):
                socket = AssistSocket([pcm[:81], pcm[81:]])
                await main.api_stt_stream(socket)
                self.assertEqual(socket.events[0], {"type": "ready", "mode": "live", "provider": "openai_live"})
                self.assertEqual(socket.events[-1], {"type": "final", "text": "Turn it off."})
                result = await main.api_conversation({"text": "Turn it off.", "conversation_id": "ha-123"})
                self.assertEqual(result["speech"], "One moment. It is off.")
                self.assertEqual(result["conversation_id"], "ha-123")
                self.assertEqual(result["source"], "pipecat_live_bridge")
                self.assertEqual(result["provider"], "openai_live")
                wav = await main.api_tts({"text": result["speech"], "options": {"preferred_format": "mp3"}})
                self.assertEqual(wav.headers["X-Audio-Extension"], "wav")
                with wave.open(io.BytesIO(wav.body)) as stream:
                    self.assertEqual(stream.getframerate(), 24000)
                    self.assertEqual(stream.readframes(stream.getnframes()), pcm * 2)
                with self.assertRaises(HTTPException) as reused:
                    await main.api_conversation({"text": "Turn it off."})
                self.assertEqual(reused.exception.status_code, 409)
                integration.default_voice = "marin"
                with self.assertRaises(HTTPException) as stale:
                    await main.api_tts({"text": result["speech"]})
                self.assertEqual(stale.exception.status_code, 409)
        self.assertEqual(seen[0]["type"], "session.start")
        self.assertEqual(seen[0]["session"]["model"], "gpt-live-1")
        self.assertEqual(seen[0]["session"]["audio"]["output"]["voice"], "cedar")
        self.assertEqual(seen[1]["type"], "session.input_audio.append")

    async def test_provider_error_returns_websocket_error_not_fallback(self):
        async def provider(socket):
            await socket.recv()
            await socket.send(json.dumps({"type": "error", "error": {"message": "Model unavailable"}}))
            await socket.wait_closed()

        async with serve(provider, "127.0.0.1", 0) as server:
            config, _, _ = gpt_config(f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/v1/live/sessions")
            with patch.object(main.STORE, "load", return_value=config):
                socket = AssistSocket([b"\x01\x06" * 80])
                await asyncio.wait_for(main.api_stt_stream(socket), timeout=8)
        self.assertEqual(socket.events[-1]["type"], "error")
        self.assertIn("Model unavailable", socket.events[-1]["detail"])
        self.assertEqual(socket.close_code, 1011)

    async def test_missing_turn_wrong_provider_and_buffered_stt_do_not_fallback(self):
        config, flow, _ = gpt_config()
        stale = main.HALiveTurn(flow_id=flow.id, provider="gemini-live", transcript="Hello", speech="Hi.")
        main._remember_ha_live_transcript(stale)
        main._remember_ha_live_speech(stale)
        with patch.object(main.STORE, "load", return_value=config):
            for endpoint, payload in (
                (main.api_conversation, {"text": "Hello"}),
                (main.api_tts, {"text": "Hi."}),
                (main.api_stt, SimpleNamespace()),
            ):
                with self.subTest(endpoint=endpoint.__name__), self.assertRaises(HTTPException):
                    await endpoint(payload)
            socket = AssistSocket([], channel=2)
            await main.api_stt_stream(socket)
            self.assertEqual(socket.events[0]["type"], "error")
            self.assertIn("PCM", socket.events[0]["detail"])

    async def test_incomplete_gpt_turn_does_not_fall_back(self):
        async def provider(socket):
            await socket.recv()
            await socket.send(json.dumps({"type": "session.started", "session": {"id": "live-ha-test"}}))
            await socket.recv()
            await socket.send(json.dumps({"type": "session.input_transcript.delta", "delta": "Hello"}))
            await socket.send(json.dumps({"type": "session.output_transcript.delta", "delta": "Hi."}))
            await socket.wait_closed()

        async with serve(provider, "127.0.0.1", 0) as server:
            config, _, _ = gpt_config(f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/v1/live/sessions")
            with (
                patch.object(main.STORE, "load", return_value=config),
                patch.object(main, "HA_LIVE_RESULT_TIMEOUT_SECONDS", 1),
            ):
                socket = AssistSocket([b"\x01\x06" * 480])
                await asyncio.wait_for(main.api_stt_stream(socket), timeout=8)
                self.assertEqual(socket.events[-1]["type"], "error")
                self.assertIn("timed out", socket.events[-1]["detail"])
                with self.assertRaises(HTTPException):
                    await main.api_conversation({"text": "Hello"})
                with self.assertRaises(HTTPException):
                    await main.api_tts({"text": "Hi."})

    async def test_disabled_live_integration_fails_before_accepting_pcm(self):
        config, _, _ = gpt_config(enabled=False)
        with patch.object(main.STORE, "load", return_value=config):
            socket = AssistSocket([])
            await main.api_stt_stream(socket)
        self.assertEqual(socket.events[0]["type"], "error")
        self.assertIn("disabled", socket.events[0]["detail"])

    async def test_cached_gpt_turn_is_not_replaced_after_provider_switch(self):
        config, flow, integration = gpt_config()
        stale = main.HALiveTurn(flow_id=flow.id, provider="openai_live", transcript="Hello", speech="Hi.")
        main._remember_ha_live_transcript(stale)
        main._remember_ha_live_speech(stale)
        integration.kind = "gemini_live"
        with patch.object(main.STORE, "load", return_value=config):
            for endpoint, payload in (
                (main.api_conversation, {"text": "Hello"}),
                (main.api_tts, {"text": "Hi."}),
            ):
                with self.subTest(endpoint=endpoint.__name__), self.assertRaises(HTTPException) as conflict:
                    await endpoint(payload)
                self.assertEqual(conflict.exception.status_code, 409)
