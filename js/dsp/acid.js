// Monophonic acid voice: saw/square -> resonant LP with envelope-modulated
// cutoff -> tanh drive. Accent boosts both level and filter sweep; slide glides
// the running voice instead of retriggering it (TB-303 legato behaviour).

import { getCtx } from '../core/audio-engine.js';
import { midiToFreq } from '../utils.js';

function driveCurve(amount) {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + amount * 6;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

export class AcidVoice {
  constructor(destination) {
    this.ctx = getCtx();
    this.dest = destination;
    this.curve = driveCurve(0.5);

    this.params = {
      cutoff: 700,
      resonance: 12,
      envMod: 0.6,
      decay: 0.25,
      tune: 0,
      waveform: 'sawtooth',
      drive: 0.5
    };

    // The voice currently sounding, so a slide step can glide into the next note.
    this.active = null;
  }

  set(key, value) {
    this.params[key] = value;
    if (key === 'drive') this.curve = driveCurve(value);
  }

  // A stable node for cutoff modulation to land on. The filter itself is
  // rebuilt for every note, so CV cannot connect to it directly — instead each
  // new filter subscribes to this bus, and the bus outlives the notes.
  get cutoffTarget() {
    if (!this._modBus) {
      this._modBus = this.ctx.createGain();
      this._modBus.gain.value = 1;
    }
    return this._modBus;
  }

  trigger(midi, time, { accent = false, slide = false, gate = 1 } = {}) {
    const p = this.params;
    const ctx = this.ctx;
    const freq = midiToFreq(midi) * Math.pow(2, p.tune / 1200);
    const noteDur = Math.max(p.decay * gate, 0.08);
    const accentMul = accent ? 1.6 : 1;
    const peakFreq = Math.min(12000, p.cutoff * (1 + p.envMod * 4 * accentMul));

    if (slide && this.active && this.active.stopTime > time) {
      const a = this.active;
      a.osc.frequency.cancelScheduledValues(time);
      a.osc.frequency.setValueAtTime(a.osc.frequency.value, time);
      a.osc.frequency.linearRampToValueAtTime(freq, time + 0.06);

      a.filter.frequency.cancelScheduledValues(time);
      a.filter.frequency.setValueAtTime(peakFreq, time);
      a.filter.frequency.exponentialRampToValueAtTime(Math.max(60, p.cutoff), time + p.decay);

      a.stopTime = time + noteDur + 0.05;
      a.osc.stop(a.stopTime);
      return;
    }

    if (this.active && this.active.stopTime > time) {
      try { this.active.osc.stop(time); } catch {}
    }

    const osc = ctx.createOscillator();
    osc.type = p.waveform;
    osc.frequency.setValueAtTime(freq, time);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(p.resonance, time);
    filter.frequency.setValueAtTime(peakFreq, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, p.cutoff), time + p.decay);

    // Let patched CV ride on top of the envelope.
    if (this._modBus) this._modBus.connect(filter.frequency);

    const shaper = ctx.createWaveShaper();
    shaper.curve = this.curve;
    shaper.oversample = '2x';

    const amp = ctx.createGain();
    const peak = accent ? 1 : 0.72;
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, time + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + noteDur);

    osc.connect(filter);
    filter.connect(shaper);
    shaper.connect(amp);
    amp.connect(this.dest);

    const stopTime = time + noteDur + 0.05;
    osc.start(time);
    osc.stop(stopTime);
    osc.onended = () => {
      // Detach the mod bus too, or every dead note leaves a connection behind.
      if (this._modBus) { try { this._modBus.disconnect(filter.frequency); } catch {} }
      osc.disconnect(); filter.disconnect(); shaper.disconnect(); amp.disconnect();
      if (this.active && this.active.osc === osc) this.active = null;
    };

    this.active = { osc, filter, stopTime };
  }
}
