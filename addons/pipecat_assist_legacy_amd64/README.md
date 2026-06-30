# Pipecat Assist Legacy amd64

Use this add-on on older amd64 Home Assistant hosts that fail to start the
standard Pipecat Assist add-on with a NumPy `X86_V2` CPU baseline error.

This variant is built from the same Pipecat Assist source as the standard
add-on, but constrains NumPy to a wheel line compatible with older x86_64 CPUs.
Use the standard add-on on newer amd64 systems and on aarch64.
