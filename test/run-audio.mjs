// Drives test/audio.html in headless Chrome over the DevTools protocol and
// prints what the page measured.
//
// Chrome's --virtual-time-budget freezes OfflineAudioContext rendering, so the
// page has to run on real time and be polled instead.
//
//   node test/run-audio.mjs

import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const CHROME = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_ = process.env.TEST_URL || 'http://localhost:3333/test/audio.html';
const PORT = 9223;
const TIMEOUT_MS = 90000;

const profile = mkdtempSync(path.join(tmpdir(), 'suite-rol-'));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
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

const wsUrl = await waitForDevTools();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('websocket failed'));
});

let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
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

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true
  }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};

await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Page.navigate', { url: URL_ }, sessionId);

const started = Date.now();
let output = '';
while (Date.now() - started < TIMEOUT_MS) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const done = await evaluate('document.title === "done"');
    output = await evaluate('document.getElementById("out")?.textContent || ""');
    if (done) break;
  } catch {}
}

console.log(output || '(no output — page never reported)');
cleanup();
process.exit(/SILENT|ERROR|REJECTION/.test(output) ? 1 : 0);
