// KANCHELSKIS — master clock, pattern bank and song mode.
//
// Owns the only Clock instance. Other modules follow it ONLY when patched to
// one of its clock outs, exactly like a hardware sync cable.
//
// A pattern slot snapshots the whole rack, not one instrument, so recalling A
// or B switches every module together. Song mode plays a list of those slots
// with a repeat count each.

import { ModuleBase } from '../core/module-base.js';
import { createPanel, section, row, button } from '../ui/panel.js';
import { createKnob } from '../ui/knob.js';
import { createDisplay } from '../ui/led-display.js';
import { SLOT_NAMES } from '../core/patterns.js';
import { el } from '../utils.js';

const BAR_OPTIONS = [1, 2, 4, 8];

export class Kanchelskis extends ModuleBase {
  constructor(opts) {
    super({
      id: 'kanchelskis',
      name: 'KANCHELSKIS',
      subtitle: 'CLOCK / PATTERNS',
      accent: '#ffb000',
      ...opts
    });

    this.bank = opts.bank;
    this.state = { bpm: 130, swing: 0, bars: 4 };

    this.stepsPerBar = 16;
    this.barCount = 4;    // pattern length in bars
    this.currentBar = 0;

    // Three clock outs at different divisions, so one module can run at half
    // speed while another sits on 16ths.
    this.clockOut = this.makeClockOut('clk-1', 'CLK');
    this.clockDiv2 = this.makeClockOut('clk-2', 'DIV2');
    this.clockDiv4 = this.makeClockOut('clk-4', 'DIV4');

    this.onClock((step, time) => {
      this.clockOut.emit(step, time);
      if (step % 2 === 0) this.clockDiv2.emit(step, time);
      if (step % 4 === 0) this.clockDiv4.emit(step, time);

      if (step % this.stepsPerBar === 0) this._onBar(step);
      this._pulse(step);
    });
  }

  _onBar(step) {
    this.currentBar = Math.floor(step / this.stepsPerBar) % this.barCount;
    this.barDisplay?.show(String(this.currentBar + 1));
    // Song mode advances on bar boundaries, never mid-pattern.
    this.bank?.advanceBar();
  }

  _pulse(step) {
    if (!this.beatLED) return;
    const isBeat = step % 4 === 0;
    const isBar = step % this.stepsPerBar === 0;
    this.beatLED.classList.toggle('is-bar', isBar);
    this.beatLED.classList.add('is-lit');
    clearTimeout(this._pulseTimer);
    this._pulseTimer = setTimeout(() => this.beatLED.classList.remove('is-lit'), isBeat ? 90 : 45);
  }

  render() {
    const panel = createPanel(this, { showVU: false, wide: true });

    const bpmDisplay = createDisplay({ digits: 4, value: this.state.bpm, label: 'TEMPO' });
    this.barDisplay = createDisplay({ digits: 2, value: '1', label: 'BAR' });
    this.beatLED = el('div', { class: 'beat-led' });

    const bpmKnob = createKnob({
      min: 40, max: 200, value: this.state.bpm, label: 'TEMPO', decimals: 0, size: 48,
      onChange: (v) => {
        this.clock.setBpm(v);
        bpmDisplay.show(Math.round(v));
        this.setState('bpm', v);
      }
    });

    const swingKnob = createKnob({
      min: 0, max: 0.7, value: this.state.swing, label: 'SWING', decimals: 2,
      onChange: (v) => { this.clock.setSwing(v); this.setState('swing', v); }
    });

    const playBtn = button('▶ PLAY', {
      className: 'btn-large btn-play',
      onClick: (b) => {
        const running = this.clock.toggle();
        b.textContent = running ? '■ STOP' : '▶ PLAY';
        b.classList.toggle('is-active', running);
        document.dispatchEvent(new CustomEvent('suite:transport', { detail: { running } }));
      }
    });

    const tapBtn = button('TAP', { className: 'btn-large', onClick: () => this._tap(bpmKnob, bpmDisplay) });

    // --- bar length ---
    const barBtns = BAR_OPTIONS.map((n) =>
      button(`${n}`, {
        active: n === this.barCount,
        className: 'btn-bar',
        onClick: () => {
          this.barCount = n;
          this.setState('bars', n);
          barBtns.forEach((b, i) => b.classList.toggle('is-active', BAR_OPTIONS[i] === n));
        }
      })
    );

    // --- pattern slots ---
    // Click selects a slot (and recalls it if it holds anything). Saving is
    // always an explicit SAVE press — clicking an empty slot used to save into
    // it, which made the bank feel like it was filling itself at random.
    this.slotEls = SLOT_NAMES.map((name, i) => {
      const b = el('button', {
        class: 'pattern-slot', type: 'button',
        title: `slot ${name} — click to select/recall, then SAVE to store. Right-click clears.`
      }, el('span', { class: 'pattern-slot-name' }, name));

      b.addEventListener('click', () => {
        this.bank.current = i;
        if (!this.bank.isEmpty(i)) {
          this.bank.load(i);
          this._status(`recalled pattern ${name}`);
        } else {
          this.bank._emit();
          this._status(`slot ${name} selected — press SAVE to store the rack here`);
        }
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.bank.clearSlot(i);
        this._status(`cleared slot ${name}`);
      });
      return b;
    });

    const saveBtn = button('SAVE', {
      className: 'btn-primary',
      onClick: () => {
        const name = SLOT_NAMES[this.bank.current];
        this.bank.save(this.bank.current);
        this._status(`whole rack saved to slot ${name}`);
      }
    });

    // --- song mode ---
    this.songList = el('div', { class: 'song-list' });

    const addSongBtn = button('+ ADD', {
      onClick: () => {
        const name = SLOT_NAMES[this.bank.current];
        if (this.bank.addToSong(this.bank.current, 4)) {
          this._status(`added ${name} to the song for 4 bars`);
        } else {
          this._status(`slot ${name} is empty — select it and press SAVE first`);
        }
      }
    });

    this.songBtn = button('SONG', {
      className: 'btn-toggle',
      onClick: (b) => {
        const on = !this.bank.songEnabled;
        if (on) {
          if (!this.bank.startSong()) { this._status('song is empty'); return; }
        } else {
          this.bank.stopSong();
        }
        b.classList.toggle('is-active', this.bank.songEnabled);
      }
    });

    const clearSongBtn = button('CLR SONG', {
      onClick: () => { this.bank.song = []; this.bank.stopSong(); this.bank._emit(); }
    });

    this.songReadout = el('span', { class: 'readout' }, '—');

    this.bank.onChange(() => this._renderBank());

    panel.body.append(
      section(null,
        row(
          el('div', { class: 'clock-readouts' }, bpmDisplay.el, this.barDisplay.el, this.beatLED),
          el('div', { class: 'knob-cluster' }, bpmKnob.el, swingKnob.el),
          el('div', { class: 'stacked' },
            el('span', { class: 'micro-label' }, 'PATTERN BARS'),
            el('div', { class: 'btn-group' }, ...barBtns)
          ),
          el('div', { class: 'button-stack' }, playBtn, tapBtn)
        )
      ),
      section('PATTERN BANK',
        row(
          el('div', { class: 'pattern-slots' }, ...this.slotEls),
          saveBtn
        )
      ),
      section('SONG',
        row(this.songBtn, addSongBtn, clearSongBtn),
        row(this.songReadout),
        this.songList
      )
    );

    this.bpmKnob = bpmKnob;
    this.swingKnob = swingKnob;
    this.clock.setBpm(this.state.bpm);
    this._renderBank();
    return panel.el;
  }

  _renderBank() {
    this.slotEls?.forEach((b, i) => {
      b.classList.toggle('is-filled', !this.bank.isEmpty(i));
      b.classList.toggle('is-current', this.bank.current === i);
    });

    if (!this.songList) return;
    this.songList.replaceChildren(
      ...this.bank.song.map((entry, i) => {
        const item = el('div', { class: 'song-item' },
          el('span', { class: 'song-slot' }, SLOT_NAMES[entry.slot]),
          el('input', {
            class: 'song-repeats', type: 'number', min: '1', max: '64',
            value: String(entry.repeats)
          }),
          el('span', { class: 'micro-label' }, 'BARS'),
          button('×', { className: 'btn-mini', onClick: () => this.bank.removeFromSong(i) })
        );
        item.querySelector('.song-repeats').addEventListener('change', (e) => {
          this.bank.setSongRepeats(i, Number(e.target.value));
        });
        const pos = this.bank.songPosition;
        item.classList.toggle('is-playing', pos?.index === i);
        return item;
      })
    );

    const pos = this.bank.songPosition;
    this.songReadout.textContent = pos
      ? `${SLOT_NAMES[pos.slot]} · bar ${pos.bar}/${pos.of}`
      : `${this.bank.song.length} entries`;
    this.songBtn?.classList.toggle('is-active', this.bank.songEnabled);
  }

  _status(text) {
    document.dispatchEvent(new CustomEvent('suite:status', { detail: { text } }));
  }

  // Tap tempo: average the last few intervals, ignore stale taps.
  _tap(bpmKnob, display) {
    const now = performance.now();
    this._taps = (this._taps || []).filter((t) => now - t < 2500);
    this._taps.push(now);
    if (this._taps.length < 2) return;

    const deltas = this._taps.slice(1).map((t, i) => t - this._taps[i]);
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const bpm = Math.round(Math.min(200, Math.max(40, 60000 / avg)));

    bpmKnob.setValue(bpm);
    this.clock.setBpm(bpm);
    display.show(bpm);
    this.setState('bpm', bpm);
  }

  applyState(key, value) {
    if (key === 'bpm') { this.bpmKnob?.setValue(value); this.clock.setBpm(value); }
    if (key === 'swing') { this.swingKnob?.setValue(value); this.clock.setSwing(value); }
    if (key === 'bars') this.barCount = value;
    this.state[key] = value;
  }
}
