// macOS `say` as a TTS provider.
//
// This is the zero-install path: every Mac has it, it writes a real WAV, and
// that WAV can be routed through ZOLA's vocoder — unlike the browser's
// speechSynthesis, which only reaches the speakers.
//
// Quality is below Piper's neural voices, but it works right now and it speaks
// Italian.

import { spawn } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const TIMEOUT_MS = 20000;

let voiceCache = null;

export async function available() {
  const voices = await listVoices();
  return voices.length > 0;
}

// `say -v '?'` prints "Name    locale    # example". Names can contain spaces
// and parentheses, so the locale column is the anchor.
export async function listVoices() {
  if (voiceCache) return voiceCache;
  if (process.platform !== 'darwin') { voiceCache = []; return voiceCache; }

  const out = await run(['-v', '?'], null).catch(() => null);
  if (!out) { voiceCache = []; return voiceCache; }

  voiceCache = out.toString('utf8')
    .split('\n')
    .map((line) => {
      const m = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#/);
      return m ? { name: m[1].trim(), locale: m[2] } : null;
    })
    .filter(Boolean);
  return voiceCache;
}

// Text goes in over stdin and the voice name is validated against the list, so
// nothing user-supplied is ever interpolated into a command line.
export async function synthesise(text, { voice, rate } = {}) {
  const voices = await listVoices();
  if (!voices.length) throw new Error('say unavailable');

  const args = [];

  if (voice) {
    const match = voices.find((v) => v.name === voice);
    if (!match) throw new Error(`unknown voice: ${voice}`);
    args.push('-v', match.name);
  }

  if (rate) {
    const r = Math.round(Number(rate));
    if (!Number.isFinite(r) || r < 60 || r > 400) throw new Error('rate out of range');
    args.push('-r', String(r));
  }

  const outPath = path.join(tmpdir(), `suite-rol-${randomUUID()}.wav`);
  args.push('-f', '-', '-o', outPath, '--data-format=LEI16@22050', '--file-format=WAVE');

  try {
    await run(args, text);
    const wav = await readFile(outPath);
    if (!wav.length) throw new Error('say produced no audio');
    return wav;
  } finally {
    unlink(outPath).catch(() => {});
  }
}

function run(args, stdin) {
  return new Promise((resolve, reject) => {
    const proc = spawn('say', args);
    const chunks = [];
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('say timed out'));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `say exited ${code}`));
      resolve(Buffer.concat(chunks));
    });

    if (stdin !== null && stdin !== undefined) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
  });
}
