# Runtime Upgrade Validation

Unit tests and a successful container build do not prove voice quality. Use
the following checks before deploying a runtime upgrade to a household.

## Automated checks

```bash
python -m pip install -e addons/pipecat_assist PyYAML
python -m unittest discover -s tests -v
node --test tests/test_card_audio.cjs
docker build -t pipecat-assist:qa addons/pipecat_assist
docker run --rm --entrypoint python3 pipecat-assist:qa -m pip check
docker build --build-arg LEGACY_AMD64_NUMPY=true \
  -t pipecat-assist:qa-legacy addons/pipecat_assist
```

Tests cover service construction and settings, not paid-provider account
permissions or every hardware architecture. CI runs the suite inside both
amd64 images. ARM64 image publication is a separate build.

## Isolated installation

Back up the add-on data and custom component before changing a running
installation. Test on a copy of the configuration, with a different port,
bound to localhost. Set `ESPHOME_PROVISIONING_ENABLED=false` on that test
process so it cannot redirect real satellites to the test server. Keep
provider keys and the Supervisor token outside the repository and logs.

## Real voice paths

Use a synthetic mono PCM16, 16 kHz WAV containing a short test question. Never
commit household audio or a configuration containing secrets.

```bash
python tests/manual_voice_regression.py --base http://127.0.0.1:17860 \
  --audio /private/input.wav --flow-id home-default --transport ha --repeat 2
python tests/manual_voice_regression.py --base http://127.0.0.1:17860 \
  --audio /private/input.wav --flow-id home-default --transport webrtc --repeat 2
python tests/manual_mcp_regression.py --native
python tests/manual_mcp_regression.py
```

The HA check exercises streamed STT, conversation, and TTS endpoints. The WebRTC
check sends actual microphone PCM through an aiortc peer and receives decoded
audio and RTVI transcripts. Repeat on the old runtime with identical settings
and input. Compare end-of-speech to audio latency, repeat-turn behavior,
transcripts, codec, sample rate, and channels. Listen on the actual target
device too: these checks cannot prove Android audio routing or perceived
voice quality.

For the ESPHome transport, use `tests/manual_va_pipecat_smoke.py` with the
private token in `VA_PIPECAT_TOKEN`, then test wake word, follow-up, barge-in,
and end-of-conversation on a physical satellite. A protocol test is not a
firmware or device-display test.

Also test the light/dark UI, opening and saving an existing pipeline, starting
and stopping a conversation, tool errors, an invalid provider key, and MCP
disconnection. Report untested providers or hardware explicitly. Never treat
a fallback to a different model or provider as a passing test.

## Dashboard audio relay

Use an isolated HA Core with the candidate custom component and app. Open the
real HA dashboard in a browser with microphone permission and normal autoplay
restrictions. Do not pass a browser flag that disables autoplay protection.
Verify that one Talk click starts audible output, without an Enable audio
button. Repeat start/stop, check microphone release and transcript cleanup,
and test both speech-to-speech and composed pipelines, including no greeting.

Block direct WebRTC or LAN media connectivity and confirm the default card still
receives audio through HA's WebSocket API. Test an actual remote HTTPS dashboard
and mobile device separately. Simulating blocked WebRTC does not prove cellular
coverage, Android sound routing, or subjective speaker quality.

Check that another authenticated connection cannot control a stream it did not
create, invalid audio packets terminate only their own stream, and disconnects
or provider failures release the binary handler and subscription. Add-on bearer
credentials must stay on the HA server, not in dashboard configuration or URLs.
