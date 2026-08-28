// YEBOAH — rhythm + acid unit.
//
// Six synthesised drum tracks and one monophonic acid line. Each track has its
// own length (16 / 32 / 64), so tracks can run polymetrically against each
// other — a 12-step hat under a 16-step kick drifts and resolves on its own.
//
// The grid shows a 16-step window; longer tracks are paged.

import { ModuleBase } from '../core/module-base.js';
import { createPanel, section, row, button, select } from '../ui/panel.js';
import { createKnob } from '../ui/knob.js';
import { createStepGrid } from '../ui/step-grid.js';
import { DRUM_VOICES, getVoice } from '../dsp/drums.js';
import { AcidVoice } from '../dsp/acid.js';
import { DRUM_PRESETS, BASS_PRESETS, parseDrumPreset, parseBassPreset } from '../dsp/presets.js';
import { el, euclid, midiToName, randInt, pick } from '../utils.js';

const WINDOW = 16;
const BASS_ROOT = 36; // C2
const LENGTHS = [16, 32, 64];

const TRACKS = [
  { id: 'kick', label: 'BD', voice: 'kick', color: '#ff4d00' },
  { id: 'snare', label: 'SD', voice: 'snare', color: '#ff8a00' },
  { id: 'hat', label: 'CH', voice: 'hat-closed', color: '#ffd000' },
  { id: 'open', label: 'OH', voice: 'hat-open', color: '#c6ff00' },
  { id: 'clap', label: 'CP', voice: 'clap', color: '#ff00c8' },
  { id: 'perc', label: 'PC', voice: 'perc', color: '#00f0ff' }
];

const ALL_ROWS = [...TRACKS, { id: 'acid', label: '303', color: '#c6ff00' }];

export class Yeboah extends ModuleBase {
  constructor(opts) {
    super({
      id: 'yeboah',
      name: 'YEBOAH',
      subtitle: 'RHYTHM / ACID',
      accent: '#ff4d00',
      ...opts
    });

    this.drumChannel = this.createChannel({ gain: 0.85 });
    this.bassChannel = this.createChannel({ gain: 0.7 });
    this.channel = this.drumChannel;

    this.drumBus = this.ctx.createGain();
    this.bassBus = this.ctx.createGain();
    this.acid = new AcidVoice(this.bassBus);

    this.trackConfig = Object.fromEntries(
      TRACKS.map((t) => [t.id, { voice: t.voice, tune: 1, decay: 1, level: 0.8, muted: false }])
    );

    this.lengths = Object.fromEntries(ALL_ROWS.map((t) => [t.id, WINDOW]));
    this.pattern = Object.fromEntries(ALL_ROWS.map((t) => [t.id, new Array(WINDOW).fill(null)]));

    this.trackGains = {};
    TRACKS.forEach((t) => {
      const g = this.ctx.createGain();
      g.gain.value = this.trackConfig[t.id].level;
      g.connect(this.drumBus);
      this.trackGains[t.id] = g;
    });

    this.loadPreset(0);
    this.loadBassPreset(0);
    this._registerJacks();

    this.playing = true;
    this.makeClockIn('clk-in', (step, time) => this._onStep(step, time));
  }

  _registerJacks() {
    this.addAudioOutput({ name: 'drum-out', label: 'DRUM', node: this.drumBus, channel: this.drumChannel });
    this.addAudioOutput({ name: 'bass-out', label: 'BASS', node: this.bassBus, channel: this.bassChannel });
    this.addCVInput({
      name: 'cutoff-cv', label: 'CUTOFF',
      target: this.acid.cutoffTarget,
      range: 4000, unit: 'Hz'
    });
  }

  // --- presets -------------------------------------------------------------

  loadPreset(index) {
    const preset = DRUM_PRESETS[index];
    if (!preset) return;
    TRACKS.forEach((t) => {
      const str = preset.tracks[t.id] || '................';
      const parsed = parseDrumPreset(str);
      const len = this.lengths[t.id];
      // Tile the 16-step preset across longer tracks so a 64-step track gets a
      // full pattern rather than 48 empty steps.
      this.pattern[t.id] = Array.from({ length: len }, (_, i) => {
        const v = parsed[i % parsed.length];
        return v ? { ...v } : null;
      });
    });
    this.presetName = preset.name;
    this.grid?.render();
    this.setState('pattern', this.getPattern());
  }

  loadBassPreset(index) {
    const preset = BASS_PRESETS[index];
    if (!preset) return;
    const parsed = parseBassPreset(preset.notes, BASS_ROOT);
    const len = this.lengths.acid;
    this.pattern.acid = Array.from({ length: len }, (_, i) => {
      const v = parsed[i % parsed.length];
      return v ? { ...v } : null;
    });
    this.grid?.render('acid');
    this.setState('pattern', this.getPattern());
  }

  setLength(trackId, len) {
    const old = this.pattern[trackId] || [];
    this.lengths[trackId] = len;
    // Growing repeats what is already there; shrinking truncates.
    this.pattern[trackId] = Array.from({ length: len }, (_, i) =>
      old.length ? (old[i % old.length] ? { ...old[i % old.length] } : null) : null
    );
    this.grid?.render();
    this._syncPager();
    this.setState('pattern', this.getPattern());
  }

  // --- playback ------------------------------------------------------------

  _onStep(step, time) {
    // Each track wraps at its own length — that is what makes it polymetric.
    ALL_ROWS.forEach((t) => {
      const pos = step % this.lengths[t.id];
      this.grid?.highlight(t.id, pos);
    });

    if (!this.playing) return;

    TRACKS.forEach((t) => {
      const pos = step % this.lengths[t.id];
      const ev = this.pattern[t.id][pos];
      if (!ev) return;
      const cfg = this.trackConfig[t.id];
      if (cfg.muted) return;
      getVoice(cfg.voice).play(
        this.trackGains[t.id], time, ev.velocity ?? 0.9,
        { tune: cfg.tune, decay: cfg.decay }
      );
    });

    const aPos = step % this.lengths.acid;
    const a = this.pattern.acid[aPos];
    if (a) {
      this.acid.trigger(a.note, time, { accent: !!a.accent, slide: !!a.slide, gate: a.gate ?? 1 });
    }
  }

  // --- pattern bank interface ---------------------------------------------

  getPattern() {
    return { steps: this.pattern, lengths: this.lengths };
  }

  setPattern(p) {
    if (!p) return;
    if (p.lengths) Object.assign(this.lengths, p.lengths);
    if (p.steps) this.pattern = p.steps;
    this.grid?.render();
    this._syncPager();
  }

  clearPattern() {
    ALL_ROWS.forEach((t) => {
      this.pattern[t.id] = new Array(this.lengths[t.id]).fill(null);
    });
    this.grid?.render();
    this.setState('pattern', this.getPattern());
  }

  // --- ui ------------------------------------------------------------------

  render() {
    const panel = createPanel(this);

    this.grid = createStepGrid({
      window: WINDOW,
      tracks: ALL_ROWS,
      getTrack: (id) => this.pattern[id],
      lengths: (id) => this.lengths[id],
      onToggle: (trackId, i) => {
        const current = this.pattern[trackId][i];
        if (trackId === 'acid') {
          // Cycle: off -> note -> accent -> slide -> off.
          if (!current) this.pattern.acid[i] = { note: BASS_ROOT, velocity: 0.85 };
          else if (!current.accent && !current.slide) current.accent = true;
          else if (current.accent && !current.slide) { current.accent = false; current.slide = true; }
          else this.pattern.acid[i] = null;
        } else {
          this.pattern[trackId][i] = current ? null : { velocity: 0.9 };
        }
        this.grid.render(trackId);
        this.setState('pattern', this.getPattern());
      },
      onEdit: (trackId, i) => this._editStep(trackId, i),
      compact: true
    });
    this.grid.render();

    // --- pager ---
    this.pageBtns = [0, 1, 2, 3].map((p) =>
      button(String(p + 1), {
        active: p === 0,
        className: 'btn-mini',
        onClick: () => {
          this.grid.setPage(p);
          this.pageBtns.forEach((b, i) => b.classList.toggle('is-active', i === p));
        }
      })
    );
    this.pager = el('div', { class: 'btn-group' }, ...this.pageBtns);

    // --- length per track ---
    const lengthTrackSel = select(
      ALL_ROWS.map((t) => ({ value: t.id, label: t.label })),
      { value: 'kick', onChange: (v) => { this.lengthTrack = v; lengthSel.value = String(this.lengths[v]); } }
    );
    const lengthSel = select(
      LENGTHS.map((n) => ({ value: n, label: `${n}` })),
      { value: WINDOW, onChange: (v) => this.setLength(this.lengthTrack, Number(v)) }
    );
    this.lengthTrack = 'kick';

    // --- presets ---
    const presetSel = select(
      DRUM_PRESETS.map((p, i) => ({ value: i, label: p.name })),
      { value: 0, onChange: (v) => this.loadPreset(Number(v)) }
    );
    const bassPresetSel = select(
      BASS_PRESETS.map((p, i) => ({ value: i, label: p.name })),
      { value: 0, onChange: (v) => this.loadBassPreset(Number(v)) }
    );

    // --- per-track voice ---
    const trackSel = select(
      TRACKS.map((t) => ({ value: t.id, label: t.label })),
      { value: 'kick', onChange: (v) => this._selectTrack(v) }
    );
    const voiceSel = select(
      DRUM_VOICES.map((v) => ({ value: v.id, label: v.label })),
      { value: 'kick', onChange: (v) => { this.trackConfig[this.selected].voice = v; this.setState('tracks', this.trackConfig); } }
    );
    const tuneKnob = createKnob({
      min: 0.5, max: 2, value: 1, label: 'TUNE', decimals: 2,
      onChange: (v) => { this.trackConfig[this.selected].tune = v; }
    });
    const decayKnob = createKnob({
      min: 0.2, max: 3, value: 1, label: 'DECAY', decimals: 2,
      onChange: (v) => { this.trackConfig[this.selected].decay = v; }
    });
    const levelKnob = createKnob({
      min: 0, max: 1.4, value: 0.8, label: 'LEVEL', decimals: 2,
      onChange: (v) => {
        this.trackConfig[this.selected].level = v;
        this.trackGains[this.selected].gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
      }
    });
    const muteBtn = button('MUTE', {
      className: 'btn-toggle',
      onClick: (b) => {
        const cfg = this.trackConfig[this.selected];
        cfg.muted = !cfg.muted;
        b.classList.toggle('is-active', cfg.muted);
      }
    });

    this.selected = 'kick';
    this._trackUI = { voiceSel, tuneKnob, decayKnob, levelKnob, muteBtn };

    // --- acid controls ---
    const acidSpecs = {
      cutoff: { min: 80, max: 6000, value: 700, label: 'CUTOFF', decimals: 0, curve: 2.5 },
      resonance: { min: 0.5, max: 25, value: 12, label: 'RESO', decimals: 1 },
      envMod: { min: 0, max: 1, value: 0.6, label: 'ENV', decimals: 2 },
      decay: { min: 0.05, max: 1, value: 0.25, label: 'DECAY', decimals: 2 }
    };
    const acidKnobs = Object.entries(acidSpecs).map(([key, spec]) =>
      createKnob({ ...spec, onChange: (v) => this.acid.set(key, v) })
    );

    const waveBtn = button('SAW', {
      className: 'btn-toggle',
      onClick: (b) => {
        const next = this.acid.params.waveform === 'sawtooth' ? 'square' : 'sawtooth';
        this.acid.set('waveform', next);
        b.textContent = next === 'sawtooth' ? 'SAW' : 'SQR';
      }
    });

    const playBtn = button('RUN', {
      active: true, className: 'btn-toggle',
      onClick: (b) => {
        this.playing = !this.playing;
        b.classList.toggle('is-active', this.playing);
        b.textContent = this.playing ? 'RUN' : 'HOLD';
      }
    });
    const randBtn = button('RND', { onClick: () => this._randomise() });
    const clearBtn = button('CLR', { onClick: () => this.clearPattern() });

    panel.body.append(
      section(null,
        row(
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'KIT'), presetSel),
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, '303'), bassPresetSel),
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'PAGE'), this.pager)
        ),
        this.grid.el,
        row(
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'LEN OF'), lengthTrackSel),
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'STEPS'), lengthSel),
          el('div', { class: 'button-stack-h' }, playBtn, randBtn, clearBtn)
        )
      ),
      section('DRUM VOICE',
        row(
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'TRACK'), trackSel),
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'SOUND'), voiceSel),
          muteBtn
        ),
        row(el('div', { class: 'knob-cluster' }, tuneKnob.el, decayKnob.el, levelKnob.el))
      ),
      section('303 LINE',
        row(el('div', { class: 'knob-cluster' }, ...acidKnobs.map((k) => k.el)), waveBtn)
      )
    );

    this.acidKnobs = acidKnobs;
    this._syncPager();
    return panel.el;
  }

  _syncPager() {
    const max = this.grid?.maxPage() ?? 0;
    this.pageBtns?.forEach((b, i) => { b.disabled = i > max; b.classList.toggle('is-dim', i > max); });
  }

  _selectTrack(id) {
    this.selected = id;
    const cfg = this.trackConfig[id];
    this._trackUI.voiceSel.value = cfg.voice;
    this._trackUI.tuneKnob.setValue(cfg.tune);
    this._trackUI.decayKnob.setValue(cfg.decay);
    this._trackUI.levelKnob.setValue(cfg.level);
    this._trackUI.muteBtn.classList.toggle('is-active', cfg.muted);
  }

  _editStep(trackId, i) {
    const ev = this.pattern[trackId][i];
    if (!ev) return;
    if (trackId === 'acid') {
      ev.note = BASS_ROOT + ((ev.note - BASS_ROOT + 1) % 25);
    } else {
      ev.velocity = ev.velocity > 0.7 ? 0.45 : ev.velocity > 0.3 ? 1 : 0.7;
    }
    this.grid.render(trackId);
    this.setState('pattern', this.getPattern());
  }

  _randomise() {
    const len = this.lengths.kick;
    this.pattern.kick = new Array(len).fill(null);
    euclid(randInt(3, 6), len).forEach((on, i) => { if (on) this.pattern.kick[i] = { velocity: 1 }; });

    const hatLen = this.lengths.hat;
    this.pattern.hat = new Array(hatLen).fill(null);
    euclid(randInt(6, 12), hatLen, randInt(0, 3)).forEach((on, i) => {
      if (on) this.pattern.hat[i] = { velocity: 0.4 + Math.random() * 0.4 };
    });

    const acidLen = this.lengths.acid;
    this.pattern.acid = new Array(acidLen).fill(null);
    const scale = [0, 3, 5, 7, 10, 12];
    for (let i = 0; i < acidLen; i++) {
      if (Math.random() > 0.55) {
        this.pattern.acid[i] = {
          note: BASS_ROOT + pick(scale) + (Math.random() > 0.8 ? 12 : 0),
          accent: Math.random() > 0.72,
          slide: Math.random() > 0.8,
          velocity: 0.85
        };
      }
    }
    this.grid.render();
    this.setState('pattern', this.getPattern());
  }

  applyState(key, value) {
    if (key === 'pattern' && value) this.setPattern(value);
    if (key === 'tracks' && value) Object.assign(this.trackConfig, value);
    this.state[key] = value;
  }
}
