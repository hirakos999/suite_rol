// Classic analysis/resynthesis vocoder, built from native Web Audio nodes.
//
// Per band: the modulator (voice) is band-passed, rectified and smoothed into
// an envelope, and that envelope drives the gain of the same band taken from
// the carrier. No AudioWorklet needed — connecting an AudioNode to an
// AudioParam is what makes the envelope-follower trick work.

const BAND_COUNT = 16;
const LOW_HZ = 120;
const HIGH_HZ = 7000;

// Rectifier curve: |x|, so the band's amplitude survives and its sign doesn't.
function rectifyCurve() {
  const n = 512;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = Math.abs((i * 2) / n - 1);
  return curve;
}

export class Vocoder {
  constructor(ctx, { bands = BAND_COUNT } = {}) {
    this.ctx = ctx;
    this.bandCount = bands;

    this.modulatorIn = ctx.createGain();
    this.carrierIn = ctx.createGain();
    this.output = ctx.createGain();
    this.output.gain.value = 1;

    // A little of the modulator's top end passed through keeps consonants
    // intelligible — pure vocoding turns every "s" into mush.
    this.sibilance = ctx.createBiquadFilter();
    this.sibilance.type = 'highpass';
    this.sibilance.frequency.value = 5000;
    this.sibilanceGain = ctx.createGain();
    this.sibilanceGain.gain.value = 0.18;
    this.modulatorIn.connect(this.sibilance);
    this.sibilance.connect(this.sibilanceGain);
    this.sibilanceGain.connect(this.output);

    const curve = rectifyCurve();
    this.bands = [];

    // Logarithmic band spacing, matching how pitch is actually perceived.
    for (let i = 0; i < bands; i++) {
      const freq = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, i / (bands - 1));
      const q = 4;

      const modBand = ctx.createBiquadFilter();
      modBand.type = 'bandpass';
      modBand.frequency.value = freq;
      modBand.Q.value = q;

      const rect = ctx.createWaveShaper();
      rect.curve = curve;

      const follower = ctx.createBiquadFilter();
      follower.type = 'lowpass';
      follower.frequency.value = 18; // envelope smoothing, ~55 ms
      follower.Q.value = 0.7;

      // Drives the carrier band's gain. Boosted because a rectified,
      // heavily-smoothed band sits well below unity.
      const depth = ctx.createGain();
      depth.gain.value = 14;

      const carBand = ctx.createBiquadFilter();
      carBand.type = 'bandpass';
      carBand.frequency.value = freq;
      carBand.Q.value = q;

      const vca = ctx.createGain();
      vca.gain.value = 0; // silent until the envelope opens it

      this.modulatorIn.connect(modBand);
      modBand.connect(rect);
      rect.connect(follower);
      follower.connect(depth);
      depth.connect(vca.gain);

      this.carrierIn.connect(carBand);
      carBand.connect(vca);
      vca.connect(this.output);

      this.bands.push({ freq, modBand, follower, depth, carBand, vca });
    }
  }

  // Widening the band Q makes it smeared and robotic; narrowing sharpens it.
  setResonance(q) {
    this.bands.forEach((b) => {
      b.modBand.Q.setTargetAtTime(q, this.ctx.currentTime, 0.02);
      b.carBand.Q.setTargetAtTime(q, this.ctx.currentTime, 0.02);
    });
  }

  // Envelope follower cutoff: low = smeared and slurred, high = snappy.
  setResponse(hz) {
    this.bands.forEach((b) => b.follower.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.02));
  }

  setDepth(amount) {
    this.bands.forEach((b) => b.depth.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.02));
  }

  setSibilance(amount) {
    this.sibilanceGain.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.02);
  }

  // Shifts every band's centre frequency — formant shifting, roughly.
  setFormantShift(semitones) {
    const ratio = Math.pow(2, semitones / 12);
    this.bands.forEach((b) => {
      b.carBand.frequency.setTargetAtTime(b.freq * ratio, this.ctx.currentTime, 0.02);
    });
  }
}
