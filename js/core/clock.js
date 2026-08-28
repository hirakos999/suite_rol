// Lookahead scheduler ("A Tale of Two Clocks"): a coarse setTimeout loop that
// schedules precise events against audioContext.currentTime.
//
// Steps are 16th notes. Subscribers get (step, time) where `time` is an exact
// AudioContext timestamp in the near future — never "now".

export class Clock {
  constructor(ctx, { bpm = 130, stepsPerBeat = 4 } = {}) {
    this.ctx = ctx;
    this.bpm = bpm;
    this.stepsPerBeat = stepsPerBeat;
    this.swing = 0;          // 0..0.7, delays every odd 16th
    this.lookahead = 25;     // ms between scheduler wakeups
    this.scheduleAheadTime = 0.1; // seconds of audio scheduled in advance
    this.currentStep = 0;
    this.nextStepTime = 0;
    this.timerId = null;
    this.running = false;
    this.listeners = new Set();
  }

  get stepDuration() {
    return 60 / this.bpm / this.stepsPerBeat;
  }

  setBpm(bpm) {
    this.bpm = Math.min(300, Math.max(40, bpm));
  }

  setSwing(amount) {
    this.swing = Math.min(0.7, Math.max(0, amount));
  }

  // Returns an unsubscribe function.
  addListener(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.currentStep = 0;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this._tick();
  }

  stop() {
    this.running = false;
    if (this.timerId) clearTimeout(this.timerId);
    this.timerId = null;
  }

  toggle() {
    this.running ? this.stop() : this.start();
    return this.running;
  }

  _tick() {
    if (!this.running) return;
    while (this.nextStepTime < this.ctx.currentTime + this.scheduleAheadTime) {
      // Swing pushes odd 16ths later without shifting the underlying grid.
      const swung = this.currentStep % 2 === 1
        ? this.nextStepTime + this.stepDuration * this.swing * 0.5
        : this.nextStepTime;
      for (const fn of this.listeners) fn(this.currentStep, swung);
      this.nextStepTime += this.stepDuration;
      this.currentStep++;
    }
    this.timerId = setTimeout(() => this._tick(), this.lookahead);
  }
}
