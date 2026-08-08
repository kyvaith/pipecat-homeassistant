"""Versioned wire protocol shared by Pipecat Assist and ESPHome satellites."""

from __future__ import annotations

import base64
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

PROTOCOL_NAME = "va-pipecat"
PROTOCOL_VERSION = 1
USER_PHRASE_WORDS = 4
ASSISTANT_PHRASE_WORDS = 6


def _compact_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _encoded_text(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _normalize_text(text: str) -> str:
    return " ".join(text.split())


def _merge_stream_text(previous: str, fragment: str) -> str:
    """Merge cumulative and tokenized transcript events without duplication."""

    previous = _normalize_text(previous)
    fragment = _normalize_text(fragment)
    if not fragment:
        return previous
    if not previous or fragment.startswith(previous):
        return fragment
    if previous.startswith(fragment) or previous.endswith(fragment):
        return previous

    max_overlap = min(len(previous), len(fragment))
    for overlap in range(max_overlap, 0, -1):
        if previous[-overlap:] == fragment[:overlap]:
            return previous + fragment[overlap:]

    separator = "" if fragment[0] in ",.;:!?)]}" else " "
    return previous + separator + fragment


def _phrase_ready(text: str, emitted: str, word_limit: int) -> bool:
    if not text or text == emitted:
        return False
    if text.rstrip().endswith((".", "!", "?", ";", ":", "\n")):
        return True
    return len(text.split()) - len(emitted.split()) >= word_limit


@dataclass
class VaPipecatProtocol:
    """Track one ESPHome conversation and translate RTVI events to compact JSON."""

    should_end_conversation: Callable[..., bool]
    input_sample_rate: int = 16000
    output_sample_rate: int = 24000
    channels: int = 1
    follow_up_ms: int = 30000
    follow_up_open_delay_ms: int = 80
    wake_open_delay_ms: int = 0
    playback_prebuffer_ms: int = 300
    turn_id: int = 0
    active: bool = False
    stop_requested: bool = False
    current_phase: str = "idle"
    last_user_text: str = ""
    user_text: str = ""
    user_emitted_text: str = ""
    assistant_segments: list[str] = field(default_factory=list)
    assistant_text: str = ""
    assistant_emitted_text: str = ""
    assistant_priority: int = 0
    active_tool_calls: set[str] = field(default_factory=set)
    tool_start_pending: bool = False

    def hello(self) -> str:
        """Return the server capability handshake."""

        return _compact_json(
            {
                "type": "hello",
                "protocol": PROTOCOL_NAME,
                "version": PROTOCOL_VERSION,
                "phase": self.current_phase,
                "audio": {
                    "format": "pcm_s16le",
                    "input_sample_rate": self.input_sample_rate,
                    "output_sample_rate": self.output_sample_rate,
                    "channels": self.channels,
                },
                "capabilities": {
                    "barge_in": True,
                    "interim_transcripts": True,
                    "server_phases": True,
                },
                "follow_up_ms": self.follow_up_ms,
                "follow_up_open_delay_ms": self.follow_up_open_delay_ms,
                "wake_open_delay_ms": self.wake_open_delay_ms,
                "playback_prebuffer_ms": self.playback_prebuffer_ms,
            }
        )

    def client_action(self, payload: str) -> str:
        """Apply one device control message and return its normalized action."""

        try:
            message = json.loads(payload)
        except (TypeError, ValueError, json.JSONDecodeError):
            return "invalid"
        if not isinstance(message, dict):
            return "invalid"

        message_type = str(message.get("type") or "").strip().lower()
        if message_type in {"start", "wake"}:
            self.turn_id += 1
            self.active = True
            self.stop_requested = False
            self.current_phase = "listening"
            self.last_user_text = ""
            self.user_text = ""
            self.user_emitted_text = ""
            self.assistant_segments.clear()
            self.assistant_text = ""
            self.assistant_emitted_text = ""
            self.assistant_priority = 0
            self.active_tool_calls.clear()
            self.tool_start_pending = False
            return "wake"
        if message_type == "interrupt":
            self.stop_requested = False
            return "interrupt"
        if message_type in {"stop", "end"}:
            self.active = False
            self.stop_requested = True
            self.active_tool_calls.clear()
            self.tool_start_pending = False
            return "stop"
        if message_type == "flush":
            return "flush"
        if message_type in {"hello", "ping"}:
            return message_type
        return "unknown"

    def phase_message(self, phase: str, **extra: Any) -> str | None:
        """Return a phase transition only when it changes."""

        if phase == self.current_phase and not extra:
            return None
        self.current_phase = phase
        payload: dict[str, Any] = {
            "type": "phase",
            "phase": phase,
            "turn_id": self.turn_id,
        }
        payload.update(extra)
        return _compact_json(payload)

    def interrupt_message(self, reason: str) -> str:
        """Tell the device to drop queued assistant audio immediately."""

        return _compact_json(
            {
                "type": "interrupt",
                "reason": reason,
                "turn_id": self.turn_id,
            }
        )

    def error_message(self, code: str, message: str, recoverable: bool = True) -> str:
        """Encode an error without putting arbitrary text directly in JSON."""

        return _compact_json(
            {
                "type": "error",
                "code": code or "pipeline_error",
                "message_b64": _encoded_text(message),
                "recoverable": recoverable,
                "turn_id": self.turn_id,
            }
        )

    def transcript_message(
        self,
        role: str,
        text: str,
        final: bool,
        *,
        phase: str | None = None,
        **extra: Any,
    ) -> str | None:
        """Encode a non-empty live transcript."""

        clean = text.strip()
        if not clean:
            return None
        payload: dict[str, Any] = {
            "type": "transcript",
            "role": role,
            "final": final,
            "text_b64": _encoded_text(clean),
            "turn_id": self.turn_id,
        }
        if phase is not None:
            self.current_phase = phase
            payload["phase"] = phase
        payload.update(extra)
        return _compact_json(payload)

    def on_rtvi_message(self, message: dict[str, Any]) -> str | None:
        """Translate one RTVI observer message to the satellite protocol."""

        if message.get("label") != "rtvi-ai":
            return None

        message_type = str(message.get("type") or "")
        data = message.get("data")
        data = data if isinstance(data, dict) else {}

        if message_type in {"user-started-speaking", "vad-user-started-speaking"}:
            self.active = True
            self.stop_requested = False
            self.user_text = ""
            self.user_emitted_text = ""
            self.assistant_segments.clear()
            self.assistant_text = ""
            self.assistant_emitted_text = ""
            self.assistant_priority = 0
            return self.phase_message("listening")

        if message_type in {"user-stopped-speaking", "vad-user-stopped-speaking"}:
            return self.phase_message("thinking")

        if message_type == "user-transcription":
            self.user_text = _merge_stream_text(self.user_text, str(data.get("text") or ""))
            final = bool(data.get("final"))
            if final:
                self.last_user_text = self.user_text
            if not final and not _phrase_ready(
                self.user_text,
                self.user_emitted_text,
                USER_PHRASE_WORDS,
            ):
                return None
            if self.user_text == self.user_emitted_text:
                return None
            self.user_emitted_text = self.user_text
            return self.transcript_message("user", self.user_text, final)

        if message_type in {
            "bot-llm-started",
            "bot-tts-started",
        }:
            return self.phase_message("thinking")

        if message_type == "llm-function-call-started":
            self.tool_start_pending = True
            return self.phase_message("thinking")

        if message_type == "llm-function-call-in-progress":
            tool_call_id = str(data.get("tool_call_id") or "").strip()
            if tool_call_id:
                self.active_tool_calls.add(tool_call_id)
            self.tool_start_pending = False
            return self.phase_message("thinking")

        if message_type == "llm-function-call-stopped":
            tool_call_id = str(data.get("tool_call_id") or "").strip()
            if tool_call_id:
                self.active_tool_calls.discard(tool_call_id)
            else:
                self.active_tool_calls.clear()
            self.tool_start_pending = False
            return self.phase_message("thinking")

        if message_type == "bot-started-speaking":
            return self.phase_message("speaking")

        if message_type in {
            "bot-output",
            "bot-transcription",
            "bot-tts-text",
            "bot-llm-text",
        }:
            text = str(data.get("text") or "").strip()
            priority = {
                "bot-output": 4,
                "bot-transcription": 3,
                "bot-tts-text": 2,
                "bot-llm-text": 1,
            }[message_type]
            if not text or priority < self.assistant_priority:
                return None
            if self.assistant_segments and self.assistant_segments[-1] == text:
                return None
            self.assistant_priority = max(self.assistant_priority, priority)
            self.assistant_segments.append(text)
            self.assistant_text = _merge_stream_text(self.assistant_text, text)
            if not _phrase_ready(
                self.assistant_text,
                self.assistant_emitted_text,
                ASSISTANT_PHRASE_WORDS,
            ):
                return None
            self.assistant_emitted_text = self.assistant_text
            return self.transcript_message("assistant", self.assistant_text, False)

        if message_type == "bot-interrupted":
            self.active_tool_calls.clear()
            self.tool_start_pending = False
            if self.stop_requested:
                self.current_phase = "idle"
                return self.interrupt_message("stopped")
            self.current_phase = "listening"
            return self.interrupt_message("barge_in")

        if message_type == "bot-stopped-speaking":
            if self.active_tool_calls or self.tool_start_pending:
                return self.phase_message("thinking")
            assistant_text = self.assistant_text
            terminal = self.stop_requested or self.should_end_conversation(
                self.last_user_text,
                assistant_text,
            )
            self.active = not terminal
            self.stop_requested = False
            next_phase = "thanks" if terminal else "listening"
            phase_extra = {"terminal": True} if terminal else {"follow_up": True}
            if assistant_text and assistant_text != self.assistant_emitted_text:
                self.assistant_emitted_text = assistant_text
                return self.transcript_message(
                    "assistant",
                    assistant_text,
                    True,
                    phase=next_phase,
                    **phase_extra,
                )
            if terminal:
                return self.phase_message("thanks", terminal=True)
            return self.phase_message("listening", follow_up=True)

        if message_type in {"error", "error-response"}:
            return self.error_message(
                str(data.get("code") or message_type),
                str(data.get("message") or data.get("error") or "Pipecat pipeline error"),
            )

        return None
