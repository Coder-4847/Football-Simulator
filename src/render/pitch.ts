import { RNG } from '../core/rng';
import { BOX_L, BOX_W, CENTER_R, GOAL_DEPTH, HALF_GOAL, HALF_L, HALF_W, PEN_SPOT, SIX_L, SIX_W } from '../match/constants';

/** Run-off (mown grass beyond the touchlines) before the advertising boards. */
export const RUNOFF_X = 6.5;
export const RUNOFF_Y = 5.5;

export interface PitchPalette { dark: string; light: string; base: string; line: string }

export const PITCH_PALETTES: PitchPalette[] = [
  { dark: '#2c8a3a', light: '#37a046', base: '#26772f', line: '#f6f9f3' },
  { dark: '#2f8a4a', light: '#3ba35b', base: '#27763d', line: '#f5f8f6' },
  { dark: '#2a8236', light: '#34983f', base: '#226b2c', line: '#f4f7f1' },
  { dark: '#348b34', light: '#43a43f', base: '#2a7229', line: '#f7f9f1' },
];

export interface NetImpulse { goal: 1 | -1; x: number; y: number; power: number; t: number }

/** Draws the grass, mowing pattern, wear, markings, goals and corner flags in world metres. */
export class PitchRenderer {
  private grain: CanvasPattern | null = null;
  private wearCanvas: HTMLCanvasElement | null = null;
  private wearCtx: CanvasRenderingContext2D | null = null;
  private wearDirty = false;
  private readonly wearPPM = 4;
  private wearUploadT = 0;
  readonly palette: PitchPalette;
  net: NetImpulse[] = [];
  private snowNoise: CanvasPattern | null = null;
  private bg: HTMLCanvasElement | null = null;
  /** pixels per metre of the baked grass layer */
  detail = 16;

  constructor(private style: number, private wet: boolean, private snow: boolean, wear: boolean, seed: string, private mowing: number) {
    this.palette = PITCH_PALETTES[style % PITCH_PALETTES.length]!;
    if (wear) {
      const w = Math.ceil((HALF_L + RUNOFF_X) * 2 * this.wearPPM), h = Math.ceil((HALF_W + RUNOFF_Y) * 2 * this.wearPPM);
      this.wearCanvas = document.createElement('canvas'); this.wearCanvas.width = w; this.wearCanvas.height = h;
      this.wearCtx = this.wearCanvas.getContext('2d')!;
      this.seedWear(new RNG(seed + ':wear'));
    }
  }

  private makeGrain(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d')!;
    const rng = new RNG('grain' + this.style);
    // soft cloudy variation
    for (let i = 0; i < 90; i++) {
      const x = rng.float(0, 256), y = rng.float(0, 256), r = rng.float(10, 34); const l = rng.chance(0.5);
      for (const ox of [0, 256, -256]) for (const oy of [0, 256, -256]) {
        const cx = x + ox, cy = y + oy; if (cx + r < 0 || cx - r > 256 || cy + r < 0 || cy - r > 256) continue;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, l ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
    // blades
    g.lineCap = 'round';
    for (let i = 0; i < 1800; i++) {
      const x = rng.float(0, 256), y = rng.float(0, 256), a = rng.float(-0.35, 0.35) - Math.PI / 2, l = rng.float(2, 5);
      g.strokeStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.08)' : 'rgba(0,20,0,0.12)'; g.lineWidth = rng.float(0.5, 1.1);
      for (const ox of [0, 256, -256]) for (const oy of [0, 256, -256]) { if ((ox !== 0 && x + ox > 270) || (oy !== 0 && y + oy > 270) || (ox < 0 && x < 10) ) continue; g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke(); }
    }
    const pat = ctx.createPattern(c, 'repeat');
    pat?.setTransform(new DOMMatrix().scale(1 / 42));
    return pat;
  }

  private seedWear(rng: RNG): void {
    const g = this.wearCtx!; const ppm = this.wearPPM;
    g.clearRect(0, 0, this.wearCanvas!.width, this.wearCanvas!.height);
    // goalmouths and penalty spots, centre circle start
    const spots: Array<[number, number, number, number]> = [];
    for (const s of [-1, 1]) { spots.push([s * (HALF_L - 2.5), 0, 6.5, 0.5], [s * (HALF_L - PEN_SPOT), 0, 1.4, 0.55], [s * (HALF_L - 9), 0, 7, 0.18]); }
    spots.push([0, 0, 1.2, 0.35]);
    for (const [x, y, r, a] of spots) this.stamp(g, x, y, r * ppm, a, ppm);
    for (let i = 0; i < 30; i++) this.stamp(g, rng.float(-HALF_L, HALF_L), rng.float(-HALF_W, HALF_W), rng.float(0.6, 1.6) * ppm, rng.float(0.03, 0.1), ppm);
    this.wearDirty = true;
  }

  private stamp(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, ppm: number): void {
    const px = (x + HALF_L + RUNOFF_X) * ppm, py = (y + HALF_W + RUNOFF_Y) * ppm;
    const gr = g.createRadialGradient(px, py, 0, px, py, r);
    gr.addColorStop(0, `rgba(122,104,58,${a})`); gr.addColorStop(1, 'rgba(122,104,58,0)');
    g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
  }

  /** Light foot-wear along a runner's track. */
  wear(x: number, y: number, strength: number): void {
    if (!this.wearCtx) return;
    this.stamp(this.wearCtx, x, y, 0.75 * this.wearPPM, 0.035 * strength, this.wearPPM);
    this.wearDirty = true;
  }

  /** Dark scuff where a slide tackle dug in. */
  skid(x: number, y: number, dx: number, dy: number, len: number): void {
    const g = this.wearCtx; if (!g) return;
    const n = Math.max(2, Math.round(len / 0.5));
    for (let i = 0; i < n; i++) { const t = i / n; this.stamp(g, x + dx * len * t, y + dy * len * t, 0.55 * this.wearPPM, 0.18, this.wearPPM); }
    this.wearDirty = true;
  }

  addNetImpulse(goal: 1 | -1, x: number, y: number, power: number): void {
    this.net.push({ goal, x, y, power: Math.min(1.5, power / 18), t: 0 });
    if (this.net.length > 6) this.net.shift();
  }

  update(dt: number): void {
    for (const n of this.net) n.t += dt;
    this.net = this.net.filter((n) => n.t < 1.6);
    this.wearUploadT += dt;
  }

  /** Pre-renders mowing stripes, grain and soft lighting once; per-frame cost is a single clipped blit. */
  private bake(ctxForPattern: CanvasRenderingContext2D): void {
    void ctxForPattern;
    const pal = this.palette;
    const X0 = -HALF_L - RUNOFF_X, X1 = HALF_L + RUNOFF_X, Y0 = -HALF_W - RUNOFF_Y, Y1 = HALF_W + RUNOFF_Y;
    const d = this.detail;
    const c = document.createElement('canvas'); c.width = Math.ceil((X1 - X0) * d); c.height = Math.ceil((Y1 - Y0) * d);
    const g = c.getContext('2d')!;
    g.setTransform(d, 0, 0, d, -X0 * d, -Y0 * d);
    g.fillStyle = pal.base; g.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    g.fillStyle = pal.light;
    const bw = 7.5;
    switch (this.mowing % 4) {
      case 0: for (let x = X0, i = 0; x < X1; x += bw, i++) if (i % 2 === 0) g.fillRect(x, Y0, bw, Y1 - Y0); break;
      case 1: for (let y = Y0, i = 0; y < Y1; y += 6.8, i++) if (i % 2 === 0) g.fillRect(X0, y, X1 - X0, 6.8); break;
      case 2: for (let x = X0, i = 0; x < X1; x += bw, i++) for (let y = Y0, j = 0; y < Y1; y += 6.8, j++) if ((i + j) % 2 === 0) g.fillRect(x, y, bw, 6.8); break;
      default: {
        g.save(); g.beginPath(); g.rect(X0, Y0, X1 - X0, Y1 - Y0); g.clip(); g.rotate(Math.PI / 4);
        for (let k = -120, i = 0; k < 120; k += 7, i++) if (i % 2 === 0) g.fillRect(k, -120, 7, 240);
        g.restore();
      }
    }
    const grain = this.makeGrain(g);
    if (grain) { g.globalAlpha = 0.9; g.fillStyle = grain; g.fillRect(X0, Y0, X1 - X0, Y1 - Y0); g.globalAlpha = 1; }
    const lg = g.createLinearGradient(X0, Y0, X1, Y1);
    lg.addColorStop(0, 'rgba(255,255,230,0.07)'); lg.addColorStop(0.5, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(0,0,30,0.1)');
    g.fillStyle = lg; g.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    this.bg = c;
  }

  /** `ctx` must already carry the world transform (1 unit = 1 m). `scale` = pixels per metre (for hairline widths). */
  draw(ctx: CanvasRenderingContext2D, scale: number, viewport: { x0: number; y0: number; x1: number; y1: number }, time: number): void {
    const pal = this.palette;
    const X0 = -HALF_L - RUNOFF_X, X1 = HALF_L + RUNOFF_X, Y0 = -HALF_W - RUNOFF_Y, Y1 = HALF_W + RUNOFF_Y;
    const RX0 = Math.max(X0, viewport.x0), RY0 = Math.max(Y0, viewport.y0), RX1 = Math.min(X1, viewport.x1), RY1 = Math.min(Y1, viewport.y1);
    if (RX1 <= RX0 || RY1 <= RY0) return;
    if (!this.bg) this.bake(ctx);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
    const blit = (img: HTMLCanvasElement): void => {
      const kx = img.width / (X1 - X0), ky = img.height / (Y1 - Y0);
      ctx.drawImage(img, (RX0 - X0) * kx, (RY0 - Y0) * ky, (RX1 - RX0) * kx, (RY1 - RY0) * ky, RX0, RY0, RX1 - RX0, RY1 - RY0);
    };
    blit(this.bg!);
    if (this.wearCanvas) blit(this.wearCanvas);
    if (this.wet) {
      // wet sheen: faint glints that drift slowly
      ctx.save(); ctx.beginPath(); ctx.rect(X0, Y0, X1 - X0, Y1 - Y0); ctx.clip();
      ctx.globalAlpha = 0.07; ctx.fillStyle = '#cfe8ff';
      for (let i = 0; i < 18; i++) { const bx = X0 + ((i * 37.3 + time * 0.8) % (X1 - X0)), by = Y0 + ((i * 17.9) % (Y1 - Y0)); ctx.fillRect(bx, by, 5, 0.25); }
      ctx.restore(); ctx.globalAlpha = 1;
    }

    // markings
    const lw = Math.max(0.13, 1.5 / scale);
    ctx.strokeStyle = pal.line; ctx.lineWidth = lw; ctx.globalAlpha = this.snow ? 0.55 : 0.93; ctx.lineJoin = 'miter';
    const hL = HALF_L, hW = HALF_W;
    ctx.strokeRect(-hL, -hW, hL * 2, hW * 2);
    ctx.beginPath(); ctx.moveTo(0, -hW); ctx.lineTo(0, hW); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, CENTER_R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = pal.line; ctx.beginPath(); ctx.arc(0, 0, 0.26, 0, Math.PI * 2); ctx.fill();
    for (const s of [-1, 1]) {
      const gx = s * hL;
      ctx.strokeRect(s > 0 ? gx - BOX_L : gx, -BOX_W / 2, BOX_L, BOX_W);
      ctx.strokeRect(s > 0 ? gx - SIX_L : gx, -SIX_W / 2, SIX_L, SIX_W);
      const sx = gx - s * PEN_SPOT;
      ctx.beginPath(); ctx.arc(sx, 0, 0.24, 0, Math.PI * 2); ctx.fill();
      // penalty arc outside the box
      const dx = BOX_L - PEN_SPOT; const a = Math.acos(dx / CENTER_R);
      ctx.beginPath(); ctx.arc(sx, 0, CENTER_R, s > 0 ? Math.PI - a : -a, s > 0 ? Math.PI + a : a); ctx.stroke();
    }
    // corner arcs
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const a0 = sx < 0 ? (sy < 0 ? 0 : Math.PI * 1.5) : (sy < 0 ? Math.PI * 0.5 : Math.PI);
      ctx.beginPath(); ctx.arc(sx * hL, sy * hW, 1, a0, a0 + Math.PI / 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (this.snow) this.drawSnow(ctx, X0, Y0, X1, Y1, scale, viewport);
  }

  private drawSnow(ctx: CanvasRenderingContext2D, X0: number, Y0: number, X1: number, Y1: number, scale: number, viewport: { x0: number; y0: number; x1: number; y1: number }): void {
    if (!this.snowNoise) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d')!;
      const rng = new RNG('snow');
      g.fillStyle = 'rgba(240,246,255,0.5)'; g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 700; i++) { g.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.35)' : 'rgba(180,200,225,0.25)'; g.fillRect(rng.float(0, 128), rng.float(0, 128), rng.float(1, 3), rng.float(1, 3)); }
      this.snowNoise = ctx.createPattern(c, 'repeat'); this.snowNoise?.setTransform(new DOMMatrix().scale(1 / 30));
    }
    if (this.snowNoise && scale > 3) { ctx.fillStyle = this.snowNoise; ctx.fillRect(Math.max(X0, viewport.x0), Math.max(Y0, viewport.y0), Math.min(X1, viewport.x1) - Math.max(X0, viewport.x0), Math.min(Y1, viewport.y1) - Math.max(Y0, viewport.y0)); }
  }

  /** Flushes accumulated wear (cheap: the canvas is drawn directly, so nothing to upload). */
  flush(): void { this.wearDirty = false; }

  /** Goals: frame, net mesh with impulse ripples. Drawn above the pitch, below players. */
  drawGoals(ctx: CanvasRenderingContext2D, scale: number, ball: { x: number; y: number; z: number }, night: boolean): void {
    const lw = Math.max(0.05, 1.2 / scale);
    for (const s of [-1, 1] as const) {
      const gx = s * HALF_L, back = gx + s * GOAL_DEPTH;
      // net depth shading
      const gr = ctx.createLinearGradient(gx, 0, back, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.38)');
      ctx.fillStyle = gr; ctx.fillRect(Math.min(gx, back), -HALF_GOAL, GOAL_DEPTH, HALF_GOAL * 2);
      // mesh
      ctx.strokeStyle = night ? 'rgba(235,242,255,0.5)' : 'rgba(255,255,255,0.62)'; ctx.lineWidth = lw * 0.55;
      const step = 0.4;
      const disp = (px: number, py: number): [number, number] => {
        let ox = 0, oy = 0;
        for (const n of this.net) {
          if (n.goal !== s) continue;
          const d = Math.hypot(px - n.x, py - n.y);
          const w = Math.exp(-d * d / 2.2) * n.power * Math.exp(-n.t * 2.6) * Math.cos(n.t * 16);
          ox += s * w * 0.9; oy += (py - n.y) * 0.0 + (n.y > 0 ? -1 : 1) * 0 + 0 * w;
        }
        // ball pushing the net while inside it
        if (Math.abs(ball.x) > HALF_L && Math.sign(ball.x) === s) {
          const d = Math.hypot(px - ball.x, py - ball.y);
          const w = Math.exp(-d * d / 1.6) * 0.5;
          ox += s * w * 0.3 * 0; oy += (ball.y - py) * w * 0.35;
        }
        return [px + ox, py + oy];
      };
      ctx.beginPath();
      for (let y = -HALF_GOAL; y <= HALF_GOAL + 0.001; y += step) {
        for (let i = 0; i <= 5; i++) { const px = gx + s * GOAL_DEPTH * (i / 5); const [dx, dy] = disp(px, y); if (i === 0) ctx.moveTo(dx, dy); else ctx.lineTo(dx, dy); }
      }
      for (let i = 1; i <= 5; i++) {
        const px = gx + s * GOAL_DEPTH * (i / 5);
        for (let k = 0; k <= 10; k++) { const py = -HALF_GOAL + HALF_GOAL * 2 * (k / 10); const [dx, dy] = disp(px, py); if (k === 0) ctx.moveTo(dx, dy); else ctx.lineTo(dx, dy); }
      }
      ctx.stroke();
      // frame (posts + crossbar + back stanchions)
      ctx.strokeStyle = '#f2f4f7'; ctx.lineWidth = lw * 1.7; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(back, -HALF_GOAL); ctx.lineTo(gx, -HALF_GOAL); ctx.lineTo(gx, HALF_GOAL); ctx.lineTo(back, HALF_GOAL); ctx.stroke();
      ctx.lineWidth = lw * 1.1; ctx.strokeStyle = 'rgba(240,244,250,0.7)'; ctx.beginPath(); ctx.moveTo(back, -HALF_GOAL); ctx.lineTo(back, HALF_GOAL); ctx.stroke();
      // posts
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(10,14,20,0.55)'; ctx.lineWidth = lw * 0.6;
      for (const py of [-HALF_GOAL, HALF_GOAL]) { ctx.beginPath(); ctx.arc(gx, py, 0.13, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
  }

  drawFlags(ctx: CanvasRenderingContext2D, time: number, scale: number): void {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x = sx * HALF_L, y = sy * HALF_W;
      const wave = Math.sin(time * 3 + sx * 2 + sy) * 0.18;
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(x + 0.12, y + 0.15, 0.2, 0.12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f5c518'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - sx * (0.85 + wave), y + sy * (0.1 + wave * 0.5)); ctx.lineTo(x - sx * (0.7 - wave), y - sy * 0.42 + wave * 0.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.arc(x, y, 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = Math.max(0.02, 0.8 / scale); ctx.stroke();
    }
  }
}
