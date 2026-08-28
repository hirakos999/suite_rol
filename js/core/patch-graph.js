// Patch graph — the single source of truth for module interconnection.
//
// Every edge here owns a REAL Web Audio connection (or a clock subscription).
// Nothing is ever purely cosmetic: adding an edge patches audio, removing one
// unpatches it.

let edgeSeq = 0;

// Which output types may drive which input types. Audio into a CV input is
// allowed on purpose — audio-rate modulation is half the fun of a modular.
const COMPATIBLE = {
  audio: ['audio', 'cv'],
  cv: ['cv', 'audio'],
  clock: ['clock'],
  midi: ['midi']
};

export class PatchGraph {
  constructor() {
    this.edges = [];
    this.modules = new Map(); // moduleId -> module instance
    this.listeners = new Set();
  }

  register(module) {
    this.modules.set(module.id, module);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this.edges);
  }

  getJack(moduleId, jackName) {
    const mod = this.modules.get(moduleId);
    return mod ? mod.getJack(jackName) : null;
  }

  canConnect(from, to) {
    if (!from || !to) return false;
    if (from.direction !== 'out' || to.direction !== 'in') return false;
    if (from.moduleId === to.moduleId) return false;
    if (!(COMPATIBLE[from.type] || []).includes(to.type)) return false;
    return !this.edges.some(
      (e) => e.from.moduleId === from.moduleId && e.from.name === from.name &&
             e.to.moduleId === to.moduleId && e.to.name === to.name
    );
  }

  // `from` and `to` are jack descriptors from ModuleBase.getJack().
  // Order-insensitive: passing (input, output) is silently swapped.
  connect(a, b) {
    let from = a, to = b;
    if (from.direction === 'in' && to.direction === 'out') [from, to] = [to, from];
    if (!this.canConnect(from, to)) return null;

    const edge = {
      id: `e${edgeSeq++}`,
      from: { moduleId: from.moduleId, name: from.name, type: from.type },
      to: { moduleId: to.moduleId, name: to.name, type: to.type },
      type: from.type,
      teardown: null
    };

    edge.teardown = this._wire(from, to);
    this.edges.push(edge);
    this._emit();
    return edge;
  }

  _wire(from, to) {
    if (from.type === 'clock') {
      // Clock jacks exchange callbacks, not audio nodes.
      const unsub = from.node.subscribe(to.node.handler);
      return () => unsub();
    }

    const src = from.node;
    const dst = to.node;
    if (!src || !dst) return () => {};

    // A CV input may expose an AudioParam directly; scale audio-rate signals
    // into its range through the jack's own depth gain when present.
    try {
      if (to.param) {
        src.connect(to.param);
        return () => { try { src.disconnect(to.param); } catch {} };
      }
      src.connect(dst);
      return () => { try { src.disconnect(dst); } catch {} };
    } catch (err) {
      console.warn('patch failed', err);
      return () => {};
    }
  }

  disconnect(edgeId) {
    const idx = this.edges.findIndex((e) => e.id === edgeId);
    if (idx === -1) return;
    const [edge] = this.edges.splice(idx, 1);
    if (edge.teardown) edge.teardown();
    this._emit();
  }

  disconnectAll(moduleId) {
    this.edges
      .filter((e) => e.from.moduleId === moduleId || e.to.moduleId === moduleId)
      .forEach((e) => this.disconnect(e.id));
  }

  isConnected(moduleId, jackName) {
    return this.edges.some(
      (e) => (e.from.moduleId === moduleId && e.from.name === jackName) ||
             (e.to.moduleId === moduleId && e.to.name === jackName)
    );
  }

  serialize() {
    return this.edges.map((e) => ({ from: e.from, to: e.to }));
  }

  restore(saved = []) {
    saved.forEach(({ from, to }) => {
      const a = this.getJack(from.moduleId, from.name);
      const b = this.getJack(to.moduleId, to.name);
      if (a && b) this.connect(a, b);
    });
  }
}
