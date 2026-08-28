// Single shared AudioContext for the whole suite.
// Created lazily on the first user gesture (browser autoplay policy).

let ctx = null;
let master = null;

// `context` lets a test (or an offline render) supply its own AudioContext
// instead of the live one.
export function initAudio({ context = null } = {}) {
  if (ctx) return ctx;
  ctx = context || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });

  // Master bus: sum -> soft limiter -> output. The limiter keeps six modules
  // patched together from clipping the moment everything plays at once.
  const sum = ctx.createGain();
  sum.gain.value = 0.8;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;

  sum.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(ctx.destination);

  master = { input: sum, gain: sum.gain, analyser };
  return ctx;
}

export function getCtx() {
  if (!ctx) throw new Error('AudioContext not initialised — call initAudio() first');
  return ctx;
}

export function getMaster() {
  if (!master) throw new Error('Master bus not initialised — call initAudio() first');
  return master;
}

export async function resumeAudio() {
  const c = initAudio();
  if (c.state === 'suspended') await c.resume();
  return c;
}

// Test hook: drops the singleton so a fresh context can be installed.
export function _resetAudio() {
  ctx = null;
  master = null;
  noiseBuffer = null;
}

// A channel strip every module routes through: level, pan, mute, metering.
export function createChannel({ label = '', gain = 0.8 } = {}) {
  const c = getCtx();

  const input = c.createGain();
  const level = c.createGain();
  const pan = c.createStereoPanner();
  const analyser = c.createAnalyser();
  analyser.fftSize = 512;

  level.gain.value = gain;

  input.connect(level);
  level.connect(pan);
  pan.connect(analyser);
  analyser.connect(getMaster().input);

  let muted = false;
  let userGain = gain;

  return {
    label,
    input,
    analyser,
    get gain() { return userGain; },
    setGain(v) {
      userGain = v;
      if (!muted) level.gain.setTargetAtTime(v, c.currentTime, 0.01);
    },
    setPan(v) { pan.pan.setTargetAtTime(v, c.currentTime, 0.01); },
    setMute(m) {
      muted = m;
      level.gain.setTargetAtTime(m ? 0 : userGain, c.currentTime, 0.01);
    },
    get muted() { return muted; }
  };
}

// Shared white-noise buffer — one allocation reused by every noise-based voice.
let noiseBuffer = null;
export function getNoiseBuffer() {
  const c = getCtx();
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

export function noiseSource({ loop = true } = {}) {
  const src = getCtx().createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = loop;
  return src;
}
