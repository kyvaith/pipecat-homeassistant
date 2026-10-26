"""Authenticated, full-duplex audio relay over Home Assistant's WebSocket API."""

from __future__ import annotations

import asyncio
import base64
import json
from contextlib import suppress
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import aiohttp
from aiohttp import web

from .const import DOMAIN

MAX_STREAMS = 8
MAX_INPUT_BYTES = 4096


def stream_url(base_url, config, message):
    """Keep the add-on address and its credentials on the HA server."""
    path = urlsplit(str(config.get("browser_ws_path") or ""))
    if (
        path.scheme
        or path.netloc
        or path.path.strip("/") != "api/assist/browser/stream"
    ):
        raise ValueError(
            "Update the Pipecat Assist app to enable dashboard audio streaming."
        )
    base = urlsplit(base_url)
    if base.scheme not in {"http", "https"}:
        raise ValueError("Invalid Pipecat Assist app URL.")
    query = dict(parse_qsl(path.query))
    query.pop("token", None)
    for key in ("flow_id", "client_id", "language"):
        if message.get(key):
            query[key] = message[key]
    return urlunsplit(
        (
            "wss" if base.scheme == "https" else "ws",
            base.netloc,
            base.path.rstrip("/") + "/" + path.path.lstrip("/"),
            urlencode(query),
            "",
        )
    )


def stream_headers(config, headers=None):
    headers = dict(headers or {})
    token = dict(parse_qsl(urlsplit(config.get("browser_ws_path", "")).query)).get(
        "token"
    )
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


class VoiceRelay:
    """Bound queues and bind every stream to its authenticated HA connection."""

    def __init__(self, hass, connection, message_id, socket, registry):
        self.hass, self.connection, self.message_id = hass, connection, message_id
        self.socket, self.registry = socket, registry
        self.key = (id(connection), message_id)
        self.queue = asyncio.Queue(maxsize=64)
        self.task = None
        self.unregister = None
        self.closed = False
        self.ready = False

    def event(self, data):
        if not self.closed:
            self.connection.send_event(self.message_id, data)

    def stop(self):
        if self.task and not self.task.done():
            self.task.cancel()

    def enqueue_audio(self, _hass, _connection, data):
        if not self.ready or self.closed:
            return
        if not data or len(data) > MAX_INPUT_BYTES or len(data) % 2:
            self.event({"type": "error", "message": "Invalid voice audio packet."})
            self.stop()
            return
        self.enqueue(bytes(data))

    def enqueue(self, payload):
        if self.closed:
            return
        try:
            self.queue.put_nowait(payload)
        except asyncio.QueueFull:
            self.event(
                {
                    "type": "error",
                    "message": "Voice connection is too slow. Please reconnect.",
                }
            )
            self.stop()

    async def send_audio(self):
        while True:
            payload = await self.queue.get()
            if isinstance(payload, bytes):
                await self.socket.send_bytes(payload)
            else:
                await self.socket.send_json(payload)

    async def receive_audio(self, handler_id):
        iterator = self.socket.__aiter__()
        while True:
            try:
                if self.ready:
                    message = await anext(iterator)
                else:
                    async with asyncio.timeout(20):
                        message = await anext(iterator)
            except StopAsyncIteration:
                self.event({"type": "closed"})
                return
            if message.type == aiohttp.WSMsgType.BINARY:
                if (
                    not self.ready
                    or not message.data
                    or len(message.data) > 65536
                    or len(message.data) % 2
                ):
                    raise ValueError("Invalid voice audio from the app.")
                self.event(
                    {
                        "type": "audio",
                        "audio": base64.b64encode(message.data).decode("ascii"),
                    }
                )
            elif message.type == aiohttp.WSMsgType.TEXT:
                event = json.loads(message.data)
                if not isinstance(event, dict):
                    raise ValueError("Invalid voice event.")
                if event.get("type") == "hello":
                    audio = event.get("audio") or {}
                    if (
                        event.get("protocol"),
                        event.get("version"),
                        audio.get("input_sample_rate"),
                        audio.get("output_sample_rate"),
                        audio.get("channels"),
                        audio.get("format"),
                    ) != ("va-pipecat", 1, 16000, 24000, 1, "pcm_s16le"):
                        raise ValueError("Unsupported Pipecat audio format.")
                    self.ready = True
                    self.event(
                        {
                            "type": "ready",
                            "input_handler_id": handler_id,
                            "input_sample_rate": 16000,
                            "output_sample_rate": 24000,
                            "channels": 1,
                        }
                    )
                    self.enqueue({"type": "wake"})
                elif event.get("type") in {
                    "phase",
                    "transcript",
                    "interrupt",
                    "error",
                    "rtvi",
                }:
                    self.event(event)
            elif message.type == aiohttp.WSMsgType.ERROR:
                raise ValueError("The Pipecat voice connection was interrupted.")

    async def run(self):
        handler_id, self.unregister = self.connection.async_register_binary_handler(
            self.enqueue_audio
        )
        self.registry[self.key] = self
        self.connection.subscriptions[self.message_id] = self.stop
        self.connection.send_result(self.message_id)
        sender = asyncio.create_task(self.send_audio())
        receiver = asyncio.create_task(self.receive_audio(handler_id))
        try:
            done, _ = await asyncio.wait(
                {sender, receiver}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                task.result()
        except (aiohttp.ClientError, ValueError, OSError, TimeoutError):
            self.event(
                {
                    "type": "error",
                    "message": "The Pipecat voice connection was interrupted.",
                }
            )
        finally:
            self.closed = True
            self.ready = False
            self.unregister()
            self.connection.subscriptions.pop(self.message_id, None)
            self.registry.pop(self.key, None)
            sender.cancel()
            receiver.cancel()
            await asyncio.gather(sender, receiver, return_exceptions=True)
            with suppress(TimeoutError, aiohttp.ClientError):
                async with asyncio.timeout(5):
                    await self.socket.close()


def register_voice_stream(hass):
    """Use HA's existing authentication and binary audio handling, not URL tokens."""
    import voluptuous as vol
    from homeassistant.components import websocket_api
    from homeassistant.helpers.aiohttp_client import async_get_clientsession

    from .views import _addon_headers, _entry_for_id, _load_addon_config

    data = hass.data.setdefault(DOMAIN, {})
    if data.get("voice_stream_registered"):
        return
    registry = data.setdefault("voice_streams", {})

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "pipecat_assist/stream",
            vol.Optional("entry_id"): str,
            vol.Optional("flow_id"): vol.All(str, vol.Length(max=128)),
            vol.Optional("client_id"): vol.All(str, vol.Length(max=128)),
            vol.Optional("language"): vol.All(str, vol.Length(max=35)),
        }
    )
    @websocket_api.async_response
    async def stream(hass, connection, message):
        if (
            len(registry) >= MAX_STREAMS
            or sum(key[0] == id(connection) for key in registry) >= 2
        ):
            connection.send_error(
                message["id"], "busy", "Too many voice conversations are active."
            )
            return
        key = (id(connection), message["id"])
        registry[key] = None
        task = asyncio.current_task()
        connection.subscriptions[message["id"]] = task.cancel
        socket = None
        relay = None
        try:
            entry = _entry_for_id(hass, message.get("entry_id", ""))
            config = await _load_addon_config(hass, entry)
            url = stream_url(entry.data["url"], config, message)
            async with asyncio.timeout(20):
                socket = await async_get_clientsession(hass).ws_connect(
                    url,
                    headers=stream_headers(config, _addon_headers(entry)),
                    heartbeat=20,
                )
            relay = VoiceRelay(hass, connection, message["id"], socket, registry)
            relay.entry_id = entry.entry_id
            relay.task = task
            await relay.run()
        except (
            aiohttp.ClientError,
            TimeoutError,
            OSError,
            ValueError,
            RuntimeError,
            web.HTTPException,
        ):
            if relay is None or relay.unregister is None:
                connection.send_error(
                    message["id"],
                    "cannot_connect",
                    "Cannot open the Pipecat voice stream. Check the app and integration versions.",
                )
            else:
                relay.event(
                    {
                        "type": "error",
                        "message": "Cannot start the Pipecat voice stream.",
                    }
                )
        finally:
            registry.pop(key, None)
            connection.subscriptions.pop(message["id"], None)
            if socket and not socket.closed:
                with suppress(TimeoutError, aiohttp.ClientError):
                    async with asyncio.timeout(5):
                        await socket.close()

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "pipecat_assist/stream/control",
            vol.Required("stream_id"): int,
            vol.Required("action"): vol.In(["interrupt", "stop"]),
        }
    )
    @websocket_api.async_response
    async def control(hass, connection, message):
        relay = registry.get((id(connection), message["stream_id"]))
        if not relay:
            connection.send_error(
                message["id"], "not_found", "Voice stream is not active."
            )
            return
        relay.enqueue({"type": message["action"]})
        connection.send_result(message["id"])

    websocket_api.async_register_command(hass, stream)
    websocket_api.async_register_command(hass, control)
    data["voice_stream_registered"] = True
