// Formant (vowel) synthesiser.
//
// A buzzy pulse train through three resonant bandpass filters tuned to the
// first three formants of a vowel. It is not speech, but it moves like speech
// — which is exactly what a vocoder needs as a modulator.
//
// This is what lets ZOLA make sound with no microphone, no TTS server and no
// file loaded.

import { getCtx, noiseSource } from '../core/audio-engine.js';

// F1/F2/F3 in Hz, roughly the male average.
export const VOWELS = {
  A: [730, 1090, 2440],
  E: [530, 1840, 2480],
  I: [270, 2290, 3010],
  O: [570, 840, 2410],
  U: [300, 870, 2240]
};

export const VOWEL_KEYS = Object.keys(VOWELS);

export class FormantVoice {
  constructor(destination) {
    this.ctx = getCtx();
    this.dest = destination;

    // Glottal source: a sawtooth carries enough harmonics for the formant
    // filters to pick out, plus a little breath noise for consonant texture.
    this.glottis = this.ctx.createOscillator();
    this.glottis.type = 'sawtooth';
    this.glottis.frequency.value = 110;

    this.breath = noiseSource();
    this.breathGain = this.ctx.createGain();
    this.breathGain.gain.value = 0.02;
    this.breath.connect(this.breathGain);

    this.amp = this.ctx.createGain();
    this.amp.gain.value = 0;

    // Three parallel resonators, one per formant.
    this.formants = [0, 1, 2].map((i) => {
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = VOWELS.A[i];
      f.Q.value = 12 - i * 3;   // higher formants are broader

      const g = this.ctx.createGain();
      g.gain.value = [1, 0.55, 0.3][i];

      this.glottis.connect(f);
      this.breathGain.connect(f);
      f.connect(g);
      g.connect(this.amp);
      return { filter: f, gain: g };
    });

    this.amp.connect(this.dest);
    this.glottis.start();
    this.breath.start();

    this.vowel = 'A';
    this.gliding = 0.06;
  }

  setPitch(hz, time = this.ctx.currentTime) {
    this.glottis.frequency.setTargetAtTime(hz, time, 0.02);
  }

  setBreath(amount) {
    this.breathGain.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.05);
  }

  // Glides between vowels rather than jumping, which is what makes a sequence
  // of them sound like it is being sung instead of switched.
  setVowel(key, time = this.ctx.currentTime) {
    const targets = VOWELS[key] || VOWELS.A;
    this.vowel = key;
    this.formants.forEach((f, i) => {
      f.filter.frequency.setTargetAtTime(targets[i], time, this.gliding);
    });
  }

  // Open the mouth for `duration`, with a soft attack so it does not click.
  speak(time = this.ctx.currentTime, duration = 0.25, level = 0.8) {
    const g = this.amp.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(Math.max(0.0001, g.value), time);
    g.linearRampToValueAtTime(level, time + 0.02);
    g.setValueAtTime(level, time + duration * 0.7);
    g.exponentialRampToValueAtTime(0.0001, time + duration);
  }

  hold(level = 0.7) {
    this.amp.gain.setTargetAtTime(level, this.ctx.currentTime, 0.05);
  }

  silence() {
    this.amp.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
  }
}
