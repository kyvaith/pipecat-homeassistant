#pragma once

#include "esphome/core/component.h"
#include "esphome/components/microphone/microphone_source.h"
#include "esphome/components/speaker/speaker.h"

#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

namespace esphome {
namespace va_pipecat {

class OnPhaseTrigger;
class OnTranscriptTrigger;
class OnRepeatedFailureTrigger;
class OnFollowupOpenedTrigger;
class OnErrorTrigger;

class VaPipecat : public Component {
 public:
  void set_url(const std::string &url);
  void set_microphone_source(microphone::MicrophoneSource *m) { mic_source_ = m; }
  void set_speaker(speaker::Speaker *s) { speaker_ = s; }
  // When enabled, microphone audio continues through thinking and speaking so
  // Pipecat VAD can detect barge-in. Use a microphone path with suitable AEC.
  void set_barge_in(bool v) { barge_in_ = v; }
  void set_playback_buffer_size(size_t bytes) { audio_buf_bytes_ = bytes; }
  // Sets the output-volume multiplier applied to TTS in handle_binary_.
  // Driven from yaml by external_media_player's volume / mute state so the
  // device's physical +/- buttons and mute switch scale our TTS the same
  // way they scale chime announcements played through media_player. (No
  // HA api: block on this firmware — there's no remote slider.) Range
  // [0, 1]; values are clamped on read so callers don't have to bounds-check.
  void set_volume(float v) { volume_ = v; }
  void add_on_phase_trigger(OnPhaseTrigger *t) { phase_triggers_.push_back(t); }
  void add_on_transcript_trigger(OnTranscriptTrigger *t) { transcript_triggers_.push_back(t); }
  void add_on_repeated_failure_trigger(OnRepeatedFailureTrigger *t) {
    repeated_failure_triggers_.push_back(t);
  }
  void add_on_followup_opened_trigger(OnFollowupOpenedTrigger *t) {
    followup_opened_triggers_.push_back(t);
  }
  void add_on_error_trigger(OnErrorTrigger *t) { error_triggers_.push_back(t); }

  bool is_connected() const { return ws_connected_; }

  // Delay (ms) the yaml wake handler waits after the wake chime before opening
  // the mic, so the chime's i2s/DAC tail can't leak into the fresh mic and
  // become a ghost turn. Pushed from the backend `hello` (wake_open_delay_ms);
  // the wake automation reads it via `- delay: !lambda`. Defaults to the safe
  // kWakeOpenDelayMs so an old backend (no key) still behaves sensibly.
  uint32_t get_wake_open_delay_ms() const { return wake_open_delay_ms_; }

  void setup() override;
  void dump_config() override;
  void loop() override;
  float get_setup_priority() const override { return setup_priority::AFTER_WIFI; }

  // YAML-callable actions.
  void start_session();
  void send_interrupt();
  void end_session();
  // Called from yaml's on_followup_opened automation AFTER the chime has
  // finished announcing through the speaker (wait_until !is_announcing +
  // i2s tail). Opens the mic for kRequestFollowUpMs. No-op if the device
  // is no longer armed (e.g. user already pressed wake before the chime
  // finished — the new session takes priority).
  void commit_followup_mic();
  bool turn_has_reply_audio() const { return this->turn_t_first_audio_out_ != 0; }

  // Called from the static esp-idf event handler trampoline.
  void on_ws_event(int32_t event_id, void *event_data);

 protected:
  void connect_();
  void schedule_reconnect_();
  void on_mic_data_(const std::vector<uint8_t> &samples);
  bool ensure_playback_speaker_ready_();
  bool drain_audio_();
  void audio_task_();
  void mic_tx_task_();
  void mic_tx_push_(const uint8_t *data, size_t len);
  size_t mic_tx_pop_(uint8_t *out, size_t max_len);
  void mic_tx_clear_();
  // Tell the backend to drop incomplete microphone input when a follow-up
  // window closes before a complete utterance.
  void send_mic_flush_();
  // Tell the backend a fresh wake started ({"type":"wake"}), for the
  // dangling-VAD guard: a server-VAD end-of-turn before the user speaks is a
  // stale pre-wake segment → backend suppresses its thinking + cancels its
  // garbage response. Sent on every start_session(); old backends ignore it.
  void send_wake_();
  void handle_text_(const char *data, size_t len);
  void handle_binary_(const uint8_t *data, size_t len);
  void queue_followup_listening_();
  void queue_terminal_thanks_();
  void handle_server_interrupt_(const std::string &reason);
  size_t flush_playback_queue_();
  void cancel_turn_(const char *message_type);
  void set_phase_(const std::string &phase);
  void set_streaming_(bool enabled);
  // Marshal a phase-LED trigger fire onto the main loop (used to drive the LED
  // ring to `listening`/`idle` from timer callbacks during the follow-up window,
  // independently of a server-sent phase).
  void fire_phase_led_(const std::string &phase);
  void fire_transcript_(const std::string &role, const std::string &text);
  void fire_error_(const std::string &code, const std::string &message);
  void open_followup_window_(uint32_t duration_ms);
  int ws_send_text_(const char *data, int len, TickType_t timeout);
  int ws_send_bin_(const char *data, int len, TickType_t timeout);

  static constexpr TickType_t kWsControlSendTimeout = pdMS_TO_TICKS(250);
  static constexpr TickType_t kWsMicSendTimeout = pdMS_TO_TICKS(10);

  std::string url_;
  microphone::MicrophoneSource *mic_source_{nullptr};
  speaker::Speaker *speaker_{nullptr};
  TaskHandle_t audio_task_handle_{nullptr};
  TaskHandle_t mic_tx_task_handle_{nullptr};

  // esp_websocket_client_handle_t kept opaque to avoid leaking esp-idf into the header.
  void *ws_handle_{nullptr};
  bool ws_connected_{false};
  bool setup_complete_{false};
  SemaphoreHandle_t ws_send_mutex_{nullptr};

  uint32_t reconnect_delay_ms_{1000};
  // Set when a reconnect timer is in flight. esp_websocket_client emits both
  // DISCONNECTED and CLOSED (and sometimes ERROR) per failure; without this
  // guard we'd double-bump the backoff delay and double-log.
  bool reconnect_pending_{false};

  // Server-driven phase, stored as an atomic enum. set_phase_ WRITES it on
  // the WS task while start_session() (main loop) READS it for the residual-
  // reply check — as a std::string that was a cross-task data race (benign in
  // practice thanks to SSO, but UB). The yaml trigger path still receives the
  // phase as a string parameter; only this cross-task state is an enum.
  enum class Phase : uint8_t { IDLE = 0, LISTENING, THINKING, REPLYING, THANKS };
  static Phase phase_from_string_(const std::string &phase);
  static const char *phase_name_(Phase p);
  std::atomic<uint8_t> current_phase_{static_cast<uint8_t>(Phase::IDLE)};
  std::vector<OnPhaseTrigger *> phase_triggers_;
  std::vector<OnTranscriptTrigger *> transcript_triggers_;
  std::vector<OnRepeatedFailureTrigger *> repeated_failure_triggers_;
  std::vector<OnFollowupOpenedTrigger *> followup_opened_triggers_;
  std::vector<OnErrorTrigger *> error_triggers_;

  // Counts consecutive failed reconnect attempts. Reset to 0 on a clean
  // WS_CONNECTED event. When it hits kRepeatedFailureThreshold we fire the
  // on_repeated_failure trigger exactly once (until the count resets) — yaml
  // plays an audible error chime so the user knows the link is dead.
  uint32_t consecutive_failures_{0};
  bool repeated_failure_fired_{false};
  static constexpr uint32_t kRepeatedFailureThreshold = 5;
  // Don't reset the failure counter/flag the moment WS reconnects — a
  // flapping link (connect → 2 s later disconnect → 5 more fails → another
  // chime) would spam the user. Require kStableConnectionMs of unbroken
  // uptime before declaring "we're properly back" and re-arming the chime.
  static constexpr uint32_t kStableConnectionMs = 30000;

  // WebSocket-task-owned scratch buffer used for TTS volume scaling.
  std::vector<int16_t> tts_buf_;

  // Streaming gate. True while the mic should be forwarded to the server:
  //   - between wake-word start_session() and "listening"/"thinking"
  //   - and again after "idle" for kFollowupMs (in case AI asked a question)
  bool streaming_{false};
  // Handsfree barge-in toggle, set from yaml (`barge_in:`). See set_barge_in().
  bool barge_in_{true};
  // Set on phase=idle when there's still TTS audio queued — we can't open
  // the mic until the speaker drains, otherwise it picks up its own output.
  // loop() flips this to a live followup window once audio_fill_ hits 0.
  bool followup_pending_{false};
  // A terminal Pipecat response must remain in `speaking` until the PCM ring
  // and downstream speaker buffers have actually drained.
  bool thanks_pending_{false};
  // Small ordering guard for a control frame received immediately after the
  // final PCM frame on the websocket task.
  uint32_t post_playback_not_before_ms_{0};
  // Tracks whether the pending follow-up was requested by the server's
  // request_follow_up tool (model asked a question) vs the natural
  // post-reply path. The former wants a longer mic window
  // (kRequestFollowUpMs); the latter uses kFollowupMs (which is 0 by
  // default — no auto-follow-up).
  bool request_follow_up_pending_{false};
  // Set when on_followup_opened has fired and we're waiting on yaml to
  // play the chime + call commit_followup_mic(). Cleared on commit or
  // when a new session preempts. Without this flag a stale
  // commit_followup_mic() call (e.g. delayed lambda after a `Stop` wake
  // word already reset state) would re-open the mic out of nowhere.
  bool followup_armed_{false};
  // Server state can finish before locally buffered PCM has played. If we fire
  // the UI trigger immediately while audio remains in PSRAM and downstream
  // trigger immediately the device looks idle while still speaking. Hold
  // the "idle" emission until the queue drains + kFollowupOpenDelayMs.
  bool idle_emit_pending_{false};
  // Set by send_interrupt() so the phase=idle that follows from the server
  // doesn't trigger a follow-up mic window. The user explicitly asked us to
  // stop — they don't want the device sitting there listening.
  bool suppress_followup_{false};
  // Set by send_interrupt() ("stop" word / barge-in). The backend may produce a
  // reply faster than real-time, so by the time the user says "stop" the audio
  // is already buffered (backend + our PSRAM) and the backend keeps streaming
  // the rest. Flushing our queue isn't enough — handle_binary_ just refills it
  // from the in-flight frames. While this is true we DROP incoming audio so the
  // cancelled reply actually goes silent. Cleared in set_phase_ on the next
  // "idle" (reply ended) or "listening" (a fresh turn's audio is legitimate).
  bool suppress_incoming_audio_{false};
  // Set by send_interrupt() (a local "stop"), cleared in start_session() (the
  // next wake). After a stop the mic gate is CLOSED, so no new turn can begin
  // until a wake — yet server VAD can still fire an end-of-turn for
  // the utterance we just cancelled, which the backend turns into a `thinking`
  // phase. Acting on that strands the LED in `thinking` until the backend's
  // 15 s watchdog (observed live 2026-06-14: "stop" mid-question -> 15 s stuck
  // thinking). While this is true, set_phase_ IGNORES `thinking` — it can only
  // be the stale tail of the cancelled turn (a legitimate `thinking` is always
  // preceded by a wake, which clears this). Scoped to `thinking` only: a web
  // search's replying->thinking has no stop so this stays false (don't break
  // the search animation), and a reply-drain emits no `thinking` (mic gated).
  bool post_stop_guard_{false};
  // Live duration (ms) of the post-reply follow-up window: how long the mic
  // stays open after the assistant finishes so the user can answer back
  // WITHOUT re-saying the wake word. Pushed from the backend add-on in the
  // `hello` handshake (`"follow_up_ms":N`) so it's tunable from the add-on
  // config without reflashing; 0 = disabled (turn-based, mic closes after each
  // reply). Clamped to kFollowupMsMax on parse. The window only opens AFTER the
  // speaker chain drains + kFollowupOpenDelayMs so the assistant's own TTS tail
  // cannot leak into the newly opened microphone path.
  uint32_t followup_ms_{0};
  static constexpr uint32_t kFollowupMsMax = 60000;
  // Live delay (ms) between the speaker draining and the follow-up mic opening,
  // also pushed from the backend `hello` ("follow_up_open_delay_ms":N). Covers
  // the i2s ring + DAC tail that plays out after has_buffered_data() goes false,
  // so the mic doesn't catch the reply's own tail. Defaults to the conservative
  // kFollowupOpenDelayMs but is tunable from the add-on (lower = snappier, risk
  // of hearing the tail; higher = safer). Clamped to kFollowupOpenDelayMaxMs.
  uint32_t followup_open_delay_ms_{kFollowupOpenDelayMs};
  static constexpr uint32_t kFollowupOpenDelayMaxMs = 5000;
  // Wake-chime echo guard: delay (ms) the yaml wake handler waits after the
  // wake chime before opening the mic. The wake-path twin of
  // followup_open_delay_ms_ (the follow-up boundary). Pushed from the backend
  // `hello` ("wake_open_delay_ms":N); read by yaml via get_wake_open_delay_ms().
  // Default 700 matches the backend default so a device on an old backend (no
  // key in hello) still gets the safe value rather than the old hardcoded 400.
  static constexpr uint32_t kWakeOpenDelayMs = 700;
  uint32_t wake_open_delay_ms_{kWakeOpenDelayMs};
  // Playback jitter buffer ("prebuffer"). Before starting/resuming playback we
  // hold audio in the PSRAM ring until at least this many ms have accumulated
  // (or a short deadline elapses), so the downstream resampler/mixer/i2s chain
  // starts with a cushion and a network jitter gap (we see 100-340 ms gaps)
  // doesn't dry it out → audible crackle. Pushed from the backend `hello`
  // ("playback_prebuffer_ms":N) so it's tunable without reflashing; clamped to
  // kPlaybackPrebufferMaxMs. Defaults to 300 ms; 0 from the backend disables it
  // and plays immediately.
  // Re-armed whenever the ring drains to empty (reply start AND post-underflow).
  uint32_t playback_prebuffer_ms_{300};
  static constexpr uint32_t kPlaybackPrebufferMaxMs = 2000;
  static constexpr uint32_t kPlaybackSampleRate = 24000;  // incoming TTS PCM rate
  // True while we're accumulating the prebuffer cushion (holding playback).
  // Touched by handle_binary_ (WS task, arms it) + loop() (main task, releases);
  // plain flag like streaming_, the tiny race is harmless.
  bool playback_priming_{false};
  // millis() when priming started (first byte after the ring was empty); used
  // for the prime deadline so real-time (non-burst) audio still starts promptly.
  uint32_t prime_started_ms_{0};

  // Resampler cold-start SILENCE-PRIME (crackle fix). The resampler does NOT
  // idle-timeout (verified vs ESPHome source): resample(stop_gracefully=false)
  // never returns FINISHED and its output mixer-source is timeout:never, so the
  // chain stays WARM between normal replies. It goes COLD only after an explicit
  // `speaker.stop: media_resampling_speaker` (yaml interrupt / "stop" / wake /
  // follow-up), which tears the task down (is_stopped()==true). The next reply
  // then cold-starts a fresh AudioResampler whose windowed-sinc FIR begins from a
  // zero state → a startup-transient click. A PSRAM prebuffer can't fix it (the
  // transient is downstream of the ring). Fix: when cold, feed kChainPrimeMs of
  // SILENCE first so the FIR settles to a clean zero output before real audio.
  // Cold = resampler is_stopped() (precise, true exactly post-speaker.stop) OR,
  // as a backup, nothing fed for > kChainColdMs. Both are only ever true at a
  // real cold reply-start, never mid-speech; a needless prime on a warm chain is
  // harmless (60ms silence).
  static constexpr uint32_t kChainPrimeMs = 60;   // silence burst to warm the filter
  static constexpr uint32_t kChainColdMs = 600;   // backup timer; is_stopped() is the primary signal
  // Bytes of silence still to feed this cold-start (24kHz mono 16-bit). >0 while
  // priming; loop() feeds silence and holds real-audio drain until it reaches 0.
  size_t chain_prime_remaining_{0};
  // millis() of the last time we fed the resampler ANYTHING (silence or real).
  // Used to detect a cold chain: now - last_fed_ms_ > kChainColdMs. 0 = never fed.
  uint32_t last_fed_ms_{0};
  // Legacy compile-time default, kept for reference. The live value now comes
  // from the backend (followup_ms_); this stays 0 so a device talking to an
  // old backend that doesn't send follow_up_ms keeps the turn-based behaviour.
  static constexpr uint32_t kFollowupMs = 0;
  // Used when the server explicitly requests a follow-up via the
  // request_follow_up tool — overrides kFollowupMs for a single turn.
  // Longer than the default because the model asked a real question
  // and the user might pause before answering.
  static constexpr uint32_t kRequestFollowUpMs = 10000;
  // After start_session() we wait this long for the server to emit
  // phase=listening (i.e. server VAD heard speech). If nothing comes, the
  // user pressed wake/button and stayed silent — close the session so we
  // do not leave a provider session streaming an empty room.
  static constexpr uint32_t kNoSpeechTimeoutMs = 7000;
  // After our PSRAM queue drains there's still audio in flight:
  //   resampler ring 4800 B (≈ 50 ms)
  //   mixer source buffer 100 ms
  //   i2s_audio_speaker buffer_duration 500 ms
  //   AEC / DAC analog tail ≈ 100 ms
  // Sum ≈ 750 ms. We add headroom so a slow drain doesn't leak TTS into
  // the mic. Hardware and acoustic tails vary by device, so this remains a
  // conservative upper bound that can be overridden by the server handshake.
  static constexpr uint32_t kFollowupOpenDelayMs = 1500;
  // Hard ceiling on how long we'll wait for the speaker chain to drain
  // (resampler ring + mixer source ring, via has_buffered_data()) after
  // PSRAM hits 0 before giving up and proceeding anyway. Should be >
  // the worst-case downstream buffer (resampler + mixer source ~150 ms,
  // plus play-out time of whatever was in flight) by a comfortable
  // margin, but short enough that a wedged speaker doesn't lock the
  // LED in `replying` forever.
  static constexpr uint32_t kSpeakerStopTimeoutMs = 3000;

  // True while we're waiting for the downstream speaker chain to actually
  // finish playing the TTS we wrote into it. Entered when audio_fill_
  // hits 0 with followup_pending_ set; exited when
  // !speaker_->has_buffered_data() OR kSpeakerStopTimeoutMs elapses.
  bool waiting_for_speaker_stop_{false};
  // millis() snapshot from when waiting_for_speaker_stop_ went true.
  // Used to fire the fallback timeout if the chain never drains.
  uint32_t speaker_stop_wait_started_ms_{0};

  // Tracks the opcode of the in-flight WS message so we can route
  // continuation frames (op_code = 0) to the same handler.
  bool last_data_was_binary_{false};

  // Output volume multiplier in [0, 1], updated from yaml whenever
  // external_media_player.volume / mute changes. Defaults to 1.0 so a
  // stand-alone va_pipecat (no media_player wiring) still plays audibly.
  float volume_{1.0f};

  // Ring buffer for pending TTS audio, allocated in PSRAM. The server can
  // burst the entire response in ~200 ms; we buffer here and drain into
  // speaker.play() from audio_task_ so main-loop LVGL/artwork work cannot
  // starve playback.
  //
  // 2 MB / (24000 Hz × 2 B) ≈ 43 s of headroom. The size is configurable to
  // match the target's PSRAM budget.
  uint8_t *audio_buf_{nullptr};
  size_t audio_buf_bytes_{2 * 1024 * 1024};
  size_t audio_head_{0};  // read pos (next byte to play)
  size_t audio_tail_{0};  // write pos (next byte to fill)
  uint32_t audio_generation_{0};  // increments on queue flush to detect stale drain-task snapshots
  size_t audio_fill_{0};  // bytes currently queued (audio_tail_ ≥ audio_head_ when not wrapped)
  // ESP32-S3 is dual-core: handle_binary_ runs in the esp-idf
  // websocket task (background) while loop() runs in the main app task,
  // typically on the other core. Both touch audio_head_/tail_/fill_
  // and the PSRAM data they index; without sync we hit races where
  // fill_ goes inconsistent, the reader sees the new tail before the
  // memcpy is visible, or two non-atomic increments lose each other.
  // The DAC then plays whatever bytes happened to be at those PSRAM
  // offsets — audible as "speech drops into hiss" mid-utterance.
  // portMUX is the cheapest cross-core primitive: a spinlock that
  // also masks interrupts on the holding core. Critical sections
  // are tiny (a few field updates + ≤2 memcpys of at most a few KB
  // per WS frame), so contention is negligible.
  portMUX_TYPE ring_mux_ = portMUX_INITIALIZER_UNLOCKED;

  // Per-turn latency anchors (millis()-relative). Captured at each state
  // transition; flushed as one summary line when the deferred phase=idle
  // emit fires (i.e. when the speaker has actually drained). Zero means
  // "not yet hit this milestone this turn".
  uint32_t turn_t_wake_{0};               // start_session() (wake-word handler)
  uint32_t turn_t_listening_{0};          // server's first phase=listening
  uint32_t turn_t_thinking_{0};           // server's phase=thinking (end-of-speech)
  uint32_t turn_t_first_audio_out_{0};    // first binary chunk arrived from server

  // Diagnostics for the "speech sometimes drops into hiss / noise"
  // symptom. We don't know the cause yet, so we measure three things
  // simultaneously and let the logs tell us which one (if any) fires
  // during a bad reply.
  //
  //  1) WS frame inter-arrival time. If the bridge stalls and audio
  //     arrives in bursts with > kWsGapWarnMs silence between, the
  //     downstream chain may underrun and inject silence/noise. We log
  //     each large gap with the duration and how full the PSRAM ring
  //     was at the time.
  //  2) TTS clipping. Software gain is disabled, so clipping is
  //     mathematically impossible while volume_ ≤ 1. Counter stays as
  //     a tripwire — if anyone reintroduces a >1 scale factor, the
  //     per-turn summary will surface it before users hear the rasp.
  //  3) Downstream underrun. speaker_->has_buffered_data() = false
  //     while audio_fill_ > 0 means the resampler/mixer/i2s chain ran
  //     dry while we still had PSRAM to feed it — bug or stall in the
  //     downstream side. We log the first underrun per reply.
  static constexpr uint32_t kThanksDisplayMs = 1200;
  uint32_t last_binary_ms_{0};
  uint32_t ws_gap_count_{0};       // # gaps > kWsGapWarnMs in this turn
  uint32_t ws_gap_max_ms_{0};      // largest gap observed this turn
  uint32_t clipped_samples_{0};    // clipped samples in this turn
  bool underrun_logged_this_turn_{false};
  static constexpr uint32_t kWsGapWarnMs = 80;  // > ~3× normal 20 ms frame

  // Realtime microphone uplink diagnostics. These run on the mic callback path
  // and tell us whether the backend is receiving real post-AEC samples or an
  // empty/silent stream.
  uint32_t mic_stream_started_ms_{0};
  uint32_t mic_last_frame_ms_{0};
  uint32_t mic_no_frame_warn_ms_{0};
  uint32_t mic_stats_last_ms_{0};
  uint32_t mic_frames_this_sec_{0};
  uint32_t mic_bytes_this_sec_{0};
  uint32_t mic_send_failures_this_sec_{0};
  uint32_t mic_max_abs_this_sec_{0};

  // Microphone uplink staging ring. The microphone callback must never wait on
  // Wi-Fi/websocket locks; it only copies PCM16 into this ring. A dedicated task
  // drains it to esp_websocket_client, so brief network stalls don't cut holes
  // in the post-AEC microphone stream. The producer still keeps the queued
  // window small: realtime speech is more useful than seconds-old backlog.
  uint8_t *mic_tx_buf_{nullptr};
  static constexpr size_t kMicTxBufBytes = 128 * 1024;
  static constexpr size_t kMicTxMaxQueuedBytes = 16 * 1024;
  static constexpr size_t kMicTxChunkBytes = 1280;  // 40 ms at 16 kHz mono PCM16
  size_t mic_tx_head_{0};
  size_t mic_tx_tail_{0};
  size_t mic_tx_fill_{0};
  uint32_t mic_tx_dropped_bytes_this_sec_{0};
  portMUX_TYPE mic_tx_mux_ = portMUX_INITIALIZER_UNLOCKED;
};

}  // namespace va_pipecat
}  // namespace esphome
