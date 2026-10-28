import type { QualityName } from './quality';
import { isMobile } from './quality';

/** Short 2D-canvas micro-benchmark used on the first launch to pick a quality preset. */
export async function runBenchmark(): Promise<QualityName> {
  try {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    if (!g) return 'Low';
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      for (let k = 0; k < 900; k++) {
        const gr = g.createRadialGradient(k % 1280, (k * 7) % 720, 2, k % 1280, (k * 7) % 720, 24 + (k % 9));
        gr.addColorStop(0, `hsla(${k % 360},70%,60%,.7)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect((k % 1280) - 40, ((k * 7) % 720) - 40, 80, 80);
      }
      g.getImageData(0, 0, 1, 1);
      if (i >= 4) times.push(performance.now() - t0);
      await new Promise<void>((res) => requestAnimationFrame(() => res()));
    }
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)] ?? 10;
    if (isMobile()) return med < 8 ? 'Medium' : 'Low';
    if (med < 6) return 'High';
    if (med < 14) return 'Medium';
    return 'Low';
  } catch { return 'Medium'; }
}
