"""Synthetic speech regression checks against a running add-on, without a microphone.

Run inside the add-on image with a mono PCM16 16 kHz WAV, e.g.:
python /tests/manual_voice_regression.py --base http://127.0.0.1:17860 \
    --audio /tests/input.wav --flow-id home-default --transport webrtc
Only use test speech; no real household audio is recorded by this script.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import time
import uuid
import wave
from contextlib import suppress
from fractions import Fraction
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin

import httpx
import websockets


def read_audio(path):
    with wave.open(str(path), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (
            1,
            2,
            16000,
        ):
            raise ValueError("Use a mono PCM16 16 kHz WAV")
        return source.readframes(source.getnframes())


def audio_info(data):
    with suppress(wave.Error), wave.open(BytesIO(data), "rb") as source:
        return {
            "sample_rate": source.getframerate(),
            "channels": source.getnchannels(),
            "duration_seconds": round(source.getnframes() / source.getframerate(), 3),
            "codec_name": "pcm_s16le",
        }
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-i",
            "pipe:0",
            "-show_entries",
            "stream=sample_rate,channels,codec_name",
            "-of",
            "json",
        ],
        input=data,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)["streams"][0]


async def ha_turn(args, pcm, client, index):
    endpoint = args.base.replace("https://", "wss://").replace("http://", "ws://")
    start = time.monotonic()
    finished_audio = None
    partials = []
    transcript = ""
    async with websockets.connect(
        endpoint + "/api/assist/stt/stream", max_size=None
    ) as ws:
        await ws.send(
            json.dumps(
                {
                    "type": "start",
                    "flow_id": args.flow_id,
                    "content_type": "audio/pcm",
                    "metadata": {
                        "format": "wav",
                        "codec": "pcm",
                        "sample_rate": 16000,
                        "bit_rate": 16,
                        "channel": 1,
                        "language": args.language,
                    },
                }
            )
        )

        async def send():
            nonlocal finished_audio
            for offset in range(0, len(pcm), 640):
                await ws.send(pcm[offset : offset + 640])
                await asyncio.sleep(0.02)
            finished_audio = time.monotonic()
            await ws.send(json.dumps({"type": "end"}))

        sender = asyncio.create_task(send())
        try:
            async with asyncio.timeout(args.timeout):
                async for message in ws:
                    event = json.loads(message)
                    if event.get("type") == "partial":
                        partials.append(event.get("text"))
                    elif event.get("type") == "final":
                        transcript = str(event.get("text") or "").strip()
                        break
                    elif event.get("type") == "error":
                        raise RuntimeError(event.get("detail") or "STT failed")
            await sender
        finally:
            sender.cancel()
            with suppress(asyncio.CancelledError):
                await sender
    if not transcript:
        raise RuntimeError("STT returned no transcript")
    stt_ms = (time.monotonic() - (finished_audio or start)) * 1000
    conversation_start = time.monotonic()
    response = await client.post(
        args.base + "/api/assist/conversation",
        json={
            "text": transcript,
            "language": args.language,
            "flow_id": args.flow_id,
            "conversation_id": f"regression-{args.flow_id}",
        },
    )
    response.raise_for_status()
    answer = response.json()
    if answer.get("error"):
        raise RuntimeError(answer["error"])
    llm_ms = (time.monotonic() - conversation_start) * 1000
    tts_start = time.monotonic()
    audio = await client.post(
        args.base + "/api/assist/tts",
        json={
            "text": answer["speech"],
            "language": args.language,
            "flow_id": args.flow_id,
            "options": {"preferred_format": "wav"},
        },
    )
    audio.raise_for_status()
    if len(audio.content) < 100:
        raise RuntimeError("TTS returned no audio")
    return {
        "transport": "ha",
        "flow_id": args.flow_id,
        "turn": index,
        "transcript": transcript,
        "speech": answer["speech"],
        "partial_count": len(partials),
        "stt_after_speech_ms": round(stt_ms),
        "conversation_ms": round(llm_ms),
        "tts_ms": round((time.monotonic() - tts_start) * 1000),
        "speech_end_to_audio_ms": round(
            (time.monotonic() - (finished_audio or start)) * 1000
        ),
        "audio_bytes": len(audio.content),
        "audio": audio_info(audio.content),
    }


async def webrtc(args, pcm, client, config):
    import numpy as np
    from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription
    from av import AudioFrame

    class TestMicrophone(MediaStreamTrack):
        kind = "audio"

        def __init__(self):
            super().__init__()
            self.pts = 0
            self.started = time.monotonic()
            self.pending = b""
            self.speech_end = asyncio.Event()
            self.speech_end_time = 0.0

        async def recv(self):
            await asyncio.sleep(
                max(0, self.started + self.pts / 16000 - time.monotonic())
            )
            chunk = self.pending[:640]
            self.pending = self.pending[640:]
            if chunk and not self.pending:
                self.speech_end_time = time.monotonic()
                self.speech_end.set()
            frame = AudioFrame(format="s16", layout="mono", samples=320)
            frame.planes[0].update(chunk.ljust(640, b"\0"))
            frame.sample_rate = 16000
            frame.pts = self.pts
            frame.time_base = Fraction(1, 16000)
            self.pts += 320
            return frame

    peer = RTCPeerConnection()
    microphone = TestMicrophone()
    peer.addTrack(microphone)
    channel = peer.createDataChannel("signalling")
    ready, speech_done, first_audio = asyncio.Event(), asyncio.Event(), asyncio.Event()
    current = {
        "active": False,
        "samples": 0,
        "transcripts": [],
        "output": [],
        "events": [],
        "audio_gaps": [],
    }
    errors = []
    consumers = []

    @channel.on("open")
    def opened():
        channel.send(
            json.dumps(
                {
                    "label": "rtvi-ai",
                    "id": uuid.uuid4().hex[:8],
                    "type": "client-ready",
                    "data": {"version": "1.4.0"},
                }
            )
        )

    @channel.on("message")
    def message(raw):
        if not isinstance(raw, str) or not raw.startswith("{"):
            return
        event = json.loads(raw)
        kind = event.get("type")
        data = event.get("data") or {}
        if kind == "bot-ready":
            ready.set()
        if kind == "bot-stopped-speaking":
            speech_done.set()
        if kind in {"error", "error-response"}:
            errors.append(str(data))
        if not current["active"]:
            return
        current["events"].append(kind)
        if kind in {"user-transcription", "user-input"} and data.get("text"):
            current["transcripts"].append(data["text"])
        if kind in {"bot-output", "bot-transcription"} and data.get("text"):
            current["output"].append(data["text"])

    @peer.on("track")
    def track_received(track):
        async def consume():
            while True:
                frame = await track.recv()
                if not current["active"]:
                    continue
                array = frame.to_ndarray().astype(np.float64)
                rms = float(np.sqrt(np.mean(array * array)))
                if rms > 30:
                    if not first_audio.is_set():
                        current["first_audio_time"] = time.monotonic()
                        first_audio.set()
                    now = time.monotonic()
                    if current.get("previous_audio_time"):
                        current["audio_gaps"].append(
                            now - current["previous_audio_time"]
                        )
                    current["previous_audio_time"] = now
                    current["samples"] += frame.samples
                    current["sample_rate"] = frame.sample_rate
                    current["channels"] = len(frame.layout.channels)

        consumers.append(asyncio.create_task(consume()))

    try:
        await peer.setLocalDescription(await peer.createOffer())
        offer_path = config.get("runner_offer_path") or "api/offer"
        response = await client.post(
            urljoin(args.base + "/", offer_path),
            json={
                "sdp": peer.localDescription.sdp,
                "type": "offer",
                "request_data": {
                    "flow_id": args.flow_id,
                    "client_id": "voice-regression-" + uuid.uuid4().hex[:8],
                    "language": args.language,
                    "source": "regression-test",
                },
            },
        )
        response.raise_for_status()
        answer = response.json()
        await peer.setRemoteDescription(
            RTCSessionDescription(sdp=answer["sdp"], type=answer["type"])
        )
        await asyncio.wait_for(ready.wait(), args.timeout)
        flow = next(f for f in config["flows"] if f["id"] == args.flow_id)
        if flow.get("greeting") or flow.get("conversation_flow", {}).get("enabled"):
            with suppress(TimeoutError):
                await asyncio.wait_for(speech_done.wait(), 15)
        await asyncio.sleep(1)
        for index in range(1, args.repeat + 1):
            speech_done.clear()
            first_audio.clear()
            microphone.speech_end.clear()
            current.update(
                active=True,
                samples=0,
                transcripts=[],
                output=[],
                events=[],
                audio_gaps=[],
                previous_audio_time=None,
            )
            microphone.pending = pcm
            await asyncio.wait_for(microphone.speech_end.wait(), args.timeout)
            await asyncio.wait_for(first_audio.wait(), args.timeout)
            await asyncio.wait_for(speech_done.wait(), args.timeout)
            await asyncio.sleep(0.3)
            current["active"] = False
            result = {
                "transport": "webrtc",
                "flow_id": args.flow_id,
                "turn": index,
                "speech_end_to_first_audio_ms": round(
                    (current["first_audio_time"] - microphone.speech_end_time) * 1000
                ),
                "audio_samples": current["samples"],
                "sample_rate": current.get("sample_rate"),
                "channels": current.get("channels"),
                "transcript_events": current["transcripts"],
                "assistant_output_events": current["output"],
                "max_audio_packet_gap_ms": round(
                    max(current["audio_gaps"], default=0) * 1000
                ),
                "errors": list(errors),
            }
            print(json.dumps(result, ensure_ascii=False), flush=True)
            if errors or not current["samples"] or not current["transcripts"]:
                raise RuntimeError("WebRTC regression check failed")
            await asyncio.sleep(0.7)
    finally:
        microphone.stop()
        await peer.close()
        for task in consumers:
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task


async def run(args):
    pcm = read_audio(args.audio)
    async with httpx.AsyncClient(timeout=args.timeout) as client:
        config_response = await client.get(args.base + "/api/assist/config")
        config_response.raise_for_status()
        config = config_response.json()
        if args.transport == "webrtc":
            await webrtc(args, pcm, client, config)
        else:
            for index in range(1, args.repeat + 1):
                result = await ha_turn(args, pcm, client, index)
                print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:7860")
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--flow-id", default="home-default")
    parser.add_argument("--language", default="pl")
    parser.add_argument("--transport", choices=("ha", "webrtc"), default="ha")
    parser.add_argument("--repeat", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=75)
    asyncio.run(run(parser.parse_args()))
