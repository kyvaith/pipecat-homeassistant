"""Optional WAV capture helpers for Pipecat voice-session debugging."""

from __future__ import annotations

import json
import re
import secrets
import wave
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from loguru import logger

from pipecat.frames.frames import Frame, InputAudioRawFrame, OutputAudioRawFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from app.config import DATA_DIR, FlowConfig, RuntimeConfig

AUDIO_DEBUG_DIR = DATA_DIR / "audio-debug"
_SAFE_FILENAME = re.compile(r"^[A-Za-z0-9_.-]+$")
_WAV_SAMPLE_WIDTH_BYTES = 2


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip()).strip("-")
    return slug or "flow"


class WavAudioRecorder(FrameProcessor):
    """Frame processor that mirrors raw Pipecat audio frames into a WAV file."""

    def __init__(self, frame_type: type[Frame], path: Path, label: str):
        super().__init__()
        self._frame_type = frame_type
        self.path = path
        self.label = label
        self.bytes_written = 0
        self.frames_written = 0
        self.sample_rate: int | None = None
        self.num_channels: int | None = None
        self._writer: wave.Wave_write | None = None
        self._disabled = False
        self._format_warning_logged = False
        self._write_warning_logged = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, self._frame_type):
            self._write_frame(frame)
        await self.push_frame(frame, direction)

    def close(self) -> None:
        if not self._writer:
            return
        try:
            self._writer.close()
        except Exception as err:
            logger.warning("Audio debug {} recorder close failed: {}", self.label, err)
        finally:
            self._writer = None

    def info(self) -> dict[str, Any]:
        return {
            "filename": self.path.name,
            "bytes": self.bytes_written,
            "frames": self.frames_written,
            "sample_rate": self.sample_rate,
            "num_channels": self.num_channels,
        }

    def _ensure_writer(self, frame: InputAudioRawFrame | OutputAudioRawFrame):
        sample_rate = int(getattr(frame, "sample_rate", 0) or 0)
        num_channels = int(getattr(frame, "num_channels", 0) or 0)
        if sample_rate <= 0 or num_channels <= 0:
            return None

        if self._writer:
            if (
                sample_rate != self.sample_rate
                or num_channels != self.num_channels
            ) and not self._format_warning_logged:
                logger.warning(
                    "Audio debug {} format changed from {}Hz/{}ch to {}Hz/{}ch; "
                    "continuing the original WAV stream",
                    self.label,
                    self.sample_rate,
                    self.num_channels,
                    sample_rate,
                    num_channels,
                )
                self._format_warning_logged = True
            return self._writer

        self.path.parent.mkdir(parents=True, exist_ok=True)
        writer = wave.open(str(self.path), "wb")
        writer.setnchannels(num_channels)
        writer.setsampwidth(_WAV_SAMPLE_WIDTH_BYTES)
        writer.setframerate(sample_rate)
        self._writer = writer
        self.sample_rate = sample_rate
        self.num_channels = num_channels
        return writer

    def _write_frame(self, frame: InputAudioRawFrame | OutputAudioRawFrame) -> None:
        if self._disabled:
            return
        audio = getattr(frame, "audio", b"")
        if not audio:
            return
        try:
            writer = self._ensure_writer(frame)
            if not writer:
                return
            writer.writeframes(audio)
            self.bytes_written += len(audio)
            self.frames_written += 1
        except Exception as err:
            self._disabled = True
            if not self._write_warning_logged:
                logger.warning("Audio debug {} recorder write failed: {}", self.label, err)
                self._write_warning_logged = True


@dataclass
class AudioDebugSession:
    id: str
    metadata_path: Path
    metadata: dict[str, Any]
    input_recorder: WavAudioRecorder
    output_recorder: WavAudioRecorder

    def write_metadata(self) -> None:
        self.metadata_path.parent.mkdir(parents=True, exist_ok=True)
        with self.metadata_path.open("w", encoding="utf-8") as file:
            json.dump(self.metadata, file, indent=2, sort_keys=True)
            file.write("\n")

    def close(self) -> None:
        self.input_recorder.close()
        self.output_recorder.close()
        self.metadata["finished_at"] = _utc_now()
        self.metadata["files"] = {
            "input": self.input_recorder.info(),
            "output": self.output_recorder.info(),
        }
        self.write_metadata()


def create_audio_debug_session(
    config: RuntimeConfig,
    flow: FlowConfig,
    provider_kind: str,
    realtime_model: str,
) -> AudioDebugSession | None:
    if not config.audio_debug_enabled:
        return None

    session_id = f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}_{_slug(flow.id)}_{secrets.token_hex(4)}"
    metadata = {
        "id": session_id,
        "started_at": _utc_now(),
        "flow_id": flow.id,
        "flow_name": flow.name,
        "provider": provider_kind,
        "model": realtime_model,
    }
    session = AudioDebugSession(
        id=session_id,
        metadata_path=AUDIO_DEBUG_DIR / f"{session_id}.json",
        metadata=metadata,
        input_recorder=WavAudioRecorder(
            InputAudioRawFrame,
            AUDIO_DEBUG_DIR / f"{session_id}_input.wav",
            "input",
        ),
        output_recorder=WavAudioRecorder(
            OutputAudioRawFrame,
            AUDIO_DEBUG_DIR / f"{session_id}_output.wav",
            "output",
        ),
    )
    session.write_metadata()
    cleanup_audio_recordings(config.audio_debug_keep_sessions)
    logger.info("Audio debug recording enabled for session {}", session_id)
    return session


def audio_debug_file_path(filename: str) -> Path:
    if not _SAFE_FILENAME.fullmatch(filename) or Path(filename).name != filename:
        raise ValueError("Invalid audio debug filename")
    path = (AUDIO_DEBUG_DIR / filename).resolve()
    root = AUDIO_DEBUG_DIR.resolve()
    try:
        path.relative_to(root)
    except ValueError as err:
        raise ValueError("Invalid audio debug filename") from err
    if path.suffix.lower() != ".wav":
        raise ValueError("Invalid audio debug file type")
    return path


def clear_audio_recordings() -> None:
    if not AUDIO_DEBUG_DIR.exists():
        return
    for path in AUDIO_DEBUG_DIR.iterdir():
        if path.is_file() and path.suffix.lower() in {".json", ".wav"}:
            path.unlink(missing_ok=True)


def cleanup_audio_recordings(keep_sessions: int) -> None:
    if not AUDIO_DEBUG_DIR.exists():
        return
    keep_sessions = max(1, int(keep_sessions or 1))
    records = _metadata_records()
    for record in records[keep_sessions:]:
        session_id = record.get("id") or Path(record.get("_metadata_file", "")).stem
        _delete_session_files(session_id, record.get("_metadata_file"))


def list_audio_recordings() -> list[dict[str, Any]]:
    records = _metadata_records()
    return [_public_record(record) for record in records]


def _metadata_records() -> list[dict[str, Any]]:
    if not AUDIO_DEBUG_DIR.exists():
        return []
    records: list[dict[str, Any]] = []
    for path in AUDIO_DEBUG_DIR.glob("*.json"):
        try:
            with path.open("r", encoding="utf-8") as file:
                record = json.load(file)
        except Exception as err:
            logger.warning("Ignoring unreadable audio debug metadata {}: {}", path.name, err)
            continue
        record["_metadata_file"] = str(path)
        record.setdefault("id", path.stem)
        records.append(record)
    return sorted(records, key=lambda item: item.get("started_at", ""), reverse=True)


def _public_record(record: dict[str, Any]) -> dict[str, Any]:
    session_id = str(record.get("id") or "")
    return {
        "id": session_id,
        "started_at": record.get("started_at"),
        "finished_at": record.get("finished_at"),
        "flow_id": record.get("flow_id"),
        "flow_name": record.get("flow_name"),
        "provider": record.get("provider"),
        "model": record.get("model"),
        "input": _public_file(AUDIO_DEBUG_DIR / f"{session_id}_input.wav"),
        "output": _public_file(AUDIO_DEBUG_DIR / f"{session_id}_output.wav"),
    }


def _public_file(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    stat = path.stat()
    return {
        "filename": path.name,
        "size": stat.st_size,
        "url": f"api/assist/debug/audio/{path.name}",
    }


def _delete_session_files(session_id: str, metadata_file: str | None = None) -> None:
    if not session_id:
        return
    for suffix in (".json", "_input.wav", "_output.wav"):
        (AUDIO_DEBUG_DIR / f"{session_id}{suffix}").unlink(missing_ok=True)
    if metadata_file:
        Path(metadata_file).unlink(missing_ok=True)
