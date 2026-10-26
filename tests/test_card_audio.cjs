const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function cardClass() {
  let Card;
  const context = vm.createContext({
    HTMLElement: class {}, console, TextDecoder, Uint8Array, DataView, Set, Map,
    atob, navigator: {}, document: { querySelectorAll: () => [] },
    window: {}, MutationObserver: class { observe() {} },
    customElements: { get() {}, define(name, value) { Card = value; } },
    requestAnimationFrame() {}, setTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'custom_components/pipecat_assist/www/pipecat-assist-card.js'), 'utf8'), context);
  return { Card, context };
}

test('audio is primed before the first network or microphone await', async () => {
  const { Card, context } = cardClass();
  const card = new Card();
  const order = [];
  context.navigator.mediaDevices = { getUserMedia: async () => { order.push('microphone'); throw Error('test stop'); } };
  card.t = key => key;
  card.primePlayback = () => { order.push('audio'); return Promise.resolve(); };
  card.render = card.clearTranscriptData = card.cancelLocalSpeechResume = card.resetAudioElement = card.fail = () => {};
  card.waitForAudioSessionRelease = async () => {};
  card.loadAddonConfig = async () => { order.push('network'); return {}; };
  await card.start();
  assert.deepEqual(order, ['audio', 'network', 'microphone']);
});

test('PCM playback keeps the configured prebuffer without adding it to every packet', () => {
  const { Card } = cardClass();
  const card = new Card();
  const starts = [];
  card.t = key => key;
  card.audioBufferMs = () => 120;
  card.playbackNodes = new Set();
  card.playbackContext = { state: 'running', currentTime: 0,
    createBuffer: (_, size, rate) => ({ duration: size / rate, getChannelData: () => new Float32Array(size) }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start(at) { starts.push(at); } }) };
  const packet = Buffer.alloc(1920).toString('base64');
  card.playPcm(packet);
  card.playbackContext.currentTime = 0.07;
  card.playPcm(packet);
  assert.equal(starts[0], 0.12);
  assert.equal(starts[1], 0.16);
});

for (const sampleRate of [48000, 44100]) {
  test(`worklet produces PCM16 at 16 kHz from ${sampleRate} Hz with anti-alias filtering`, () => {
    let Processor;
    const packets = [];
    const context = vm.createContext({ sampleRate, AudioWorkletProcessor: class { constructor() { this.port = { postMessage(data) { packets.push(new Uint8Array(data)); } }; } },
      registerProcessor(_, value) { Processor = value; }, Float32Array, DataView, ArrayBuffer, Math });
    vm.runInContext(fs.readFileSync(path.join(root, 'custom_components/pipecat_assist/www/pipecat-assist-audio-worklet.js'), 'utf8'), context);
    function rms(frequency) {
      packets.length = 0;
      const processor = new Processor();
      for (let offset = 0; offset < sampleRate; offset += 128) {
        const input = Float32Array.from({ length: Math.min(128, sampleRate - offset) }, (_, i) => Math.sin(2 * Math.PI * frequency * (offset + i) / sampleRate) * 0.5);
        processor.process([[input]]);
      }
      assert.ok(Math.abs(packets.length * 320 - 16000) <= 320);
      const bytes = Buffer.concat(packets.map(p => Buffer.from(p)));
      const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    }
    assert.ok(rms(12000) < rms(1000) * 0.03);
  });
}
