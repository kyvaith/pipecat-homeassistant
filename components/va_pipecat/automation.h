#pragma once

#include "esphome/core/automation.h"
#include "va_pipecat.h"

#include <string>

namespace esphome {
namespace va_pipecat {

class OnPhaseTrigger : public Trigger<std::string> {
 public:
  explicit OnPhaseTrigger(VaPipecat *parent) { parent->add_on_phase_trigger(this); }
};

class OnTranscriptTrigger : public Trigger<std::string, std::string> {
 public:
  explicit OnTranscriptTrigger(VaPipecat *parent) { parent->add_on_transcript_trigger(this); }
};

class OnAudioLevelTrigger : public Trigger<float, float> {
 public:
  explicit OnAudioLevelTrigger(VaPipecat *parent) { parent->add_on_audio_level_trigger(this); }
};

class OnRepeatedFailureTrigger : public Trigger<> {
 public:
  explicit OnRepeatedFailureTrigger(VaPipecat *parent) {
    parent->add_on_repeated_failure_trigger(this);
  }
};

// Fires when the device opens a follow-up mic window (i.e. server's
// request_follow_up message landed and the audio buffer has drained).
// yaml uses this to play the wake chime + flip the LED to "listening"
// so the user knows the assistant is waiting for their answer.
class OnFollowupOpenedTrigger : public Trigger<> {
 public:
  explicit OnFollowupOpenedTrigger(VaPipecat *parent) {
    parent->add_on_followup_opened_trigger(this);
  }
};

class OnErrorTrigger : public Trigger<std::string, std::string> {
 public:
  explicit OnErrorTrigger(VaPipecat *parent) { parent->add_on_error_trigger(this); }
};

template<typename... Ts> class StartAction final : public Action<Ts...> {
 public:
  explicit StartAction(VaPipecat *parent) : parent_(parent) {}
  void play(const Ts &...x) override { this->parent_->start_session(); }

 protected:
  VaPipecat *parent_;
};

template<typename... Ts> class InterruptAction final : public Action<Ts...> {
 public:
  explicit InterruptAction(VaPipecat *parent) : parent_(parent) {}
  void play(const Ts &...x) override { this->parent_->send_interrupt(); }

 protected:
  VaPipecat *parent_;
};

template<typename... Ts> class StopAction final : public Action<Ts...> {
 public:
  explicit StopAction(VaPipecat *parent) : parent_(parent) {}
  void play(const Ts &...x) override { this->parent_->end_session(); }

 protected:
  VaPipecat *parent_;
};

template<typename... Ts> class SetUrlAction final : public Action<Ts...> {
 public:
  explicit SetUrlAction(VaPipecat *parent) : parent_(parent) {}
  TEMPLATABLE_VALUE(std::string, url)
  void play(const Ts &...x) override { this->parent_->set_url(this->url_.value(x...)); }

 protected:
  VaPipecat *parent_;
};

template<typename... Ts> class SetVolumeAction final : public Action<Ts...> {
 public:
  explicit SetVolumeAction(VaPipecat *parent) : parent_(parent) {}
  TEMPLATABLE_VALUE(float, volume)
  void play(const Ts &...x) override { this->parent_->set_volume(this->volume_.value(x...)); }

 protected:
  VaPipecat *parent_;
};

template<typename... Ts> class ConnectedCondition final : public Condition<Ts...> {
 public:
  explicit ConnectedCondition(VaPipecat *parent) : parent_(parent) {}
  bool check(const Ts &...x) override { return this->parent_->is_connected(); }

 protected:
  VaPipecat *parent_;
};

}  // namespace va_pipecat
}  // namespace esphome
