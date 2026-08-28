// Seven-segment style readout, the red LED block on every Aira Compact.
// Drawn with divs rather than a font so it stays crisp at any size.

import { el } from '../utils.js';

const SEGMENTS = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
  '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  '-': 'g', ' ': '', 'A': 'abcefg', 'b': 'cdefg', 'C': 'adef', 'd': 'bcdeg',
  'E': 'adefg', 'F': 'aefg', 'H': 'bcefg', 'L': 'def', 'P': 'abefg',
  'r': 'eg', 'o': 'cdeg', 'S': 'acdfg', 'U': 'bcdef', 'n': 'ceg', 't': 'defg'
};

function digit() {
  const d = el('div', { class: 'seg-digit' });
  const segs = {};
  'abcdefg'.split('').forEach((s) => {
    const seg = el('div', { class: `seg seg-${s}` });
    segs[s] = seg;
    d.append(seg);
  });
  return { el: d, segs };
}

export function createDisplay({ digits = 4, value = '', label = '' } = {}) {
  const cells = Array.from({ length: digits }, digit);
  const screen = el('div', { class: 'seg-screen' }, ...cells.map((c) => c.el));
  const wrap = el('div', { class: 'display' }, screen);
  if (label) wrap.append(el('div', { class: 'display-label' }, label));

  function show(text) {
    const str = String(text).padStart(digits, ' ').slice(-digits);
    cells.forEach((cell, i) => {
      const on = SEGMENTS[str[i]] ?? '';
      'abcdefg'.split('').forEach((s) => {
        cell.segs[s].classList.toggle('on', on.includes(s));
      });
    });
  }

  show(value);
  return { el: wrap, show };
}
