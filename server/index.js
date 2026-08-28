import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { synthesise, status as ttsStatus, listVoices } from './tts/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3333;

const app = express();
app.use(express.json({ limit: '256kb' }));

// AudioWorklet and SharedArrayBuffer both want a cross-origin isolated page.
// Harmless now, required the moment a worklet lands here.
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

app.use(express.static(ROOT, { extensions: ['html'] }));

app.get('/api/health', async (req, res) => {
  res.json({ ok: true, tts: await ttsStatus() });
});

// Voice list for ZOLA's dropdown.
app.get('/api/tts/voices', async (req, res) => {
  try {
    res.json(await listVoices());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Text -> WAV. Piper if configured, otherwise macOS `say`. ZOLA falls back to
// browser speech synthesis only when both are unavailable.
app.post('/api/tts', async (req, res) => {
  const { text, voice, rate, provider } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text required' });
  }
  if (text.length > 600) {
    return res.status(413).json({ error: 'text too long' });
  }

  try {
    const { wav, provider: used } = await synthesise(text, { provider, voice, rate });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-TTS-Provider', used);
    res.send(wav);
  } catch (err) {
    console.warn('[tts]', err.message);
    res.status(503).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  SUITE ROL  →  http://localhost:${PORT}\n`);
});
