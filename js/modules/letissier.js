// LE TISSIER — chord engine.
//
// Six detuned voices playing a sequence of chord slots. Voicing morph shifts
// inversions and spread live; strum spreads the note starts so a pad becomes
// an arpeggio without changing the harmony.

import { ModuleBase } from '../core/module-base.js';
import { createPanel, section, row, button, select } from '../ui/panel.js';
import { createKnob } from '../ui/knob.js';
import { el, midiToFreq, midiToName, NOTE_NAMES, clamp, pick } from '../utils.js';

const SLOTS = 8;
const VOICES = 6;

const CHORD_TYPES = {
  min:    { label: 'min',  intervals: [0, 3, 7] },
  maj:    { label: 'maj',  intervals: [0, 4, 7] },
  min7:   { label: 'min7', intervals: [0, 3, 7, 10] },
  maj7:   { label: 'maj7', intervals: [0, 4, 7, 11] },
  dom7:   { label: '7',    intervals: [0, 4, 7, 10] },
  sus2:   { label: 'sus2', intervals: [0, 2, 7] },
  sus4:   { label: 'sus4', intervals: [0, 5, 7] },
  dim:    { label: 'dim',  intervals: [0, 3, 6] },
  min9:   { label: 'min9', intervals: [0, 3, 7, 10, 14] },
  maj9:   { label: 'maj9', intervals: [0, 4, 7, 11, 14] }
};

export class LeTissier extends ModuleBase {
  constructor(opts) {
    super({
      id: 'letissier',
      name: 'LE TISSIER',
      subtitle: 'CHORD ENGINE',
      accent: '#00b4ff',
      ...opts
    });

    this.createChannel({ gain: 0.45 });

    this.params = {
      detune: 12, spread: 0.5, strum: 0, brightness: 0.5,
      attack: 0.06, release: 0.9, wave: 'sawtooth', octave: 0
    };

    // Eight slots, each fired on its own bar. Empty slots hold the previous chord.
    this.slots = [
      { root: 9, type: 'min7' },   // Am7
      { root: 5, type: 'maj7' },   // Fmaj7
      { root: 0, type: 'maj9' },   // Cmaj9
      { root: 7, type: 'dom7' },   // G7
      null, null, null, null
    ];

    this.currentSlot = 0;
    this.playing = true;
    this.barLength = 16; // steps per slot

    this._buildGraph();
    this._registerJacks();
    this.makeClockIn('clk-in', (step, time) => this._onStep(step, time));
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2600;
    this.filter.Q.value = 0.7;

    this.out = ctx.createGain();
    this.out.gain.value = 0.8;
    this.filter.connect(this.out);

    // Each voice is a pair of oscillators detuned against each other — the
    // cheapest way to a wide pad without a chorus.
    this.voices = Array.from({ length: VOICES }, () => {
      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      a.type = b.type = this.params.wave;
      const g = ctx.createGain();
      g.gain.value = 0;
      a.connect(g); b.connect(g);
      g.connect(this.filter);
      a.start(); b.start();
      return { a, b, g };
    });

  }

  _registerJacks() {
    this.addAudioOutput({ name: 'audio-out', label: 'OUT', node: this.out });
    this.addCVInput({
      name: 'cutoff-cv', label: 'BRIGHT',
      target: this.filter.frequency, range: 5000, unit: 'Hz'
    });
  }

  _onStep(step, time) {
    if (!this.playing) return;
    if (step % this.barLength !== 0) return;

    // Advance to the next non-empty slot, wrapping.
    const total = this.slots.length;
    for (let i = 1; i <= total; i++) {
      const idx = (this.currentSlot + i) % total;
      if (this.slots[idx]) { this.currentSlot = idx; break; }
    }
    this._playSlot(this.currentSlot, time);
  }

  // Build the actual voiced pitches: chord tones, spread across octaves by the
  // spread knob, inverted by the morph amount.
  _voicing(slot) {
    const { intervals } = CHORD_TYPES[slot.type];
    const base = 48 + slot.root + this.params.octave * 12;
    const spread = this.params.spread;
    const notes = [];

    for (let i = 0; i < VOICES; i++) {
      const degree = intervals[i % intervals.length];
      // Voices past the first pass climb octaves; spread widens the gaps.
      const octaveJump = Math.floor(i / intervals.length) * 12;
      const lift = Math.round(spread * (i / VOICES) * 12);
      notes.push(base + degree + octaveJump + lift);
    }
    return notes;
  }

  _playSlot(idx, time) {
    const slot = this.slots[idx];
    if (!slot) return;

    const notes = this._voicing(slot);
    const p = this.params;
    const strumGap = p.strum * 0.09;

    notes.forEach((midi, i) => {
      const v = this.voices[i];
      const t = time + i * strumGap;
      const freq = midiToFreq(midi);

      v.a.frequency.setValueAtTime(freq, t);
      v.b.frequency.setValueAtTime(freq * Math.pow(2, p.detune / 1200), t);

      // Upper voices sit back a little so the chord keeps a root.
      const level = (0.16 / Math.sqrt(VOICES)) * (1 - i * 0.06);
      const g = v.g.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(level, t + p.attack);
      g.setTargetAtTime(level * 0.75, t + p.attack, 0.4);
      g.setTargetAtTime(0.0001, t + this.barLength * this.clock.stepDuration * 0.85, p.release / 3);
    });

    this._flashSlot(idx);
    if (this.chordReadout) {
      this.chordReadout.textContent = `${NOTE_NAMES[slot.root]}${CHORD_TYPES[slot.type].label}`;
    }
  }

  // --- pattern bank interface ---------------------------------------------

  getPattern() {
    return { slots: this.slots, barLength: this.barLength };
  }

  setPattern(p) {
    if (!p) return;
    if (p.slots) this.slots = p.slots;
    if (p.barLength) this.barLength = p.barLength;
    this.slotEls?.forEach((_, i) => this._refreshSlot(i));
  }

  clearPattern() {
    this.slots = new Array(SLOTS).fill(null);
    this.slotEls?.forEach((_, i) => this._refreshSlot(i));
    this._allOff();
  }

  _flashSlot(idx) {
    this.slotEls?.forEach((elm, i) => elm.classList.toggle('is-playing', i === idx));
  }

  render() {
    const panel = createPanel(this);

    // --- chord slot strip ---
    this.slotEls = this.slots.map((slot, i) => {
      const btn = el('button', { class: 'chord-slot', type: 'button' },
        el('span', { class: 'chord-slot-index' }, String(i + 1)),
        el('span', { class: 'chord-slot-name' }, slot ? `${NOTE_NAMES[slot.root]}${CHORD_TYPES[slot.type].label}` : '—')
      );
      btn.classList.toggle('is-filled', !!slot);
      btn.addEventListener('click', () => this._selectSlot(i));
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.slots[i] = null;
        this._refreshSlot(i);
      });
      return btn;
    });

    const rootSel = select(
      NOTE_NAMES.map((n, i) => ({ value: i, label: n })),
      { value: 9, onChange: (v) => this._editSlot({ root: Number(v) }) }
    );

    const typeSel = select(
      Object.entries(CHORD_TYPES).map(([k, v]) => ({ value: k, label: v.label })),
      { value: 'min7', onChange: (v) => this._editSlot({ type: v }) }
    );

    const knob = (name, spec) => createKnob({
      ...spec,
      onChange: (v) => {
        this.params[name] = v;
        if (name === 'brightness') this.filter.frequency.setTargetAtTime(400 + v * 7000, this.ctx.currentTime, 0.05);
      }
    });

    const knobs = [
      knob('spread', { min: 0, max: 1, value: 0.5, label: 'SPREAD', decimals: 2 }),
      knob('detune', { min: 0, max: 40, value: 12, label: 'DETUNE', decimals: 0 }),
      knob('strum', { min: 0, max: 1, value: 0, label: 'STRUM', decimals: 2 }),
      knob('brightness', { min: 0, max: 1, value: 0.5, label: 'TONE', decimals: 2 }),
      knob('attack', { min: 0.005, max: 2, value: 0.06, label: 'ATK', decimals: 3, curve: 2 }),
      knob('release', { min: 0.1, max: 4, value: 0.9, label: 'REL', decimals: 2 })
    ];

    const waveSel = select(
      [
        { value: 'sawtooth', label: 'SAW' }, { value: 'square', label: 'SQR' },
        { value: 'triangle', label: 'TRI' }, { value: 'sine', label: 'SIN' }
      ],
      { value: 'sawtooth', onChange: (v) => { this.voices.forEach((x) => { x.a.type = v; x.b.type = v; }); } }
    );

    const lenSel = select(
      [{ value: 8, label: '1/2 BAR' }, { value: 16, label: '1 BAR' }, { value: 32, label: '2 BAR' }],
      { value: 16, onChange: (v) => { this.barLength = Number(v); } }
    );

    const runBtn = button('RUN', {
      active: true, className: 'btn-toggle',
      onClick: (b) => {
        this.playing = !this.playing;
        b.classList.toggle('is-active', this.playing);
        b.textContent = this.playing ? 'RUN' : 'HOLD';
        if (!this.playing) this._allOff();
      }
    });

    const rndBtn = button('RND', { onClick: () => this._randomProgression() });

    this.chordReadout = el('span', { class: 'readout readout-large' }, 'Am7');
    this._slotSel = { rootSel, typeSel };
    this.selectedSlot = 0;

    panel.body.append(
      section('SEQUENCE', el('div', { class: 'chord-slots' }, ...this.slotEls)),
      section('SLOT EDIT',
        row(
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'ROOT'), rootSel),
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'TYPE'), typeSel),
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'LEN'), lenSel),
          this.chordReadout
        )
      ),
      section('VOICE',
        row(
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'WAVE'), waveSel),
          el('div', { class: 'knob-cluster' }, ...knobs.map((k) => k.el))
        )
      ),
      section(null, row(el('div', { class: 'button-stack' }, runBtn, rndBtn)))
    );

    this._selectSlot(0);
    return panel.el;
  }

  _selectSlot(i) {
    this.selectedSlot = i;
    this.slotEls.forEach((e, idx) => e.classList.toggle('is-selected', idx === i));
    const slot = this.slots[i];
    if (slot) {
      this._slotSel.rootSel.value = String(slot.root);
      this._slotSel.typeSel.value = slot.type;
    }
    // Audition the slot so editing is immediate.
    if (slot) this._playSlot(i, this.ctx.currentTime + 0.01);
  }

  _editSlot(patch) {
    const i = this.selectedSlot;
    const current = this.slots[i] || { root: 0, type: 'min7' };
    this.slots[i] = { ...current, ...patch };
    this._refreshSlot(i);
    this._playSlot(i, this.ctx.currentTime + 0.01);
    this.setState('slots', this.slots);
  }

  _refreshSlot(i) {
    const slot = this.slots[i];
    const elm = this.slotEls[i];
    elm.querySelector('.chord-slot-name').textContent =
      slot ? `${NOTE_NAMES[slot.root]}${CHORD_TYPES[slot.type].label}` : '—';
    elm.classList.toggle('is-filled', !!slot);
    this.setState('slots', this.slots);
  }

  _randomProgression() {
    // Roots drawn from a minor key, types weighted toward sevenths.
    const keyRoots = [0, 3, 5, 7, 8, 10];
    const types = ['min7', 'maj7', 'min9', 'dom7', 'sus4', 'maj9'];
    const len = pick([4, 4, 8]);
    this.slots = this.slots.map((_, i) =>
      i < len ? { root: pick(keyRoots), type: pick(types) } : null
    );
    this.slots.forEach((_, i) => this._refreshSlot(i));
  }

  _allOff() {
    const t = this.ctx.currentTime;
    this.voices.forEach((v) => {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(0.0001, t, 0.1);
    });
  }

  applyState(key, value) {
    if (key === 'slots' && value) {
      this.slots = value;
      this.slotEls?.forEach((_, i) => this._refreshSlot(i));
    }
    this.state[key] = value;
  }
}
