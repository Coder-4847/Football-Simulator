import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { createCanvas } from '../animation/rig';

interface KitSpec { primary: string; secondary: string; pattern: string }

const cache = new Map<string, Texture>();

/** Shirt texture in capsule UV space: u wraps around the torso, v runs bottom→top. */
export function shirtTexture(k: KitSpec): Texture {
  const key = `${k.primary}|${k.secondary}|${k.pattern}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 512, H = 256;
  const c = createCanvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = k.primary; g.fillRect(0, 0, W, H);
  g.fillStyle = k.secondary;
  switch (k.pattern) {
    case 'stripes': { const n = 10; for (let i = 0; i < n; i += 2) g.fillRect((i / n) * W, 0, W / n, H); break; }
    case 'hoops': { const n = 8; for (let i = 0; i < n; i += 2) g.fillRect(0, (i / n) * H, W, H / n); break; }
    case 'halves': g.fillRect(0, 0, W / 2, H); break;
    case 'sash': { g.beginPath(); g.moveTo(0, H * 0.3); g.lineTo(W, H * 0.85); g.lineTo(W, H * 0.55); g.lineTo(0, 0); g.closePath(); g.fill(); g.beginPath(); g.moveTo(0, H); g.lineTo(0, H * 0.7); g.lineTo(W, 0.3 * H); g.lineTo(W, H * 0.6); g.fill(); break; }
    case 'checks': { const n = 12; for (let i = 0; i < n; i++) for (let j = 0; j < 6; j++) if ((i + j) % 2 === 0) g.fillRect((i / n) * W, (j / 6) * H, W / n, H / 6); break; }
    case 'pinstripe': { g.globalAlpha = 0.55; for (let i = 0; i < 32; i++) g.fillRect((i / 32) * W, 0, 3, H); g.globalAlpha = 1; break; }
    case 'chevron': { g.lineWidth = 22; g.strokeStyle = k.secondary; for (let r = 0; r < 4; r++) { g.beginPath(); for (let i = 0; i <= 8; i++) { const x = (i / 8) * W; const y = H * 0.25 + r * 52 + (i % 2 === 0 ? 0 : 26); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); } break; }
    default: break;
  }
  // fabric weave and soft gradient
  g.globalAlpha = 0.07; g.fillStyle = '#000';
  for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  g.globalAlpha = 1;
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.wrapS = RepeatWrapping; t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

export function clearKitCache(): void { for (const t of cache.values()) t.dispose(); cache.clear(); }
