// Drives the real page in headless Chrome and checks that controls are
// actually reachable and that the pattern bank / clear behave.
//
// The important check here is elementFromPoint: a control can be rendered
// perfectly and still be unclickable because something transparent sits on top
// of it. Only hit-testing finds that.
//
//   node test/run-ui.mjs

import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const CHROME = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_ = 'http://localhost:3333/#autostart';
const PORT = 9224;

const profile = mkdtempSync(path.join(tmpdir(), 'suite-rol-ui-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1900,1200',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  'about:blank'
], { stdio: 'ignore' });

const cleanup = () => {
  chrome.kill('SIGKILL');
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

async function waitForDevTools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('devtools never came up');
}

const ws = new WebSocket(await waitForDevTools());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.exception?.description
      || msg.params.exceptionDetails.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Page.navigate', { url: URL_ }, sessionId);
await new Promise((r) => setTimeout(r, 4000));

async function evaluate(expr) {
  // async so snippets can await fetch; awaitPromise resolves it before return.
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true
  }, sessionId);
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  }
  return r.result.value;
}

let failures = 0;
const ok = (cond, msg, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('\nSUITE ROL — UI interaction test\n');

ok(await evaluate('return !!document.querySelector(".panel")'), 'rack rendered');
ok(await evaluate('return document.querySelectorAll(".panel").length === 6'), 'six panels present');

// --- hit testing: is anything covering the controls? ---
const blocked = await evaluate(`
  const sel = '.knob-dial, .btn, .select, .step-cell, .pad, .chord-slot, .pattern-slot';
  const out = [];
  for (const elm of document.querySelectorAll(sel)) {
    const r = elm.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Skip anything scrolled under the fixed top/status bars: that is the
    // viewport clipping it, not another element stealing its clicks.
    const topBar = document.querySelector('.topbar')?.getBoundingClientRect().height || 0;
    const statusBar = document.querySelector('.statusbar')?.getBoundingClientRect().height || 0;
    if (r.top < topBar || r.bottom > innerHeight - statusBar) continue;
    if (r.left < 0 || r.right > innerWidth) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) continue;
    if (elm === hit || elm.contains(hit) || hit.contains(elm)) continue;
    out.push({
      target: elm.className,
      module: elm.closest('.panel')?.dataset.module || '?',
      covering: hit.tagName + '.' + (hit.getAttribute('class') || '')
    });
  }
  return out;
`);
ok(blocked.length === 0, `every visible control is hit-testable`,
  blocked.length ? `${blocked.length} blocked, e.g. ${JSON.stringify(blocked[0])}` : '');

// --- pattern bank: select a slot, then SAVE ---
await evaluate(`document.querySelectorAll('.pattern-slot')[2].click(); return true;`);
await new Promise((r) => setTimeout(r, 200));
ok(await evaluate(`return document.querySelectorAll('.pattern-slot')[2].classList.contains('is-current')`),
  'clicking a slot selects it');
ok(await evaluate(`return !document.querySelectorAll('.pattern-slot')[2].classList.contains('is-filled')`),
  'clicking an empty slot does NOT silently save into it');

await evaluate(`
  [...document.querySelectorAll('.btn')].find(b => b.textContent.trim() === 'SAVE')?.click();
  return true;
`);
await new Promise((r) => setTimeout(r, 300));
ok(await evaluate(`return document.querySelectorAll('.pattern-slot')[2].classList.contains('is-filled')`),
  'SAVE stores the rack into the selected slot');

const filledCount = await evaluate(`return document.querySelectorAll('.pattern-slot.is-filled').length`);
ok(filledCount === 1, 'only the clicked slot is filled', `${filledCount} filled`);

const currentCount = await evaluate(`return document.querySelectorAll('.pattern-slot.is-current').length`);
ok(currentCount === 1, 'exactly one slot reads as current', `${currentCount} current`);

// --- persistence of the bank (persist is debounced, so wait it out) ---
await new Promise((r) => setTimeout(r, 1200));
ok(await evaluate(`
  const raw = localStorage.getItem('suite-rol-v2');
  if (!raw) return false;
  const data = JSON.parse(raw);
  return Array.isArray(data.bank?.slots) && data.bank.slots.filter(Boolean).length > 0;
`), 'saved slot reaches localStorage');

// --- song ---
await evaluate(`
  [...document.querySelectorAll('.btn')].find(b => b.textContent.trim() === '+ ADD')?.click();
  return true;
`);
await new Promise((r) => setTimeout(r, 300));
ok(await evaluate(`return document.querySelectorAll('.song-item').length === 1`), 'ADD appends a song entry');

// --- recall must actually restore the grids ---
await evaluate(`
  const before = document.querySelectorAll('.step-cell.is-on').length;
  window.__before = before;
  [...document.querySelectorAll('.btn')].find(b => b.textContent.trim() === 'CLR')?.click();
  return true;
`);
await new Promise((r) => setTimeout(r, 300));
const afterClr = await evaluate('return document.querySelectorAll(".step-cell.is-on").length');
await evaluate(`document.querySelectorAll('.pattern-slot')[2].click(); return true;`);
await new Promise((r) => setTimeout(r, 300));
const afterRecall = await evaluate('return document.querySelectorAll(".step-cell.is-on").length');
ok(afterRecall > afterClr, 'recalling a slot restores the step grids',
  `${afterClr} lit after clear, ${afterRecall} after recall`);

// --- clear all ---
await evaluate(`
  const b = document.getElementById('clear-all');
  b.click(); b.click();
  return true;
`);
await new Promise((r) => setTimeout(r, 500));
ok(await evaluate(`return document.querySelectorAll('.pattern-slot.is-filled').length === 0`),
  'CLEAR empties the pattern bank');
ok(await evaluate(`return document.querySelectorAll('.step-cell.is-on').length === 0`),
  'CLEAR empties every step grid');
ok(await evaluate(`return document.querySelectorAll('.song-item').length === 0`),
  'CLEAR empties the song');

// --- cables still present after clear (default patch restored) ---
ok(await evaluate(`return document.querySelectorAll('[data-edge]').length === 5`),
  'default clock patch restored after clear',
  `${await evaluate(`return document.querySelectorAll('[data-edge]').length`)} cables`);

// --- TTS end to end: server speech must land in ZOLA's buffer ---
const tts = await evaluate(`
  const res = await fetch('/api/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'prova del vocoder' })
  });
  return { status: res.status, provider: res.headers.get('X-TTS-Provider'),
           bytes: (await res.arrayBuffer()).byteLength };
`);
ok(tts.status === 200, 'TTS endpoint answers', `status ${tts.status}`);
ok(tts.bytes > 1000, `TTS returned audio via "${tts.provider}"`, `${tts.bytes} bytes`);

ok(await evaluate(`return document.querySelectorAll('#zola optgroup').length > 0
  || document.querySelectorAll('.panel[data-module=zola] optgroup').length > 0`),
  'voice dropdown populated from the server');

ok(consoleErrors.length === 0, 'no console errors',
  consoleErrors.slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} FAILURES\n` : '\nall UI checks passed\n');
cleanup();
process.exit(failures ? 1 : 0);
