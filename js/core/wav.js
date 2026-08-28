// Float32 capture -> 16-bit PCM WAV blob.

export function encodeWAV(left, right, sampleRate) {
  const length = Math.min(left.length, right.length);
  const buffer = new ArrayBuffer(44 + length * 4);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length * 4, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);   // PCM
  view.setUint16(22, 2, true);   // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length * 4, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    view.setInt16(offset, floatTo16(left[i]), true); offset += 2;
    view.setInt16(offset, floatTo16(right[i]), true); offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function mergeChunks(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

function floatTo16(s) {
  const v = Math.max(-1, Math.min(1, s));
  return v < 0 ? v * 0x8000 : v * 0x7fff;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
