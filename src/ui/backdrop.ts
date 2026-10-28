import { PitchRenderer } from '../render/pitch';
import { RNG } from '../core/rng';

interface Dot { cx: number; cy: number; ax: number; ay: number; fx: number; fy: number; ph: number; team: 0 | 1 }

/** Slowly drifting top-down pitch with a passing move, drawn behind the menus. */
export class MenuBackdrop {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { alpha: false })!;
  private pitch = new PitchRenderer(0, false, false, false, 'menu', 0);
  private dots: Dot[] = [];
  private raf = 0;
  private t = 0;
  private last = 0;
  private running = false;
  private ball = { x: 0, y: 0 };

  constructor(parent: HTMLElement) {
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none';
    parent.prepend(this.canvas);
    const rng = new RNG('menu-dots');
    for (let i = 0; i < 14; i++) this.dots.push({ cx: rng.float(-38, 38), cy: rng.float(-22, 22), ax: rng.float(3, 9), ay: rng.float(3, 8), fx: rng.float(0.15, 0.4), fy: rng.float(0.15, 0.4), ph: rng.float(0, 6.28), team: i % 2 as 0 | 1 });
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  private resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(window.innerWidth * dpr * 0.75); this.canvas.height = Math.round(window.innerHeight * dpr * 0.75);
  };

  show(): void {
    this.canvas.style.display = 'block';
    if (this.running) return;
    this.running = true; this.last = performance.now();
    const frame = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000)); this.last = now;
      this.t += dt; this.draw();
    };
    this.raf = requestAnimationFrame(frame);
  }

  hide(): void { this.running = false; cancelAnimationFrame(this.raf); this.canvas.style.display = 'none'; }

  private pos(d: Dot): [number, number] { return [d.cx + Math.sin(this.t * d.fx + d.ph) * d.ax, d.cy + Math.cos(this.t * d.fy + d.ph * 1.3) * d.ay]; }

  private draw(): void {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const S = Math.max(W / 62, H / 40);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#0b0f14'; c.fillRect(0, 0, W, H);
    const camX = Math.sin(this.t * 0.05) * 22 + 10, camY = Math.cos(this.t * 0.04) * 6;
    c.setTransform(S, 0, 0, S, W / 2 - camX * S, H / 2 - camY * S);
    this.pitch.draw(c, S, { x0: -200, y0: -200, x1: 200, y1: 200 }, this.t);
    // passing move between a few of the dots
    const lead = Math.floor(this.t / 1.6) % this.dots.length;
    const from = this.dots[lead]!, to = this.dots[(lead + 1) % this.dots.length]!;
    const k = (this.t % 1.6) / 1.6;
    const [fx, fy] = this.pos(from), [tx, ty] = this.pos(to);
    this.ball.x = fx + (tx - fx) * k; this.ball.y = fy + (ty - fy) * k;
    for (const d of this.dots) {
      const [x, y] = this.pos(d);
      c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(x + 0.35, y + 0.45, 0.8, 0.6, 0, 0, 6.3); c.fill();
      c.fillStyle = d.team === 0 ? '#e5484d' : '#3b82f6'; c.beginPath(); c.ellipse(x, y, 0.62, 0.9, Math.atan2(ty - fy, tx - fx), 0, 6.3); c.fill();
      c.fillStyle = '#e0ac82'; c.beginPath(); c.arc(x, y, 0.3, 0, 6.3); c.fill();
    }
    c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 0.1; c.setLineDash([0.5, 0.4]); c.beginPath(); c.moveTo(fx, fy); c.lineTo(tx, ty); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#fff'; c.beginPath(); c.arc(this.ball.x, this.ball.y, 0.3, 0, 6.3); c.fill();
    // legibility veil
    c.setTransform(1, 0, 0, 1, 0, 0);
    const g = c.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(8,12,18,0.94)'); g.addColorStop(0.5, 'rgba(8,12,18,0.72)'); g.addColorStop(1, 'rgba(8,12,18,0.5)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
}
