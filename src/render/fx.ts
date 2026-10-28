import { RNG } from '../core/rng';
import type { Weather } from '../match/types';

type Kind = 'dust' | 'grass' | 'confetti' | 'spark' | 'ring' | 'splash' | 'streak';

interface Particle {
  kind: Kind; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; size: number; color: string; rot: number; vr: number; alive: boolean;
}

const MAX = 700;

/** Pooled world-space particles: dust, turf, confetti, impact rings and speed streaks. */
export class Particles {
  private pool: Particle[] = [];
  private rng = new RNG('fx');
  /** 0..1.4 density multiplier from the quality preset */
  density = 1;

  constructor() { for (let i = 0; i < MAX; i++) this.pool.push({ kind: 'dust', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, color: '#fff', rot: 0, vr: 0, alive: false }); }

  private spawn(kind: Kind, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string, vr = 0): void {
    const p = this.pool.find((q) => !q.alive);
    if (!p) return;
    p.kind = kind; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.max = life; p.size = size; p.color = color; p.rot = this.rng.float(0, 6.28); p.vr = vr; p.alive = true;
  }

  dust(x: number, y: number, n: number, speed: number, color = 'rgba(196,174,128,'): void {
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) { const a = this.rng.float(0, 6.28), s = this.rng.float(0.2, 1) * speed; this.spawn('dust', x, y, 0.1, Math.cos(a) * s, Math.sin(a) * s, this.rng.float(0.2, 1.1), this.rng.float(0.35, 0.8), this.rng.float(0.25, 0.55), color); }
  }

  turf(x: number, y: number, dx: number, dy: number, n: number, color = '#2f7a35'): void {
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) { const s = this.rng.float(1, 4.5); const a = Math.atan2(dy, dx) + this.rng.float(-0.8, 0.8); this.spawn('grass', x, y, 0.05, Math.cos(a) * s, Math.sin(a) * s, this.rng.float(1.2, 3.2), this.rng.float(0.35, 0.7), this.rng.float(0.05, 0.1), color, this.rng.float(-14, 14)); }
  }

  confetti(x: number, y: number, n: number, colors: string[]): void {
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) { const a = this.rng.float(0, 6.28), s = this.rng.float(2, 9); this.spawn('confetti', x, y, 0.5, Math.cos(a) * s, Math.sin(a) * s, this.rng.float(4, 11), this.rng.float(1.6, 3.2), this.rng.float(0.1, 0.2), colors[this.rng.int(0, colors.length - 1)]!, this.rng.float(-12, 12)); }
  }

  sparks(x: number, y: number, n: number, color: string): void {
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) { const a = this.rng.float(0, 6.28), s = this.rng.float(1.5, 6); this.spawn('spark', x, y, 0.4, Math.cos(a) * s, Math.sin(a) * s, this.rng.float(0.5, 3), this.rng.float(0.25, 0.55), this.rng.float(0.05, 0.1), color); }
  }

  ring(x: number, y: number, size: number, color: string, life = 0.35): void { this.spawn('ring', x, y, 0, 0, 0, 0, life, size, color); }

  streak(x: number, y: number, dx: number, dy: number, len: number): void { this.spawn('streak', x, y, 0, dx, dy, 0, 0.18, len, 'rgba(255,255,255,'); }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      if (p.kind === 'ring' || p.kind === 'streak') continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vz -= (p.kind === 'confetti' ? 5 : 9.8) * dt;
      const drag = Math.exp(-(p.kind === 'confetti' ? 1.6 : 2.4) * dt); p.vx *= drag; p.vy *= drag;
      if (p.z < 0) { p.z = 0; p.vz = -p.vz * 0.25; if (p.kind === 'grass' || p.kind === 'confetti') { p.vx *= 0.5; p.vy *= 0.5; } }
      p.rot += p.vr * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, scale: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.life / p.max;
      const lift = p.z * 0.45;
      switch (p.kind) {
        case 'dust': {
          ctx.fillStyle = `${p.color}${(t * 0.38).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y - lift, Math.max(0.01, p.size * (1.7 - t * 0.7)), 0, Math.PI * 2); ctx.fill(); break;
        }
        case 'grass': case 'confetti': {
          ctx.save(); ctx.translate(p.x, p.y - lift); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.globalAlpha = Math.min(1, t * 2.2);
          if (p.kind === 'confetti') ctx.fillRect(-p.size / 2, -p.size * 0.25 * Math.abs(Math.cos(p.rot * 2)) - 0.01, p.size, p.size * 0.5 * Math.abs(Math.cos(p.rot * 2)) + 0.02); else ctx.fillRect(-p.size, -p.size * 0.3, p.size * 2, p.size * 0.6);
          ctx.restore(); break;
        }
        case 'spark': {
          ctx.globalAlpha = t; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y - lift, Math.max(0.01, p.size * (0.5 + t)), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; break;
        }
        case 'ring': {
          ctx.strokeStyle = p.color; ctx.globalAlpha = t * 0.8; ctx.lineWidth = Math.max(0.06, 2.2 / scale);
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.01, p.size * (1.2 - t) * 1.6 + 0.1), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; break;
        }
        case 'streak': {
          ctx.strokeStyle = `${p.color}${(t * 0.45).toFixed(3)})`; ctx.lineWidth = Math.max(0.05, 2 / scale); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * p.size, p.y - p.vy * p.size); ctx.stroke(); break;
        }
        default: break;
      }
    }
  }

  clear(): void { for (const p of this.pool) p.alive = false; }
}

/** Screen-space weather: rain streaks, snowflakes, fog and wet-lens darkening. */
export class WeatherLayer {
  private n = 0;
  private xs!: Float32Array; private ys!: Float32Array; private zs!: Float32Array;
  private rng = new RNG('weather2d');
  kind: Weather = 'clear';
  private splash: Array<{ x: number; y: number; t: number }> = [];

  set(kind: Weather, count: number): void {
    this.kind = kind;
    this.n = kind === 'rain' ? count : kind === 'snow' ? Math.round(count * 0.7) : 0;
    this.xs = new Float32Array(this.n); this.ys = new Float32Array(this.n); this.zs = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) { this.xs[i] = this.rng.next(); this.ys[i] = this.rng.next(); this.zs[i] = this.rng.float(0.4, 1); }
  }

  update(dt: number): void {
    const rain = this.kind === 'rain';
    for (let i = 0; i < this.n; i++) {
      const z = this.zs[i]!;
      this.ys[i] = this.ys[i]! + dt * (rain ? 1.9 * z + 0.9 : 0.12 + 0.12 * z);
      this.xs[i] = this.xs[i]! + dt * (rain ? -0.22 * z : Math.sin(this.ys[i]! * 9 + i) * 0.03 - 0.01);
      if (this.ys[i]! > 1) { this.ys[i] = this.ys[i]! - 1; this.xs[i] = this.rng.next(); if (rain && this.rng.chance(0.15) && this.splash.length < 40) this.splash.push({ x: this.rng.next(), y: this.rng.next(), t: 0 }); }
      if (this.xs[i]! < 0) this.xs[i] = this.xs[i]! + 1;
      else if (this.xs[i]! > 1) this.xs[i] = this.xs[i]! - 1;
    }
    for (const s of this.splash) s.t += dt;
    this.splash = this.splash.filter((s) => s.t < 0.3);
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, night: boolean): void {
    if (this.kind === 'fog') {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(200,210,220,0.18)'); g.addColorStop(1, night ? 'rgba(40,48,60,0.7)' : 'rgba(205,214,224,0.78)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); return;
    }
    if (this.kind === 'rain') {
      ctx.fillStyle = 'rgba(20,34,56,0.1)'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = night ? 'rgba(190,210,255,0.4)' : 'rgba(215,228,245,0.5)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < this.n; i++) { const x = this.xs[i]! * w, y = this.ys[i]! * h, z = this.zs[i]!; const l = 12 + z * 18; ctx.moveTo(x, y); ctx.lineTo(x - l * 0.13, y - l); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(210,225,245,0.5)'; ctx.lineWidth = 1;
      for (const s of this.splash) { const r = 2 + s.t * 22; ctx.globalAlpha = 1 - s.t / 0.3; ctx.beginPath(); ctx.ellipse(s.x * w, s.y * h, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    } else if (this.kind === 'snow') {
      ctx.fillStyle = 'rgba(235,242,255,0.07)'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < this.n; i++) { const z = this.zs[i]!; ctx.beginPath(); ctx.arc(this.xs[i]! * w, this.ys[i]! * h, 1 + z * 2.4, 0, Math.PI * 2); ctx.fill(); }
    }
  }
}

/**
 * Time-of-day lighting without bloom: a low-resolution darkness mask with soft pools cut out under the floodlights
 * and around the action, then upscaled over the scene.
 */
export class LightingLayer {
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  constructor(private mode: 'day' | 'dusk' | 'night') {
    this.cv = document.createElement('canvas'); this.cv.width = 320; this.cv.height = 180;
    this.g = this.cv.getContext('2d')!;
  }

  /** `toScreen` maps world → CSS px. `lights` are floodlight masts; `focus` is the ball. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, toScreen: (x: number, y: number) => [number, number], scale: number, lights: Array<{ x: number; y: number }>, focus: { x: number; y: number }, flash: number): void {
    if (this.mode === 'day') {
      // gentle warm sun wash
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'rgba(255,248,225,0.06)'); g.addColorStop(1, 'rgba(20,30,60,0.05)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      return;
    }
    const cw = this.cv.width, ch = this.cv.height, g = this.g;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = this.mode === 'night' ? 'rgba(4,8,24,0.74)' : 'rgba(90,38,14,0.42)';
    g.fillRect(0, 0, cw, ch);
    g.globalCompositeOperation = 'destination-out';
    const k = cw / w;
    const pool = (x: number, y: number, r: number, a: number): void => {
      const [sx, sy] = toScreen(x, y);
      const px = sx * k, py = sy * k, pr = r * scale * k;
      const gr = g.createRadialGradient(px, py, pr * 0.12, px, py, pr);
      gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    };
    if (this.mode === 'night') {
      // the pitch stays brightly lit by the floodlights while the stands and surroundings fall into shadow
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) pool(sx * 30, sy * 14, 48, 0.55);
      for (const l of lights) pool(l.x * 0.7, l.y * 0.7, 30, 0.3);
      pool(0, 0, 60, 0.5);
      pool(focus.x, focus.y, 16, 0.14);
    } else {
      pool(0, 0, 100, 0.3);
      pool(focus.x, focus.y, 26, 0.16);
    }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.cv, 0, 0, w, h);
    if (flash > 0.01) { ctx.fillStyle = `rgba(255,255,255,${(flash * 0.08).toFixed(3)})`; ctx.fillRect(0, 0, w, h); }
  }
}

export function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.max(w, h) * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(4,8,16,${strength})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
