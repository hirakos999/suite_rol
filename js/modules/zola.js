// ZOLA — voice lab.
//
// Four voice sources feed one shared chain: an internal vowel synth (always
// available, sequenceable), typed text via TTS, the live mic, and imported
// files. The chain is vocoder -> glitch -> looper.
//
// The vowel synth exists so the module works with nothing installed and no
// permissions granted — a vocoder with no modulator is silent, which is what
// made this module feel broken.

import { ModuleBase } from '../core/module-base.js';
import { createPanel, section, row, button, toggle, select } from '../ui/panel.js';
import { createKnob } from '../ui/knob.js';
import { createStepGrid } from '../ui/step-grid.js';
import { Vocoder } from '../dsp/vocoder.js';
import { FormantVoice, VOWEL_KEYS } from '../dsp/formant.js';
import { el, midiToFreq, pick, randInt } from '../utils.js';

const STEPS = 16;

export class Zola extends ModuleBase {
  constructor(opts) {
    super({
      id: 'zola',
      name: 'ZOLA',
      subtitle: 'VOICE LAB',
      accent: '#a56bff',
      ...opts
    });

    this.createChannel({ gain: 0.7 });

    this.buffer = null;
    this.source = null;
    this.loopLayers = [];
    this.glitching = false;
    this.vowelSeqOn = true;

    this.params = {
      carrierNote: 45, carrierDetune: 14, vocDepth: 14,
      dry: 0, pitch: 1, stutterRate: 4, stutterChance: 0,
      vowelPitch: 110, breath: 0.02
    };

    // Vowel sequence: one vowel (or rest) per step.
    this.vowelPattern = new Array(STEPS).fill(null);
    [0, 3, 6, 8, 11, 14].forEach((i) => {
      this.vowelPattern[i] = { vowel: pick(VOWEL_KEYS), velocity: 0.8 };
    });

    this._buildGraph();
    this._registerJacks();
    this.makeClockIn('clk-in', (step, time) => this._onStep(step, time));
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.vocoder = new Vocoder(ctx, { bands: 16 });

    // Everything that counts as "voice" lands here.
    this.voiceIn = ctx.createGain();
    this.voiceIn.connect(this.vocoder.modulatorIn);

    // Dry blend so the raw voice can sit under the vocoded signal.
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0;
    this.voiceIn.connect(this.dryGain);

    // Internal vowel synth — a voice source that always exists.
    this.formant = new FormantVoice(this.voiceIn);

    // Internal carrier: three detuned saws, harmonically dense enough for the
    // filter bank to have something to chew on in every band.
    this.carrierBus = ctx.createGain();
    this.carrierBus.gain.value = 0.28;
    this.carrierOscs = [-1, 0, 1].map((i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(this.params.carrierNote);
      osc.detune.value = i * this.params.carrierDetune;
      osc.connect(this.carrierBus);
      osc.start();
      return osc;
    });
    this.carrierBus.connect(this.vocoder.carrierIn);

    this.carrierIn = ctx.createGain();
    this.carrierIn.connect(this.vocoder.carrierIn);

    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.vocoder.output.connect(this.out);
    this.dryGain.connect(this.out);

    // Bypass path: the voice straight to the output, so the module can be used
    // as a plain sampler/looper when the vocoder is not what you want.
    this.bypassGain = ctx.createGain();
    this.bypassGain.gain.value = 0;
    this.voiceIn.connect(this.bypassGain);
    this.bypassGain.connect(this.out);

    this.loopBus = ctx.createGain();
    this.out.connect(this.loopBus);

    this.voiceJackIn = ctx.createGain();
    this.voiceJackIn.connect(this.voiceIn);
  }

  _registerJacks() {
    this.addAudioOutput({ name: 'audio-out', label: 'OUT', node: this.out });
    this.addJack({ direction: 'in', name: 'carrier-in', type: 'audio', label: 'CARRIER', node: this.carrierIn });
    this.addJack({ direction: 'in', name: 'voice-in', type: 'audio', label: 'VOICE', node: this.voiceJackIn });
  }

  // --- sources -------------------------------------------------------------

  // The server picks the best provider it has (Piper, else macOS `say`) and
  // returns a WAV, which means the speech lands in the buffer and goes through
  // the vocoder like any other source.
  async speak(text) {
    if (!text.trim()) return;
    this._status('synthesising…');
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: this.voice || undefined,
          rate: this.speechRate || undefined
        })
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const provider = res.headers.get('X-TTS-Provider') || 'tts';
      this.buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this._status(`${provider} · ${this.buffer.duration.toFixed(2)}s · vocoded`);
      this.playVoice();
    } catch {
      // Last resort. Browser speech cannot be captured into a buffer, so it
      // bypasses the whole chain — say so instead of pretending.
      if ('speechSynthesis' in window) {
        speechSynthesis.speak(new SpeechSynthesisUtterance(text));
        this._status('browser voice — NOT vocoded (server TTS unavailable)');
      } else {
        this._status('no TTS available');
      }
    }
  }

  // Voice list for the dropdown, grouped by locale with Italian first.
  async loadVoices() {
    try {
      const res = await fetch('/api/tts/voices');
      if (!res.ok) return;
      const { say: voices = [] } = await res.json();
      if (!voices.length || !this.voiceSel) return;

      const groups = new Map();
      voices.forEach((v) => {
        if (!groups.has(v.locale)) groups.set(v.locale, []);
        groups.get(v.locale).push(v.name);
      });

      const order = [...groups.keys()].sort((a, b) => {
        const rank = (l) => (l.startsWith('it') ? 0 : l.startsWith('en') ? 1 : 2);
        return rank(a) - rank(b) || a.localeCompare(b);
      });

      this.voiceSel.replaceChildren(
        ...order.map((locale) => {
          const group = el('optgroup', { label: locale });
          groups.get(locale).forEach((name) => group.append(el('option', { value: name }, name)));
          return group;
        })
      );

      // Default to the first Italian voice when there is one.
      const preferred = voices.find((v) => v.locale.startsWith('it'))?.name;
      if (preferred) { this.voiceSel.value = preferred; this.voice = preferred; }
      else this.voice = this.voiceSel.value;
    } catch {
      // No server voices — the dropdown just stays as it is.
    }
  }

  async startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType });
        this.buffer = await this.ctx.decodeAudioData(await blob.arrayBuffer());
        this._status(`mic · ${this.buffer.duration.toFixed(2)}s`);
        this._micStop = null;
        this.micBtn.setOn(false);
        this.playVoice();
      };
      rec.start();
      this._status('recording…');
      this._micStop = () => rec.stop();
      return true;
    } catch {
      this._status('mic permission denied');
      this.micBtn.setOn(false);
      return false;
    }
  }

  stopMic() {
    this._micStop?.();
    this._micStop = null;
  }

  // Live mic straight into the chain, no recording step — the immediate way to
  // hear the vocoder working.
  async toggleLiveMic(on) {
    if (!on) {
      this._liveStream?.getTracks().forEach((t) => t.stop());
      this._liveNode?.disconnect();
      this._liveStream = null;
      this._liveNode = null;
      this._status('live mic off');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
      });
      this._liveStream = stream;
      this._liveNode = this.ctx.createMediaStreamSource(stream);
      this._liveNode.connect(this.voiceIn);
      this._status('live mic → vocoder');
    } catch {
      this._status('mic permission denied');
      this.liveBtn.setOn(false);
    }
  }

  async loadFile(file) {
    this.buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
    this._status(`${file.name} · ${this.buffer.duration.toFixed(2)}s`);
    this.playVoice();
  }

  playVoice({ loop = false, time = this.ctx.currentTime } = {}) {
    if (!this.buffer) { this._status('nothing loaded — try the vowel sequencer'); return; }
    if (this.source) { try { this.source.stop(); } catch {} }

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = loop;
    src.playbackRate.value = this.params.pitch;
    src.connect(this.voiceIn);
    src.start(time);
    this.source = src;
    src.onended = () => { if (this.source === src) this.source = null; };
  }

  // --- clock ---------------------------------------------------------------

  _onStep(step, time) {
    const pos = step % STEPS;
    this.grid?.highlightAll(pos);

    if (this.vowelSeqOn) {
      const ev = this.vowelPattern[pos];
      if (ev) {
        this.formant.setVowel(ev.vowel, time);
        this.formant.speak(time, this.clock.stepDuration * 1.6, ev.velocity);
      }
    }

    if (!this.glitching) return;
    const p = this.params;
    if (step % Math.max(1, Math.round(16 / p.stutterRate)) !== 0) return;
    if (Math.random() > p.stutterChance) return;
    this._stutter(time);
  }

  _stutter(time) {
    if (!this.buffer) return;
    const sliceLen = this.clock.stepDuration * (16 / this.params.stutterRate);
    const pos = Math.random() * Math.max(0, this.buffer.duration - sliceLen);

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.params.pitch * (Math.random() > 0.75 ? 2 : 1);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(1, time + 0.004);
    g.gain.setValueAtTime(1, time + sliceLen - 0.008);
    g.gain.linearRampToValueAtTime(0.0001, time + sliceLen);

    src.connect(g);
    g.connect(this.voiceIn);
    src.start(time, pos, sliceLen);
    src.stop(time + sliceLen + 0.02);
    src.onended = () => { src.disconnect(); g.disconnect(); };
  }

  // --- looper --------------------------------------------------------------

  toggleLoopRecord() {
    if (this._loopStop) { this._loopStop(); return; }

    const dest = this.ctx.createMediaStreamDestination();
    this.loopBus.connect(dest);
    const rec = new MediaRecorder(dest.stream);
    const chunks = [];

    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      this.loopBus.disconnect(dest);
      const buf = await this.ctx.decodeAudioData(
        await new Blob(chunks, { type: rec.mimeType }).arrayBuffer()
      );
      this._addLayer(buf);
      this._loopStop = null;
      this.loopBtn.setOn(false);
    };

    rec.start();
    this._status('looper recording…');
    this._loopStop = () => rec.stop();
  }

  _addLayer(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0.75;
    src.connect(g);
    g.connect(this.channel.input);
    src.start();
    this.loopLayers.push({ src, gain: g, buffer });
    this._renderLayers();
  }

  undoLayer() {
    const layer = this.loopLayers.pop();
    if (!layer) return;
    try { layer.src.stop(); } catch {}
    layer.gain.disconnect();
    this._renderLayers();
  }

  clearLayers() {
    while (this.loopLayers.length) this.undoLayer();
  }

  _renderLayers() {
    if (this.layerReadout) {
      const n = this.loopLayers.length;
      this.layerReadout.textContent = `${n} LAYER${n === 1 ? '' : 'S'}`;
    }
  }

  // --- pattern bank interface ---------------------------------------------

  getPattern() {
    return { vowels: this.vowelPattern, seqOn: this.vowelSeqOn };
  }

  setPattern(p) {
    if (!p) return;
    if (p.vowels) this.vowelPattern = p.vowels;
    if (p.seqOn !== undefined) this.vowelSeqOn = p.seqOn;
    this.grid?.render();
  }

  clearPattern() {
    this.vowelPattern = new Array(STEPS).fill(null);
    this.grid?.render();
    this.setState('pattern', this.getPattern());
  }

  // --- ui ------------------------------------------------------------------

  render() {
    const panel = createPanel(this);

    this.statusEl = el('span', { class: 'readout' }, 'vowel sequencer running');
    this.layerReadout = el('span', { class: 'readout' }, '0 LAYERS');

    // --- vowel sequencer ---
    this.grid = createStepGrid({
      window: STEPS,
      tracks: [{ id: 'vow', label: 'VOW', color: this.accent }],
      getTrack: () => this.vowelPattern,
      onToggle: (_t, i) => {
        this.vowelPattern[i] = this.vowelPattern[i]
          ? null
          : { vowel: pick(VOWEL_KEYS), velocity: 0.8 };
        this.grid.render();
        this.setState('pattern', this.getPattern());
      },
      onEdit: (_t, i) => {
        const ev = this.vowelPattern[i];
        if (!ev) return;
        // Cycle through the vowels on right-click.
        const next = (VOWEL_KEYS.indexOf(ev.vowel) + 1) % VOWEL_KEYS.length;
        ev.vowel = VOWEL_KEYS[next];
        this._status(`step ${i + 1}: ${ev.vowel}`);
        this.grid.render();
        this.setState('pattern', this.getPattern());
      },
      compact: true
    });
    this.grid.render();

    const seqBtn = toggle('VOWEL SEQ', {
      value: true,
      onChange: (on) => {
        this.vowelSeqOn = on;
        if (!on) this.formant.silence();
      }
    });
    const rndVowels = button('RND', {
      onClick: () => {
        this.vowelPattern = new Array(STEPS).fill(null);
        for (let i = 0; i < randInt(4, 10); i++) {
          this.vowelPattern[randInt(0, STEPS - 1)] = { vowel: pick(VOWEL_KEYS), velocity: 0.7 + Math.random() * 0.3 };
        }
        this.grid.render();
      }
    });
    const clrVowels = button('CLR', { onClick: () => this.clearPattern() });

    const vowelKnobs = [
      createKnob({
        min: 55, max: 330, value: 110, label: 'VOICE', decimals: 0, unit: 'Hz', curve: 1.6,
        onChange: (v) => { this.params.vowelPitch = v; this.formant.setPitch(v); }
      }),
      createKnob({
        min: 0, max: 0.3, value: 0.02, label: 'BREATH', decimals: 3,
        onChange: (v) => { this.params.breath = v; this.formant.setBreath(v); }
      })
    ];

    const holdVowel = select(
      VOWEL_KEYS.map((v) => ({ value: v, label: v })),
      { value: 'A', onChange: (v) => this.formant.setVowel(v) }
    );

    // --- other sources ---
    const textInput = el('input', {
      type: 'text', class: 'text-input',
      placeholder: 'type something to say…', value: 'acid never died'
    });
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.speak(textInput.value);
    });
    const speakBtn = button('SPEAK', { className: 'btn-primary', onClick: () => this.speak(textInput.value) });

    this.voiceSel = el('select', { class: 'select' }, el('option', { value: '' }, 'default'));
    this.voiceSel.addEventListener('change', () => { this.voice = this.voiceSel.value; });

    const rateKnob = createKnob({
      min: 80, max: 320, value: 180, label: 'RATE', decimals: 0, unit: ' wpm',
      onChange: (v) => { this.speechRate = Math.round(v); }
    });
    this.speechRate = 180;

    this.liveBtn = toggle('LIVE MIC', { onChange: (on) => this.toggleLiveMic(on) });
    this.micBtn = toggle('REC MIC', { onChange: (on) => (on ? this.startMic() : this.stopMic()) });

    const fileInput = el('input', { type: 'file', accept: 'audio/*', class: 'file-input' });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) this.loadFile(fileInput.files[0]);
    });

    const playBtn = button('PLAY', { onClick: () => this.playVoice() });
    const loopSrcBtn = toggle('LOOP SRC', { onChange: (on) => this.playVoice({ loop: on }) });

    // --- carrier + vocoder ---
    const carrierKnobs = [
      createKnob({
        min: 24, max: 72, value: 45, label: 'CARRIER', decimals: 0,
        onChange: (v) => {
          this.params.carrierNote = v;
          this.carrierOscs.forEach((o) => o.frequency.setTargetAtTime(midiToFreq(v), this.ctx.currentTime, 0.02));
        }
      }),
      createKnob({
        min: 0, max: 40, value: 14, label: 'SPREAD', decimals: 0,
        onChange: (v) => {
          this.params.carrierDetune = v;
          this.carrierOscs.forEach((o, i) => o.detune.setTargetAtTime((i - 1) * v, this.ctx.currentTime, 0.02));
        }
      })
    ];

    const vocKnobs = [
      createKnob({ min: 2, max: 40, value: 14, label: 'DEPTH', decimals: 0, onChange: (v) => this.vocoder.setDepth(v) }),
      createKnob({ min: 1, max: 16, value: 4, label: 'BAND Q', decimals: 1, onChange: (v) => this.vocoder.setResonance(v) }),
      createKnob({ min: 4, max: 90, value: 18, label: 'RESP', decimals: 0, curve: 1.6, onChange: (v) => this.vocoder.setResponse(v) }),
      createKnob({ min: -12, max: 12, value: 0, label: 'FORMANT', decimals: 0, onChange: (v) => this.vocoder.setFormantShift(v) }),
      createKnob({ min: 0, max: 0.6, value: 0.18, label: 'SIBIL', decimals: 2, onChange: (v) => this.vocoder.setSibilance(v) }),
      createKnob({
        min: 0, max: 1, value: 0, label: 'DRY', decimals: 2,
        onChange: (v) => this.dryGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
      })
    ];

    const bypassBtn = toggle('BYPASS', {
      onChange: (on) => {
        this.bypassGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
        this.vocoder.output.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.02);
      }
    });

    // --- glitch + looper ---
    const glitchKnobs = [
      createKnob({ min: 0, max: 1, value: 0, label: 'AMOUNT', decimals: 2, onChange: (v) => { this.params.stutterChance = v; } }),
      createKnob({ min: 1, max: 16, value: 4, label: 'RATE', decimals: 0, onChange: (v) => { this.params.stutterRate = Math.round(v); } }),
      createKnob({
        min: 0.25, max: 3, value: 1, label: 'PITCH', decimals: 2, curve: 2,
        onChange: (v) => {
          this.params.pitch = v;
          if (this.source) this.source.playbackRate.setTargetAtTime(v, this.ctx.currentTime, 0.02);
        }
      })
    ];
    const glitchBtn = toggle('GLITCH', { onChange: (on) => { this.glitching = on; } });

    this.loopBtn = toggle('LOOP REC', { onChange: () => this.toggleLoopRecord() });
    const undoBtn = button('UNDO', { onClick: () => this.undoLayer() });
    const clearBtn = button('CLEAR', { onClick: () => this.clearLayers() });

    panel.body.append(
      section('VOWEL SYNTH',
        this.grid.el,
        row(seqBtn, rndVowels, clrVowels,
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'HOLD'), holdVowel)),
        row(el('div', { class: 'knob-cluster' }, ...vowelKnobs.map((k) => k.el)))
      ),
      section('SPEECH',
        row(textInput, speakBtn),
        row(
          el('div', { class: 'stacked' }, el('span', { class: 'micro-label' }, 'VOICE'), this.voiceSel),
          rateKnob.el
        )
      ),
      section('OTHER SOURCES',
        row(this.liveBtn, this.micBtn, playBtn, loopSrcBtn),
        row(fileInput, this.statusEl)
      ),
      section('CARRIER', row(el('div', { class: 'knob-cluster' }, ...carrierKnobs.map((k) => k.el)), bypassBtn)),
      section('VOCODER', row(el('div', { class: 'knob-cluster' }, ...vocKnobs.map((k) => k.el)))),
      section('GLITCH', row(glitchBtn, el('div', { class: 'knob-cluster' }, ...glitchKnobs.map((k) => k.el)))),
      section('LOOPER', row(this.loopBtn, undoBtn, clearBtn, this.layerReadout))
    );

    this.loadVoices();
    return panel.el;
  }

  _status(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  applyState(key, value) {
    if (key === 'pattern' && value) this.setPattern(value);
    this.state[key] = value;
  }
}
