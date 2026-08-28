// Synthesised drum voices — no samples, so the whole kit costs nothing to ship
// and every parameter stays live.
//
// Each voice: play(dest, time, velocity, mods) where mods = { tune, decay }
// are the per-track knob multipliers.

import { getCtx, noiseSource } from '../core/audio-engine.js';

function pitchedHit(dest, time, { freqStart, freqEnd, dur, type = 'sine', gain = 1, click = 0 }) {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), time + dur);

  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(0.0001, gain), time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + dur + 0.02);
  osc.onended = () => { osc.disconnect(); g.disconnect(); };

  // Short noise transient on top — what makes a kick "knock" on small speakers.
  if (click > 0) {
    noiseHit(dest, time, { filterType: 'highpass', freq: 3000, dur: 0.012, gain: click * gain });
  }
}

function noiseHit(dest, time, { filterType = 'highpass', freq = 6000, q = 1, dur = 0.1, gain = 0.6 }) {
  const ctx = getCtx();
  const src = noiseSource();
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  filter.Q.value = q;

  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(0.0001, gain), time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  src.start(time);
  src.stop(time + dur + 0.02);
  src.onended = () => { src.disconnect(); filter.disconnect(); g.disconnect(); };
}

export const DRUM_VOICES = [
  {
    id: 'kick', label: 'KICK',
    play: (d, t, v, m) => pitchedHit(d, t, {
      freqStart: 150 * m.tune, freqEnd: 45 * m.tune,
      dur: 0.35 * m.decay, gain: v, click: 0.35
    })
  },
  {
    id: 'kick-deep', label: 'KICK DEEP',
    play: (d, t, v, m) => pitchedHit(d, t, {
      freqStart: 110 * m.tune, freqEnd: 32 * m.tune,
      dur: 0.6 * m.decay, gain: v, click: 0.2
    })
  },
  {
    id: 'snare', label: 'SNARE',
    play: (d, t, v, m) => {
      pitchedHit(d, t, { freqStart: 220 * m.tune, freqEnd: 180 * m.tune, dur: 0.15 * m.decay, type: 'triangle', gain: v * 0.6 });
      noiseHit(d, t, { filterType: 'bandpass', freq: 1800 * m.tune, q: 0.8, dur: 0.18 * m.decay, gain: v * 0.8 });
    }
  },
  {
    id: 'rimshot', label: 'RIM',
    play: (d, t, v, m) => pitchedHit(d, t, {
      freqStart: 900 * m.tune, freqEnd: 700 * m.tune,
      dur: 0.04 * m.decay, type: 'square', gain: v * 0.4
    })
  },
  {
    id: 'hat-closed', label: 'HAT CL',
    play: (d, t, v, m) => noiseHit(d, t, {
      filterType: 'highpass', freq: 7000 * m.tune, dur: 0.05 * m.decay, gain: v * 0.5
    })
  },
  {
    id: 'hat-open', label: 'HAT OP',
    play: (d, t, v, m) => noiseHit(d, t, {
      filterType: 'highpass', freq: 7000 * m.tune, dur: 0.32 * m.decay, gain: v * 0.45
    })
  },
  {
    id: 'clap', label: 'CLAP',
    // Three offset noise bursts — the classic 909 clap trick.
    play: (d, t, v, m) => [0, 0.011, 0.022].forEach((off, i) =>
      noiseHit(d, t + off, {
        filterType: 'bandpass', freq: 1500 * m.tune, q: 1,
        dur: (i === 2 ? 0.18 : 0.05) * m.decay, gain: v * 0.55
      })
    )
  },
  {
    id: 'tom-low', label: 'TOM LO',
    play: (d, t, v, m) => pitchedHit(d, t, {
      freqStart: 140 * m.tune, freqEnd: 80 * m.tune, dur: 0.3 * m.decay, gain: v * 0.8
    })
  },
  {
    id: 'tom-high', label: 'TOM HI',
    play: (d, t, v, m) => pitchedHit(d, t, {
      freqStart: 320 * m.tune, freqEnd: 180 * m.tune, dur: 0.24 * m.decay, gain: v * 0.8
    })
  },
  {
    id: 'cowbell', label: 'COWBELL',
    play: (d, t, v, m) => {
      pitchedHit(d, t, { freqStart: 800 * m.tune, freqEnd: 800 * m.tune, dur: 0.3 * m.decay, type: 'square', gain: v * 0.3 });
      pitchedHit(d, t, { freqStart: 540 * m.tune, freqEnd: 540 * m.tune, dur: 0.3 * m.decay, type: 'square', gain: v * 0.26 });
    }
  },
  {
    id: 'clave', label: 'CLAVE',
    play: (d, t, v, m) => pitchedHit(d, t, {
      freqStart: 2500 * m.tune, freqEnd: 2400 * m.tune, dur: 0.05 * m.decay, type: 'triangle', gain: v * 0.5
    })
  },
  {
    id: 'perc', label: 'PERC',
    play: (d, t, v, m) => noiseHit(d, t, {
      filterType: 'bandpass', freq: 2200 * m.tune, q: 2, dur: 0.12 * m.decay, gain: v * 0.5
    })
  },
  {
    id: 'crash', label: 'CRASH',
    play: (d, t, v, m) => noiseHit(d, t, {
      filterType: 'highpass', freq: 5000 * m.tune, dur: 1.2 * m.decay, gain: v * 0.35
    })
  },
  {
    id: 'shaker', label: 'SHAKER',
    play: (d, t, v, m) => noiseHit(d, t, {
      filterType: 'highpass', freq: 8000 * m.tune, dur: 0.09 * m.decay, gain: v * 0.3
    })
  }
];

export function getVoice(id) {
  return DRUM_VOICES.find((v) => v.id === id) || DRUM_VOICES[0];
}
