// Pixel VU meter — discrete blocks, no smooth gradient, so it reads as a
// hardware bargraph rather than a CSS progress bar.
//
// All meters share one rAF loop; adding a module costs no extra frame budget.

const meters = [];
let running = false;

function loop() {
  for (const m of meters) m.tick();
  requestAnimationFrame(loop);
}

export function createVU({ analyser, segments = 14, width = 96, height = 10, color = '#c6ff00' }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'vu';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);

  const data = new Uint8Array(analyser.fftSize);
  const segW = width / segments;
  let peak = 0;
  let peakHold = 0;

  const meter = {
    el: canvas,
    tick() {
      if (!canvas.isConnected) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const c = (v - 128) / 128; sum += c * c; }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms * 3.2);

      // Fast attack, slow release, plus a peak marker that falls back slowly.
      peak = level > peak ? level : peak * 0.88;
      if (peak > peakHold) { peakHold = peak; }
      else { peakHold = Math.max(peak, peakHold - 0.008); }

      g.clearRect(0, 0, width, height);
      const lit = Math.round(peak * segments);
      const peakSeg = Math.round(peakHold * segments);

      for (let i = 0; i < segments; i++) {
        const x = i * segW;
        const hot = i >= segments - 2;
        const warm = i >= segments - 5;
        if (i < lit) g.fillStyle = hot ? '#ff3b30' : warm ? '#ffb000' : color;
        else if (i === peakSeg - 1) g.fillStyle = 'rgba(255,255,255,0.45)';
        else g.fillStyle = 'rgba(255,255,255,0.07)';
        g.fillRect(x, 0, segW - 1, height);
      }
    }
  };

  meters.push(meter);
  if (!running) { running = true; loop(); }
  return meter;
}
