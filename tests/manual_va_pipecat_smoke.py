"""Manual raw-PCM smoke test for the ESPHome Pipecat WebSocket endpoint."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import time
import wave
from pathlib import Path
from urllib.parse import urlencode

import websockets


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--flow-id", default="home-default")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--ready-delay", type=float, default=2.0)
    return parser.parse_args()


def _read_pcm(path: Path) -> tuple[bytes, int]:
    with wave.open(str(path), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise ValueError("audio must be mono PCM16")
        sample_rate = source.getframerate()
        return source.readframes(source.getnframes()), sample_rate


async def _run(args: argparse.Namespace) -> int:
    token = os.environ.get("VA_PIPECAT_TOKEN", "")
    if not token:
        raise RuntimeError("VA_PIPECAT_TOKEN is required")

    pcm, sample_rate = _read_pcm(args.audio)
    if sample_rate != 16000:
        raise ValueError(f"audio sample rate must be 16000 Hz, got {sample_rate}")

    query = urlencode(
        {
            "token": token,
            "flow_id": args.flow_id,
            "client_id": "manual-smoke-test",
        }
    )
    endpoint = f"{args.url.rstrip('/')}?{query}"
    binary_bytes = 0
    phases: list[str] = []
    transcripts: list[tuple[str, str]] = []
    started = time.monotonic()

    async with websockets.connect(endpoint, max_size=None) as websocket:
        hello = json.loads(await websocket.recv())
        if hello.get("type") != "hello":
            raise RuntimeError(f"unexpected handshake: {hello}")

        # The WebSocket is accepted before the realtime model finishes its
        # handshake. A real satellite normally stays connected from boot.
        await asyncio.sleep(args.ready_delay)
        await websocket.send('{"type":"wake"}')

        chunk_bytes = sample_rate * 2 // 50
        silence = b"\0" * chunk_bytes
        for _ in range(10):
            await websocket.send(silence)
            await asyncio.sleep(0.02)
        for offset in range(0, len(pcm), chunk_bytes):
            await websocket.send(pcm[offset : offset + chunk_bytes])
            await asyncio.sleep(0.02)
        for _ in range(60):
            await websocket.send(silence)
            await asyncio.sleep(0.02)

        while time.monotonic() - started < args.timeout:
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=1.0)
            except TimeoutError:
                if binary_bytes and phases and phases[-1] in {"listening", "thanks", "idle"}:
                    break
                continue

            if isinstance(message, bytes):
                binary_bytes += len(message)
                continue

            payload = json.loads(message)
            if payload.get("type") == "phase":
                phases.append(str(payload.get("phase") or ""))
            elif payload.get("type") == "transcript":
                text = base64.b64decode(payload.get("text_b64") or "").decode(
                    "utf-8",
                    errors="replace",
                )
                transcripts.append((str(payload.get("role") or ""), text))
            elif payload.get("type") == "error":
                raise RuntimeError(
                    f"backend error: {payload.get('code')}: {payload.get('message')}"
                )

    print(
        json.dumps(
            {
                "phases": phases,
                "transcripts": transcripts,
                "output_audio_bytes": binary_bytes,
            },
            ensure_ascii=False,
        )
    )
    return 0 if binary_bytes and any(role == "user" for role, _ in transcripts) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_run(_arguments())))
