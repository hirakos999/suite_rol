// TTS provider chain.
//
// Piper first when it is configured (neural voices, best quality), then macOS
// `say` (installed on every Mac, speaks Italian, needs nothing). Both return a
// WAV the browser can decode and route through ZOLA's vocoder.
//
// If both are unavailable the client falls back to browser speechSynthesis,
// which cannot be routed through the effects chain — ZOLA says so rather than
// pretending it was vocoded.

import * as piper from './piper.js';
import * as say from './say.js';

export async function status() {
  const [piperState, sayAvailable, sayVoices] = await Promise.all([
    piper.piperStatus(),
    say.available(),
    say.listVoices()
  ]);

  const providers = [];
  if (piperState.available) providers.push({ id: 'piper', model: piperState.model });
  if (sayAvailable) providers.push({ id: 'say', voices: sayVoices.length });

  return {
    available: providers.length > 0,
    active: providers[0]?.id ?? null,
    providers,
    piper: piperState,
    reason: providers.length ? null : 'no TTS provider available'
  };
}

export async function listVoices() {
  const sayVoices = await say.listVoices();
  return {
    say: sayVoices,
    // Italian and English first — the two the rack is likely to be used in.
    suggested: sayVoices
      .filter((v) => v.locale.startsWith('it') || v.locale.startsWith('en'))
      .map((v) => v.name)
  };
}

export async function synthesise(text, { provider, voice, rate } = {}) {
  const errors = [];

  const wantPiper = !provider || provider === 'piper';
  if (wantPiper) {
    try {
      return { wav: await piper.synthesise(text, { voice }), provider: 'piper' };
    } catch (err) {
      errors.push(`piper: ${err.message}`);
      if (provider === 'piper') throw new Error(errors.join(' · '));
    }
  }

  const wantSay = !provider || provider === 'say';
  if (wantSay) {
    try {
      return { wav: await say.synthesise(text, { voice, rate }), provider: 'say' };
    } catch (err) {
      errors.push(`say: ${err.message}`);
    }
  }

  throw new Error(errors.join(' · ') || 'no TTS provider available');
}
