"""Audio relay contracts independent of a running Home Assistant."""

import asyncio
import base64
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock

import aiohttp

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "_pipecat_relay_test"
package = ModuleType(PACKAGE)
package.__path__ = [str(ROOT / "custom_components/pipecat_assist")]
sys.modules[PACKAGE] = package
spec = importlib.util.spec_from_file_location(
    f"{PACKAGE}.voice_stream", Path(package.__path__[0]) / "voice_stream.py"
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class RelayTests(unittest.IsolatedAsyncioTestCase):
    def test_url_is_server_owned_and_does_not_expose_the_token(self):
        config = {"browser_ws_path": "api/assist/browser/stream?token=private-secret"}
        url = module.stream_url(
            "http://addon:7860", config, {"flow_id": "home", "language": "pl"}
        )
        self.assertEqual(
            url, "ws://addon:7860/api/assist/browser/stream?flow_id=home&language=pl"
        )
        self.assertNotIn("secret", url)
        self.assertEqual(
            module.stream_headers(config)["Authorization"], "Bearer private-secret"
        )
        for path in ("https://untrusted/api", "//untrusted/api", "api/assist/other"):
            with self.assertRaises(ValueError):
                module.stream_url("http://addon:7860", {"browser_ws_path": path}, {})

    async def test_binary_audio_and_subscription_cleanup(self):
        connection = SimpleNamespace(
            subscriptions={},
            send_event=Mock(),
            send_result=Mock(),
            async_register_binary_handler=Mock(return_value=(3, Mock())),
        )
        hello = {
            "type": "hello",
            "protocol": "va-pipecat",
            "version": 1,
            "audio": {
                "format": "pcm_s16le",
                "input_sample_rate": 16000,
                "output_sample_rate": 24000,
                "channels": 1,
            },
        }
        socket = AsyncMock()

        async def events():
            yield SimpleNamespace(type=aiohttp.WSMsgType.TEXT, data=json.dumps(hello))
            await asyncio.sleep(0)
            yield SimpleNamespace(type=aiohttp.WSMsgType.BINARY, data=b"\x01\x02" * 960)

        socket.__aiter__ = lambda _: events()
        registry = {}
        relay = module.VoiceRelay(None, connection, 7, socket, registry)
        await relay.run()
        emitted = [call.args[1] for call in connection.send_event.call_args_list]
        self.assertEqual(emitted[0]["input_handler_id"], 3)
        self.assertEqual(base64.b64decode(emitted[1]["audio"]), b"\x01\x02" * 960)
        self.assertEqual(emitted[-1]["type"], "closed")
        self.assertEqual(registry, {})
        self.assertEqual(connection.subscriptions, {})
        socket.close.assert_awaited_once()
        connection.async_register_binary_handler.return_value[1].assert_called_once()

    async def test_invalid_packets_and_backpressure_close_the_stream(self):
        connection = SimpleNamespace(send_event=Mock())
        relay = module.VoiceRelay(None, connection, 1, AsyncMock(), {})
        relay.ready = True
        relay.task = Mock(done=lambda: False)
        relay.enqueue_audio(None, None, b"odd")
        relay.task.cancel.assert_called_once()
        relay.task.reset_mock()
        for _ in range(65):
            relay.enqueue_audio(None, None, b"\0\0" * 320)
        relay.task.cancel.assert_called_once()
        self.assertEqual(relay.queue.qsize(), 64)

    async def test_cancellation_cleans_up_a_silent_backend(self):
        connection = SimpleNamespace(
            subscriptions={},
            send_event=Mock(),
            send_result=Mock(),
            async_register_binary_handler=Mock(return_value=(1, Mock())),
        )
        socket = AsyncMock()

        async def events():
            await asyncio.Event().wait()
            yield None

        socket.__aiter__ = lambda _: events()
        registry = {}
        relay = module.VoiceRelay(None, connection, 1, socket, registry)
        relay.task = asyncio.create_task(relay.run())
        await asyncio.sleep(0)
        relay.stop()
        with self.assertRaises(asyncio.CancelledError):
            await relay.task
        self.assertFalse(registry)
        self.assertFalse(connection.subscriptions)
        socket.close.assert_awaited_once()

    async def test_sender_failure_does_not_wait_for_backend_audio(self):
        connection = SimpleNamespace(
            subscriptions={},
            send_event=Mock(),
            send_result=Mock(),
            async_register_binary_handler=Mock(return_value=(1, Mock())),
        )
        socket = AsyncMock()
        socket.send_bytes.side_effect = aiohttp.ClientConnectionError()

        async def events():
            await asyncio.Event().wait()
            yield None

        socket.__aiter__ = lambda _: events()
        registry = {}
        relay = module.VoiceRelay(None, connection, 1, socket, registry)
        relay.enqueue(b"\0\0")
        await asyncio.wait_for(relay.run(), timeout=1)
        self.assertFalse(registry)
        self.assertFalse(connection.subscriptions)
        self.assertEqual(connection.send_event.call_args.args[1]["type"], "error")
        socket.close.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
