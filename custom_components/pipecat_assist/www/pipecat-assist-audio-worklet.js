/* Stateful low-pass resampling: browser microphone -> mono PCM16 at 16 kHz. */
class PipecatMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.position = 0;
    this.ring = new Float32Array(63);
    this.cursor = 0;
    this.taps = new Float32Array(this.ring.length);
    const cutoff = Math.min(0.45, 7200 / sampleRate);
    const middle = (this.taps.length - 1) / 2;
    let sum = 0;
    for (let i = 0; i < this.taps.length; i++) {
      const x = i - middle;
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (this.taps.length - 1));
      this.taps[i] = sinc * window;
      sum += this.taps[i];
    }
    for (let i = 0; i < this.taps.length; i++) this.taps[i] /= sum;
    this.packet = new DataView(new ArrayBuffer(640));
    this.offset = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let input = 0;
      for (const channel of channels) input += channel[i];
      this.ring[this.cursor] = input / channels.length;
      this.cursor = (this.cursor + 1) % this.ring.length;
      this.position += 1;
      if (this.position < this.ratio) continue;
      this.position -= this.ratio;
      let value = 0;
      for (let j = 0; j < this.taps.length; j++) {
        value += this.ring[(this.cursor + this.ring.length - 1 - j) % this.ring.length] * this.taps[j];
      }
      value = Math.max(-1, Math.min(1, value));
      this.packet.setInt16(this.offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      this.offset += 2;
      if (this.offset === this.packet.byteLength) {
        this.port.postMessage(this.packet.buffer, [this.packet.buffer]);
        this.packet = new DataView(new ArrayBuffer(640));
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("pipecat-microphone", PipecatMicrophone);
