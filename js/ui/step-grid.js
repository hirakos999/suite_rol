// Step sequencer grid. One row per track, one square LED per step.
//
// The grid always shows a 16-step window. Tracks longer than that are paged,
// so a 64-step track is four pages of the same widget — the way hardware with
// a fixed button row handles long patterns.
//
// Click toggles a step. Right-click opens the per-step editor the caller
// supplies via `onEdit`. `highlight()` moves the playhead.

import { el } from '../utils.js';

export function createStepGrid({
  window: windowSize = 16,
  tracks = [],           // [{ id, label, color }]
  // A FUNCTION, not an object: modules replace their pattern arrays wholesale
  // (clear, preset load, bank recall), and a captured reference would keep
  // rendering the old array forever.
  getTrack,              // (trackId) -> array
  lengths = null,        // (trackId) -> length, or a map
  onToggle = () => {},
  onEdit = null,
  compact = false
}) {
  const cellsByTrack = new Map();
  let page = 0;

  const dataOf = (id) => getTrack(id) || [];
  const lengthOf = (id) => {
    const l = typeof lengths === 'function' ? lengths(id) : lengths?.[id];
    return l ?? (dataOf(id).length || windowSize);
  };
  const absIndex = (i) => page * windowSize + i;

  const ruler = el('div', { class: 'grid-ruler' },
    Array.from({ length: windowSize }, (_, i) =>
      el('span', { class: 'ruler-tick' + (i % 4 === 0 ? ' is-beat' : '') },
        i % 4 === 0 ? String(i / 4 + 1) : '')
    )
  );

  const rows = tracks.map((track) => {
    const cells = Array.from({ length: windowSize }, (_, i) => {
      const cell = el('button', {
        class: 'step-cell',
        'data-track': track.id,
        type: 'button',
        'aria-label': `${track.label} step ${i + 1}`
      });
      if (track.color) cell.style.setProperty('--step-color', track.color);
      if (i % 4 === 0) cell.classList.add('is-downbeat');

      cell.addEventListener('click', () => {
        const idx = absIndex(i);
        if (idx >= lengthOf(track.id)) return;
        onToggle(track.id, idx, cell);
      });
      if (onEdit) {
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const idx = absIndex(i);
          if (idx >= lengthOf(track.id)) return;
          onEdit(track.id, idx, cell);
        });
      }
      return cell;
    });
    cellsByTrack.set(track.id, cells);

    return el('div', { class: 'grid-row' },
      el('span', { class: 'grid-row-label', style: track.color ? { color: track.color } : {} }, track.label),
      el('div', { class: 'grid-cells' }, ...cells)
    );
  });

  const root = el('div', {
    class: 'step-grid' + (compact ? ' is-compact' : ''),
    style: { '--steps': String(windowSize) }
  },
    el('div', { class: 'grid-row grid-row-ruler' },
      el('span', { class: 'grid-row-label' }, ''),
      ruler
    ),
    ...rows
  );

  let playhead = -1;

  const api = {
    el: root,

    get page() { return page; },

    setPage(p) {
      page = Math.max(0, p);
      api.render();
      api.clearHighlight();
    },

    // Highest page any track can reach, so the caller can build a pager.
    maxPage() {
      const longest = Math.max(...tracks.map((t) => lengthOf(t.id)), windowSize);
      return Math.ceil(longest / windowSize) - 1;
    },

    render(trackId = null) {
      const ids = trackId ? [trackId] : [...cellsByTrack.keys()];
      ids.forEach((id) => {
        const cells = cellsByTrack.get(id);
        const data = dataOf(id);
        const len = lengthOf(id);
        cells.forEach((cell, i) => {
          const idx = absIndex(i);
          // Steps past this track's length are inert — visible, but not part
          // of the pattern, which is what makes polymetric lengths readable.
          const outOfRange = idx >= len;
          cell.classList.toggle('is-out', outOfRange);
          if (outOfRange) {
            cell.classList.remove('is-on', 'is-accent', 'is-slide');
            cell.style.setProperty('--step-vel', '0');
            return;
          }
          const v = data[idx];
          const on = !!v && (typeof v !== 'object' || v.on !== false);
          cell.classList.toggle('is-on', on);
          cell.classList.toggle('is-accent', !!(v && v.accent));
          cell.classList.toggle('is-slide', !!(v && v.slide));
          const vel = v && typeof v === 'object' && v.velocity !== undefined ? v.velocity : 1;
          cell.style.setProperty('--step-vel', on ? String(0.35 + vel * 0.65) : '0');
        });
      });
    },

    // `step` is absolute; the playhead only shows when it falls on this page.
    highlight(trackId, step) {
      const cells = cellsByTrack.get(trackId);
      if (!cells) return;
      const rel = step - page * windowSize;
      cells.forEach((c, i) => c.classList.toggle('is-playing', i === rel));
      if (trackId === tracks[0]?.id) {
        [...ruler.children].forEach((t, i) => t.classList.toggle('is-playing', i === rel));
      }
    },

    // Convenience for single-track grids.
    highlightAll(step) {
      const rel = step - page * windowSize;
      if (rel === playhead) return;
      cellsByTrack.forEach((cells) => {
        cells.forEach((c, i) => c.classList.toggle('is-playing', i === rel));
      });
      [...ruler.children].forEach((t, i) => t.classList.toggle('is-playing', i === rel));
      playhead = rel;
    },

    clearHighlight() {
      cellsByTrack.forEach((cells) => cells.forEach((c) => c.classList.remove('is-playing')));
      [...ruler.children].forEach((t) => t.classList.remove('is-playing'));
      playhead = -1;
    },

    cell(trackId, step) {
      const rel = step - page * windowSize;
      return (cellsByTrack.get(trackId) || [])[rel] || null;
    }
  };

  return api;
}
