// JUNINHO — tweak synth.
//
// Two detunable oscillators plus a sub, into a switchable filter with its own
// ADSR. The sequencer carries note, velocity, gate and probability per step,
// and motion recording captures knob moves onto per-parameter lanes.

import { ModuleBase } from '../core/module-base.js';
import { createPanel, section, row, button, select, toggle } from '../ui/panel.js';
import { createKnob } from '../ui/knob.js';
import { createStepGrid } from '../ui/step-grid.js';
import { el, midiToFreq, midiToName, pick, clamp } from '../utils.js';

const STEPS = 16;
const ROOT = 48; // C3
const SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor — the techno default

export class Juninho extends ModuleBase {
  constructor(opts) {
    super({
      id: 'juninho',
      name: 'JUNINHO',
      subtitle: 'TWEAK SYNTH',
      accent: '#c6ff00',
      ...opts
    });

    this.createChannel({ gain: 0.6 });

    this.params = {
      wave1: 'sawtooth', wave2: 'square',
      detune: 8, subLevel: 0.3, mix: 0.5,
      filterType: 'lowpass', cutoff: 1800, resonance: 4, envAmount: 0.6,
      attack: 0.01, decay: 0.18, sustain: 0.4, release: 0.25,
      glide: 0
    };

    this.pattern = new Array(STEPS).fill(null);
    this._seed();

    // Motion lanes: paramName -> array of per-step values (null = untouched).
    this.motion = {};
    this.recording = false;
    this.playing = true;
    this.lastStep = 0;

    this._buildGraph();
    this._registerJacks();
    this.makeClockIn('clk-in', (step, time) => this._onStep(step, time));
  }

  _buildGraph() {
    const ctx = this.ctx;

    // The filter and amp are shared; each note retriggers their envelopes
    // rather than spawning a new chain, which is what makes it mono and glidy.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = this.params.filterType;
    this.filter.frequency.value = this.params.cutoff;
    this.filter.Q.value = this.params.resonance;

    this.amp = ctx.createGain();
    this.amp.gain.value = 0;

    this.out = ctx.createGain();
    this.out.gain.value = 0.8;

    this.filter.connect(this.amp);
    this.amp.connect(this.out);

    const mkOsc = (type, gain) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midiToFreq(ROOT);
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(this.filter);
      osc.start();
      return { osc, g };
    };

    this.osc1 = mkOsc(this.params.wave1, 0.5);
    this.osc2 = mkOsc(this.params.wave2, 0.5);
    this.sub = mkOsc('sine', this.params.subLevel);

  }

  _registerJacks() {
    this.addAudioOutput({ name: 'audio-out', label: 'OUT', node: this.out });
    this.addCVInput({
      name: 'cutoff-cv', label: 'CUTOFF',
      target: this.filter.frequency, range: 5000, unit: 'Hz'
    });
    this.addCVInput({
      name: 'amp-cv', label: 'AMP',
      target: this.amp.gain, range: 1
    });
  }

  _seed() {
    [0, 3, 6, 8, 11, 14].forEach((i) => {
      this.pattern[i] = { note: ROOT + pick(SCALE), velocity: 0.8, gate: 0.6, prob: 1 };
    });
  }

  _onStep(step, time) {
    const pos = step % STEPS;
    this.grid?.highlightAll(pos);
    this.lastStep = pos;
    if (!this.playing) return;

    // Motion playback: replay recorded knob positions ahead of the note.
    Object.entries(this.motion).forEach(([param, lane]) => {
      const v = lane[pos];
      if (v !== null && v !== undefined) this._applyParam(param, v, time);
    });

    const ev = this.pattern[pos];
    if (!ev) return;
    if (ev.prob !== undefined && Math.random() > ev.prob) return;

    this._noteOn(ev.note, time, ev.velocity ?? 0.8, (ev.gate ?? 0.6) * this.clock.stepDuration);
  }

  _noteOn(midi, time, velocity, gateLen) {
    const p = this.params;
    const freq = midiToFreq(midi);
    const glide = p.glide;

    [[this.osc1, 1], [this.osc2, 1], [this.sub, 0.5]].forEach(([o, ratio]) => {
      const target = freq * ratio * (o === this.osc2 ? Math.pow(2, p.detune / 1200) : 1);
      if (glide > 0) {
        o.osc.frequency.cancelScheduledValues(time);
        o.osc.frequency.setValueAtTime(o.osc.frequency.value, time);
        o.osc.frequency.exponentialRampToValueAtTime(Math.max(20, target), time + glide);
      } else {
        o.osc.frequency.setValueAtTime(target, time);
      }
    });

    // Amp ADSR.
    const g = this.amp.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(Math.max(0.0001, g.value), time);
    g.linearRampToValueAtTime(velocity, time + p.attack);
    g.linearRampToValueAtTime(velocity * p.sustain, time + p.attack + p.decay);
    g.setValueAtTime(velocity * p.sustain, time + gateLen);
    g.exponentialRampToValueAtTime(0.0001, time + gateLen + p.release);

    // Filter envelope rides on top of the static cutoff.
    const peak = clamp(p.cutoff * (1 + p.envAmount * 5), 60, 16000);
    const f = this.filter.frequency;
    f.cancelScheduledValues(time);
    f.setValueAtTime(peak, time);
    f.exponentialRampToValueAtTime(Math.max(60, p.cutoff), time + p.decay + 0.05);
  }

  _applyParam(name, value, time = this.ctx.currentTime) {
    this.params[name] = value;
    if (name === 'cutoff') this.filter.frequency.setTargetAtTime(value, time, 0.01);
    if (name === 'resonance') this.filter.Q.setTargetAtTime(value, time, 0.01);
    if (name === 'subLevel') this.sub.g.gain.setTargetAtTime(value, time, 0.01);
    if (name === 'mix') {
      this.osc1.g.gain.setTargetAtTime(1 - value, time, 0.01);
      this.osc2.g.gain.setTargetAtTime(value, time, 0.01);
    }
  }

  render() {
    const panel = createPanel(this);

    this.grid = createStepGrid({
      tracks: [{ id: 'seq', label: 'SEQ', color: this.accent }],
      getTrack: () => this.pattern,
      window: STEPS,
      onToggle: (_t, i) => {
        this.pattern[i] = this.pattern[i]
          ? null
          : { note: ROOT + pick(SCALE), velocity: 0.8, gate: 0.6, prob: 1 };
        this.grid.render();
        this.setState('pattern', this.getPattern());
      },
      onEdit: (_t, i) => {
        const ev = this.pattern[i];
        if (!ev) return;
        // Walk up the scale, wrapping two octaves.
        const idx = SCALE.indexOf((ev.note - ROOT) % 12);
        const next = SCALE[(idx + 1) % SCALE.length] + (idx === SCALE.length - 1 ? 12 : 0);
        ev.note = ROOT + (next % 24);
        this.noteReadout.textContent = midiToName(ev.note);
        this.grid.render();
        this.setState('pattern', this.getPattern());
      },
      compact: true
    });
    this.grid.render();

    const knob = (name, spec) => createKnob({
      ...spec,
      onChange: (v) => {
        this._applyParam(name, v);
        if (this.recording) this._recordMotion(name, v);
      }
    });

    const oscKnobs = [
      knob('mix', { min: 0, max: 1, value: 0.5, label: 'MIX', decimals: 2 }),
      knob('detune', { min: 0, max: 50, value: 8, label: 'DETUNE', decimals: 0 }),
      knob('subLevel', { min: 0, max: 1, value: 0.3, label: 'SUB', decimals: 2 })
    ];

    const filterKnobs = [
      knob('cutoff', { min: 80, max: 12000, value: 1800, label: 'CUTOFF', decimals: 0, curve: 2.5 }),
      knob('resonance', { min: 0.5, max: 22, value: 4, label: 'RESO', decimals: 1 }),
      knob('envAmount', { min: 0, max: 1, value: 0.6, label: 'ENV', decimals: 2 })
    ];

    const envKnobs = [
      knob('attack', { min: 0.001, max: 1, value: 0.01, label: 'ATK', decimals: 3, curve: 2 }),
      knob('decay', { min: 0.01, max: 1.5, value: 0.18, label: 'DEC', decimals: 2 }),
      knob('sustain', { min: 0, max: 1, value: 0.4, label: 'SUS', decimals: 2 }),
      knob('release', { min: 0.01, max: 2, value: 0.25, label: 'REL', decimals: 2 }),
      knob('glide', { min: 0, max: 0.3, value: 0, label: 'GLIDE', decimals: 3 })
    ];

    const waveSel = (which, value) => select(
      [
        { value: 'sawtooth', label: 'SAW' }, { value: 'square', label: 'SQR' },
        { value: 'triangle', label: 'TRI' }, { value: 'sine', label: 'SIN' }
      ],
      { value, onChange: (v) => { this[which].osc.type = v; } }
    );

    const filterSel = select(
      [
        { value: 'lowpass', label: 'LP' }, { value: 'highpass', label: 'HP' },
        { value: 'bandpass', label: 'BP' }, { value: 'notch', label: 'NOTCH' }
      ],
      { value: 'lowpass', onChange: (v) => { this.filter.type = v; this.params.filterType = v; } }
    );

    const recBtn = toggle('MOTION REC', {
      onChange: (on) => {
        this.recording = on;
        if (on) this.motion = {};
        this.motionReadout.textContent = on ? 'ARMED' : `${Object.keys(this.motion).length} LANES`;
      }
    });

    const clearMotion = button('CLR', { onClick: () => this.clearPattern() });

    const runBtn = button('RUN', {
      active: true, className: 'btn-toggle',
      onClick: (b) => {
        this.playing = !this.playing;
        b.classList.toggle('is-active', this.playing);
        b.textContent = this.playing ? 'RUN' : 'HOLD';
      }
    });

    this.noteReadout = el('span', { class: 'readout' }, midiToName(ROOT));
    this.motionReadout = el('span', { class: 'readout' }, '0 LANES');

    panel.body.append(
      section(null, this.grid.el),
      section('OSC',
        row(
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'OSC 1'), waveSel('osc1', 'sawtooth')),
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'OSC 2'), waveSel('osc2', 'square')),
          el('div', { class: 'knob-cluster' }, ...oscKnobs.map((k) => k.el))
        )
      ),
      section('FILTER',
        row(
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'TYPE'), filterSel),
          el('div', { class: 'knob-cluster' }, ...filterKnobs.map((k) => k.el))
        )
      ),
      section('ENVELOPE', row(el('div', { class: 'knob-cluster' }, ...envKnobs.map((k) => k.el)))),
      section(null,
        row(
          el('div', { class: 'button-stack' }, runBtn, recBtn, clearMotion),
          el('div', { class: 'readout-stack' }, this.noteReadout, this.motionReadout)
        )
      )
    );

    return panel.el;
  }

  // --- pattern bank interface ---------------------------------------------

  getPattern() {
    return { steps: this.pattern, motion: this.motion };
  }

  setPattern(p) {
    if (!p) return;
    if (p.steps) this.pattern = p.steps;
    if (p.motion) this.motion = p.motion;
    this.grid?.render();
    this.motionReadout && (this.motionReadout.textContent = `${Object.keys(this.motion).length} LANES`);
  }

  clearPattern() {
    this.pattern = new Array(STEPS).fill(null);
    this.motion = {};
    this.grid?.render();
    if (this.motionReadout) this.motionReadout.textContent = '0 LANES';
    this.setState('pattern', this.getPattern());
  }

  // Motion recording writes the current value into the step the sequencer is
  // on, so a knob sweep during playback becomes a per-step automation lane.
  _recordMotion(param, value) {
    if (!this.motion[param]) this.motion[param] = new Array(STEPS).fill(null);
    this.motion[param][this.lastStep] = value;
    this.motionReadout.textContent = `${Object.keys(this.motion).length} LANES`;
  }

  applyState(key, value) {
    if (key === 'pattern' && value) this.setPattern(value);
    if (key === 'params' && value) Object.assign(this.params, value);
    this.state[key] = value;
  }
}
