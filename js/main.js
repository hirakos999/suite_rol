import { initAudio, resumeAudio, getCtx, getMaster } from './core/audio-engine.js';
import { Clock } from './core/clock.js';
import { PatchGraph } from './core/patch-graph.js';
import { PatternBank } from './core/patterns.js';
import { Recorder } from './core/recorder.js';
import { PatchBay } from './ui/patch-bay.js';
import { createHelp } from './ui/help.js';
import { createVU } from './ui/vu.js';
import { debounce } from './utils.js';

import { Kanchelskis } from './modules/kanchelskis.js';
import { Yeboah } from './modules/yeboah.js';
import { Juninho } from './modules/juninho.js';
import { LeTissier } from './modules/letissier.js';
import { Asprilla } from './modules/asprilla.js';
import { Zola } from './modules/zola.js';

const STORAGE_KEY = 'suite-rol-v2';
const VOICE_MODULES = [Yeboah, Juninho, LeTissier, Asprilla, Zola];

// Default patch: everything synced to the master clock, so the rack makes
// sense the moment it boots.
const DEFAULT_PATCH = ['yeboah', 'juninho', 'letissier', 'asprilla', 'zola'].map((id) => ({
  from: { moduleId: 'kanchelskis', name: 'clk-1' },
  to: { moduleId: id, name: 'clk-in' }
}));

const rack = document.getElementById('rack');
const cableLayer = document.getElementById('cables');
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
  clearTimeout(setStatus._t);
  setStatus._t = setTimeout(() => { statusEl.textContent = 'ready'; }, 3000);
}
document.addEventListener('suite:status', (e) => setStatus(e.detail.text));

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

async function boot() {
  await resumeAudio();
  const ctx = getCtx();

  const clock = new Clock(ctx, { bpm: 130 });
  const graph = new PatchGraph();
  const saved = loadSaved();

  // Voice modules first, then the clock — the bank needs the list of modules
  // it will be snapshotting, and KANCHELSKIS needs the bank.
  const voices = VOICE_MODULES.map((Mod) => {
    const m = new Mod({ clock });
    graph.register(m);
    return m;
  });

  const bank = new PatternBank(voices);
  const master = new Kanchelskis({ clock, bank });
  graph.register(master);

  const modules = [master, ...voices];

  // KANCHELSKIS sits alone across the top; the five voices form the row below.
  document.getElementById('clock-slot').append(master.render());
  voices.forEach((m) => rack.append(m.render()));
  modules.forEach((m) => { if (saved.modules?.[m.id]) m.restore(saved.modules[m.id]); });

  const patchBay = new PatchBay({
    svg: cableLayer, graph,
    rack: document.getElementById('rack-area'),
    onStatus: setStatus
  });

  graph.restore(saved.patch?.length ? saved.patch : DEFAULT_PATCH);

  // Output normalisation and the sample deck's resample source both depend on
  // what is currently patched, so they refresh on every graph change.
  const syncPatchState = () => {
    modules.forEach((m) => m.updateNormalisation(graph));
    const deck = voices.find((m) => m.id === 'asprilla');
    if (deck) deck.inputPatched = graph.isConnected('asprilla', 'audio-in');
  };
  graph.onChange(syncPatchState);
  syncPatchState();

  requestAnimationFrame(() => patchBay.redraw());

  if (saved.bank) bank.restore(saved.bank);

  // --- help + cable visibility ---
  const help = createHelp();
  document.body.append(help.el);
  document.getElementById('help-btn').addEventListener('click', () => help.toggle());

  const cablesBtn = document.getElementById('cables-btn');
  cablesBtn.addEventListener('click', () => {
    const hidden = document.body.classList.toggle('cables-hidden');
    cablesBtn.classList.toggle('is-active', !hidden);
    setStatus(hidden ? 'cables hidden' : 'cables shown');
  });

  // --- master meter + volume ---
  document.getElementById('master-meter').append(
    createVU({ analyser: getMaster().analyser, width: 110, height: 11 }).el
  );

  const masterVol = document.getElementById('master-vol');
  masterVol.addEventListener('input', () => {
    getMaster().gain.setTargetAtTime(Number(masterVol.value), ctx.currentTime, 0.02);
  });

  // --- persistence ---
  const persist = debounce(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      modules: Object.fromEntries(modules.map((m) => [m.id, m.serialize()])),
      patch: graph.serialize(),
      bank: bank.serialize()
    }));
  }, 600);

  document.addEventListener('suite:state-change', persist);
  graph.onChange(persist);
  bank.onChange(persist);

  // --- transport ---
  const transportBtn = document.getElementById('transport');
  const syncTransport = (running) => {
    transportBtn.textContent = running ? '■' : '▶';
    transportBtn.classList.toggle('is-running', running);
    document.body.classList.toggle('is-running', running);
  };
  transportBtn.addEventListener('click', () => syncTransport(clock.toggle()));
  document.addEventListener('suite:transport', (e) => syncTransport(e.detail.running));

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); syncTransport(clock.toggle()); }
  });

  // --- master recorder ---
  // Records the post-limiter master bus. Free-running, a fixed number of bars,
  // or a fixed number of seconds — chosen in the header.
  const recBtn = document.getElementById('rec');
  const recMode = document.getElementById('rec-mode');
  const recAmount = document.getElementById('rec-amount');
  const recTime = document.getElementById('rec-time');
  let recorder = null;

  const updateRecAmount = () => {
    const mode = recMode.value;
    recAmount.style.display = mode === 'free' ? 'none' : '';
    recAmount.replaceChildren(
      ...(mode === 'bars' ? [1, 2, 4, 8, 16, 32] : [5, 10, 15, 30, 60, 120]).map((n) => {
        const o = document.createElement('option');
        o.value = String(n);
        o.textContent = mode === 'bars' ? `${n} BAR` : `${n} SEC`;
        return o;
      })
    );
    recAmount.value = mode === 'bars' ? '4' : '30';
  };
  recMode.addEventListener('change', updateRecAmount);
  updateRecAmount();

  recBtn.addEventListener('click', () => {
    if (recorder?.recording) { recorder.stop(); return; }

    recorder = new Recorder(getMaster().analyser);
    recorder.onTick = (secs) => { recTime.textContent = formatTime(secs); };
    recorder.onStop = (result) => {
      recBtn.classList.remove('is-recording');
      document.body.classList.remove('is-recording');
      if (!result.left.length) { setStatus('recording was empty'); return; }

      const blob = recorder.toBlob(result);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `suite-rol-${stamp()}.wav`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`recorded ${result.duration.toFixed(1)}s → WAV`);
      recTime.textContent = '0:00';
    };

    const mode = recMode.value;
    const amount = Number(recAmount.value);
    recorder.start(
      mode === 'bars' ? { bars: amount, clock }
        : mode === 'seconds' ? { seconds: amount }
          : {}
    );

    recBtn.classList.add('is-recording');
    document.body.classList.add('is-recording');
    setStatus(mode === 'free' ? 'recording — click again to stop' : `recording ${amount} ${mode}`);
  });

  // --- clear all ---
  document.getElementById('clear-all').addEventListener('click', () => {
    // Two-step, because it throws away every pattern, cable and stored slot.
    const btn = document.getElementById('clear-all');
    if (!btn.classList.contains('is-armed')) {
      btn.classList.add('is-armed');
      btn.textContent = 'SURE?';
      setStatus('CLEAR ALL — click again to confirm');
      clearTimeout(btn._t);
      btn._t = setTimeout(() => {
        btn.classList.remove('is-armed');
        btn.textContent = 'CLEAR';
      }, 4000);
      return;
    }

    clearTimeout(btn._t);
    btn.classList.remove('is-armed');
    btn.textContent = 'CLEAR';

    voices.forEach((m) => m.clearPattern());
    bank.clearAll();
    graph.edges.slice().forEach((e) => graph.disconnect(e.id));
    graph.restore(DEFAULT_PATCH);
    patchBay.redraw();
    localStorage.removeItem(STORAGE_KEY);
    setStatus('rack cleared');
  });

  // --- patch import / export ---
  document.getElementById('export-patch').addEventListener('click', () => {
    const data = {
      modules: Object.fromEntries(modules.map((m) => [m.id, m.serialize()])),
      patch: graph.serialize(),
      bank: bank.serialize()
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `suite-rol-${stamp()}.patch.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('patch exported');
  });

  const importInput = document.getElementById('import-patch');
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      graph.edges.slice().forEach((e) => graph.disconnect(e.id));
      modules.forEach((m) => { if (data.modules?.[m.id]) m.restore(data.modules[m.id]); });
      if (data.bank) bank.restore(data.bank);
      graph.restore(data.patch || []);
      patchBay.redraw();
      setStatus(`loaded ${file.name}`);
    } catch {
      setStatus('bad patch file');
    }
  });

  document.getElementById('panic').addEventListener('click', () => {
    clock.stop();
    syncTransport(false);
    getMaster().gain.setValueAtTime(0, ctx.currentTime);
    getMaster().gain.setTargetAtTime(Number(masterVol.value), ctx.currentTime + 0.15, 0.05);
    setStatus('panic');
  });

  clock.start();
  syncTransport(true);
  setStatus(`${modules.length} modules online`);
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// AudioContext creation must happen inside a user gesture.
const overlay = document.getElementById('boot');
const bootBtn = document.getElementById('boot-btn');

bootBtn.addEventListener('click', async () => {
  initAudio();
  try {
    await boot();
    overlay.classList.add('is-gone');
    setTimeout(() => overlay.remove(), 400);
  } catch (err) {
    console.error(err);
    bootBtn.textContent = 'BOOT FAILED — SEE CONSOLE';
  }
}, { once: true });

// #autostart skips the splash for development and headless capture.
if (location.hash === '#autostart') bootBtn.click();
