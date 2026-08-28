// Shared module chassis: coloured edge strip, header with name, body slot, and
// the jack strip along the bottom.
//
// Modelled on the Aira Compact layout — every unit is the same box, only the
// edge colour and the middle section differ.

import { el } from '../utils.js';
import { createJackEl } from './patch-bay.js';
import { createVU } from './vu.js';
import { createKnob } from './knob.js';

export function createPanel(module, { showVU = true, wide = false } = {}) {
  const body = el('div', { class: 'panel-body' });

  // Inputs. A CV input carries its own attenuverter: the cable does nothing
  // until this is turned up, which is why patching can never silence a module.
  const cvByName = new Map(module.listCVInputs().map((c) => [c.name, c]));

  const inputEls = module.listJacks('in').map((jack) => {
    const slot = createJackEl(jack);
    const cv = cvByName.get(jack.name);
    if (cv) {
      const depth = createKnob({
        min: -1, max: 1, value: 0, label: 'DEPTH', decimals: 2, size: 26,
        onChange: (v) => cv.depth.gain.setTargetAtTime(v * cv.range, module.ctx.currentTime, 0.02)
      });
      depth.el.classList.add('knob-mini');
      slot.append(depth.el);
      cv.knob = depth;
    }
    return slot;
  });

  // Outputs. MIX is the direct feed to the master, on by default: a patched
  // module keeps playing rather than disappearing. Turn it off for exclusive
  // routing into another module.
  const outByName = new Map(module.listOutputs().map((o) => [o.name, o]));

  const outputEls = module.listJacks('out').map((jack) => {
    const slot = createJackEl(jack);
    const out = outByName.get(jack.name);
    if (out) {
      const dir = el('button', {
        class: 'dir-toggle is-active', type: 'button',
        title: 'MIX: send this output to the master as well. Off = only where it is patched.'
      }, 'MIX');
      dir.addEventListener('click', () => {
        const mix = !dir.classList.contains('is-active');
        dir.classList.toggle('is-active', mix);
        module.setDirect(jack.name, mix);
      });
      slot.append(dir);
      out.dirEl = dir;
    }
    return slot;
  });

  const jackStrip = el('div', { class: 'panel-jacks' },
    ...inputEls,
    (inputEls.length && outputEls.length) ? el('div', { class: 'jack-divider' }) : null,
    ...outputEls
  );

  const header = el('div', { class: 'panel-header' },
    el('div', { class: 'panel-title' },
      el('h2', {}, module.name),
      module.subtitle ? el('span', { class: 'panel-subtitle' }, module.subtitle) : null
    ),
    el('div', { class: 'panel-meta' })
  );

  const root = el('section', {
    class: 'panel' + (wide ? ' panel-wide' : ''),
    'data-module': module.id,
    style: { '--accent': module.accent }
    // Jacks sit directly under the header, above the controls: the clock lives
    // at the top of the rack, so cables run up and out instead of crossing
    // every panel on their way down.
  }, el('div', { class: 'panel-edge' }), header, jackStrip, body);

  if (showVU && module.channel) {
    header.querySelector('.panel-meta').append(
      createVU({ analyser: module.channel.analyser, color: module.accent, width: 76, height: 9 }).el
    );
  }

  return { el: root, body, header, meta: header.querySelector('.panel-meta') };
}

// A labelled row of controls, the visual unit inside every panel body.
export function section(title, ...children) {
  return el('div', { class: 'panel-section' },
    title ? el('div', { class: 'section-title' }, title) : null,
    el('div', { class: 'section-content' }, ...children)
  );
}

export function row(...children) {
  return el('div', { class: 'control-row' }, ...children);
}

export function button(label, { active = false, className = '', onClick } = {}) {
  const b = el('button', {
    class: `btn ${className}`.trim() + (active ? ' is-active' : ''),
    type: 'button'
  }, label);
  if (onClick) b.addEventListener('click', () => onClick(b));
  return b;
}

export function toggle(label, { value = false, onChange = () => {} } = {}) {
  let on = value;
  const b = button(label, { active: on, className: 'btn-toggle' });
  b.addEventListener('click', () => {
    on = !on;
    b.classList.toggle('is-active', on);
    onChange(on);
  });
  b.setOn = (v) => { on = v; b.classList.toggle('is-active', on); };
  return b;
}

export function select(options, { value, onChange = () => {}, label = '' } = {}) {
  const sel = el('select', { class: 'select' },
    ...options.map((o) => {
      const opt = el('option', { value: o.value ?? o }, o.label ?? o);
      if ((o.value ?? o) === value) opt.selected = true;
      return opt;
    })
  );
  sel.addEventListener('change', () => onChange(sel.value));
  return label ? el('label', { class: 'select-wrap' }, el('span', {}, label), sel) : sel;
}
