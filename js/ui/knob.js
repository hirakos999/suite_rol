// Rotary knob. Drag vertically, wheel to nudge, dblclick to reset.
// The pointer is captured so a fast drag off the knob keeps tracking.

import { el, clamp } from '../utils.js';

export function createKnob({
  min = 0, max = 1, value = 0.5, label = '', unit = '',
  size = 44, decimals = 2, curve = 1, onChange = () => {}
}) {
  const defaultValue = value;
  const range = max - min;
  const MIN_ANGLE = -140;
  const MAX_ANGLE = 140;

  const dial = el('div', { class: 'knob-dial', tabindex: '0', style: { width: size + 'px', height: size + 'px' } });
  const pointer = el('div', { class: 'knob-pointer' });
  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arc.setAttribute('class', 'knob-arc');
  arc.setAttribute('viewBox', '0 0 100 100');
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  track.setAttribute('class', 'knob-arc-track');
  const fill = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fill.setAttribute('class', 'knob-arc-fill');
  arc.append(track, fill);
  dial.append(arc, pointer);

  const labelEl = el('div', { class: 'knob-label' }, label);
  const valueEl = el('div', { class: 'knob-readout' });
  const wrap = el('div', { class: 'knob' }, dial, labelEl, valueEl);

  let val = value;

  // Normalised position -> value, with an optional exponential curve so
  // frequency knobs feel right instead of cramming everything at the bottom.
  const toNorm = (v) => Math.pow((v - min) / range, 1 / curve);
  const fromNorm = (n) => min + Math.pow(clamp(n, 0, 1), curve) * range;

  function arcPath(fromPct, toPct) {
    const a0 = (MIN_ANGLE + fromPct * (MAX_ANGLE - MIN_ANGLE) - 90) * Math.PI / 180;
    const a1 = (MIN_ANGLE + toPct * (MAX_ANGLE - MIN_ANGLE) - 90) * Math.PI / 180;
    const r = 42;
    const x0 = 50 + r * Math.cos(a0), y0 = 50 + r * Math.sin(a0);
    const x1 = 50 + r * Math.cos(a1), y1 = 50 + r * Math.sin(a1);
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  track.setAttribute('d', arcPath(0, 1));

  function render() {
    const pct = toNorm(val);
    pointer.style.transform = `translate(-50%, -100%) rotate(${MIN_ANGLE + pct * (MAX_ANGLE - MIN_ANGLE)}deg)`;
    fill.setAttribute('d', arcPath(0, Math.max(0.001, pct)));
    valueEl.textContent = (decimals === 0 ? Math.round(val) : val.toFixed(decimals)) + unit;
  }

  function setValue(v, notify = true) {
    val = clamp(v, min, max);
    render();
    if (notify) onChange(val);
  }

  let dragging = false, startY = 0, startNorm = 0;

  dial.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startNorm = toNorm(val);
    dial.setPointerCapture(e.pointerId);
    dial.classList.add('is-dragging');
  });
  dial.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // Shift = fine adjust.
    const scale = e.shiftKey ? 600 : 160;
    setValue(fromNorm(startNorm + (startY - e.clientY) / scale));
  });
  const endDrag = () => { dragging = false; dial.classList.remove('is-dragging'); };
  dial.addEventListener('pointerup', endDrag);
  dial.addEventListener('pointercancel', endDrag);
  dial.addEventListener('dblclick', () => setValue(defaultValue));
  dial.addEventListener('wheel', (e) => {
    e.preventDefault();
    setValue(fromNorm(toNorm(val) - Math.sign(e.deltaY) * 0.03));
  }, { passive: false });
  dial.addEventListener('keydown', (e) => {
    const stepBy = e.shiftKey ? 0.005 : 0.03;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setValue(fromNorm(toNorm(val) + stepBy)); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setValue(fromNorm(toNorm(val) - stepBy)); }
  });

  render();

  return {
    el: wrap,
    get value() { return val; },
    setValue: (v) => setValue(v, false)
  };
}
