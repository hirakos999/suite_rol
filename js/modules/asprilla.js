// ASPRILLA — sample deck.
//
// Two pad sources: a built-in synthesised kit (so the module makes sound with
// no file at all), or chops of a loaded sample. RESAMPLE captures whatever is
// patched into the audio in — or the master mix if nothing is — for a chosen
// number of bars, which is how a kick pattern built on YEBOAH becomes a single
// sample here.

import { ModuleBase } from '../core/module-base.js';
import { createPanel, section, row, button, toggle, select } from '../ui/panel.js';
import { createKnob } from '../ui/knob.js';
import { createStepGrid } from '../ui/step-grid.js';
import { Recorder } from '../core/recorder.js';
import { getMaster } from '../core/audio-engine.js';
import { getVoice } from '../dsp/drums.js';
import { SAMPLE_KITS } from '../dsp/presets.js';
import { el, clamp, randInt } from '../utils.js';

const PADS = 8;
const STEPS = 16;
const RESAMPLE_BARS = [1, 2, 4, 8];

export class Asprilla extends ModuleBase {
  constructor(opts) {
    super({
      id: 'asprilla',
      name: 'ASPRILLA',
      subtitle: 'SAMPLE DECK',
      accent: '#ff00c8',
      ...opts
    });

    this.createChannel({ gain: 0.8 });

    this.buffer = null;
    this.chops = [];
    this.activePad = 0;
    this.playing = true;
    this.granular = false;
    this.mode = 'kit';        // 'kit' | 'chop'
    this.kitIndex = 0;
    this.resampleBars = 2;

    this.params = {
      pitch: 1, start: 0, length: 1, filter: 1,
      grainSize: 0.08, grainScatter: 0.2, grainDensity: 0.7, grainPitch: 0
    };

    this.pattern = Object.fromEntries(
      Array.from({ length: PADS }, (_, i) => [`p${i}`, new Array(STEPS).fill(null)])
    );

    this._buildGraph();
    this._registerJacks();
    this.makeClockIn('clk-in', (step, time) => this._onStep(step, time));
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;

    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.filter.connect(this.out);

    // Anything patched to the audio in is available for resampling, and is
    // also passed through so the deck can be used as an insert.
    this.audioIn = ctx.createGain();
    this.thru = ctx.createGain();
    this.thru.gain.value = 0;   // silent until THRU is enabled
    this.audioIn.connect(this.thru);
    this.thru.connect(this.filter);
  }

  _registerJacks() {
    this.addAudioOutput({ name: 'audio-out', label: 'OUT', node: this.out });
    this.addJack({ direction: 'in', name: 'audio-in', type: 'audio', label: 'IN', node: this.audioIn });
    this.addCVInput({
      name: 'tone-cv', label: 'TONE',
      target: this.filter.frequency, range: 8000, unit: 'Hz'
    });
  }

  // --- sample loading ------------------------------------------------------

  async loadArrayBuffer(arrayBuffer, name = 'sample') {
    try {
      this.buffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.sampleName = name;
      this.setMode('chop');
      this.autoChop();
      this._drawWave();
      this._status(`${name} · ${this.buffer.duration.toFixed(2)}s · ${this.chops.length} chops`);
    } catch (err) {
      this._status('decode failed');
      console.error(err);
    }
  }

  loadAudioBuffer(buffer, name = 'resample') {
    this.buffer = buffer;
    this.sampleName = name;
    this.setMode('chop');
    this.autoChop();
    this._drawWave();
    this._status(`${name} · ${buffer.duration.toFixed(2)}s · ${this.chops.length} chops`);
  }

  // Transient detection: RMS over short windows; a hit is a window whose
  // energy jumps well above the running average and is far enough from the
  // previous cut.
  autoChop(sensitivity = 1.8) {
    if (!this.buffer) return;
    const data = this.buffer.getChannelData(0);
    const rate = this.buffer.sampleRate;
    const win = Math.floor(rate * 0.01);
    const minGap = Math.floor(rate * 0.06);

    const energies = [];
    for (let i = 0; i + win < data.length; i += win) {
      let sum = 0;
      for (let j = 0; j < win; j++) sum += data[i + j] * data[i + j];
      energies.push(Math.sqrt(sum / win));
    }

    const avg = energies.reduce((a, b) => a + b, 0) / (energies.length || 1);
    const cuts = [0];
    for (let i = 1; i < energies.length; i++) {
      if (energies[i] > avg * sensitivity && energies[i] > energies[i - 1] * 1.6) {
        const pos = i * win;
        if (pos - cuts[cuts.length - 1] > minGap) cuts.push(pos);
      }
    }

    if (cuts.length < 2) {
      const slice = Math.floor(data.length / PADS);
      this.chops = Array.from({ length: PADS }, (_, i) => ({
        start: (i * slice) / rate,
        end: ((i + 1) * slice) / rate
      }));
    } else {
      this.chops = cuts.slice(0, PADS).map((c, i) => ({
        start: c / rate,
        end: (cuts[i + 1] ?? data.length) / rate
      }));
    }
    this._paintPads();
    this._drawWave();
  }

  // Splits into equal slices instead of transients — better for loops that are
  // already on the grid.
  gridChop(count = PADS) {
    if (!this.buffer) return;
    const slice = this.buffer.duration / count;
    this.chops = Array.from({ length: count }, (_, i) => ({
      start: i * slice,
      end: (i + 1) * slice
    }));
    this._paintPads();
    this._drawWave();
  }

  setMode(mode) {
    this.mode = mode;
    this.modeBtns?.forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
    this._paintPads();
  }

  // --- resampling ----------------------------------------------------------

  // Records the audio-in jack when something is patched there, otherwise the
  // master bus — so "grab what I am hearing" works with no cable at all.
  startResample() {
    if (this._recorder?.recording) return;

    const patched = this._inputPatched;
    const source = patched ? this.audioIn : getMaster().analyser;

    this._recorder = new Recorder(source);
    this._recorder.onTick = (secs) => {
      this._status(`resampling ${secs.toFixed(1)}s…`);
    };
    this._recorder.onStop = (result) => {
      if (!result.left.length) { this._status('resample captured nothing'); return; }
      this.loadAudioBuffer(this.recorderToBuffer(result), `resample ${this.resampleBars}b`);
      this.resampleBtn?.classList.remove('is-active');
    };

    this._recorder.start({ bars: this.resampleBars, clock: this.clock });
    this._status(`resampling ${this.resampleBars} bars from ${patched ? 'IN' : 'MASTER'}…`);
    this.resampleBtn?.classList.add('is-active');
  }

  recorderToBuffer(result) {
    return this._recorder.toAudioBuffer(result);
  }

  stopResample() {
    this._recorder?.stop();
    this.resampleBtn?.classList.remove('is-active');
  }

  // --- playback ------------------------------------------------------------

  playPad(index, time = this.ctx.currentTime, velocity = 1) {
    if (this.mode === 'kit') return this._playKit(index, time, velocity);
    return this.playChop(index, time, velocity);
  }

  _playKit(index, time, velocity) {
    const kit = SAMPLE_KITS[this.kitIndex];
    const slot = kit?.slots[index];
    if (!slot) return;
    getVoice(slot.type).play(this.filter, time, velocity, {
      tune: slot.tune * this.params.pitch,
      decay: slot.decay * this.params.length
    });
    this._flashPad(index);
  }

  playChop(index, time = this.ctx.currentTime, velocity = 1) {
    if (!this.buffer) return;
    const chop = this.chops[index];
    if (!chop) return;

    if (this.granular) return this._playGranular(chop, time, velocity);

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.params.pitch;

    const g = this.ctx.createGain();
    const dur = (chop.end - chop.start) * this.params.length / this.params.pitch;
    g.gain.setValueAtTime(velocity, time);
    // Short fade-out prevents the click a hard buffer stop would make.
    g.gain.setTargetAtTime(0.0001, time + Math.max(0.01, dur - 0.01), 0.006);

    src.connect(g);
    g.connect(this.filter);
    src.start(time, chop.start + this.params.start * (chop.end - chop.start), dur);
    src.stop(time + dur + 0.05);
    src.onended = () => { src.disconnect(); g.disconnect(); };

    this._flashPad(index);
  }

  _playGranular(chop, time, velocity) {
    const p = this.params;
    const span = chop.end - chop.start;
    const count = Math.max(1, Math.round(p.grainDensity * 28));
    const spacing = (span * p.length) / count;

    for (let i = 0; i < count; i++) {
      const t = time + i * spacing;
      const scatter = (Math.random() * 2 - 1) * p.grainScatter * span;
      const pos = clamp(chop.start + i * spacing + scatter, 0, this.buffer.duration - p.grainSize);

      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.playbackRate.value = p.pitch * Math.pow(2, (Math.random() * 2 - 1) * p.grainPitch / 12);

      const g = this.ctx.createGain();
      // Triangular grain window — cheap, and enough to keep grains click-free.
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(velocity * 0.5, t + p.grainSize / 2);
      g.gain.linearRampToValueAtTime(0.0001, t + p.grainSize);

      src.connect(g);
      g.connect(this.filter);
      src.start(t, pos, p.grainSize * 1.2);
      src.stop(t + p.grainSize * 1.2);
      src.onended = () => { src.disconnect(); g.disconnect(); };
    }
  }

  _onStep(step, time) {
    const pos = step % STEPS;
    this.grid?.highlightAll(pos);
    if (!this.playing) return;

    for (let p = 0; p < PADS; p++) {
      const ev = this.pattern[`p${p}`][pos];
      if (ev) this.playPad(p, time, ev.velocity ?? 1);
    }
  }

  // --- pattern bank interface ---------------------------------------------

  getPattern() {
    return { steps: this.pattern, mode: this.mode, kitIndex: this.kitIndex };
  }

  setPattern(p) {
    if (!p) return;
    if (p.steps) Object.assign(this.pattern, p.steps);
    if (p.mode) this.setMode(p.mode);
    if (p.kitIndex !== undefined) this.kitIndex = p.kitIndex;
    this.grid?.render();
  }

  clearPattern() {
    Object.keys(this.pattern).forEach((k) => { this.pattern[k] = new Array(STEPS).fill(null); });
    this.grid?.render();
    this.setState('pattern', this.getPattern());
  }

  // --- ui ------------------------------------------------------------------

  render() {
    const panel = createPanel(this);

    this.canvas = el('canvas', { class: 'waveform', width: '600', height: '70' });
    this.statusEl = el('span', { class: 'readout' }, 'kit mode — no sample loaded');

    const drop = el('div', { class: 'dropzone' }, this.canvas, this.statusEl);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault();
      drop.classList.remove('is-over');
      const file = e.dataTransfer.files[0];
      if (file) this.loadArrayBuffer(await file.arrayBuffer(), file.name);
    });

    const fileInput = el('input', { type: 'file', accept: 'audio/*', class: 'file-input' });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (file) this.loadArrayBuffer(await file.arrayBuffer(), file.name);
    });

    // --- mode + kit ---
    this.modeBtns = ['kit', 'chop'].map((m) => {
      const b = button(m.toUpperCase(), {
        active: m === this.mode,
        className: 'btn-toggle',
        onClick: () => {
          if (m === 'chop' && !this.buffer) { this._status('load or resample a sample first'); return; }
          this.setMode(m);
        }
      });
      b.dataset.mode = m;
      return b;
    });

    const kitSel = select(
      SAMPLE_KITS.map((k, i) => ({ value: i, label: k.name })),
      { value: 0, onChange: (v) => { this.kitIndex = Number(v); this.setMode('kit'); } }
    );

    // --- pads ---
    this.padEls = Array.from({ length: PADS }, (_, i) => {
      const pad = el('button', { class: 'pad', type: 'button' },
        el('span', { class: 'pad-index' }, String(i + 1)),
        el('span', { class: 'pad-name' }, '')
      );
      pad.addEventListener('pointerdown', () => {
        this.activePad = i;
        this.playPad(i);
        this._selectPad(i);
      });
      return pad;
    });

    this.grid = createStepGrid({
      window: STEPS,
      tracks: Array.from({ length: PADS }, (_, i) => ({
        id: `p${i}`, label: String(i + 1), color: this.accent
      })),
      getTrack: (id) => this.pattern[id],
      onToggle: (trackId, i) => {
        this.pattern[trackId][i] = this.pattern[trackId][i] ? null : { velocity: 1 };
        this.grid.render(trackId);
        this.setState('pattern', this.getPattern());
      },
      compact: true
    });
    this.grid.render();

    // --- resample ---
    const barsSel = select(
      RESAMPLE_BARS.map((n) => ({ value: n, label: `${n} BAR` })),
      { value: 2, onChange: (v) => { this.resampleBars = Number(v); } }
    );

    this.resampleBtn = button('RESAMPLE', {
      className: 'btn-primary',
      onClick: () => {
        if (this._recorder?.recording) this.stopResample();
        else this.startResample();
      }
    });

    const chopBtn = button('AUTO CHOP', { onClick: () => this.autoChop() });
    const gridChopBtn = button('GRID CHOP', { onClick: () => this.gridChop() });

    this.thruBtn = toggle('THRU', {
      onChange: (on) => this.thru.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02)
    });

    // --- knobs ---
    const knob = (name, spec) => createKnob({
      ...spec,
      onChange: (v) => {
        this.params[name] = v;
        if (name === 'filter') {
          this.filter.frequency.setTargetAtTime(200 + v * 17800, this.ctx.currentTime, 0.02);
        }
      }
    });

    const playKnobs = [
      knob('pitch', { min: 0.25, max: 4, value: 1, label: 'PITCH', decimals: 2, curve: 2 }),
      knob('start', { min: 0, max: 0.9, value: 0, label: 'START', decimals: 2 }),
      knob('length', { min: 0.05, max: 2, value: 1, label: 'LEN', decimals: 2 }),
      knob('filter', { min: 0, max: 1, value: 1, label: 'TONE', decimals: 2 })
    ];

    const grainKnobs = [
      knob('grainSize', { min: 0.005, max: 0.4, value: 0.08, label: 'SIZE', decimals: 3, curve: 2 }),
      knob('grainScatter', { min: 0, max: 1, value: 0.2, label: 'SCATTER', decimals: 2 }),
      knob('grainDensity', { min: 0.05, max: 1, value: 0.7, label: 'DENSITY', decimals: 2 }),
      knob('grainPitch', { min: 0, max: 12, value: 0, label: 'SPRAY', decimals: 1 })
    ];

    const grainRow = row(el('div', { class: 'knob-cluster' }, ...grainKnobs.map((k) => k.el)));
    grainRow.classList.add('is-disabled');

    const granBtn = toggle('GRANULAR', {
      onChange: (on) => {
        this.granular = on;
        grainRow.classList.toggle('is-disabled', !on);
      }
    });

    const runBtn = button('RUN', {
      active: true, className: 'btn-toggle',
      onClick: (b) => {
        this.playing = !this.playing;
        b.classList.toggle('is-active', this.playing);
        b.textContent = this.playing ? 'RUN' : 'HOLD';
      }
    });
    const rndBtn = button('RND', { onClick: () => this._randomise() });
    const clrBtn = button('CLR', { onClick: () => this.clearPattern() });

    panel.body.append(
      section('SOURCE',
        row(...this.modeBtns, el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'KIT'), kitSel)),
        drop,
        row(fileInput, chopBtn, gridChopBtn),
        row(this.resampleBtn, barsSel, this.thruBtn)
      ),
      section('PADS', el('div', { class: 'pad-grid' }, ...this.padEls)),
      section(null,
        this.grid.el,
        row(el('div', { class: 'button-stack-h' }, runBtn, rndBtn, clrBtn))
      ),
      section('PLAYBACK', row(el('div', { class: 'knob-cluster' }, ...playKnobs.map((k) => k.el)))),
      section('GRAIN', row(granBtn), grainRow)
    );

    this._paintPads();
    return panel.el;
  }

  _status(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  // Set by main whenever the patch changes. Patching something into IN also
  // opens THRU, so the incoming signal is audible instead of vanishing into a
  // muted node while you wonder where it went.
  set inputPatched(v) {
    const changed = v !== this._inputPatched;
    this._inputPatched = v;
    if (changed && v && this.thruBtn && !this.thruBtn.classList.contains('is-active')) {
      this.thruBtn.setOn(true);
      this.thru.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
      this._status('input patched — THRU opened, RESAMPLE will capture it');
    }
  }

  _randomise() {
    Object.keys(this.pattern).forEach((k) => { this.pattern[k] = new Array(STEPS).fill(null); });
    const usable = this.mode === 'kit' ? PADS : Math.max(1, this.chops.length);
    for (let i = 0; i < randInt(4, 10); i++) {
      const pad = `p${randInt(0, usable - 1)}`;
      this.pattern[pad][randInt(0, STEPS - 1)] = { velocity: 0.6 + Math.random() * 0.4 };
    }
    this.grid.render();
    this.setState('pattern', this.getPattern());
  }

  _selectPad(i) {
    this.padEls.forEach((p, idx) => p.classList.toggle('is-selected', idx === i));
    this._drawWave();
  }

  _flashPad(i) {
    const pad = this.padEls?.[i];
    if (!pad) return;
    pad.classList.add('is-hit');
    setTimeout(() => pad.classList.remove('is-hit'), 90);
  }

  _paintPads() {
    if (!this.padEls) return;
    const kit = SAMPLE_KITS[this.kitIndex];
    this.padEls.forEach((pad, i) => {
      const loaded = this.mode === 'kit' ? !!kit?.slots[i] : !!this.chops[i];
      pad.classList.toggle('is-loaded', loaded);
      pad.querySelector('.pad-name').textContent =
        this.mode === 'kit' ? (kit?.slots[i]?.type.slice(0, 6) ?? '') : (this.chops[i] ? 'chop' : '');
    });
  }

  _drawWave() {
    if (!this.canvas) return;
    const g = this.canvas.getContext('2d');
    const { width, height } = this.canvas;
    g.clearRect(0, 0, width, height);

    if (!this.buffer) return;
    const data = this.buffer.getChannelData(0);
    const step = Math.ceil(data.length / width);

    // Min/max envelope per pixel column.
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let x = 0; x < width; x++) {
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) {
        const v = data[x * step + j] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = (1 + min) * height / 2;
      const y2 = (1 + max) * height / 2;
      g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }

    g.strokeStyle = this.accent;
    g.lineWidth = 1;
    this.chops.forEach((chop, i) => {
      const x = (chop.start / this.buffer.duration) * width;
      g.globalAlpha = i === this.activePad ? 1 : 0.45;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, height);
      g.stroke();
    });
    g.globalAlpha = 1;
  }

  applyState(key, value) {
    if (key === 'pattern' && value) this.setPattern(value);
    this.state[key] = value;
  }
}
