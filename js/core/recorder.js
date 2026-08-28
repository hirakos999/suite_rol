// Captures any node's output to a WAV.
//
// ScriptProcessor rather than MediaRecorder: it gives raw float samples, so
// the result is uncompressed WAV with no encoder latency — and it can be
// handed straight back to a sampler as an AudioBuffer.
//
// Three modes: free-running until stopped, a fixed number of seconds, or a
// fixed number of bars (which needs the clock to know how long a bar is).

import { getCtx } from './audio-engine.js';
import { encodeWAV, mergeChunks } from './wav.js';

const BUFFER_SIZE = 4096;

export class Recorder {
  constructor(sourceNode) {
    this.ctx = getCtx();
    this.source = sourceNode;
    this.recording = false;
    this.left = [];
    this.right = [];
    this.processor = null;
    this.silentSink = null;
    this.onTick = null;
    this.onStop = null;
    this._limitSamples = Infinity;
  }

  get seconds() {
    const frames = this.left.reduce((n, c) => n + c.length, 0);
    return frames / this.ctx.sampleRate;
  }

  // limit: { seconds } or { bars, clock } or nothing for open-ended.
  start(limit = {}) {
    if (this.recording) return;

    this.left = [];
    this.right = [];
    this.recording = true;

    if (limit.seconds) {
      this._limitSamples = limit.seconds * this.ctx.sampleRate;
    } else if (limit.bars && limit.clock) {
      const barSeconds = limit.clock.stepDuration * 16;
      this._limitSamples = limit.bars * barSeconds * this.ctx.sampleRate;
    } else {
      this._limitSamples = Infinity;
    }

    const proc = this.ctx.createScriptProcessor(BUFFER_SIZE, 2, 2);
    let captured = 0;

    proc.onaudioprocess = (e) => {
      if (!this.recording) return;
      this.left.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      this.right.push(new Float32Array(e.inputBuffer.getChannelData(1)));
      captured += e.inputBuffer.length;
      this.onTick?.(captured / this.ctx.sampleRate);
      if (captured >= this._limitSamples) this.stop();
    };

    // A ScriptProcessor only runs while it is connected to something, so it
    // feeds a muted gain rather than the speakers.
    this.silentSink = this.ctx.createGain();
    this.silentSink.gain.value = 0;

    this.source.connect(proc);
    proc.connect(this.silentSink);
    this.silentSink.connect(this.ctx.destination);
    this.processor = proc;
  }

  stop() {
    if (!this.recording) return null;
    this.recording = false;

    try { this.source.disconnect(this.processor); } catch {}
    try { this.processor.disconnect(); } catch {}
    try { this.silentSink.disconnect(); } catch {}
    this.processor.onaudioprocess = null;
    this.processor = null;

    const result = {
      left: mergeChunks(this.left),
      right: mergeChunks(this.right),
      sampleRate: this.ctx.sampleRate,
      duration: this.seconds
    };
    this.onStop?.(result);
    return result;
  }

  toBlob(result) {
    return encodeWAV(result.left, result.right, result.sampleRate);
  }

  // Same capture, handed back as an AudioBuffer so a sampler can load it
  // without a decode round-trip.
  toAudioBuffer(result) {
    const buf = this.ctx.createBuffer(2, result.left.length, result.sampleRate);
    buf.getChannelData(0).set(result.left);
    buf.getChannelData(1).set(result.right);
    return buf;
  }
}
