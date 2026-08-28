// Piper TTS bridge.
//
// Piper is an ONNX text-to-speech binary: it reads text on stdin and writes a
// WAV to stdout, so no HTTP server or Python runtime is involved.
//
// Install (macOS):
//   brew install piper-tts        # or download a release binary
//   # then fetch a voice model + its .json config, e.g.
//   #   it_IT-riccardo-x_low.onnx / it_IT-riccardo-x_low.onnx.json
//
// Point the server at them:
//   PIPER_BIN=/opt/homebrew/bin/piper \
//   PIPER_MODEL=/path/to/it_IT-riccardo-x_low.onnx \
//   npm run dev

import { spawn } from 'child_process';
import { access, constants } from 'fs/promises';

const BIN = process.env.PIPER_BIN || 'piper';
const MODEL = process.env.PIPER_MODEL || '';
const TIMEOUT_MS = 15000;

let cachedStatus = null;

export async function piperStatus() {
  if (cachedStatus) return cachedStatus;

  if (!MODEL) {
    cachedStatus = { available: false, reason: 'PIPER_MODEL not set' };
    return cachedStatus;
  }
  try {
    await access(MODEL, constants.R_OK);
  } catch {
    cachedStatus = { available: false, reason: `model not readable: ${MODEL}` };
    return cachedStatus;
  }

  const binOk = await new Promise((resolve) => {
    const p = spawn(BIN, ['--help']);
    p.on('error', () => resolve(false));
    p.on('close', () => resolve(true));
  });

  cachedStatus = binOk
    ? { available: true, model: MODEL }
    : { available: false, reason: `piper binary not found: ${BIN}` };
  return cachedStatus;
}

export async function synthesise(text, { voice } = {}) {
  const status = await piperStatus();
  if (!status.available) throw new Error(status.reason);

  return new Promise((resolve, reject) => {
    const args = ['--model', voice || MODEL, '--output_file', '-'];
    const proc = spawn(BIN, args);

    const chunks = [];
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('piper timed out'));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `piper exited ${code}`));
      const wav = Buffer.concat(chunks);
      if (!wav.length) return reject(new Error('piper produced no audio'));
      resolve(wav);
    });

    proc.stdin.write(text);
    proc.stdin.end();
  });
}
