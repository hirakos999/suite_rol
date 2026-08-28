// Base class every module extends. Owns its jacks, its channel strip and its
// serialisable state; subclasses supply the audio graph and the UI.

import { getCtx, createChannel } from './audio-engine.js';

export class ModuleBase {
  constructor({ id, name, subtitle, accent, clock }) {
    this.id = id;
    this.name = name;
    this.subtitle = subtitle || '';
    this.accent = accent || '#c6ff00';
    this.clock = clock;
    this.ctx = getCtx();
    this.jacks = new Map();
    this.state = {};
    this.el = null;
    this._unsubs = [];
    this._cvInputs = [];
    this._outputs = [];
  }

  // --- jacks ---------------------------------------------------------------

  // direction: 'in' | 'out'; type: 'audio' | 'cv' | 'clock' | 'midi'
  addJack({ direction, name, type, label, node, param = null }) {
    const jack = {
      moduleId: this.id,
      module: this,
      direction, name, type,
      label: label || name,
      node, param
    };
    this.jacks.set(name, jack);
    return jack;
  }

  getJack(name) {
    return this.jacks.get(name) || null;
  }

  listJacks(direction) {
    return [...this.jacks.values()].filter((j) => !direction || j.direction === direction);
  }

  // A CV input is an attenuverter, not a hard wire: the cable lands on an
  // input gain whose depth starts at ZERO. Patching therefore never changes
  // the sound until the depth knob is turned up — which is both how hardware
  // behaves and the only way to stop a full-scale audio signal from driving a
  // filter cutoff to negative Hz and silencing it.
  addCVInput({ name, label, target, range, unit = '' }) {
    const input = this.ctx.createGain();
    input.gain.value = 1;

    const depth = this.ctx.createGain();
    depth.gain.value = 0;

    input.connect(depth);
    depth.connect(target);

    this.addJack({ direction: 'in', name, type: 'cv', label, node: input });
    const entry = { name, label, depth, range, unit };
    this._cvInputs.push(entry);
    return entry;
  }

  listCVInputs() {
    return this._cvInputs;
  }

  // An audio output that also feeds the module's channel strip.
  //
  // The direct feed to the master stays ON even when the output is patched.
  // Hardware normalisation (patching steals the signal) is the "correct"
  // behaviour, but it makes a module vanish from the mix the moment you cable
  // it somewhere, which reads as a bug. The MIX button turns the direct feed
  // off for anyone who wants exclusive routing.
  addAudioOutput({ name, label, node, channel }) {
    const direct = this.ctx.createGain();
    direct.gain.value = 1;
    node.connect(direct);
    direct.connect((channel || this.channel).input);

    this.addJack({ direction: 'out', name, type: 'audio', label, node });
    const entry = { name, label, direct, mix: true, patched: false };
    this._outputs.push(entry);
    return entry;
  }

  listOutputs() {
    return this._outputs;
  }

  // Called by main when the patch changes, so outputs can track their state.
  updateNormalisation(graph) {
    this._outputs.forEach((o) => {
      o.patched = graph.isConnected(this.id, o.name);
    });
  }

  // Direct feed to the master, independent of what is patched.
  setDirect(name, mix) {
    const o = this._outputs.find((x) => x.name === name);
    if (!o) return;
    o.mix = mix;
    o.direct.gain.setTargetAtTime(mix ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  // Clock output helper: exposes a subscribe() the patch graph can call.
  makeClockOut(name, label = 'CLK OUT') {
    const subs = new Set();
    const jack = this.addJack({
      direction: 'out', name, type: 'clock', label,
      node: {
        subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
        emit(step, time) { for (const fn of subs) fn(step, time); },
        get count() { return subs.size; }
      }
    });
    return jack.node;
  }

  makeClockIn(name, fn, label = 'CLK IN') {
    this.addJack({
      direction: 'in', name, type: 'clock', label,
      node: { handler: fn }
    });
  }

  // --- audio ---------------------------------------------------------------

  createChannel(opts) {
    this.channel = createChannel({ label: this.name, ...opts });
    return this.channel;
  }

  // --- patterns ------------------------------------------------------------
  //
  // Modules that hold a pattern implement these so KANCHELSKIS can snapshot
  // the whole rack into a pattern slot and recall it.

  getPattern() { return null; }
  setPattern() {}
  clearPattern() {}

  // --- lifecycle -----------------------------------------------------------

  onClock(fn) {
    this._unsubs.push(this.clock.addListener(fn));
  }

  setState(key, value) {
    this.state[key] = value;
    document.dispatchEvent(new CustomEvent('suite:state-change', {
      detail: { moduleId: this.id, key, value }
    }));
  }

  serialize() {
    return { ...this.state };
  }

  restore(saved = {}) {
    Object.entries(saved).forEach(([k, v]) => this.applyState(k, v));
  }

  applyState() {}

  dispose() {
    this._unsubs.forEach((fn) => fn());
    this._unsubs = [];
  }

  render() { throw new Error(`${this.id}: render() not implemented`); }
}
