// Headless smoke test: boots the whole rack against a stub Web Audio API and
// asserts that every module renders, every jack registers, patching actually
// wires nodes, and a full bar of clock steps runs without throwing.
//
//   node test/smoke.mjs
//
// jsdom has no Web Audio, so the stubs below record connections instead of
// making sound. That is enough to catch the failures that matter here: bad
// node graphs, missing params, and render-time crashes.

import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dir, '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- audio stub

const connections = [];

function param(value = 0) {
  return {
    value,
    setValueAtTime(v) { this.value = v; return this; },
    setTargetAtTime(v) { this.value = v; return this; },
    linearRampToValueAtTime(v) { this.value = v; return this; },
    exponentialRampToValueAtTime(v) { this.value = v; return this; },
    cancelScheduledValues() { return this; }
  };
}

function node(type, extra = {}) {
  return {
    type,
    connect(target) { connections.push([type, target?.type ?? 'param']); return target; },
    disconnect() {},
    start() {}, stop() {},
    ...extra
  };
}

class StubAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = node('destination');
  }
  resume() { return Promise.resolve(); }
  createGain() { return node('gain', { gain: param(1) }); }
  createOscillator() {
    return node('oscillator', { frequency: param(440), detune: param(0), onended: null });
  }
  createBiquadFilter() {
    return node('biquad', { frequency: param(1000), Q: param(1), gain: param(0) });
  }
  createWaveShaper() { return node('shaper', { curve: null, oversample: 'none' }); }
  createDynamicsCompressor() {
    return node('compressor', {
      threshold: param(-24), knee: param(30), ratio: param(12),
      attack: param(0.003), release: param(0.25)
    });
  }
  createAnalyser() {
    return node('analyser', {
      fftSize: 2048,
      getByteTimeDomainData(arr) { arr.fill(128); }
    });
  }
  createStereoPanner() { return node('panner', { pan: param(0) }); }
  createBufferSource() {
    return node('bufferSource', { buffer: null, loop: false, playbackRate: param(1), onended: null });
  }
  createScriptProcessor() {
    return node('script', { onaudioprocess: null });
  }
  createMediaStreamSource() { return node('streamSource'); }
  createBuffer(ch, len, rate) {
    const data = new Float32Array(len);
    return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: () => data };
  }
  createMediaStreamDestination() { return node('streamDest', { stream: {} }); }
  decodeAudioData() { return Promise.resolve(this.createBuffer(1, 48000, 48000)); }
}

// -------------------------------------------------------------------- jsdom

const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:3333/', pretendToBeVisual: true });
const { window } = dom;

global.window = window;
global.document = window.document;
// Node 21+ defines a getter-only global navigator, so it has to be redefined.
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
global.CustomEvent = window.CustomEvent;
global.Node = window.Node;
global.performance = window.performance;
global.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 16);
global.cancelAnimationFrame = clearTimeout;
global.AudioContext = StubAudioContext;
window.AudioContext = StubAudioContext;
global.ResizeObserver = window.ResizeObserver = class { observe() {} disconnect() {} };
global.MediaRecorder = window.MediaRecorder = class { start() {} stop() {} };
global.fetch = () => Promise.reject(new Error('offline in test'));

// jsdom lays nothing out, so every rect is zero — enough for the cable maths
// to run without NaN.
window.Element.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0 };
};
window.HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({}, {
    get: (_t, prop) => (prop === 'canvas' ? this : () => {})
  });
};

const load = (rel) => import(pathToFileURL(path.join(rootDir, rel)).href);

// --------------------------------------------------------------------- test

console.log('\nSUITE ROL — smoke test\n');

const { initAudio, getCtx, getMaster } = await load('js/core/audio-engine.js');
const { Clock } = await load('js/core/clock.js');
const { PatchGraph } = await load('js/core/patch-graph.js');
const { PatternBank, SLOT_NAMES } = await load('js/core/patterns.js');
const { Recorder } = await load('js/core/recorder.js');

initAudio();
ok(!!getCtx(), 'audio context initialised');
ok(!!getMaster().input, 'master bus built');

const clock = new Clock(getCtx(), { bpm: 130 });
ok(Math.abs(clock.stepDuration - 60 / 130 / 4) < 1e-9, 'step duration matches bpm');

const graph = new PatchGraph();

const voiceFiles = [
  ['js/modules/yeboah.js', 'Yeboah'],
  ['js/modules/juninho.js', 'Juninho'],
  ['js/modules/letissier.js', 'LeTissier'],
  ['js/modules/asprilla.js', 'Asprilla'],
  ['js/modules/zola.js', 'Zola']
];

const voices = [];
for (const [file, name] of voiceFiles) {
  const mod = await load(file);
  const instance = new mod[name]({ clock });
  graph.register(instance);
  voices.push(instance);
  ok(true, `constructed ${instance.name}`);
}

const bank = new PatternBank(voices);
const { Kanchelskis } = await load('js/modules/kanchelskis.js');
const master = new Kanchelskis({ clock, bank });
graph.register(master);
ok(true, 'constructed KANCHELSKIS');

const modules = [master, ...voices];

const rack = document.getElementById('rack');
for (const m of modules) {
  const elm = m.render();
  rack.append(elm);
  ok(elm && elm.classList.contains('panel'), `${m.name} renders a panel`);
  ok(m.listJacks().length > 0, `${m.name} exposes ${m.listJacks().length} jacks`);
}

// Every voice module must accept sync.
voices.forEach((m) => {
  ok(!!m.getJack('clk-in'), `${m.name} has a clock input`);
});

// Every CV input must start at zero depth, or patching would change the sound
// the instant a cable lands — the bug this guards against silenced filters.
let cvCount = 0;
modules.forEach((m) => m.listCVInputs().forEach((cv) => {
  cvCount++;
  if (cv.depth.gain.value !== 0) ok(false, `${m.name}.${cv.name} depth must start at 0`);
}));
ok(true, `${cvCount} CV inputs all start at zero depth`);

// --- patching ---
const clkOut = graph.getJack('kanchelskis', 'clk-1');
const yeboahClk = graph.getJack('yeboah', 'clk-in');
ok(graph.canConnect(clkOut, yeboahClk), 'clock out -> clock in is legal');

const edge = graph.connect(clkOut, yeboahClk);
ok(!!edge, 'clock patch created');
ok(graph.isConnected('yeboah', 'clk-in'), 'yeboah reads as patched');

const audioOut = graph.getJack('juninho', 'audio-out');
ok(!graph.connect(audioOut, graph.getJack('yeboah', 'clk-in')), 'audio -> clock rejected');
ok(!!graph.connect(audioOut, graph.getJack('yeboah', 'cutoff-cv')), 'audio -> cv accepted');
ok(!graph.connect(clkOut, graph.getJack('kanchelskis', 'clk-1')), 'self-patch rejected');

const before = connections.length;
graph.connect(graph.getJack('zola', 'audio-out'), graph.getJack('asprilla', 'audio-in'));
ok(connections.length > before, 'audio patch made a real node connection');

// --- output normalisation ---
const juninho = voices.find((m) => m.id === 'juninho');
const jOut = juninho.listOutputs()[0];
ok(jOut.direct.gain.value === 1, 'unpatched output feeds the master directly');
modules.forEach((m) => m.updateNormalisation(graph));
// Patching must NOT silence a module in the master — a module vanishing the
// moment you cable it reads as a bug, whatever the hardware would do.
ok(jOut.direct.gain.value === 1, 'patched output still reaches the master');
ok(jOut.patched === true, 'output knows it is patched');
juninho.setDirect('audio-out', false);
ok(jOut.direct.gain.value === 0, 'MIX off routes it exclusively');
juninho.setDirect('audio-out', true);

// --- pattern bank ---
voices.forEach((m) => {
  ok(m.getPattern() !== null, `${m.name} exposes a pattern`);
});

bank.save(0);
ok(!bank.isEmpty(0), 'pattern saved into slot A');
const yeboah = voices.find((m) => m.id === 'yeboah');
const before64 = JSON.stringify(yeboah.getPattern());
yeboah.clearPattern();
ok(JSON.stringify(yeboah.getPattern()) !== before64, 'clearing changes the pattern');
bank.load(0);
ok(JSON.stringify(yeboah.getPattern()) === before64, 'slot A recall restores it');

bank.save(1);
ok(bank.addToSong(0, 2) && bank.addToSong(1, 3), 'song entries added');
ok(bank.startSong(), 'song starts');
bank.advanceBar(); bank.advanceBar();
ok(bank.songPosition.slot === 1, 'song advances after the repeat count');

// --- per-track lengths ---
yeboah.setLength('hat', 32);
ok(yeboah.lengths.hat === 32, 'hat track set to 32 steps');
ok(yeboah.pattern.hat.length === 32, 'pattern array grew to match');
ok(yeboah.lengths.kick === 16, 'other tracks keep their own length');

// --- sample deck kit ---
const deck = voices.find((m) => m.id === 'asprilla');
ok(deck.mode === 'kit', 'sample deck starts in kit mode so it makes sound with no file');
let padThrew = null;
try { deck.playPad(0, 0, 1); } catch (e) { padThrew = e; }
ok(!padThrew, `kit pad plays${padThrew ? ` — ${padThrew.message}` : ''}`);

// --- voice lab internal source ---
const zola = voices.find((m) => m.id === 'zola');
ok(!!zola.formant, 'voice lab has an internal vowel source');
ok(zola.vowelPattern.some(Boolean), 'vowel sequence is seeded');

// --- recorder ---
const rec = new Recorder(getMaster().analyser);
rec.start({ bars: 2, clock });
ok(rec.recording, 'recorder starts');
rec.stop();
ok(!rec.recording, 'recorder stops');

// --- run a bar ---
voices.forEach((m) => {
  const j = m.getJack('clk-in');
  if (j && !graph.isConnected(m.id, 'clk-in')) graph.connect(clkOut, j);
});

let threw = null;
try {
  for (let step = 0; step < 64; step++) {
    getCtx().currentTime = step * clock.stepDuration;
    clock.listeners.forEach((fn) => fn(step, getCtx().currentTime + 0.05));
  }
} catch (err) { threw = err; }
ok(!threw, `64 clock steps ran clean${threw ? ` — ${threw.message}` : ''}`);

// --- clear all ---
voices.forEach((m) => m.clearPattern());
ok(true, 'every module cleared without throwing');

// --- serialise round trip ---
const snapshot = {
  modules: Object.fromEntries(modules.map((m) => [m.id, m.serialize()])),
  patch: graph.serialize(),
  bank: bank.serialize()
};
const json = JSON.stringify(snapshot);
ok(json.length > 2, `state serialises (${(json.length / 1024).toFixed(1)} kB)`);

graph.edges.slice().forEach((e) => graph.disconnect(e.id));
ok(graph.edges.length === 0, 'all cables pulled');
graph.restore(snapshot.patch);
ok(graph.edges.length === snapshot.patch.length, 'patch restored from JSON');

modules.forEach((m) => m.restore(snapshot.modules[m.id]));
ok(true, 'module state restored without throwing');

console.log(failures ? `\n${failures} FAILURES\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
