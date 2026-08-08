#include "va_pipecat.h"
#include "automation.h"

#include "esphome/core/helpers.h"
#include "esphome/core/log.h"
#include "esphome/components/audio/audio.h"

#include <algorithm>
#include <cstring>

#include <esp_websocket_client.h>
#include <esp_event.h>
#include <esp_heap_caps.h>

namespace esphome {
namespace va_pipecat {

static const char *const TAG = "va_pipecat";

// Free-function trampoline. esp-idf event registration takes a C function
// pointer; we recover the VaPipecat* from the user_data slot.
static void va_ws_event_handler(void *handler_args, esp_event_base_t /*base*/, int32_t event_id, void *event_data) {
  auto *self = static_cast<VaPipecat *>(handler_args);
  if (self == nullptr)
    return;
  self->on_ws_event(event_id, event_data);
}

// Parse the unsigned integer immediately following `key` in `msg` (key includes
// the quotes + colon, e.g. "\"follow_up_ms\":"). Returns true and sets `out` if a
// run of digits was found right after the key. Keeps us out of a JSON parser for
// the few small ints the backend sends in `hello`.
static bool parse_uint_after_key(const std::string &msg, const char *key, uint32_t &out) {
  size_t p = msg.find(key);
  if (p == std::string::npos)
    return false;
  p += std::strlen(key);
  uint32_t v = 0;
  bool any = false;
  while (p < msg.size() && msg[p] >= '0' && msg[p] <= '9') {
    v = v * 10u + static_cast<uint32_t>(msg[p] - '0');
    p++;
    any = true;
  }
  if (!any)
    return false;
  out = v;
  return true;
}

static bool parse_string_after_key(const std::string &msg, const char *key, std::string &out) {
  size_t p = msg.find(key);
  if (p == std::string::npos)
    return false;
  p += std::strlen(key);
  size_t end = msg.find('"', p);
  if (end == std::string::npos)
    return false;
  out.assign(msg.data() + p, end - p);
  return true;
}

void VaPipecat::set_url(const std::string &url) {
  if (url == this->url_) {
    return;
  }
  this->url_ = url;

  if (!this->setup_complete_) {
    return;
  }

  if (this->ws_handle_ == nullptr) {
    if (!this->url_.empty()) {
      ESP_LOGI(TAG, "Pipecat endpoint configured; connecting");
      this->cancel_timeout("va_reconnect");
      this->cancel_timeout("va_stable_connection");
      this->reconnect_delay_ms_ = 1000;
      this->connect_();
    }
    return;
  }

  ESP_LOGI(TAG, "Pipecat endpoint changed; reconnecting");
  this->cancel_timeout("va_reconnect");
  this->cancel_timeout("va_stable_connection");
  this->ws_connected_ = false;
  this->reconnect_pending_ = false;
  this->reconnect_delay_ms_ = 1000;

  auto handle = static_cast<esp_websocket_client_handle_t>(this->ws_handle_);
  esp_websocket_client_stop(handle);
  esp_websocket_client_destroy(handle);
  this->ws_handle_ = nullptr;
  this->connect_();
}

void VaPipecat::provision_endpoint(std::string endpoint) {
  static constexpr size_t kMaxEndpointLength = 2048;
  if (!this->auto_provision_) {
    ESP_LOGW(TAG, "Ignoring automatic endpoint provisioning because it is disabled");
    return;
  }
  if (endpoint.empty() || endpoint.size() > kMaxEndpointLength ||
      !(endpoint.rfind("ws://", 0) == 0 || endpoint.rfind("wss://", 0) == 0)) {
    ESP_LOGW(TAG, "Rejected invalid Pipecat endpoint");
    return;
  }
  this->set_url(endpoint);
}

void VaPipecat::setup() {
  ESP_LOGCONFIG(TAG, "Setting up VA Pipecat...");

#ifdef USE_API_CUSTOM_SERVICES
  if (this->auto_provision_) {
    this->register_service(&VaPipecat::provision_endpoint, "provision_pipecat", {"endpoint"});
  }
#endif

  if (this->mic_source_ == nullptr || this->speaker_ == nullptr) {
    ESP_LOGE(TAG, "Microphone source and speaker are required");
    this->mark_failed();
    return;
  }

  this->ws_send_mutex_ = xSemaphoreCreateMutex();
  if (this->ws_send_mutex_ == nullptr) {
    ESP_LOGE(TAG, "Failed to create websocket send mutex");
    this->mark_failed();
    return;
  }

  // Keep the large full-duplex rings in external RAM so networking and audio
  // tasks retain enough internal memory.
  this->audio_buf_ = static_cast<uint8_t *>(
      heap_caps_malloc(this->audio_buf_bytes_, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (this->audio_buf_ == nullptr) {
    ESP_LOGE(TAG, "Failed to allocate %u-byte audio buffer in PSRAM",
             (unsigned) this->audio_buf_bytes_);
  } else {
    ESP_LOGCONFIG(TAG, "Allocated %u-byte audio ring buffer in PSRAM",
                  (unsigned) this->audio_buf_bytes_);
  }

  this->mic_tx_buf_ = static_cast<uint8_t *>(
      heap_caps_malloc(kMicTxBufBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (this->mic_tx_buf_ == nullptr) {
    ESP_LOGE(TAG, "Failed to allocate %u-byte mic uplink ring buffer in PSRAM", (unsigned) kMicTxBufBytes);
  } else {
    ESP_LOGCONFIG(TAG, "Allocated %u-byte mic uplink ring buffer in PSRAM", (unsigned) kMicTxBufBytes);
  }

  if (this->audio_buf_ == nullptr || this->mic_tx_buf_ == nullptr) {
    if (this->audio_buf_ != nullptr) {
      heap_caps_free(this->audio_buf_);
      this->audio_buf_ = nullptr;
    }
    if (this->mic_tx_buf_ != nullptr) {
      heap_caps_free(this->mic_tx_buf_);
      this->mic_tx_buf_ = nullptr;
    }
    vSemaphoreDelete(this->ws_send_mutex_);
    this->ws_send_mutex_ = nullptr;
    this->mark_failed();
    return;
  }

  // Tell the resampler what format we'll feed it. The resampler converts to
  // its yaml-configured output format (48k 16-bit) before passing to the
  // mixer → i2s leaf. Start the speaker task once so play() calls just push
  // into its ring buffer instead of racing to re-create the i2s channel.
  if (this->speaker_ != nullptr) {
    audio::AudioStreamInfo info(/*bits_per_sample=*/16, /*channels=*/1, /*sample_rate=*/24000);
    this->speaker_->set_audio_stream_info(info);
    this->speaker_->start();
  }

  BaseType_t task_ok = xTaskCreatePinnedToCore(
      [](void *arg) { static_cast<VaPipecat *>(arg)->audio_task_(); },
      "va_audio", 4096, this, 11, &this->audio_task_handle_, tskNO_AFFINITY);
  if (task_ok != pdPASS) {
    this->audio_task_handle_ = nullptr;
    ESP_LOGE(TAG, "Failed to start realtime audio drain task");
    this->speaker_->stop();
    heap_caps_free(this->audio_buf_);
    heap_caps_free(this->mic_tx_buf_);
    this->audio_buf_ = nullptr;
    this->mic_tx_buf_ = nullptr;
    vSemaphoreDelete(this->ws_send_mutex_);
    this->ws_send_mutex_ = nullptr;
    this->mark_failed();
    return;
  }

  task_ok = xTaskCreatePinnedToCore(
      [](void *arg) { static_cast<VaPipecat *>(arg)->mic_tx_task_(); },
      "va_mic_tx", 4096, this, 6, &this->mic_tx_task_handle_, tskNO_AFFINITY);
  if (task_ok != pdPASS) {
    this->mic_tx_task_handle_ = nullptr;
    ESP_LOGE(TAG, "Failed to start realtime mic uplink task");
    vTaskDelete(this->audio_task_handle_);
    this->audio_task_handle_ = nullptr;
    this->speaker_->stop();
    heap_caps_free(this->audio_buf_);
    heap_caps_free(this->mic_tx_buf_);
    this->audio_buf_ = nullptr;
    this->mic_tx_buf_ = nullptr;
    vSemaphoreDelete(this->ws_send_mutex_);
    this->ws_send_mutex_ = nullptr;
    this->mark_failed();
    return;
  }

  this->mic_source_->add_data_callback(
      [this](const std::vector<uint8_t> &data) { this->on_mic_data_(data); });
  this->setup_complete_ = true;
  this->connect_();
}

void VaPipecat::dump_config() {
  ESP_LOGCONFIG(TAG, "VA Pipecat:");
  ESP_LOGCONFIG(TAG, "  Endpoint: %s", this->url_.empty() ? "not configured" : "configured");
  ESP_LOGCONFIG(TAG, "  Automatic provisioning: %s", YESNO(this->auto_provision_));
  ESP_LOGCONFIG(TAG, "  Barge-in: %s", YESNO(this->barge_in_));
  ESP_LOGCONFIG(TAG, "  Playback buffer: %u bytes", (unsigned) this->audio_buf_bytes_);
  ESP_LOGCONFIG(TAG, "  Connected: %s", YESNO(this->ws_connected_));
}

int VaPipecat::ws_send_text_(const char *data, int len, TickType_t timeout) {
  auto handle = static_cast<esp_websocket_client_handle_t>(this->ws_handle_);
  if (handle == nullptr)
    return -1;

  if (this->ws_send_mutex_ != nullptr && xSemaphoreTake(this->ws_send_mutex_, timeout) != pdTRUE)
    return -1;
  const int sent = esp_websocket_client_send_text(handle, data, len, timeout);
  if (this->ws_send_mutex_ != nullptr)
    xSemaphoreGive(this->ws_send_mutex_);
  return sent;
}

int VaPipecat::ws_send_bin_(const char *data, int len, TickType_t timeout) {
  auto handle = static_cast<esp_websocket_client_handle_t>(this->ws_handle_);
  if (handle == nullptr)
    return -1;

  if (this->ws_send_mutex_ != nullptr && xSemaphoreTake(this->ws_send_mutex_, timeout) != pdTRUE)
    return -1;
  const int sent = esp_websocket_client_send_bin(handle, data, len, timeout);
  if (this->ws_send_mutex_ != nullptr)
    xSemaphoreGive(this->ws_send_mutex_);
  return sent;
}

void VaPipecat::audio_task_() {
  while (true) {
    bool did_work = false;
    for (uint8_t i = 0; i < 8; i++) {
      if (!this->drain_audio_())
        break;
      did_work = true;
    }
    vTaskDelay(pdMS_TO_TICKS(did_work ? 1 : 5));
  }
}

bool VaPipecat::ensure_playback_speaker_ready_() {
  if (this->speaker_ == nullptr)
    return false;

  const audio::AudioStreamInfo playback_info(/*bits_per_sample=*/16, /*channels=*/1,
                                             /*sample_rate=*/kPlaybackSampleRate);

  if (this->speaker_->get_audio_stream_info() != playback_info) {
    if (!this->speaker_->is_stopped()) {
      ESP_LOGD(TAG, "stopping realtime speaker before restoring 24 kHz playback format");
      this->speaker_->stop();
      this->last_fed_ms_ = 0;
      this->chain_prime_remaining_ = 0;
      return false;
    }

    ESP_LOGD(TAG, "restoring realtime speaker playback format to 24 kHz mono PCM");
    this->speaker_->set_audio_stream_info(playback_info);
    this->last_fed_ms_ = 0;
    this->chain_prime_remaining_ = 0;
  }

  if (this->speaker_->is_stopped()) {
    this->speaker_->start();
  }
  return true;
}

bool VaPipecat::drain_audio_() {
  if (this->speaker_ == nullptr || this->audio_buf_ == nullptr)
    return false;

  portENTER_CRITICAL(&this->ring_mux_);
  size_t head = this->audio_head_;
  size_t tail = this->audio_tail_;
  size_t fill = this->audio_fill_;
  uint32_t generation = this->audio_generation_;
  portEXIT_CRITICAL(&this->ring_mux_);
  if (fill == 0)
    return false;

  if (!this->ensure_playback_speaker_ready_())
    return false;

  {
    const uint32_t now_ms = millis();
    const bool resampler_cold = this->speaker_->is_stopped() || this->last_fed_ms_ == 0 ||
                                (now_ms - this->last_fed_ms_) > kChainColdMs;
    if (this->chain_prime_remaining_ == 0 && resampler_cold) {
      this->chain_prime_remaining_ =
          (size_t) kChainPrimeMs * (kPlaybackSampleRate / 1000) * 2;
      ESP_LOGD(TAG, "resampler cold — priming %u bytes of silence before reply",
               (unsigned) this->chain_prime_remaining_);
    }
    if (this->chain_prime_remaining_ > 0) {
      static const uint8_t kSilence[480] = {0};
      size_t want = std::min(this->chain_prime_remaining_, sizeof(kSilence));
      size_t fed = this->speaker_->play(kSilence, want);
      if (fed > 0) {
        this->chain_prime_remaining_ -= fed;
        this->last_fed_ms_ = now_ms;
        return true;
      }
      return false;
    }
  }

  if (this->playback_priming_) {
    const size_t target = (size_t) this->playback_prebuffer_ms_ * (kPlaybackSampleRate / 1000) * 2;
    if (fill >= target || (millis() - this->prime_started_ms_) >= this->playback_prebuffer_ms_) {
      this->playback_priming_ = false;
      ESP_LOGD(TAG, "prebuffer ready (%u bytes) — playback start", (unsigned) fill);
    } else {
      return false;
    }
  }

  if (!this->underrun_logged_this_turn_ && !this->speaker_->has_buffered_data() &&
      this->last_fed_ms_ != 0) {
    ESP_LOGW(TAG, "downstream underrun: %u bytes queued in PSRAM but speaker chain is dry",
             (unsigned) fill);
    this->underrun_logged_this_turn_ = true;
  }

  size_t contiguous = (head < tail) ? (tail - head) : (this->audio_buf_bytes_ - head);
  if (contiguous > fill)
    contiguous = fill;

  size_t accepted = this->speaker_->play(this->audio_buf_ + head, contiguous);
  if (accepted == 0)
    return false;

  this->last_fed_ms_ = millis();
  portENTER_CRITICAL(&this->ring_mux_);
  if (this->audio_generation_ == generation && this->audio_fill_ >= accepted) {
    this->audio_head_ = (this->audio_head_ + accepted) % this->audio_buf_bytes_;
    this->audio_fill_ -= accepted;
  }
  portEXIT_CRITICAL(&this->ring_mux_);

  static uint32_t dbg_last = 0;
  uint32_t now = millis();
  if (now - dbg_last >= 500) {
    ESP_LOGD(TAG, "drained %u bytes (%u still queued)", (unsigned) accepted,
             (unsigned) (fill - accepted));
    dbg_last = now;
  }
  return true;
}

void VaPipecat::mic_tx_task_() {
  uint8_t chunk[kMicTxChunkBytes];
  while (true) {
    if (!this->streaming_ || !this->ws_connected_ || this->ws_handle_ == nullptr) {
      this->mic_tx_clear_();
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }

    const size_t len = this->mic_tx_pop_(chunk, sizeof(chunk));
    if (len == 0) {
      vTaskDelay(pdMS_TO_TICKS(1));
      continue;
    }

    const int sent = this->ws_send_bin_(reinterpret_cast<const char *>(chunk), static_cast<int>(len),
                                        kWsMicSendTimeout);
    if (sent != static_cast<int>(len)) {
      this->mic_send_failures_this_sec_++;
      portENTER_CRITICAL(&this->mic_tx_mux_);
      if (this->mic_tx_fill_ > kMicTxMaxQueuedBytes) {
        const size_t drop = (this->mic_tx_fill_ - kMicTxMaxQueuedBytes) & ~static_cast<size_t>(1);
        this->mic_tx_head_ = (this->mic_tx_head_ + drop) % kMicTxBufBytes;
        this->mic_tx_fill_ -= drop;
        this->mic_tx_dropped_bytes_this_sec_ += drop;
      }
      portEXIT_CRITICAL(&this->mic_tx_mux_);
      vTaskDelay(pdMS_TO_TICKS(2));
    }
  }
}

void VaPipecat::loop() {
  this->publish_audio_levels_();

  if (this->streaming_ && this->mic_source_ != nullptr) {
    const uint32_t now = millis();
    const uint32_t last_frame = this->mic_last_frame_ms_;
    const uint32_t reference = last_frame != 0 ? last_frame : this->mic_stream_started_ms_;
    if (reference != 0 && now - reference > 1000 && now - this->mic_no_frame_warn_ms_ > 1000) {
      ESP_LOGW(TAG, "mic uplink: no frames for %u ms while streaming (source_running=%s)",
               (unsigned) (now - reference), this->mic_source_->is_running() ? "yes" : "no");
      this->mic_no_frame_warn_ms_ = now;
    }
  }

  // Audio playback is drained by audio_task_ so LVGL/artwork work in the main
  // loop cannot starve realtime TTS.
  // If a follow-up window was deferred while audio was draining, wait for
  // the downstream chain (resampler + mixer + i2s + DAC tail) to actually
  // finish playing before firing the deferred LED-idle / chime trigger.
  // Just because our PSRAM queue is empty doesn't mean the user has heard
  // the audio yet — and an "сейчас посмотрю" preamble before a tool call
  // would drain the ring mid-turn, so we can't act on audio_fill_==0
  // alone.
  //
  // Primary signal: speaker_->is_stopped(). The resampling speaker
  // transitions to STOPPED only after every byte we wrote has actually
  // gone out through the i2s pipeline.
  //
  // Fallback: kSpeakerStopTimeoutMs (3 s). If something wedges and the
  // speaker never reports STOPPED, we still progress so the LED doesn't
  // lock in `replying`.
  if ((this->followup_pending_ || this->thanks_pending_) &&
      this->audio_fill_ == 0 && !this->waiting_for_speaker_stop_ &&
      static_cast<int32_t>(millis() - this->post_playback_not_before_ms_) >= 0) {
    this->waiting_for_speaker_stop_ = true;
    this->speaker_stop_wait_started_ms_ = millis();
  }
  if (this->waiting_for_speaker_stop_) {
    // Use has_buffered_data() instead of is_stopped(): the resampler only
    // transitions to STATE_STOPPED once its downstream (mixer source)
    // reports stopped, but our mixer sources are configured `timeout:
    // never` and stay RUNNING forever, so is_stopped() would never fire
    // and we'd always hit the fallback. has_buffered_data() walks the
    // chain (resampler ring + mixer source ring) and returns false as
    // soon as both have drained — exactly what we want.
    //
    // Note: this does *not* cover the i2s 500ms ring + ~100ms DAC tail
    // downstream of the mixer. We fire ~500ms before true silence. For
    // the LED that's imperceptible; for the request_follow_up chime,
    // yaml's wait_until !is_announcing + i2s tail delay already absorbs
    // any small overlap with the fading TTS tail.
    const bool speaker_drained =
        (this->speaker_ != nullptr) && !this->speaker_->has_buffered_data();
    const bool timed_out =
        (millis() - this->speaker_stop_wait_started_ms_) >= kSpeakerStopTimeoutMs;
    if (speaker_drained || timed_out) {
      if (timed_out && !speaker_drained) {
        ESP_LOGW(TAG,
                 "speaker still had buffered data after %u ms — "
                 "proceeding anyway (fallback)",
                 (unsigned) kSpeakerStopTimeoutMs);
      }
      this->waiting_for_speaker_stop_ = false;
      const bool terminal = this->thanks_pending_;
      this->thanks_pending_ = false;
      const bool was_request = this->request_follow_up_pending_;
      this->followup_pending_ = false;
      this->request_follow_up_pending_ = false;
      if (terminal) {
        this->set_phase_("thanks");
        this->set_timeout("va_thanks", kThanksDisplayMs, [this]() {
          this->set_phase_("idle");
        });
      } else if (was_request) {
        // Request-driven path: speaker has drained, now hand off to yaml
        // for the chime → wait_until !is_announcing → commit_followup_mic
        // sequence (announcement lane is separate from the TTS lane we
        // just waited on, so the chime won't collide with our tail).
        // Do not emit the deferred idle here. ESPHome yaml resumes paused
        // media on idle, and the user should answer the assistant's question
        // in silence instead of over resumed music.
        this->idle_emit_pending_ = false;
        this->followup_armed_ = true;
        for (auto *t : this->followup_opened_triggers_) {
          t->trigger();
        }
      } else {
        // Natural-idle path: emit the deferred LED idle, and — if the backend
        // configured a follow-up window (followup_ms_ > 0) — open the mic for
        // that long so the user can answer back without a wake word.
        this->open_followup_window_(this->followup_ms_);
      }
    }
  }
}

void VaPipecat::connect_() {
  if (this->url_.empty()) {
    ESP_LOGW(TAG, "Realtime backend URL is empty; websocket connection disabled");
    return;
  }

  if (this->ws_handle_ != nullptr) {
    // Already initialised; just (re)start. A synchronous start failure must
    // reschedule — otherwise the reconnect chain stalls silently and the
    // device stays offline until a reboot.
    esp_err_t err = esp_websocket_client_start(static_cast<esp_websocket_client_handle_t>(this->ws_handle_));
    if (err != ESP_OK) {
      ESP_LOGE(TAG, "esp_websocket_client_start (restart) failed: %d — rescheduling", (int) err);
      this->schedule_reconnect_();
    }
    return;
  }

  esp_websocket_client_config_t cfg = {};
  cfg.uri = this->url_.c_str();
  cfg.disable_auto_reconnect = true;  // we drive reconnects ourselves with exponential backoff
  cfg.reconnect_timeout_ms = 5000;    // ignored because disable_auto_reconnect=true
  cfg.ping_interval_sec = 60;
  cfg.pingpong_timeout_sec = 180;
  cfg.disable_pingpong_discon = true;

  esp_websocket_client_handle_t handle = esp_websocket_client_init(&cfg);
  if (handle == nullptr) {
    ESP_LOGE(TAG, "esp_websocket_client_init failed");
    this->schedule_reconnect_();
    return;
  }
  this->ws_handle_ = handle;

  esp_err_t err = esp_websocket_register_events(handle, WEBSOCKET_EVENT_ANY, va_ws_event_handler, this);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "esp_websocket_register_events failed: %d", (int) err);
  }

  ESP_LOGI(TAG, "Connecting to Pipecat backend");
  err = esp_websocket_client_start(handle);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "esp_websocket_client_start failed: %d", (int) err);
    this->schedule_reconnect_();
  }
}

void VaPipecat::schedule_reconnect_() {
  // esp_websocket_client emits multiple events per failure (DISCONNECTED,
  // CLOSED, sometimes ERROR). Coalesce them into a single reconnect.
  if (this->reconnect_pending_) {
    return;
  }
  this->reconnect_pending_ = true;

  // One per *failure* (coalesced), not per individual WS event. Once we
  // cross the threshold fire the audible-error trigger exactly once until
  // a successful connect resets the counter.
  this->consecutive_failures_++;
  if (this->consecutive_failures_ >= kRepeatedFailureThreshold &&
      !this->repeated_failure_fired_) {
    this->repeated_failure_fired_ = true;
    ESP_LOGW(TAG, "%u consecutive reconnect failures — firing on_repeated_failure",
             (unsigned) this->consecutive_failures_);
    this->defer([this]() {
      for (auto *trigger : this->repeated_failure_triggers_) {
        trigger->trigger();
      }
    });
  }

  uint32_t delay = this->reconnect_delay_ms_;
  ESP_LOGI(TAG, "Scheduling reconnect in %u ms", (unsigned) delay);
  // Backoff schedule: 1s -> 2s -> 5s -> 10s (capped).
  if (this->reconnect_delay_ms_ < 2000) {
    this->reconnect_delay_ms_ = 2000;
  } else if (this->reconnect_delay_ms_ < 5000) {
    this->reconnect_delay_ms_ = 5000;
  } else {
    this->reconnect_delay_ms_ = 10000;
  }
  this->set_timeout("va_reconnect", delay, [this]() {
    this->reconnect_pending_ = false;
    this->connect_();
  });
}

void VaPipecat::on_ws_event(int32_t event_id, void *event_data) {
  auto *data = static_cast<esp_websocket_event_data_t *>(event_data);
  switch (event_id) {
    case WEBSOCKET_EVENT_CONNECTED: {
      ESP_LOGI(TAG, "WS connected");
      this->ws_connected_ = true;
      this->reconnect_delay_ms_ = 1000;  // reset backoff on a clean open
      // Don't reset the failure counter / fired flag yet — a flap-and-die
      // link would spam chimes. Only re-arm after the connection has held
      // for kStableConnectionMs without a disconnect.
      this->set_timeout("va_stable_connection", kStableConnectionMs, [this]() {
        if (this->ws_connected_) {
          this->consecutive_failures_ = 0;
          this->repeated_failure_fired_ = false;
          ESP_LOGD(TAG, "WS stable for %u ms — error chime re-armed",
                   (unsigned) kStableConnectionMs);
        }
      });

      this->set_phase_("idle");
      break;
    }
    case WEBSOCKET_EVENT_DATA: {
      if (data == nullptr || data->data_ptr == nullptr || data->data_len <= 0)
        break;
      // op_code: 0x01 = text, 0x02 = binary, 0x00 = continuation of the prior
      // frame. esp_websocket_client splits long messages, so we must track the
      // type from the first chunk and feed continuations to the same handler.
      uint8_t op = data->op_code;
      if (op == 0x01) {
        this->last_data_was_binary_ = false;
        this->handle_text_(data->data_ptr, static_cast<size_t>(data->data_len));
      } else if (op == 0x02) {
        this->last_data_was_binary_ = true;
        this->handle_binary_(reinterpret_cast<const uint8_t *>(data->data_ptr),
                             static_cast<size_t>(data->data_len));
      } else if (op == 0x00) {
        // Continuation. Route based on the type of the in-flight message.
        if (this->last_data_was_binary_) {
          this->handle_binary_(reinterpret_cast<const uint8_t *>(data->data_ptr),
                               static_cast<size_t>(data->data_len));
        } else {
          this->handle_text_(data->data_ptr, static_cast<size_t>(data->data_len));
        }
      }
      break;
    }
    case WEBSOCKET_EVENT_DISCONNECTED:
    case WEBSOCKET_EVENT_CLOSED:
    case WEBSOCKET_EVENT_ERROR: {
      if (this->ws_connected_) {
        ESP_LOGW(TAG, "WS disconnected (event %d)", (int) event_id);
      }
      this->ws_connected_ = false;
      // Connection broke before the stability window elapsed — keep the
      // failure counter and the fired flag. A flapping link won't earn
      // a fresh chime.
      this->cancel_timeout("va_stable_connection");
      this->set_phase_("idle");
      this->schedule_reconnect_();
      break;
    }
    default:
      break;
  }
}

void VaPipecat::handle_text_(const char *data, size_t len) {
  std::string msg(data, len);
  ESP_LOGD(TAG, "WS text: %s", msg.c_str());

  if (msg.find("\"type\":\"error\"") != std::string::npos) {
    ESP_LOGW(TAG, "Server reported error: %s", msg.c_str());
    // Without an audible cue the user just sees the LED go idle and
    // assumes the assistant ignored them. Reuse the on_repeated_failure
    // trigger — it already plays error_cloud_expired and the failure
    // mode is identical from the user's perspective ("something went
    // wrong, try again"). We deliberately don't bump consecutive_failures_
    // here; that counter is for WS reachability, not server-side errors.
    // Marshalled via defer(): handle_text_ runs on the WS task and ESPHome
    // triggers (→ the yaml play_sound script) are not thread-safe.
    std::string code{"pipeline_error"};
    std::string message_b64;
    std::string message{"Pipecat pipeline error"};
    parse_string_after_key(msg, "\"code\":\"", code);
    if (parse_string_after_key(msg, "\"message_b64\":\"", message_b64) &&
        message_b64.size() <= 1536) {
      message.resize((message_b64.size() * 3u) / 4u + 4u);
      const size_t decoded =
          base64_decode(message_b64, reinterpret_cast<uint8_t *>(message.data()), message.size());
      message.resize(decoded);
    }
    this->fire_error_(code, message);
    this->flush_playback_queue_();
    this->set_streaming_(false);
    this->suppress_followup_ = true;
    this->set_phase_("idle");
    return;
  }

  if (msg.find("\"type\":\"hello\"") != std::string::npos) {
    // Handshake ack from the backend. It may carry follow-up tuning so the
    // device behaviour is configurable from the add-on (no reflash): a reconnect
    // after an add-on restart re-reads these.
    //   "follow_up_ms":N            — how long the mic stays open after a reply
    //                                 so the user can answer without a wake word.
    //   "follow_up_open_delay_ms":N — delay before that mic opens, to let the
    //                                 reply's i2s/DAC tail finish playing out.
    uint32_t v = 0;
    if (msg.find("\"protocol\":\"va-pipecat\"") == std::string::npos ||
        msg.find("\"version\":1") == std::string::npos) {
      ESP_LOGE(TAG, "Unsupported va-pipecat handshake: %s", msg.c_str());
      this->fire_error_("protocol_mismatch", "Unsupported va-pipecat protocol");
      return;
    }
    if (parse_uint_after_key(msg, "\"follow_up_ms\":", v)) {
      if (v > kFollowupMsMax)
        v = kFollowupMsMax;
      this->followup_ms_ = v;
      ESP_LOGI(TAG, "hello: follow-up window = %u ms (%s)", (unsigned) v,
               v == 0 ? "disabled, turn-based" : "mic stays open after replies");
    }
    if (parse_uint_after_key(msg, "\"follow_up_open_delay_ms\":", v)) {
      if (v > kFollowupOpenDelayMaxMs)
        v = kFollowupOpenDelayMaxMs;
      this->followup_open_delay_ms_ = v;
      ESP_LOGI(TAG, "hello: follow-up mic-open delay = %u ms", (unsigned) v);
    }
    if (parse_uint_after_key(msg, "\"wake_open_delay_ms\":", v)) {
      if (v > kFollowupOpenDelayMaxMs)  // reuse the same 5 s ceiling
        v = kFollowupOpenDelayMaxMs;
      this->wake_open_delay_ms_ = v;
      ESP_LOGI(TAG, "hello: wake mic-open delay = %u ms", (unsigned) v);
    }
    if (parse_uint_after_key(msg, "\"playback_prebuffer_ms\":", v)) {
      if (v > kPlaybackPrebufferMaxMs)
        v = kPlaybackPrebufferMaxMs;
      this->playback_prebuffer_ms_ = v;
      ESP_LOGI(TAG, "hello: playback prebuffer (jitter buffer) = %u ms (%s)", (unsigned) v,
               v == 0 ? "disabled" : "cushion before playback");
    }
    return;
  }

  if (msg.find("\"type\":\"interrupt\"") != std::string::npos) {
    std::string reason{"pipeline"};
    parse_string_after_key(msg, "\"reason\":\"", reason);
    this->handle_server_interrupt_(reason);
    return;
  }

  if (msg.find("\"type\":\"transcript\"") != std::string::npos) {
    std::string role;
    std::string text_b64;
    if (!parse_string_after_key(msg, "\"role\":\"", role) ||
        !parse_string_after_key(msg, "\"text_b64\":\"", text_b64)) {
      ESP_LOGW(TAG, "transcript message missing role/text_b64");
      return;
    }
    if (text_b64.size() > 1536) {
      ESP_LOGW(TAG, "transcript too large (%u b64 bytes), dropping", (unsigned) text_b64.size());
      return;
    }
    std::string text;
    text.resize((text_b64.size() * 3u) / 4u + 4u);
    size_t decoded = base64_decode(text_b64, reinterpret_cast<uint8_t *>(text.data()), text.size());
    text.resize(decoded);
    if (!text.empty()) {
      this->fire_transcript_(role, text);
    }
    return;
  }

  if (msg.find("\"type\":\"request_follow_up\"") != std::string::npos) {
    // Server's model called the request_follow_up tool — it asked a
    // question and wants the user to answer without saying a wake word. This
    // can arrive before phase=replying / before audio is queued, so only latch
    // the intent here. phase=idle (response.done) arms the follow-up once the
    // real reply has actually played out.
    ESP_LOGI(TAG, "request_follow_up — latched for end of reply");
    this->request_follow_up_pending_ = true;
    return;
  }

  // Substring match on `"value":"<phase>"` — keeps us out of a JSON parser
  // until M3 needs richer payloads.
  static const char *const kPhases[] = {
      "listening", "thinking", "speaking", "replying", "thanks", "idle"};
  for (const char *p : kPhases) {
    const std::string phase_needle = std::string("\"phase\":\"") + p + "\"";
    const std::string legacy_needle = std::string("\"value\":\"") + p + "\"";
    if (msg.find(phase_needle) != std::string::npos ||
        msg.find(legacy_needle) != std::string::npos) {
      const std::string phase = std::string(p) == "replying" ? "speaking" : p;
      if (phase == "listening" &&
          msg.find("\"follow_up\":true") != std::string::npos) {
        this->defer([this]() { this->queue_followup_listening_(); });
      } else if (phase == "thanks" &&
                 msg.find("\"terminal\":true") != std::string::npos) {
        this->defer([this]() { this->queue_terminal_thanks_(); });
      } else {
        this->set_phase_(phase);
      }
      return;
    }
  }
}

size_t VaPipecat::flush_playback_queue_() {
  portENTER_CRITICAL(&this->ring_mux_);
  const size_t flushed_bytes = this->audio_fill_;
  this->audio_head_ = 0;
  this->audio_tail_ = 0;
  this->audio_fill_ = 0;
  this->audio_generation_++;
  portEXIT_CRITICAL(&this->ring_mux_);

  this->playback_priming_ = false;
  this->chain_prime_remaining_ = 0;
  return flushed_bytes;
}

void VaPipecat::queue_followup_listening_() {
  ESP_LOGI(TAG, "Pipecat follow-up queued until local playback drains");
  this->thanks_pending_ = false;
  this->followup_pending_ = true;
  this->request_follow_up_pending_ = false;
  this->idle_emit_pending_ = false;
  this->post_playback_not_before_ms_ = millis() + 100;
  this->cancel_timeout("va_no_speech");
  this->cancel_timeout("va_followup");
  this->cancel_timeout("va_followup_open");
}

void VaPipecat::queue_terminal_thanks_() {
  ESP_LOGI(TAG, "Pipecat terminal phase queued until local playback drains");
  this->set_streaming_(false);
  this->followup_pending_ = false;
  this->thanks_pending_ = false;
  this->request_follow_up_pending_ = false;
  this->idle_emit_pending_ = false;
  this->thanks_pending_ = true;
  this->post_playback_not_before_ms_ = millis() + 100;
  this->cancel_timeout("va_no_speech");
  this->cancel_timeout("va_followup");
  this->cancel_timeout("va_followup_open");
}

void VaPipecat::handle_server_interrupt_(const std::string &reason) {
  const std::string reason_copy = reason;
  this->defer([this, reason_copy]() {
    const size_t flushed_bytes = this->flush_playback_queue_();
    this->followup_pending_ = false;
    this->thanks_pending_ = false;
    this->waiting_for_speaker_stop_ = false;
    this->request_follow_up_pending_ = false;
    this->idle_emit_pending_ = false;
    this->cancel_timeout("va_followup");
    this->cancel_timeout("va_followup_open");
    this->cancel_timeout("va_tts_tail");

    if (reason_copy == "stopped") {
      this->set_streaming_(false);
      this->suppress_incoming_audio_ = true;
      this->set_phase_("idle");
    } else {
      // Drop any PCM frames that were already in flight behind the interrupt.
      // A new assistant response cannot arrive within this short guard because
      // the user still has to finish the next utterance.
      this->set_phase_("listening");
      this->suppress_incoming_audio_ = true;
      this->set_timeout("va_interrupt_tail", 250, [this]() {
        this->suppress_incoming_audio_ = false;
      });
    }

    ESP_LOGI(TAG, "server interrupt reason=%s; flushed %u bytes of queued TTS",
             reason_copy.c_str(), (unsigned) flushed_bytes);
  });
}

void VaPipecat::handle_binary_(const uint8_t *data, size_t len) {
  if (this->speaker_ == nullptr || len < 2 || this->audio_buf_ == nullptr)
    return;
  // After a "stop"/barge-in (send_interrupt) the backend is still streaming the
  // rest of the already-generated reply. Drop it so the cancelled reply goes
  // silent instead of refilling the PSRAM ring we just flushed. Cleared on the
  // next "idle"/"listening" phase (see set_phase_).
  if (this->suppress_incoming_audio_)
    return;
  const uint32_t now_ms = millis();
  if (this->turn_t_first_audio_out_ == 0 && this->turn_t_wake_ != 0) {
    this->turn_t_first_audio_out_ = now_ms;
  }
  // Detector 1: WS frame inter-arrival jitter. A gap > kWsGapWarnMs means
  // the backend stalled or a network burst arrived late, either of which
  // could starve the downstream chain. Log immediately so the gap is
  // adjacent to whatever the user reports hearing.
  if (this->last_binary_ms_ != 0) {
    const uint32_t gap = now_ms - this->last_binary_ms_;
    if (gap > kWsGapWarnMs) {
      this->ws_gap_count_++;
      if (gap > this->ws_gap_max_ms_) this->ws_gap_max_ms_ = gap;
      ESP_LOGW(TAG, "ws audio gap: %u ms (ring fill %u bytes)",
               (unsigned) gap, (unsigned) this->audio_fill_);
    }
  }
  this->last_binary_ms_ = now_ms;
  // PCM16 mono @ 24 kHz, append to ring buffer. loop() drains.
  // Snapshot audio_fill_ under the lock — it's modified by loop() on the
  // other core and we can't trust a torn read.
  size_t free_space;
  portENTER_CRITICAL(&this->ring_mux_);
  free_space = this->audio_buf_bytes_ - this->audio_fill_;
  portEXIT_CRITICAL(&this->ring_mux_);
  if (len > free_space) {
    ESP_LOGW(TAG, "audio buffer overflow: dropping %u bytes (have %u free of %u total)",
             (unsigned) (len - free_space), (unsigned) free_space,
             (unsigned) this->audio_buf_bytes_);
    len = free_space;
    if (len == 0)
      return;
  }
  // Apply user-controlled volume from external_media_player before writing to
  // the ring. volume_ is set from yaml on every media_player volume / mute
  // change. With vol ≤ 1 there is no mathematical way to overflow int16, but
  // we keep a defensive saturation + clipped_samples_ counter so any future
  // gain re-introduction shows up in the per-turn summary instead of silently
  // distorting.
  size_t pairs = len / 2;
  if (pairs > 0) {
    auto *in = reinterpret_cast<const int16_t *>(data);
    // This vector is owned only by the websocket task. Sharing scratch storage
    // with the microphone callback would race resize/reallocation and place
    // unrelated samples in the TTS ring.
    float vol = this->volume_;
    if (vol < 0.0f) vol = 0.0f;
    else if (vol > 1.0f) vol = 1.0f;
    if (vol < 0.999f) {
      this->tts_buf_.resize(pairs);
      // Q15 fixed point so the inner loop stays integer-only.
      int32_t scale = static_cast<int32_t>(vol * 32768.0f);
      uint32_t clipped = 0;
      for (size_t i = 0; i < pairs; i++) {
        int32_t v = (static_cast<int32_t>(in[i]) * scale) >> 15;
        if (v > 32767) { v = 32767; clipped++; }
        else if (v < -32768) { v = -32768; clipped++; }
        this->tts_buf_[i] = static_cast<int16_t>(v);
      }
      this->clipped_samples_ += clipped;
      data = reinterpret_cast<const uint8_t *>(this->tts_buf_.data());
    }
    // len is unchanged (pairs * 2 == len rounded down; trailing odd byte ignored).
    len = pairs * 2;
    this->update_audio_level_(this->output_level_q15_, reinterpret_cast<const int16_t *>(data), pairs, 4);
    this->last_output_audio_ms_ = now_ms;
  }
  // Two-part write: from tail to end, then wrap to start.
  // We need a stable snapshot of audio_tail_ for the memcpy destination,
  // then commit tail + fill atomically with the writes so the reader on
  // the other core never sees a new tail before the memcpy completed.
  // Doing the memcpy *inside* the critical section is the simplest way
  // to guarantee that ordering — len is at most a few KB per WS frame
  // and PSRAM memcpy is ~10–20 µs, well under any audio deadline.
  portENTER_CRITICAL(&this->ring_mux_);
  const bool was_empty = (this->audio_fill_ == 0);
  size_t tail = this->audio_tail_;
  size_t first = std::min(len, this->audio_buf_bytes_ - tail);
  std::memcpy(this->audio_buf_ + tail, data, first);
  if (first < len) {
    std::memcpy(this->audio_buf_, data + first, len - first);
  }
  this->audio_tail_ = (tail + len) % this->audio_buf_bytes_;
  this->audio_fill_ += len;
  portEXIT_CRITICAL(&this->ring_mux_);
  // Jitter buffer: arm priming only when the ring was empty AND the downstream
  // chain is dry — i.e. a true reply start or a real underflow. Mid-reply the
  // ring routinely flips empty (loop() drains each WS clump on arrival) while
  // the downstream chain still holds ~600 ms of audio; re-arming there did
  // nothing but spam "prebuffer ready" every ~50 ms and could hold a small
  // trailing chunk for the full prebuffer deadline. has_buffered_data() is a
  // counter read, safe enough from the WS task. Only when enabled.
  if (was_empty && this->playback_prebuffer_ms_ > 0 && !this->playback_priming_ &&
      !this->speaker_->has_buffered_data()) {
    this->prime_started_ms_ = now_ms;
    this->playback_priming_ = true;
  }
  // No per-chunk log — fires 50+ times per reply at DEBUG and drowns the
  // log. The throttled drain log in loop() gives enough visibility into
  // queue depth.
}

void VaPipecat::on_mic_data_(const std::vector<uint8_t> &samples) {
  if (!this->ws_connected_ || this->ws_handle_ == nullptr)
    return;
  // i2s_mics yields interleaved stereo int32 frames: [L0_low,L0_high, R0_low,R0_high, L1..].
  // Each frame = 8 bytes (2ch × 4 bytes). We want one channel converted to
  // int16 mono. Real audio sits in the high 16 bits (ADC pads up to int32).
  // MicrophoneSource supplies 16 kHz, 16-bit, mono audio. For full-duplex
  // barge-in it should be an AEC-processed source.
  if (samples.size() < sizeof(int16_t))
    return;

  const auto *mono_samples = reinterpret_cast<const int16_t *>(samples.data());
  const size_t mono_sample_count = samples.size() / sizeof(int16_t);
  const uint32_t now_ms = millis();
  this->mic_last_frame_ms_ = now_ms;

  // Streaming gate. When no session is active we don't forward frames to the
  // backend, so wake-word detection remains the only always-on capture path.
  if (!this->streaming_) {
    return;
  }

  this->update_audio_level_(this->input_level_q15_, mono_samples, mono_sample_count, 4);
  this->last_input_audio_ms_ = now_ms;

  uint32_t max_abs = 0;
  for (size_t i = 0; i < mono_sample_count; i += 4) {
    const int32_t sample = mono_samples[i];
    const uint32_t abs_sample = sample < 0 ? static_cast<uint32_t>(-sample) : static_cast<uint32_t>(sample);
    if (abs_sample > max_abs)
      max_abs = abs_sample;
  }
  if (max_abs > this->mic_max_abs_this_sec_)
    this->mic_max_abs_this_sec_ = max_abs;
  this->mic_frames_this_sec_++;
  this->mic_bytes_this_sec_ += samples.size();

  const int len = static_cast<int>(mono_sample_count * sizeof(int16_t));
  this->mic_tx_push_(samples.data(), static_cast<size_t>(len));

  if (now_ms - this->mic_stats_last_ms_ >= 1000) {
    size_t tx_queued = 0;
    uint32_t tx_dropped = 0;
    portENTER_CRITICAL(&this->mic_tx_mux_);
    tx_queued = this->mic_tx_fill_;
    tx_dropped = this->mic_tx_dropped_bytes_this_sec_;
    this->mic_tx_dropped_bytes_this_sec_ = 0;
    portEXIT_CRITICAL(&this->mic_tx_mux_);
    const bool anomaly = this->mic_send_failures_this_sec_ != 0 || tx_dropped != 0 ||
                         this->mic_bytes_this_sec_ < 24000;
    if (anomaly) {
      ESP_LOGW(TAG, "mic uplink anomaly: frames=%u bytes=%u max_abs=%u send_failures=%u "
                    "tx_queued=%u tx_dropped=%u ws=%s",
               (unsigned) this->mic_frames_this_sec_,
               (unsigned) this->mic_bytes_this_sec_,
               (unsigned) this->mic_max_abs_this_sec_,
               (unsigned) this->mic_send_failures_this_sec_,
               (unsigned) tx_queued,
               (unsigned) tx_dropped,
               this->ws_connected_ ? "yes" : "no");
    } else {
      ESP_LOGD(TAG, "mic uplink: frames=%u bytes=%u max_abs=%u tx_queued=%u ws=%s",
               (unsigned) this->mic_frames_this_sec_,
               (unsigned) this->mic_bytes_this_sec_,
               (unsigned) this->mic_max_abs_this_sec_,
               (unsigned) tx_queued,
               this->ws_connected_ ? "yes" : "no");
    }
    this->mic_stats_last_ms_ = now_ms;
    this->mic_frames_this_sec_ = 0;
    this->mic_bytes_this_sec_ = 0;
    this->mic_send_failures_this_sec_ = 0;
    this->mic_max_abs_this_sec_ = 0;
  }
}

void VaPipecat::mic_tx_push_(const uint8_t *data, size_t len) {
  if (this->mic_tx_buf_ == nullptr || data == nullptr || len == 0)
    return;

  if (len > kMicTxMaxQueuedBytes) {
    const size_t drop = len - kMicTxMaxQueuedBytes;
    data += drop;
    len = kMicTxMaxQueuedBytes;
  }
  len &= ~static_cast<size_t>(1);
  if (len == 0)
    return;

  portENTER_CRITICAL(&this->mic_tx_mux_);
  const size_t free_space = kMicTxBufBytes - this->mic_tx_fill_;
  if (len > free_space) {
    const size_t drop = len - free_space;
    this->mic_tx_head_ = (this->mic_tx_head_ + drop) % kMicTxBufBytes;
    this->mic_tx_fill_ -= drop;
    this->mic_tx_dropped_bytes_this_sec_ += drop;
  }
  if (this->mic_tx_fill_ + len > kMicTxMaxQueuedBytes) {
    const size_t drop = (this->mic_tx_fill_ + len - kMicTxMaxQueuedBytes) & ~static_cast<size_t>(1);
    this->mic_tx_head_ = (this->mic_tx_head_ + drop) % kMicTxBufBytes;
    this->mic_tx_fill_ -= drop;
    this->mic_tx_dropped_bytes_this_sec_ += drop;
  }

  size_t tail = this->mic_tx_tail_;
  const size_t first = std::min(len, kMicTxBufBytes - tail);
  std::memcpy(this->mic_tx_buf_ + tail, data, first);
  if (first < len) {
    std::memcpy(this->mic_tx_buf_, data + first, len - first);
  }
  this->mic_tx_tail_ = (tail + len) % kMicTxBufBytes;
  this->mic_tx_fill_ += len;
  portEXIT_CRITICAL(&this->mic_tx_mux_);
}

size_t VaPipecat::mic_tx_pop_(uint8_t *out, size_t max_len) {
  if (this->mic_tx_buf_ == nullptr || out == nullptr || max_len == 0)
    return 0;

  max_len &= ~static_cast<size_t>(1);
  portENTER_CRITICAL(&this->mic_tx_mux_);
  size_t len = std::min(max_len, this->mic_tx_fill_);
  len &= ~static_cast<size_t>(1);
  if (len == 0) {
    portEXIT_CRITICAL(&this->mic_tx_mux_);
    return 0;
  }

  size_t head = this->mic_tx_head_;
  const size_t first = std::min(len, kMicTxBufBytes - head);
  std::memcpy(out, this->mic_tx_buf_ + head, first);
  if (first < len) {
    std::memcpy(out + first, this->mic_tx_buf_, len - first);
  }
  this->mic_tx_head_ = (head + len) % kMicTxBufBytes;
  this->mic_tx_fill_ -= len;
  portEXIT_CRITICAL(&this->mic_tx_mux_);
  return len;
}

void VaPipecat::mic_tx_clear_() {
  portENTER_CRITICAL(&this->mic_tx_mux_);
  this->mic_tx_head_ = 0;
  this->mic_tx_tail_ = 0;
  this->mic_tx_fill_ = 0;
  portEXIT_CRITICAL(&this->mic_tx_mux_);
}

VaPipecat::Phase VaPipecat::phase_from_string_(const std::string &phase) {
  if (phase == "listening")
    return Phase::LISTENING;
  if (phase == "thinking")
    return Phase::THINKING;
  if (phase == "speaking" || phase == "replying")
    return Phase::REPLYING;
  if (phase == "thanks")
    return Phase::THANKS;
  return Phase::IDLE;
}

const char *VaPipecat::phase_name_(Phase p) {
  switch (p) {
    case Phase::LISTENING:
      return "listening";
    case Phase::THINKING:
      return "thinking";
    case Phase::REPLYING:
      return "speaking";
    case Phase::THANKS:
      return "thanks";
    default:
      return "idle";
  }
}

void VaPipecat::set_streaming_(bool enabled) {
  if (this->streaming_ == enabled)
    return;

  this->streaming_ = enabled;
  if (enabled) {
    const uint32_t now = millis();
    this->mic_tx_clear_();
    this->mic_stream_started_ms_ = now;
    this->mic_last_frame_ms_ = 0;
    this->mic_no_frame_warn_ms_ = 0;
    this->mic_stats_last_ms_ = now;
    this->mic_frames_this_sec_ = 0;
    this->mic_bytes_this_sec_ = 0;
    this->mic_send_failures_this_sec_ = 0;
    this->mic_max_abs_this_sec_ = 0;
    if (this->mic_source_ != nullptr) {
      this->mic_source_->start();
      ESP_LOGI(TAG, "mic uplink opened (source_running=%s)",
               this->mic_source_->is_running() ? "yes" : "no");
    } else {
      ESP_LOGE(TAG, "mic uplink opened but microphone source is missing");
    }
  } else {
    if (this->mic_source_ != nullptr) {
      this->mic_source_->stop();
    }
    this->mic_tx_clear_();
    ESP_LOGI(TAG, "mic uplink closed");
  }
}

void VaPipecat::set_phase_(const std::string &phase) {
  // Don't dedupe — we want yaml-side control_leds to re-render even on
  // identical phase if other inputs (e.g. va WS connection state) have
  // changed since the last emission.
  const Phase prev = static_cast<Phase>(this->current_phase_.load());
  this->current_phase_.store(static_cast<uint8_t>(phase_from_string_(phase)));
  ESP_LOGD(TAG, "Phase -> %s (was %s)", phase.c_str(), phase_name_(prev));

  // Post-stop `thinking` guard. After a local "stop" the mic gate is closed
  // (send_interrupt set post_stop_guard_), so no new turn can begin until a
  // wake (start_session clears it). A `thinking` arriving here is the server
  // VAD's end-of-turn for the utterance we just cancelled — acting on it
  // strands the LED in `thinking` until the backend's 15 s watchdog (observed
  // 2026-06-14: "stop" mid-question -> 15 s stuck thinking). Ignore it, keeping
  // the prior phase. Scoped to `thinking`: a web search's replying->thinking
  // has no stop (guard stays false), and a reply-drain emits no `thinking`.
  if (this->post_stop_guard_ && phase == "thinking") {
    this->current_phase_.store(static_cast<uint8_t>(prev));  // don't advance to the stale value
    ESP_LOGI(TAG, "ignoring stale 'thinking' after stop (no wake since)");
    return;
  }

  // Lift the post-"stop" incoming-audio suppression ONLY on "listening" — a
  // genuine fresh user turn whose reply is legitimate. We deliberately do NOT
  // lift on "idle": the backend may keep streaming already-generated audio
  // after cancellation, so it can drain for many
  // seconds AFTER the stop. An "idle" can arrive mid-drain — notably the
  // backend's thinking-watchdog force-idle — and lifting suppression there
  // un-mutes the still-arriving tail, which then plays as an "answer out of
  // nowhere" (observed live 2026-06-13 10:11). A real next reply is always
  // preceded by "listening" (the user speaks), so that stays the only safe
  // gate; until then the tail keeps being dropped. We also do NOT clear on
  // "thinking"/"replying" — those can still belong to the reply we cancelled.
  if (this->suppress_incoming_audio_ && phase == "listening") {
    this->suppress_incoming_audio_ = false;
    ESP_LOGI(TAG, "incoming-audio suppression lifted on phase=listening");
  }

  // Streaming gate state machine:
  //   listening  → mic on (user is being heard)
  //   thinking   → mic stays on. `thinking` only means "the VAD thinks the user
  //                stopped", but with semantic_vad it can flap listening↔thinking
  //                at the start of a turn while the user is still talking. No bot
  //                audio plays during thinking (no echo risk), so keep streaming
  //                until the reply genuinely begins — otherwise a spurious
  //                `thinking` cuts the mic, the backend's input watchdog
  //                force-ends the turn with no transcript, and the turn hangs.
  //   replying   → mic off unless barge_in is enabled and the source has AEC.
  //   idle       → mic on for kFollowupMs so the user can answer a question
  //                without re-triggering the wake word. Timer expiry closes
  //                the session.
  if (phase == "listening") {
    this->thanks_pending_ = false;
    if (!this->streaming_) {
      ESP_LOGI(TAG, "phase=listening — mic streaming on");
      this->set_streaming_(true);
    }
    // Handsfree barge-in cut-over: a `listening` arriving while we still have
    // TTS queued means the backend's server VAD heard the user talk over the
    // reply and already cancelled the active response. Drop the audio still in
    // our PSRAM ring so playback stops immediately instead of finishing the
    // now-cancelled sentence. We do NOT send a WS interrupt here — the backend
    // initiated this — we just stop local playback.
    if (this->barge_in_ && this->audio_fill_ > 0) {
      portENTER_CRITICAL(&this->ring_mux_);
      this->audio_head_ = 0;
      this->audio_tail_ = 0;
      this->audio_fill_ = 0;
      this->audio_generation_++;
      portEXIT_CRITICAL(&this->ring_mux_);
      this->idle_emit_pending_ = false;
      ESP_LOGI(TAG, "phase=listening during reply — barge-in, flushed TTS queue");
    }
    if (this->turn_t_listening_ == 0 && this->turn_t_wake_ != 0) {
      this->turn_t_listening_ = millis();
    }
    // Server heard us — watchdog no longer needed.
    this->cancel_timeout("va_no_speech");
    this->cancel_timeout("va_followup");
    this->followup_pending_ = false;
    this->waiting_for_speaker_stop_ = false;
    this->request_follow_up_pending_ = false;
    this->followup_armed_ = false;
    this->idle_emit_pending_ = false;
  } else if (phase == "thinking" || phase == "speaking" || phase == "replying") {
    this->thanks_pending_ = false;
    // Gate the mic off only once the bot actually starts speaking (`replying`).
    // With handsfree barge-in we don't gate at all (server VAD plus device AEC
    // arbitrate talk-over). Crucially we do NOT gate on `thinking`: semantic_vad
    // can flap listening↔thinking at the start of a turn while the user is still
    // speaking, and cutting the mic on those spurious flaps starves the backend
    // of audio → its input watchdog force-ends the turn with no transcript → the
    // turn hangs in thinking. No bot audio plays during thinking, so there's no
    // echo cost to keeping the mic open until the reply genuinely starts.
    if ((phase == "speaking" || phase == "replying") && this->streaming_ && !this->barge_in_) {
      ESP_LOGI(TAG, "phase=replying — mic streaming off");
      this->set_streaming_(false);
    }
    if (phase == "thinking" && this->turn_t_thinking_ == 0 && this->turn_t_wake_ != 0) {
      this->turn_t_thinking_ = millis();
    }
    this->cancel_timeout("va_followup");
    this->cancel_timeout("va_followup_open");
    this->cancel_timeout("va_tts_tail");
    this->cancel_timeout("va_no_speech");
    if (!this->request_follow_up_pending_) {
      this->followup_pending_ = false;
      this->waiting_for_speaker_stop_ = false;
    }
    this->followup_armed_ = false;
    this->idle_emit_pending_ = false;  // new turn began, drop any held idle
  } else if (phase == "thanks") {
    // A short terminal UI state. No follow-up is allowed after a real goodbye.
    this->set_streaming_(false);
    this->followup_pending_ = false;
    this->waiting_for_speaker_stop_ = false;
    this->request_follow_up_pending_ = false;
    this->followup_armed_ = false;
    this->idle_emit_pending_ = false;
    this->suppress_followup_ = true;
    this->cancel_timeout("va_no_speech");
    this->cancel_timeout("va_followup");
    this->cancel_timeout("va_followup_open");
    this->cancel_timeout("va_tts_tail");
  } else if (phase == "idle") {
    this->thanks_pending_ = false;
    // Turn boundary: reset the WS-gap reference so the silence between THIS
    // reply and the NEXT turn's reply (~7 s across a follow-up exchange, where
    // start_session() — the other reset point — is never called) isn't logged
    // as a bogus "ws audio gap". Only intra-reply gaps are real signal.
    this->last_binary_ms_ = 0;
    // Only open a follow-up window if we just finished a real turn —
    // i.e. the previous phase was thinking or replying. Otherwise we'd
    // open the window for every spurious idle (initial WS hello, post-
    // disconnect idle, etc), spamming "follow-up window open" logs and
    // opening the mic for 5s every time the device just reconnects.
    const bool turn_just_ended = prev == Phase::THINKING || prev == Phase::REPLYING;
    if (!turn_just_ended) {
      // Plain idle (boot, reconnect, etc) — no follow-up. Fall through to
      // the regular trigger fire so the LED updates.
      //
      // An idle that arrives while the mic gate is still OPEN means an orphaned
      // stream that nothing else will close — shut it. Two real ways to reach
      // here with streaming_ still true:
      //   • idle straight from `listening`: the turn died without a reply (a
      //     backend force-idle on rate-limit / thinking-watchdog — the backend
      //     suppresses `thinking` after declaring a turn dead, so `listening`
      //     is exactly where the device sits — or a WS drop mid-listening).
      //   • idle from `idle` (prev==IDLE) with the mic open: the brief post-wake
      //     "waiting for the first phase" window, or an open follow-up window,
      //     when the WS drops (on_ws_event fires set_phase_("idle") on
      //     disconnect). Without this the gate stays open and the mic resumes
      //     streaming the room the instant we reconnect — and the backend's
      //     mic-resume buffer clear can't help because the stream never paused.
      // Closing here can't cut a LIVE follow-up window short: the only idle that
      // reaches an open window is exactly such a disconnect — the backend sends
      // no idle while it's waiting for the user to answer.
      if (this->streaming_) {
        ESP_LOGI(TAG, "idle while mic open (prev=%s) — closing orphaned mic gate",
                 phase_name_(prev));
        this->set_streaming_(false);
        this->cancel_timeout("va_no_speech");
      }
    } else if (this->suppress_followup_) {
      // send_interrupt() set this — user explicitly asked us to stop.
      // Close the session cleanly: streaming off, no follow-up, fall through
      // to the regular trigger fire so the LED goes idle.
      this->suppress_followup_ = false;
      this->set_streaming_(false);
      this->followup_pending_ = false;
      this->waiting_for_speaker_stop_ = false;
      this->request_follow_up_pending_ = false;
      this->followup_armed_ = false;
      this->cancel_timeout("va_tts_tail");
      this->idle_emit_pending_ = false;
    } else if (this->audio_fill_ == 0) {
      // Stale-`idle` guard. prev==REPLYING with NO audio played since the last
      // wake (turn_t_first_audio_out_==0) means this `idle` belongs to a reply
      // that was stopped and then superseded by a new wake while it was still
      // draining: start_session() reset turn_t_first_audio_out_ and the old
      // tail is suppressed, so nothing actually played in THIS session. Opening
      // a follow-up here lights a spurious `listening` window over the fresh
      // wake session (observed live 2026-06-14: web-search → "stop" → bare wake
      // → ~4 s `listening` flicker; device log "Phase -> idle (was replying)").
      // Ignore it: the wake's no-speech watchdog is still armed (we never
      // reached `listening`, so it was never cancelled) and owns the session —
      // it idles the LED and closes the mic. current_phase_ is already IDLE
      // (set at the top of set_phase_), so the next message's `prev` is fine.
      // Tight by construction: a reply that really played sets
      // turn_t_first_audio_out_ (suppression lifts on `listening`), and a
      // follow-up chain keeps it set (only start_session resets it), so no
      // legitimate follow-up is skipped; the dead-turn path (prev==THINKING,
      // watchdog already cancelled) is deliberately left untouched.
      if (prev == Phase::REPLYING && this->turn_t_first_audio_out_ == 0) {
        ESP_LOGI(TAG, "stale replying-idle after wake (no audio this session) "
                      "— ignoring, no follow-up");
        // Distinguished by the mic gate: streaming_==true is a BARE WAKE (mic
        // still open, never reached `replying` this session) → the no-speech
        // watchdog is armed and owns the idle + mic close, so leave the LED on
        // the wake state. streaming_==false means the turn DID reach `replying`
        // (mic gated) but the audio never played — e.g. suppress_incoming_audio_
        // was still set from an earlier stop, so turn_t_first_audio_out_ stayed
        // 0. The watchdog was cancelled when the turn reached `listening`, so
        // nothing else fires idle → fall through to the LED trigger below, else
        // the ring strands on `replying` (observed live 2026-06-14: rapid stops
        // left suppression on, the search reply was dropped, the LED hung).
        if (this->streaming_) {
          return;  // bare wake: va_no_speech owns the idle + mic
        }
        // else: fall through to fire the idle LED (still no follow-up).
      } else {
        // Server says response.done and the device has actually played out.
        // Open the follow-up window (mic on so user can answer a question).
        const bool was_request = this->request_follow_up_pending_;
        this->request_follow_up_pending_ = false;
        if (was_request) {
          // The assistant explicitly asked a question. Do not expose the
          // server's transitionary idle to YAML: media resume is bound to idle
          // and would restart music under the user's follow-up answer.
          this->idle_emit_pending_ = false;
          this->followup_armed_ = true;
          for (auto *t : this->followup_opened_triggers_) {
            t->trigger();
          }
          return;
        }
        this->open_followup_window_(this->followup_ms_);
      }
      // fall through to fire the trigger normally below (LED -> idle); the
      // follow-up window, if any, fires its own `listening` LED after its delay.
    } else {
      // Server says response.done, but we still have seconds of TTS queued
      // in PSRAM + downstream rings. Two things wait on the queue:
      //   1) the LED transition to idle (otherwise it goes off while the
      //      device is still speaking)
      //   2) opening the follow-up mic window (echo + false VAD trigger)
      // Mark both pending; the drain handler in loop() releases them
      // together after the speaker actually finishes.
      ESP_LOGI(TAG, "phase=idle but %u bytes still queued; LED + follow-up deferred",
               (unsigned) this->audio_fill_);
      this->followup_pending_ = true;
      this->idle_emit_pending_ = true;
      return;  // suppress immediate trigger fire — open_followup_window_ will fire it later
    }
  }

  // set_phase_ may be called from the websocket task; ESPHome triggers and
  // most component APIs are not thread-safe. Marshal the side effects onto
  // the main loop via defer().
  std::string phase_copy = phase;
  this->defer([this, phase_copy]() {
    // We deliberately do NOT call speaker->stop() on "listening" anymore:
    // the speaker task runs continuously after setup() and play() just
    // appends to its ring buffer. Stop/start churn was creating multiple
    // speaker_task instances racing for the i2s channel ("Parent bus is
    // busy"). For barge-in/interrupt we'll add a buffer-flush API in M3.
    for (auto *t : this->phase_triggers_) {
      t->trigger(phase_copy);
    }
  });
}

void VaPipecat::start_session() {
  // Open the streaming window. on_mic_data_ will start forwarding frames to
  // the backend until the conversation reaches a terminal phase.

  // Belt-and-suspenders barge-in. The yaml wake handler calls send_interrupt()
  // when it observes voice_assistant_phase == replying, but two windows slip
  // past that check:
  //   1) server already sent phase=idle yet PSRAM still has seconds of TTS
  //      queued (idle_emit_pending_). yaml's voice_assistant_phase has been
  //      reset to idle and the wake handler takes the "fresh session" path —
  //      no interrupt — so the new reply overlaps with the tail of the old.
  //   2) wake fires mid-reply while the backend is still generating audio.
  // The bridge treats interrupt as cheap when there's nothing to cancel
  // (response_cancel_not_active is in its benignCodes set), and
  // input_audio_buffer.clear is safe here because mic frames for the new turn
  // don't start flowing until after this function returns.
  const Phase phase_now = static_cast<Phase>(this->current_phase_.load());
  const bool residual_reply =
      this->audio_fill_ > 0 ||
      this->idle_emit_pending_ ||
      (phase_now == Phase::REPLYING && this->turn_t_first_audio_out_ != 0);
  if (residual_reply) {
    ESP_LOGI(TAG, "start_session: interrupting residual reply (phase=%s, fill=%u)",
             phase_name_(phase_now), (unsigned) this->audio_fill_);
    this->send_interrupt();
  }

  ESP_LOGI(TAG, "start_session() — streaming on");
  this->set_streaming_(true);
  // Tell the backend a fresh wake started (dangling-VAD guard, A). Sent AFTER
  // the residual-reply interrupt above so the backend sees interrupt → wake in
  // order. The first real mic frame for this turn doesn't flow until after this
  // returns, so the guard's "speech since wake" tracker starts clean.
  this->send_wake_();
  // Wake-word feedback must not wait for a network round trip. The server will
  // send the same phase once its VAD observes speech; duplicate phase events
  // are intentionally allowed so the UI can refresh connection state.
  this->set_phase_("listening");
  // New wake word starts a fresh session — drop any pending or active
  // follow-up window from the previous turn.
  this->followup_pending_ = false;
  this->thanks_pending_ = false;
  this->waiting_for_speaker_stop_ = false;
  this->request_follow_up_pending_ = false;
  this->followup_armed_ = false;
  this->idle_emit_pending_ = false;
  this->suppress_followup_ = false;
  // A genuine new turn starts here — drop the post-stop `thinking` guard so
  // this turn's `thinking` shows normally. (Set last, AFTER the residual-reply
  // send_interrupt() above re-set it, so the wake always ends with it clear.)
  this->post_stop_guard_ = false;
  this->cancel_timeout("va_followup");
  this->cancel_timeout("va_followup_open");
  this->cancel_timeout("va_tts_tail");
  this->cancel_timeout("va_interrupt_tail");
  this->cancel_timeout("va_thanks");
  // Anchor turn-latency timestamps for the new turn.
  this->turn_t_wake_ = millis();
  this->turn_t_listening_ = 0;
  this->turn_t_thinking_ = 0;
  this->turn_t_first_audio_out_ = 0;
  // Reset audio-quality detectors for this turn.
  this->last_binary_ms_ = 0;
  this->ws_gap_count_ = 0;
  this->ws_gap_max_ms_ = 0;
  this->clipped_samples_ = 0;
  this->underrun_logged_this_turn_ = false;
  // Watchdog: if server doesn't hear us within kNoSpeechTimeoutMs, abort the
  // session so we're not stuck with the mic open after a misfire.
  this->set_timeout("va_no_speech", kNoSpeechTimeoutMs, [this]() {
    ESP_LOGI(TAG, "no speech detected for %u ms — aborting session",
             (unsigned) kNoSpeechTimeoutMs);
    this->send_mic_flush_();
    this->set_streaming_(false);
    this->turn_t_wake_ = 0;
    // Force LED back to idle from yaml side.
    this->defer([this]() {
      for (auto *t : this->phase_triggers_) {
        t->trigger("idle");
      }
    });
  });
}

void VaPipecat::open_followup_window_(uint32_t duration_ms) {
  // If a phase=idle LED transition was held back while audio drained, fire
  // it now so the LED goes to idle in sync with the speaker actually going
  // quiet (instead of as soon as the server emitted response.done).
  if (this->idle_emit_pending_) {
    this->idle_emit_pending_ = false;
    this->defer([this]() {
      for (auto *t : this->phase_triggers_) {
        t->trigger("idle");
      }
    });
    // Per-turn latency summary. Anchors are zero if we skipped a milestone
    // (e.g. interrupt mid-reply); show "?" so the line stays readable.
    if (this->turn_t_wake_ != 0) {
      uint32_t now = millis();
      auto fmt = [](uint32_t from, uint32_t to) -> std::string {
        if (from == 0 || to == 0 || to < from)
          return "?";
        return std::to_string(to - from) + "ms";
      };
      ESP_LOGI(TAG,
               "turn latency: wake→listening=%s listening→thinking=%s "
               "thinking→first_audio=%s first_audio→played_out=%s "
               "total=%s",
               fmt(this->turn_t_wake_, this->turn_t_listening_).c_str(),
               fmt(this->turn_t_listening_, this->turn_t_thinking_).c_str(),
               fmt(this->turn_t_thinking_, this->turn_t_first_audio_out_).c_str(),
               fmt(this->turn_t_first_audio_out_, now).c_str(),
               fmt(this->turn_t_wake_, now).c_str());
      // Audio-quality summary: only logged if anything anomalous fired.
      // A clean turn produces no line — keeps the noise floor low.
      if (this->ws_gap_count_ > 0 || this->clipped_samples_ > 0 ||
          this->underrun_logged_this_turn_) {
        ESP_LOGW(TAG,
                 "turn audio: ws_gaps=%u (max=%ums) clipped_samples=%u underrun=%s",
                 (unsigned) this->ws_gap_count_,
                 (unsigned) this->ws_gap_max_ms_,
                 (unsigned) this->clipped_samples_,
                 this->underrun_logged_this_turn_ ? "yes" : "no");
      }
      this->turn_t_wake_ = 0;  // mark turn as logged
    }
  }
  if (duration_ms == 0) {
    // Follow-up disabled for this call: turn-based behaviour like the
    // original pipeline. Leave the mic closed; user must say a wake word
    // for the next turn. (The LED idle was already emitted above / by the
    // set_phase_ tail.)
    this->set_streaming_(false);
    return;
  }
  // Follow-up dialog window. We do NOT open the mic immediately: has_buffered_
  // data() (the drain signal that got us here) goes false ~500 ms before true
  // silence — there's still the i2s ring + DAC tail playing out. Opening the
  // mic now would let that tail leak back in and false-trigger
  // the server VAD. So wait followup_open_delay_ms_ (from the backend) for the
  // tail to clear, THEN open the mic and show `listening` so the user can see
  // the device is waiting for them to answer (without a wake word). The LED
  // stays idle (emitted just above) during this short gap. Any new turn / wake /
  // stop / interrupt cancels "va_followup_open" before it fires (see set_phase_,
  // start_session, send_interrupt), so a new turn won't reopen the mic under it.
  const uint32_t open_delay = this->followup_open_delay_ms_;
  ESP_LOGI(TAG, "follow-up: mic opens in %u ms, then listening for %u ms",
           (unsigned) open_delay, (unsigned) duration_ms);
  this->set_timeout("va_followup_open", open_delay, [this, duration_ms]() {
    if (!this->ws_connected_) {
      // The reply drained into a dead connection (WS dropped mid-reply).
      // Opening the mic would show a "listening" LED while on_mic_data_
      // drops every frame — a window the user talks into for nothing.
      // Leave the LED on idle; a fresh wake after reconnect starts clean.
      ESP_LOGI(TAG, "follow-up window skipped — WS disconnected");
      return;
    }
    ESP_LOGI(TAG, "follow-up window open (mic on, listening for %u ms)", (unsigned) duration_ms);
    this->set_streaming_(true);
    this->fire_phase_led_("listening");  // blue ring: user may answer now
    this->set_timeout("va_followup", duration_ms, [this]() {
      if (this->streaming_) {
        ESP_LOGI(TAG, "follow-up window expired — mic streaming off");
        this->set_streaming_(false);
        this->send_mic_flush_();        // drop any uncommitted partial utterance
        this->fire_phase_led_("idle");  // no answer came; back to idle
      }
    });
  });
}

void VaPipecat::send_mic_flush_() {
  // The mic gate just closed mid-stream because a follow-up window timed out.
  // If the user had started (but not finished) speaking, that audio sits
  // uncommitted in the backend input buffer; left there, a later wake's
  // audio "completes" it and the model answers a stale half-sentence. Drop it
  // NOW, at the cut-off, so no reactive clear-on-wake is needed (that disturbed
  // the server VAD and caused garbage commits). This timer only fires when the
  // user did NOT trigger speech — `listening` cancels va_followup — so it can
  // never drop a valid command. Cheap no-op when the buffer was empty.
  if (this->ws_connected_ && this->ws_handle_ != nullptr) {
    const char msg[] = "{\"type\":\"flush\"}";
    this->ws_send_text_(msg, sizeof(msg) - 1, kWsControlSendTimeout);
    ESP_LOGI(TAG, "follow-up window closed — sent flush (drop uncommitted mic audio)");
  }
}

void VaPipecat::send_wake_() {
  // Tell the backend a fresh wake started (dangling-VAD guard, A). Until the
  // user actually speaks this turn, server VAD can still fire an
  // end-of-turn for a PREVIOUS utterance that never closed (the reply gated the
  // mic mid-sentence) — committing it auto-creates a garbage answer to an empty
  // turn. The backend uses this signal to suppress that stale thinking + cancel
  // the racing response. Sent on every start_session(); old backends ignore it.
  if (this->ws_connected_ && this->ws_handle_ != nullptr) {
    const char msg[] = "{\"type\":\"wake\"}";
    this->ws_send_text_(msg, sizeof(msg) - 1, kWsControlSendTimeout);
    ESP_LOGI(TAG, "wake — sent {\"type\":\"wake\"} (dangling-VAD guard)");
  }
}

void VaPipecat::fire_phase_led_(const std::string &phase) {
  // Drive the yaml on_phase automation (LED ring + voice_assistant_phase global)
  // from a device-side timer, not a server message. Marshalled via defer() so it
  // runs on the main loop even if called from another task.
  std::string phase_copy = phase;
  this->defer([this, phase_copy]() {
    for (auto *t : this->phase_triggers_) {
      t->trigger(phase_copy);
    }
  });
}

void VaPipecat::fire_transcript_(const std::string &role, const std::string &text) {
  std::string role_copy = role;
  std::string text_copy = text;
  this->defer([this, role_copy, text_copy]() {
    for (auto *t : this->transcript_triggers_) {
      t->trigger(role_copy, text_copy);
    }
  });
}

void VaPipecat::update_audio_level_(std::atomic<uint16_t> &target, const int16_t *samples, size_t sample_count,
                                    size_t step) {
  if (samples == nullptr || sample_count == 0)
    return;
  if (step == 0)
    step = 1;

  uint64_t absolute_sum = 0;
  uint32_t peak = 0;
  size_t measured = 0;
  for (size_t index = 0; index < sample_count; index += step) {
    const int32_t sample = samples[index];
    const uint32_t absolute = sample < 0 ? static_cast<uint32_t>(-sample) : static_cast<uint32_t>(sample);
    absolute_sum += absolute;
    peak = std::max(peak, absolute);
    measured++;
  }
  if (measured == 0)
    return;

  const uint32_t mean = static_cast<uint32_t>(absolute_sum / measured);
  // Mean absolute amplitude is stable enough for animation while the small
  // peak contribution keeps consonants visible. The gain maps ordinary speech
  // into the useful middle of Q15 without a costly FFT or square root.
  const uint32_t envelope = ((mean * 3U + peak) / 4U) * 8U;
  target.store(static_cast<uint16_t>(std::min<uint32_t>(32767U, envelope)), std::memory_order_relaxed);
}

void VaPipecat::publish_audio_levels_() {
  if (this->audio_level_triggers_.empty())
    return;

  const uint32_t now = millis();
  if (now - this->last_audio_level_publish_ms_ < kAudioLevelPublishIntervalMs)
    return;
  this->last_audio_level_publish_ms_ = now;

  const uint32_t last_input_audio_ms = this->last_input_audio_ms_.load(std::memory_order_relaxed);
  const uint32_t last_output_audio_ms = this->last_output_audio_ms_.load(std::memory_order_relaxed);
  const uint16_t input_target =
      now - last_input_audio_ms <= 100 ? this->input_level_q15_.load(std::memory_order_relaxed) : 0;
  const uint16_t output_target =
      now - last_output_audio_ms <= 100 ? this->output_level_q15_.load(std::memory_order_relaxed) : 0;

  const auto smooth = [](uint16_t current, uint16_t target) -> uint16_t {
    const int32_t delta = static_cast<int32_t>(target) - current;
    const int32_t divisor = delta >= 0 ? 3 : 6;
    const int32_t next = static_cast<int32_t>(current) + delta / divisor;
    return static_cast<uint16_t>(std::max<int32_t>(0, std::min<int32_t>(32767, next)));
  };
  this->published_input_level_q15_ = smooth(this->published_input_level_q15_, input_target);
  this->published_output_level_q15_ = smooth(this->published_output_level_q15_, output_target);

  const auto phase = static_cast<Phase>(this->current_phase_.load(std::memory_order_relaxed));
  if (phase == Phase::IDLE && this->published_input_level_q15_ < 8 && this->published_output_level_q15_ < 8)
    return;

  const float input_level = static_cast<float>(this->published_input_level_q15_) / 32767.0f;
  const float output_level = static_cast<float>(this->published_output_level_q15_) / 32767.0f;
  for (auto *trigger : this->audio_level_triggers_)
    trigger->trigger(input_level, output_level);
}

void VaPipecat::fire_error_(const std::string &code, const std::string &message) {
  const std::string code_copy = code;
  const std::string message_copy = message;
  this->defer([this, code_copy, message_copy]() {
    if (this->error_triggers_.empty()) {
      // Backward-compatible fallback for configurations that only provide a
      // generic connectivity/error notification.
      for (auto *trigger : this->repeated_failure_triggers_) {
        trigger->trigger();
      }
      return;
    }
    for (auto *trigger : this->error_triggers_) {
      trigger->trigger(code_copy, message_copy);
    }
  });
}

void VaPipecat::commit_followup_mic() {
  // Called from yaml's on_followup_opened automation once the chime has
  // finished playing AND the i2s tail has cleared (wait_until + delay).
  // If anything pre-empted us between trigger fire and here (a fresh
  // wake word, a Stop, send_interrupt, or a new turn starting) the
  // armed flag was cleared — silently no-op so we don't reopen the mic
  // out of nowhere.
  if (!this->followup_armed_) {
    ESP_LOGD(TAG, "commit_followup_mic: not armed, ignoring");
    return;
  }
  this->followup_armed_ = false;
  ESP_LOGI(TAG, "follow-up mic armed by yaml (window %u ms)",
           (unsigned) kRequestFollowUpMs);
  this->set_streaming_(true);
  this->set_timeout("va_followup", kRequestFollowUpMs, [this]() {
    if (this->streaming_) {
      ESP_LOGI(TAG, "follow-up window expired — mic streaming off");
      this->set_streaming_(false);
      this->send_mic_flush_();  // drop any uncommitted partial utterance
    }
  });
}

void VaPipecat::cancel_turn_(const char *message_type) {
  // Best-effort cancel to the backend — ONLY if the socket is alive. The local
  // cleanup below must ALWAYS run: returning early on a dead socket (the old
  // behaviour) left streaming_ on, the PSRAM ring full and the follow-up timers
  // armed after a "stop" on a dead link, so the mic would resume streaming the
  // room the instant we reconnected.
  if (this->ws_connected_ && this->ws_handle_ != nullptr) {
    const std::string msg = std::string("{\"type\":\"") + message_type + "\"}";
    this->ws_send_text_(msg.c_str(), msg.size(), kWsControlSendTimeout);
  } else {
    ESP_LOGW(TAG, "send_interrupt: WS not connected — local cleanup only");
  }
  // Flush our PSRAM playback queue — what's already been pushed into the
  // resampler/mixer/leaf will still drain (~600 ms residual), but everything
  // we have yet to hand off is dropped. The yaml side stops the resampler
  // explicitly. Reset deferred state too so we don't accidentally hold an
  // "idle" emit waiting for the (now-empty) queue. The ring reset has to
  // happen under the mux: the WS task could be mid-write and seeing
  // head=tail=fill=0 partway through would let it write into a "freshly
  // empty" buffer the user just barge-cancelled.
  const size_t flushed_bytes = this->flush_playback_queue_();
  // Drop further incoming TTS until the backend confirms the turn boundary —
  // it keeps streaming the rest of the (already-generated) reply otherwise.
  this->suppress_incoming_audio_ = true;
  // Close the mic gate. An interrupt during the OPEN follow-up window would
  // otherwise leave streaming_ true while the va_followup close-timer gets
  // cancelled just below — mic open and streaming indefinitely, so any
  // later room speech becomes an unprompted turn. Callers that start a fresh
  // turn (start_session) re-open it themselves right after.
  this->set_streaming_(false);
  this->followup_pending_ = false;
  this->thanks_pending_ = false;
  this->waiting_for_speaker_stop_ = false;
  this->request_follow_up_pending_ = false;
  this->followup_armed_ = false;
  this->idle_emit_pending_ = false;
  this->cancel_timeout("va_no_speech");
  this->cancel_timeout("va_followup");
  this->cancel_timeout("va_tts_tail");
  this->cancel_timeout("va_interrupt_tail");
  this->cancel_timeout("va_thanks");
  // The phase=idle the server is about to send shouldn't open a follow-up
  // mic window — the user said "stop", not "wait for me to keep talking".
  this->suppress_followup_ = true;
  // Mic gate is now closed: no new turn can begin until a wake. Ignore any
  // `thinking` the backend emits in the meantime — it's the server VAD's
  // end-of-turn for the utterance we just cancelled, not a real new turn.
  // Cleared in start_session() (the next wake). See set_phase_.
  this->post_stop_guard_ = true;
  this->cancel_timeout("va_followup_open");
  // Report how much already-buffered TTS we just dropped — i.e. how much of the
  // (burst-complete) reply the user did NOT hear. If stale audio ever bleeds into
  // the next turn, this number + the next "Phase ->" tell the story.
  ESP_LOGI(TAG, "send_interrupt — WS msg sent; flushed %u bytes (~%u ms) of queued TTS, suppressing further audio until next turn",
           (unsigned) flushed_bytes,
           (unsigned) (flushed_bytes / (kPlaybackSampleRate / 1000 * 2)));
}

void VaPipecat::send_interrupt() {
  this->cancel_turn_("interrupt");
}

void VaPipecat::end_session() {
  this->cancel_turn_("stop");
  this->set_streaming_(false);
  this->followup_pending_ = false;
  this->thanks_pending_ = false;
  this->waiting_for_speaker_stop_ = false;
  this->request_follow_up_pending_ = false;
  this->followup_armed_ = false;
  this->idle_emit_pending_ = false;
  this->suppress_followup_ = true;
  this->post_stop_guard_ = true;
  this->cancel_timeout("va_no_speech");
  this->cancel_timeout("va_followup");
  this->cancel_timeout("va_followup_open");
  this->cancel_timeout("va_tts_tail");
  this->cancel_timeout("va_interrupt_tail");
  this->cancel_timeout("va_thanks");
  this->fire_phase_led_("idle");
}

}  // namespace va_pipecat
}  // namespace esphome
