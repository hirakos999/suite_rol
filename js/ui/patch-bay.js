// Patch bay: renders jacks as DOM sockets and cables as SVG beziers on an
// overlay above the rack.
//
// The overlay is pointer-events:none so it never eats clicks meant for module
// controls; only the cable paths themselves opt back in, so a cable can be
// clicked to pull it out.

import { el } from '../utils.js';

export function createJackEl(jack) {
  const socket = el('button', {
    class: `jack jack-${jack.type} jack-${jack.direction}`,
    type: 'button',
    'data-module': jack.moduleId,
    'data-jack': jack.name,
    'data-type': jack.type,
    title: `${jack.label} (${jack.type} ${jack.direction})`
  }, el('span', { class: 'jack-ring' }));

  return el('div', { class: 'jack-slot' },
    socket,
    el('span', { class: 'jack-label' }, jack.label)
  );
}

export class PatchBay {
  constructor({ svg, graph, rack, onStatus = () => {} }) {
    this.svg = svg;
    this.graph = graph;
    this.rack = rack;
    this.onStatus = onStatus;
    this.dragging = null;
    this.tempPath = null;

    this._bind();
    this.graph.onChange(() => this.redraw());

    // Cables are absolutely positioned in rack space, so any reflow that moves
    // a module must redraw them.
    const ro = new ResizeObserver(() => this.redraw());
    ro.observe(rack);
    window.addEventListener('resize', () => this.redraw());
    rack.addEventListener('scroll', () => this.redraw(), { passive: true });
  }

  _bind() {
    this.rack.addEventListener('pointerdown', (e) => {
      const socket = e.target.closest('.jack');
      if (!socket) return;
      e.preventDefault();
      this._startDrag(socket, e);
    });

    // Cables are inert to the pointer (they lie across the panels), so a cable
    // is unplugged at its socket: right-click a patched jack.
    this.rack.addEventListener('contextmenu', (e) => {
      const socket = e.target.closest('.jack');
      if (!socket) return;
      e.preventDefault();
      const edges = this.graph.edges.filter(
        (edge) =>
          (edge.from.moduleId === socket.dataset.module && edge.from.name === socket.dataset.jack) ||
          (edge.to.moduleId === socket.dataset.module && edge.to.name === socket.dataset.jack)
      );
      if (!edges.length) return;
      edges.forEach((edge) => this.graph.disconnect(edge.id));
      this.onStatus(`unplugged ${edges.length} cable${edges.length > 1 ? 's' : ''}`);
    });

    // Hovering a socket lights up the cables running from it.
    this.rack.addEventListener('pointerover', (e) => {
      const socket = e.target.closest('.jack');
      this._lightCables(socket);
    });
    this.rack.addEventListener('pointerout', (e) => {
      if (!e.relatedTarget?.closest?.('.jack')) this._lightCables(null);
    });
  }

  _lightCables(socket) {
    const id = socket?.dataset.module;
    const name = socket?.dataset.jack;
    this.svg.querySelectorAll('[data-edge]').forEach((path) => {
      const edge = this.graph.edges.find((x) => x.id === path.dataset.edge);
      const lit = !!edge && !!socket && (
        (edge.from.moduleId === id && edge.from.name === name) ||
        (edge.to.moduleId === id && edge.to.name === name)
      );
      path.classList.toggle('is-lit', lit);
    });
  }

  _jackFromEl(socket) {
    return this.graph.getJack(socket.dataset.module, socket.dataset.jack);
  }

  _center(socket) {
    const r = socket.getBoundingClientRect();
    const base = this.rack.getBoundingClientRect();
    return {
      x: r.left - base.left + r.width / 2 + this.rack.scrollLeft,
      y: r.top - base.top + r.height / 2 + this.rack.scrollTop
    };
  }

  _startDrag(socket, ev) {
    const jack = this._jackFromEl(socket);
    if (!jack) return;

    const origin = this._center(socket);
    this.dragging = { jack, socket, origin };

    // Dim every socket this cable cannot legally reach.
    this.rack.querySelectorAll('.jack').forEach((s) => {
      const other = this._jackFromEl(s);
      const ok = other && (
        this.graph.canConnect(jack, other) || this.graph.canConnect(other, jack)
      );
      s.classList.toggle('is-target', !!ok);
      s.classList.toggle('is-blocked', !ok && s !== socket);
    });
    socket.classList.add('is-dragging');

    this.tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempPath.setAttribute('class', `cable cable-${jack.type} is-temp`);
    this.svg.append(this.tempPath);

    const move = (e) => {
      const base = this.rack.getBoundingClientRect();
      const p = {
        x: e.clientX - base.left + this.rack.scrollLeft,
        y: e.clientY - base.top + this.rack.scrollTop
      };
      this.tempPath.setAttribute('d', cablePath(origin, p));
    };

    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.tempPath?.remove();
      this.tempPath = null;

      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.jack');
      this.rack.querySelectorAll('.jack').forEach((s) =>
        s.classList.remove('is-target', 'is-blocked', 'is-dragging')
      );

      if (target && target !== socket) {
        const other = this._jackFromEl(target);
        const edge = this.graph.connect(jack, other);
        this.onStatus(edge
          ? `${jack.moduleId}.${jack.name} → ${other.moduleId}.${other.name}`
          : 'incompatible jacks');
      }
      this.dragging = null;
    };

    move(ev);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  redraw() {
    [...this.svg.querySelectorAll('[data-edge]')].forEach((p) => p.remove());

    const size = this.rack.getBoundingClientRect();
    this.svg.setAttribute('viewBox', `0 0 ${size.width} ${this.rack.scrollHeight}`);
    this.svg.style.height = this.rack.scrollHeight + 'px';

    this.graph.edges.forEach((edge) => {
      const a = this.rack.querySelector(`.jack[data-module="${edge.from.moduleId}"][data-jack="${edge.from.name}"]`);
      const b = this.rack.querySelector(`.jack[data-module="${edge.to.moduleId}"][data-jack="${edge.to.name}"]`);
      if (!a || !b) return;

      const p1 = this._center(a);
      const p2 = this._center(b);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', `cable cable-${edge.type}`);
      path.setAttribute('d', cablePath(p1, p2));
      path.dataset.edge = edge.id;
      this.svg.append(path);
    });

    // Mark patched sockets so the plug reads as "occupied".
    this.rack.querySelectorAll('.jack').forEach((s) => {
      s.classList.toggle('is-patched', this.graph.isConnected(s.dataset.module, s.dataset.jack));
    });
  }
}

// Quadratic bezier with the control point pushed downward proportionally to
// cable length — a real patch cable sags under its own weight.
function cablePath(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const sag = Math.min(160, dist * 0.32);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2 + sag;
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}
