import esphome.codegen as cg
import esphome.config_validation as cv
from esphome import automation, final_validate as fv
from esphome.components import api, esp32, microphone, speaker
from esphome.const import (
    CONF_ID,
    CONF_ON_ERROR,
    CONF_TRIGGER_ID,
    CONF_URL,
    CONF_VOLUME,
)

CODEOWNERS = ["@kyvaith"]
DEPENDENCIES = ["api", "network", "microphone", "speaker", "psram"]

CONF_MICROPHONE = "microphone"
CONF_SPEAKER = "speaker"
CONF_AUTO_PROVISION = "auto_provision"
CONF_BARGE_IN = "barge_in"
CONF_PLAYBACK_BUFFER_SIZE = "playback_buffer_size"
CONF_ON_PHASE = "on_phase"
CONF_ON_TRANSCRIPT = "on_transcript"
CONF_ON_REPEATED_FAILURE = "on_repeated_failure"
CONF_ON_FOLLOWUP_OPENED = "on_followup_opened"


def validate_websocket_url(value):
    value = cv.string_strict(value)
    if value and not value.startswith(("ws://", "wss://")):
        raise cv.Invalid("URL must start with ws:// or wss://")
    return value


va_pipecat_ns = cg.esphome_ns.namespace("va_pipecat")
VaPipecat = va_pipecat_ns.class_("VaPipecat", cg.Component)
OnPhaseTrigger = va_pipecat_ns.class_(
    "OnPhaseTrigger", automation.Trigger.template(cg.std_string)
)
OnTranscriptTrigger = va_pipecat_ns.class_(
    "OnTranscriptTrigger", automation.Trigger.template(cg.std_string, cg.std_string)
)
OnRepeatedFailureTrigger = va_pipecat_ns.class_(
    "OnRepeatedFailureTrigger", automation.Trigger.template()
)
OnFollowupOpenedTrigger = va_pipecat_ns.class_(
    "OnFollowupOpenedTrigger", automation.Trigger.template()
)
OnErrorTrigger = va_pipecat_ns.class_(
    "OnErrorTrigger", automation.Trigger.template(cg.std_string, cg.std_string)
)
StartAction = va_pipecat_ns.class_("StartAction", automation.Action)
InterruptAction = va_pipecat_ns.class_("InterruptAction", automation.Action)
StopAction = va_pipecat_ns.class_("StopAction", automation.Action)
SetUrlAction = va_pipecat_ns.class_("SetUrlAction", automation.Action)
SetVolumeAction = va_pipecat_ns.class_("SetVolumeAction", automation.Action)
ConnectedCondition = va_pipecat_ns.class_("ConnectedCondition", automation.Condition)

CONFIG_SCHEMA = cv.All(
    cv.Schema(
        {
            cv.GenerateID(): cv.declare_id(VaPipecat),
            cv.Optional(CONF_URL, default=""): validate_websocket_url,
            cv.Optional(CONF_AUTO_PROVISION, default=True): cv.boolean,
            cv.Required(CONF_MICROPHONE): microphone.microphone_source_schema(
                min_bits_per_sample=16,
                max_bits_per_sample=16,
                min_channels=1,
                max_channels=1,
            ),
            cv.Optional(CONF_BARGE_IN, default=True): cv.boolean,
            cv.Optional(CONF_PLAYBACK_BUFFER_SIZE, default="2MB"): cv.All(
                cv.validate_bytes,
                cv.int_range(min=64 * 1024, max=4 * 1024 * 1024),
            ),
            cv.Required(CONF_SPEAKER): cv.use_id(speaker.Speaker),
            cv.Optional(CONF_ON_PHASE): automation.validate_automation(
                {
                    cv.GenerateID(CONF_TRIGGER_ID): cv.declare_id(OnPhaseTrigger),
                }
            ),
            cv.Optional(CONF_ON_TRANSCRIPT): automation.validate_automation(
                {
                    cv.GenerateID(CONF_TRIGGER_ID): cv.declare_id(OnTranscriptTrigger),
                }
            ),
            cv.Optional(CONF_ON_REPEATED_FAILURE): automation.validate_automation(
                {
                    cv.GenerateID(CONF_TRIGGER_ID): cv.declare_id(
                        OnRepeatedFailureTrigger
                    ),
                }
            ),
            cv.Optional(CONF_ON_FOLLOWUP_OPENED): automation.validate_automation(
                {
                    cv.GenerateID(CONF_TRIGGER_ID): cv.declare_id(
                        OnFollowupOpenedTrigger
                    ),
                }
            ),
            cv.Optional(CONF_ON_ERROR): automation.validate_automation(
                {
                    cv.GenerateID(CONF_TRIGGER_ID): cv.declare_id(OnErrorTrigger),
                }
            ),
        }
    ).extend(cv.COMPONENT_SCHEMA),
    cv.only_on_esp32,
    cv.only_with_framework("esp-idf"),
)


def _final_validate(config):
    if config[CONF_AUTO_PROVISION]:
        api_config = fv.full_config.get().get("api")
        if api_config is None or not api_config.get(api.CONF_CUSTOM_SERVICES, False):
            raise cv.Invalid(
                "auto_provision requires 'custom_services: true' in the api section"
            )
    elif not config[CONF_URL]:
        raise cv.Invalid("url is required when auto_provision is disabled")
    return config


FINAL_VALIDATE_SCHEMA = cv.All(
    cv.Schema(
        {
            cv.Required(
                CONF_MICROPHONE
            ): microphone.final_validate_microphone_source_schema(
                "va_pipecat", sample_rate=16000
            ),
        },
        extra=cv.ALLOW_EXTRA,
    ),
    _final_validate,
)


async def to_code(config):
    # esp-idf managed component providing esp_websocket_client.
    esp32.add_idf_component(
        name="espressif/esp_websocket_client",
        ref="1.7.0",
    )

    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)

    cg.add(var.set_url(config[CONF_URL]))
    cg.add(var.set_auto_provision(config[CONF_AUTO_PROVISION]))
    cg.add(var.set_barge_in(config[CONF_BARGE_IN]))
    cg.add(var.set_playback_buffer_size(config[CONF_PLAYBACK_BUFFER_SIZE]))

    # Own an active microphone source during realtime turns. The underlying
    # esp_audio_stack microphone is reference-counted, so this can run alongside
    # micro_wake_word while ensuring the realtime uplink never depends on another
    # component keeping the mic open.
    mic_source = await microphone.microphone_source_to_code(
        config[CONF_MICROPHONE], passive=False
    )
    cg.add(var.set_microphone_source(mic_source))

    spk = await cg.get_variable(config[CONF_SPEAKER])
    cg.add(var.set_speaker(spk))

    for conf in config.get(CONF_ON_PHASE, []):
        trigger = cg.new_Pvariable(conf[CONF_TRIGGER_ID], var)
        await automation.build_automation(trigger, [(cg.std_string, "phase")], conf)

    for conf in config.get(CONF_ON_TRANSCRIPT, []):
        trigger = cg.new_Pvariable(conf[CONF_TRIGGER_ID], var)
        await automation.build_automation(
            trigger,
            [(cg.std_string, "role"), (cg.std_string, "text")],
            conf,
        )

    for conf in config.get(CONF_ON_REPEATED_FAILURE, []):
        trigger = cg.new_Pvariable(conf[CONF_TRIGGER_ID], var)
        await automation.build_automation(trigger, [], conf)

    for conf in config.get(CONF_ON_FOLLOWUP_OPENED, []):
        trigger = cg.new_Pvariable(conf[CONF_TRIGGER_ID], var)
        await automation.build_automation(trigger, [], conf)

    for conf in config.get(CONF_ON_ERROR, []):
        trigger = cg.new_Pvariable(conf[CONF_TRIGGER_ID], var)
        await automation.build_automation(
            trigger,
            [(cg.std_string, "code"), (cg.std_string, "message")],
            conf,
        )


VA_ACTION_SCHEMA = automation.maybe_simple_id(
    {
        cv.GenerateID(): cv.use_id(VaPipecat),
    }
)


@automation.register_action(
    "va_pipecat.start", StartAction, VA_ACTION_SCHEMA, synchronous=True
)
@automation.register_action(
    "va_pipecat.interrupt", InterruptAction, VA_ACTION_SCHEMA, synchronous=True
)
@automation.register_action(
    "va_pipecat.stop", StopAction, VA_ACTION_SCHEMA, synchronous=True
)
async def va_pipecat_control_action_to_code(config, action_id, template_arg, args):
    parent = await cg.get_variable(config[CONF_ID])
    return cg.new_Pvariable(action_id, template_arg, parent)


SET_URL_ACTION_SCHEMA = cv.maybe_simple_value(
    {
        cv.GenerateID(): cv.use_id(VaPipecat),
        cv.Required(CONF_URL): cv.templatable(cv.string_strict),
    },
    key=CONF_URL,
)


@automation.register_action(
    "va_pipecat.set_url", SetUrlAction, SET_URL_ACTION_SCHEMA, synchronous=True
)
async def va_pipecat_set_url_action_to_code(config, action_id, template_arg, args):
    parent = await cg.get_variable(config[CONF_ID])
    var = cg.new_Pvariable(action_id, template_arg, parent)
    value = await cg.templatable(config[CONF_URL], args, cg.std_string)
    cg.add(var.set_url(value))
    return var


SET_VOLUME_ACTION_SCHEMA = cv.maybe_simple_value(
    {
        cv.GenerateID(): cv.use_id(VaPipecat),
        cv.Required(CONF_VOLUME): cv.templatable(cv.percentage),
    },
    key=CONF_VOLUME,
)


@automation.register_action(
    "va_pipecat.set_volume",
    SetVolumeAction,
    SET_VOLUME_ACTION_SCHEMA,
    synchronous=True,
)
async def va_pipecat_set_volume_action_to_code(config, action_id, template_arg, args):
    parent = await cg.get_variable(config[CONF_ID])
    var = cg.new_Pvariable(action_id, template_arg, parent)
    value = await cg.templatable(config[CONF_VOLUME], args, cg.float_)
    cg.add(var.set_volume(value))
    return var


@automation.register_condition(
    "va_pipecat.connected", ConnectedCondition, VA_ACTION_SCHEMA
)
async def va_pipecat_connected_condition_to_code(
    config, condition_id, template_arg, args
):
    parent = await cg.get_variable(config[CONF_ID])
    return cg.new_Pvariable(condition_id, template_arg, parent)
