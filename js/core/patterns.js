// Pattern bank and song mode.
//
// A pattern slot is a snapshot of every module's pattern at once — the whole
// rack, not one instrument. Song mode plays a list of those slots with a
// repeat count each, so a full arrangement is a list of letters.

export const SLOT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export class PatternBank {
  constructor(modules) {
    this.modules = modules;
    this.slots = new Array(SLOT_NAMES.length).fill(null);
    this.current = 0;
    this.listeners = new Set();

    // Song mode: [{ slot: 0, repeats: 4 }, ...]
    this.song = [];
    this.songEnabled = false;
    this.songIndex = 0;
    this.songRepeat = 0;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this);
  }

  // Deep-copied so later edits do not mutate the stored slot.
  save(index) {
    const snapshot = {};
    this.modules.forEach((m) => {
      const p = m.getPattern();
      if (p !== null && p !== undefined) snapshot[m.id] = structuredClone(p);
    });
    this.slots[index] = snapshot;
    this.current = index;
    this._emit();
    return snapshot;
  }

  load(index) {
    const snapshot = this.slots[index];
    if (!snapshot) return false;
    this.modules.forEach((m) => {
      if (snapshot[m.id]) m.setPattern(structuredClone(snapshot[m.id]));
    });
    this.current = index;
    this._emit();
    return true;
  }

  copy(from, to) {
    if (!this.slots[from]) return false;
    this.slots[to] = structuredClone(this.slots[from]);
    this._emit();
    return true;
  }

  clearSlot(index) {
    this.slots[index] = null;
    this.song = this.song.filter((s) => s.slot !== index);
    this._emit();
  }

  clearAll() {
    this.slots.fill(null);
    this.song = [];
    this.songEnabled = false;
    this._emit();
  }

  isEmpty(index) {
    return !this.slots[index];
  }

  // --- song ----------------------------------------------------------------

  addToSong(slot, repeats = 4) {
    if (!this.slots[slot]) return false;
    this.song.push({ slot, repeats });
    this._emit();
    return true;
  }

  removeFromSong(index) {
    this.song.splice(index, 1);
    this._emit();
  }

  setSongRepeats(index, repeats) {
    if (this.song[index]) this.song[index].repeats = Math.max(1, repeats);
    this._emit();
  }

  startSong() {
    if (!this.song.length) return false;
    this.songEnabled = true;
    this.songIndex = 0;
    this.songRepeat = 0;
    this.load(this.song[0].slot);
    this._emit();
    return true;
  }

  stopSong() {
    this.songEnabled = false;
    this._emit();
  }

  // Called once per bar boundary. Advances the song when the current entry
  // has played its repeats.
  advanceBar() {
    if (!this.songEnabled || !this.song.length) return;

    this.songRepeat++;
    const entry = this.song[this.songIndex];
    if (this.songRepeat < entry.repeats) return;

    this.songRepeat = 0;
    this.songIndex = (this.songIndex + 1) % this.song.length;
    this.load(this.song[this.songIndex].slot);
  }

  get songPosition() {
    if (!this.songEnabled || !this.song.length) return null;
    const entry = this.song[this.songIndex];
    return {
      index: this.songIndex,
      slot: entry.slot,
      bar: this.songRepeat + 1,
      of: entry.repeats
    };
  }

  serialize() {
    return { slots: this.slots, song: this.song };
  }

  restore(data = {}) {
    if (Array.isArray(data.slots)) {
      this.slots = data.slots.slice(0, SLOT_NAMES.length);
      while (this.slots.length < SLOT_NAMES.length) this.slots.push(null);
    }
    if (Array.isArray(data.song)) this.song = data.song;
    this._emit();
  }
}
