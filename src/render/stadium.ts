import { RNG } from '../core/rng';
import { HALF_L, HALF_W } from '../match/constants';
import { RUNOFF_X, RUNOFF_Y } from './pitch';

type Side = 'N' | 'S' | 'E' | 'W';
type RoofType = 'none' | 'partial' | 'cantilever' | 'ring' | 'flat';

interface StandSpec { depth: number; gap: number }

export interface StadiumStyle {
  name: string;
  stands: Record<Side, StandSpec | null>;
  seatA: string; seatB: string; concrete: string; roofColor: string; apron: string;
  roof: RoofType;
  cornerFill: boolean;
  track: boolean;
  led: boolean;
  masts: 'corner' | 'roof' | 'none';
  /** grass bank instead of seating on the null sides */
  bank: boolean;
}

const S = (depth: number, gap = 4.5): StandSpec => ({ depth, gap });

export const STADIUM_STYLES: StadiumStyle[] = [
  { name: 'Foundry Park', stands: { N: S(15), S: S(17), E: S(12, 5), W: S(12, 5) }, seatA: '#1d4ed8', seatB: '#e5e7eb', concrete: '#8b93a0', roofColor: '#c8d2de', apron: '#6c7380', roof: 'cantilever', cornerFill: false, track: false, led: true, masts: 'corner', bank: false },
  { name: 'Meridian Arena', stands: { N: S(19, 4), S: S(19, 4), E: S(17, 4), W: S(17, 4) }, seatA: '#b91c1c', seatB: '#1f2937', concrete: '#a7afbb', roofColor: '#eef2f7', apron: '#7b8390', roof: 'ring', cornerFill: true, track: false, led: true, masts: 'roof', bank: false },
  { name: 'Harbour Ground', stands: { N: S(13), S: S(19, 4), E: S(8, 6), W: S(8, 6) }, seatA: '#0f766e', seatB: '#fbbf24', concrete: '#9a9388', roofColor: '#6f6a64', apron: '#76706a', roof: 'flat', cornerFill: false, track: false, led: true, masts: 'corner', bank: false },
  { name: 'Lantern Stadium', stands: { N: S(16), S: S(16), E: S(14, 5), W: S(14, 5) }, seatA: '#7c3aed', seatB: '#f1f5f9', concrete: '#8d98ac', roofColor: '#dfe6f0', apron: '#6e778a', roof: 'ring', cornerFill: true, track: false, led: true, masts: 'roof', bank: false },
  { name: 'Old Citadel', stands: { N: S(9, 7), S: S(10, 7), E: S(8, 8), W: S(8, 8) }, seatA: '#374151', seatB: '#9ca3af', concrete: '#7b746c', roofColor: '#4b4743', apron: '#b0463b', roof: 'partial', cornerFill: true, track: true, led: false, masts: 'corner', bank: false },
  { name: 'Hillside Park', stands: { N: S(15), S: null, E: S(10, 5), W: S(10, 5) }, seatA: '#ea580c', seatB: '#1f2937', concrete: '#98a0aa', roofColor: '#aab1ba', apron: '#6f7782', roof: 'flat', cornerFill: false, track: false, led: true, masts: 'corner', bank: true },
  { name: 'Skyline Bowl', stands: { N: S(22, 3.5), S: S(22, 3.5), E: S(19, 3.5), W: S(19, 3.5) }, seatA: '#0369a1', seatB: '#f8fafc', concrete: '#c0cad6', roofColor: '#eef2f6', apron: '#8591a0', roof: 'ring', cornerFill: true, track: false, led: true, masts: 'roof', bank: false },
  { name: 'Anvil Road', stands: { N: S(11, 4), S: S(12, 4), E: S(9, 4), W: S(9, 4) }, seatA: '#be123c', seatB: '#fde68a', concrete: '#8f8f98', roofColor: '#6b7280', apron: '#6b6b74', roof: 'cantilever', cornerFill: true, track: false, led: true, masts: 'corner', bank: false },
];

const SPONSORS: Array<[string, string, string]> = [
  ['VELOCITY', '#c81e3a', '#ffffff'], ['NORTHBEAM', '#0b3d91', '#ffd23f'], ['AXIOM', '#111827', '#38bdf8'], ['HALCYON', '#0f766e', '#ffffff'], ['ZENITH', '#7c3aed', '#fde68a'],
  ['QUARTZ BANK', '#1e293b', '#e2e8f0'], ['TERRA FOODS', '#15803d', '#fef9c3'], ['LUMEN AIR', '#0369a1', '#ffffff'], ['KESTREL', '#b45309', '#ffffff'], ['ORBIT', '#be185d', '#ffffff'],
  ['MERIDIAN', '#1d4ed8', '#fef08a'], ['PIONEER', '#334155', '#f97316'],
];

/** Where the camera is allowed to roam and how far the pre-rendered world extends. */
export interface StadiumExtent { x0: number; y0: number; x1: number; y1: number }

export const BOARD_X = HALF_L + RUNOFF_X;    // inner edge of the end boards
export const BOARD_Y = HALF_W + RUNOFF_Y;    // inner edge of the side boards
const BOARD_T = 0.85;

interface Section { side: Side; x0: number; y0: number; x1: number; y1: number; layer: HTMLCanvasElement | null; bounceAmp: number; phase: number; roofFrac: number }

export interface StadiumView {
  extent: StadiumExtent;
  ground: HTMLCanvasElement;
  sections: Section[];
  style: StadiumStyle;
  masts: Array<{ x: number; y: number }>;
  ppm: number;
  boardSets: HTMLCanvasElement[][];
  dispose(): void;
}

interface BuildOpts { night: boolean; crowd: number; detail: number; home: { primary: string; secondary: string }; away: { primary: string; secondary: string }; seed: string }

function secExtent(style: StadiumStyle): StadiumExtent {
  const e = style.stands.E, w = style.stands.W, n = style.stands.N, s = style.stands.S;
  const ex = Math.max(e ? BOARD_X + BOARD_T + e.gap + e.depth : BOARD_X + 8, w ? BOARD_X + BOARD_T + w.gap + w.depth : BOARD_X + 8);
  const ey = Math.max(n ? BOARD_Y + BOARD_T + n.gap + n.depth : BOARD_Y + 8, s ? BOARD_Y + BOARD_T + s.gap + s.depth : BOARD_Y + 8);
  return { x0: -ex - 4, y0: -ey - 4, x1: ex + 4, y1: ey + 4 };
}

export function buildStadium(styleIdx: number, o: BuildOpts): StadiumView {
  const style = STADIUM_STYLES[((styleIdx % STADIUM_STYLES.length) + STADIUM_STYLES.length) % STADIUM_STYLES.length]!;
  const rng = new RNG(o.seed + ':stadium');
  const ext = secExtent(style);
  const ppm = o.detail;
  const W = Math.ceil((ext.x1 - ext.x0) * ppm), H = Math.ceil((ext.y1 - ext.y0) * ppm);
  const ground = document.createElement('canvas'); ground.width = W; ground.height = H;
  const g = ground.getContext('2d')!;
  g.setTransform(ppm, 0, 0, ppm, -ext.x0 * ppm, -ext.y0 * ppm);
  // background: outside the bowl
  const bg = g.createLinearGradient(0, ext.y0, 0, ext.y1);
  bg.addColorStop(0, o.night ? '#0a0d14' : '#59606b'); bg.addColorStop(1, o.night ? '#0a0d14' : '#4a505a');
  g.fillStyle = bg; g.fillRect(ext.x0, ext.y0, ext.x1 - ext.x0, ext.y1 - ext.y0);

  // apron / running track around the pitch (inside the stands)
  const apronX0 = ext.x0 + 2, apronY0 = ext.y0 + 2;
  const innerX = BOARD_X + BOARD_T, innerY = BOARD_Y + BOARD_T;
  const gapMax = 9;
  g.fillStyle = style.apron;
  g.fillRect(-innerX - gapMax, -innerY - gapMax, (innerX + gapMax) * 2, (innerY + gapMax) * 2);
  if (style.track) {
    // 400 m style track: lanes around the pitch
    g.strokeStyle = '#c4523f'; g.lineWidth = 7; g.strokeRect(-innerX - 4, -innerY - 4, (innerX + 4) * 2, (innerY + 4) * 2);
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 0.1;
    for (let i = 0; i <= 6; i++) { const d = 0.5 + i * 1.0; g.strokeRect(-innerX - 0.5 - d, -innerY - 0.5 - d, (innerX + 0.5 + d) * 2, (innerY + 0.5 + d) * 2); }
  }
  void apronX0; void apronY0;

  // stands
  const sections: Section[] = [];
  const spec = style.stands;
  const outerE = spec.E ? innerX + spec.E.gap + spec.E.depth : innerX + 8, outerW = spec.W ? innerX + spec.W.gap + spec.W.depth : innerX + 8;
  const outerN = spec.N ? innerY + spec.N.gap + spec.N.depth : innerY + 8, outerS = spec.S ? innerY + spec.S.gap + spec.S.depth : innerY + 8;
  const mk = (side: Side, x0: number, y0: number, x1: number, y1: number, roofFrac: number): void => { sections.push({ side, x0, y0, x1, y1, layer: null, bounceAmp: 0, phase: rng.float(0, 6.28), roofFrac }); };
  const roofFrac = style.roof === 'ring' ? 0.8 : style.roof === 'cantilever' ? 0.62 : style.roof === 'flat' ? 0.72 : style.roof === 'partial' ? 0.5 : 0;
  if (spec.N) mk('N', style.cornerFill ? -outerW : -innerX, -outerN, style.cornerFill ? outerE : innerX, -(innerY + spec.N.gap), style.roof === 'partial' ? 0 : roofFrac);
  if (spec.S) mk('S', style.cornerFill ? -outerW : -innerX, innerY + spec.S.gap, style.cornerFill ? outerE : innerX, outerS, roofFrac);
  if (spec.E) mk('E', innerX + spec.E.gap, style.cornerFill ? -(innerY + (spec.N?.gap ?? 4) + (spec.N?.depth ?? 0)) : -innerY, outerE, style.cornerFill ? innerY + (spec.S?.gap ?? 4) + (spec.S?.depth ?? 0) : innerY, style.roof === 'partial' ? 0 : roofFrac);
  if (spec.W) mk('W', -outerW, style.cornerFill ? -(innerY + (spec.N?.gap ?? 4) + (spec.N?.depth ?? 0)) : -innerY, -(innerX + spec.W.gap), style.cornerFill ? innerY + (spec.S?.gap ?? 4) + (spec.S?.depth ?? 0) : innerY, roofFrac);
  // E/W sections overlap N/S in corners when cornerFill: shrink E/W to the span between the N/S stands
  for (const sec of sections) {
    if (!style.cornerFill) continue;
    if (sec.side === 'E' || sec.side === 'W') { sec.y0 = -(innerY + (spec.N?.gap ?? 0) + 0); sec.y1 = innerY + (spec.S?.gap ?? 0) + 0; }
  }

  const homeCol = o.home.primary, awayCol = o.away.primary;
  const palette = ['#cfd8e3', '#e6e6e6', '#2b3a55', '#b04a3a', '#d9a441', '#3f7f5d', '#7a5aa6', '#9aa6b5', '#e8c9a3'];
  const skins = ['#f1c9a5', '#e0ac82', '#c68642', '#a96f43', '#7a4a2b'];

  for (const sec of sections) {
    const horizontal = sec.side === 'N' || sec.side === 'S';
    const w = sec.x1 - sec.x0, h = sec.y1 - sec.y0;
    // concrete floor under the section
    g.fillStyle = style.concrete; g.fillRect(sec.x0, sec.y0, w, h);
    // seat bands: rows run parallel to the pitch edge; rows nearer the pitch are lower
    const rowH = 0.82;
    const depth = horizontal ? h : w;
    const rows = Math.floor(depth / rowH);
    const layer = document.createElement('canvas'); layer.width = Math.ceil(w * ppm); layer.height = Math.ceil(h * ppm);
    const c = layer.getContext('2d')!;
    c.setTransform(ppm, 0, 0, ppm, -sec.x0 * ppm, -sec.y0 * ppm);
    sec.layer = layer;
    const sectionW = 13;                      // seating block width along the stand
    const len = horizontal ? w : h;
    const crowdDensity = Math.max(0.25, Math.min(1, o.crowd * (0.82 + rng.float(0, 0.16))));
    const home = sec.side === 'W' ? 0.78 : sec.side === 'E' ? 0.1 : 0.4;
    const away = sec.side === 'E' ? 0.62 : sec.side === 'W' ? 0.06 : 0.2;
    for (let r = 0; r < rows; r++) {
      // the row nearest the pitch is index 0
      const off = (r + 0.5) * rowH;
      const tier = Math.floor(r / 11);
      // draw the row's seats in blocks
      const alongStart = horizontal ? sec.x0 : sec.y0;
      for (let b = 0; b * sectionW < len; b++) {
        const a0 = alongStart + b * sectionW, a1 = Math.min(alongStart + len, a0 + sectionW);
        const blockCol = (r % 7 === 3 && (b + tier) % 2 === 0) ? style.seatB : style.seatA;
        // seat band
        c.fillStyle = blockCol;
        const poss = (a: number, d: number): [number, number] => horizontal ? [a, sec.side === 'N' ? sec.y1 - d : sec.y0 + d] : [sec.side === 'W' ? sec.x1 - d : sec.x0 + d, a];
        const [bx, by] = poss(a0 + 0.1, off);
        if (horizontal) c.fillRect(bx, by - rowH * 0.44, a1 - a0 - 0.2, rowH * 0.88); else c.fillRect(bx - rowH * 0.44, by, rowH * 0.88, a1 - a0 - 0.2);
        // riser shade
        c.fillStyle = 'rgba(0,0,0,0.2)';
        if (horizontal) c.fillRect(bx, by + (sec.side === 'N' ? -rowH * 0.44 : rowH * 0.36), a1 - a0 - 0.2, rowH * 0.08); else c.fillRect(bx + (sec.side === 'W' ? -rowH * 0.44 : rowH * 0.36), by, rowH * 0.08, a1 - a0 - 0.2);
        // fans
        const spacing = 0.52;
        for (let a = a0 + 0.35; a < a1 - 0.25; a += spacing) {
          if (rng.next() > crowdDensity) continue;
          const roll = rng.next();
          const col = roll < home ? homeCol : roll < home + away ? awayCol : palette[rng.int(0, palette.length - 1)]!;
          const [fx, fy] = poss(a + rng.float(-0.04, 0.04), off + rng.float(-0.05, 0.05));
          // shoulders
          c.fillStyle = col;
          c.beginPath(); if (horizontal) c.ellipse(fx, fy, 0.27, 0.17, 0, 0, Math.PI * 2); else c.ellipse(fx, fy, 0.17, 0.27, 0, 0, Math.PI * 2); c.fill();
          // head
          const hairy = rng.chance(0.62);
          c.fillStyle = hairy ? (rng.chance(0.5) ? '#17120e' : rng.chance(0.5) ? '#4a2f1a' : '#a77a3f') : skins[rng.int(0, skins.length - 1)]!;
          const hx = fx + (horizontal ? 0 : (sec.side === 'W' ? 0.07 : -0.07)), hy = fy + (horizontal ? (sec.side === 'N' ? 0.07 : -0.07) : 0);
          c.beginPath(); c.arc(hx, hy, hairy ? 0.125 : 0.115, 0, Math.PI * 2); c.fill();
          if (hairy) { c.fillStyle = skins[rng.int(0, skins.length - 1)]!; c.beginPath(); c.arc(hx + (horizontal ? 0 : (sec.side === 'W' ? 0.07 : -0.07)), hy + (horizontal ? (sec.side === 'N' ? 0.07 : -0.07) : 0), 0.06, 0, Math.PI * 2); c.fill(); }
          if (rng.chance(0.05)) { c.fillStyle = col; c.fillRect(fx - 0.16, fy - 0.16, 0.32, 0.12); }  // scarf held up
        }
      }
      // aisle lines
      if (r % 1 === 0) {
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.07;
        for (let b = 0; b * sectionW < len; b++) {
          const a = alongStart + b * sectionW;
          c.beginPath(); if (horizontal) { const y = sec.side === 'N' ? sec.y1 - off : sec.y0 + off; c.moveTo(a, y - rowH / 2); c.lineTo(a, y + rowH / 2); } else { const x = sec.side === 'W' ? sec.x1 - off : sec.x0 + off; c.moveTo(x - rowH / 2, a); c.lineTo(x + rowH / 2, a); } c.stroke();
        }
      }
    }
    // front wall and vomitory shading
    c.fillStyle = 'rgba(0,0,0,0.3)';
    if (horizontal) { c.fillRect(sec.x0, sec.side === 'N' ? sec.y1 - 0.4 : sec.y0, w, 0.4); } else { c.fillRect(sec.side === 'W' ? sec.x1 - 0.4 : sec.x0, sec.y0, 0.4, h); }
    // keep layer pixels only (the fan layer carries the seats too so the bounce moves everything together)
    // remove from ground so the seats are not drawn twice
    g.fillStyle = style.concrete; g.fillRect(sec.x0, sec.y0, w, h);
  }

  // grass banks for missing stands
  if (style.bank) {
    for (const sd of ['N', 'S', 'E', 'W'] as Side[]) {
      if (spec[sd]) continue;
      const horizontal = sd === 'N' || sd === 'S';
      const gr = horizontal ? g.createLinearGradient(0, sd === 'N' ? -innerY : innerY, 0, sd === 'N' ? -innerY - 18 : innerY + 18) : g.createLinearGradient(sd === 'W' ? -innerX : innerX, 0, sd === 'W' ? -innerX - 18 : innerX + 18, 0);
      gr.addColorStop(0, '#2c6b34'); gr.addColorStop(1, '#1d4a24');
      g.fillStyle = gr;
      if (horizontal) g.fillRect(-innerX - 10, sd === 'N' ? -innerY - 18 : innerY, (innerX + 10) * 2, 18); else g.fillRect(sd === 'W' ? -innerX - 18 : innerX, -innerY, 18, innerY * 2);
    }
  }

  // floodlight masts
  const masts: Array<{ x: number; y: number }> = [];
  if (style.masts === 'corner') for (const sx of [-1, 1]) for (const sy of [-1, 1]) masts.push({ x: sx * (BOARD_X + 8), y: sy * (BOARD_Y + 7) });
  else if (style.masts === 'roof') for (const sx of [-1, 1]) for (const sy of [-1, 1]) masts.push({ x: sx * (BOARD_X * 0.55), y: sy * (BOARD_Y + 7) });
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (const m of masts) { g.beginPath(); g.ellipse(m.x, m.y, 0.9, 0.9, 0, 0, Math.PI * 2); g.fill(); }

  // photographers behind the goals, ball-boy seats
  const camGroups: Array<[number, number, number]> = [[-1, 0, 1], [1, 0, 1]];
  for (const [sx] of camGroups) for (let i = -6; i <= 6; i++) { g.fillStyle = '#1f2937'; g.beginPath(); g.arc(sx * (BOARD_X + 1.6), i * 1.2, 0.3, 0, Math.PI * 2); g.fill(); g.fillStyle = '#111'; g.fillRect(sx * (BOARD_X + 1.6) - 0.12, i * 1.2 - 0.1, 0.4, 0.2); }

  // ad boards: three sponsor sets so they can cycle
  const boardSets: HTMLCanvasElement[][] = [];
  const bppm = Math.max(12, Math.min(18, o.detail * 1.4));
  for (let set = 0; set < 3; set++) {
    const row: HTMLCanvasElement[] = [];
    for (let sideIdx = 0; sideIdx < 4; sideIdx++) {
      const horiz = sideIdx < 2;
      const len = horiz ? (BOARD_X + BOARD_T) * 2 : (BOARD_Y + BOARD_T) * 2;
      const cv = document.createElement('canvas'); cv.width = Math.ceil(len * bppm); cv.height = Math.ceil(BOARD_T * bppm);
      const cx = cv.getContext('2d')!;
      const segL = 6;
      const n = Math.ceil(len / segL);
      for (let i = 0; i < n; i++) {
        const sp = SPONSORS[(i * 5 + set * 3 + sideIdx * 2) % SPONSORS.length]!;
        cx.fillStyle = sp[1]; cx.fillRect(i * segL * bppm, 0, segL * bppm, cv.height);
        cx.fillStyle = 'rgba(255,255,255,0.12)'; cx.fillRect(i * segL * bppm, 0, segL * bppm, cv.height * 0.35);
        cx.fillStyle = sp[2]; cx.font = `800 ${cv.height * 0.62}px system-ui, sans-serif`; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(sp[0], (i + 0.5) * segL * bppm, cv.height * 0.54);
        cx.fillStyle = 'rgba(0,0,0,0.5)'; cx.fillRect(i * segL * bppm, 0, 2, cv.height);
      }
      row.push(cv);
    }
    boardSets.push(row);
  }

  // technical areas + perimeter wall shadow
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(-innerX, -innerY - 0.6, innerX * 2, 0.6); g.fillRect(-innerX, innerY, innerX * 2, 0.6);

  const dispose = (): void => { ground.width = 0; for (const s of sections) if (s.layer) s.layer.width = 0; };
  return { extent: ext, ground, sections, style, masts, ppm, boardSets, dispose };
}

/** Draw `img` (covering world rect x0..x1,y0..y1) clipped to the visible world rectangle, so cost follows screen area. */
function drawClipped(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number, view: { x0: number; y0: number; x1: number; y1: number }, ox = 0, oy = 0): void {
  const vx0 = Math.max(x0, view.x0 - ox), vy0 = Math.max(y0, view.y0 - oy), vx1 = Math.min(x1, view.x1 - ox), vy1 = Math.min(y1, view.y1 - oy);
  if (vx1 <= vx0 || vy1 <= vy0) return;
  const kx = img.width / (x1 - x0), ky = img.height / (y1 - y0);
  ctx.drawImage(img, (vx0 - x0) * kx, (vy0 - y0) * ky, (vx1 - vx0) * kx, (vy1 - vy0) * ky, vx0 + ox, vy0 + oy, vx1 - vx0, vy1 - vy0);
}

/** Draw the pre-rendered ground layer (world transform active). */
export function drawStadiumGround(ctx: CanvasRenderingContext2D, st: StadiumView, view: { x0: number; y0: number; x1: number; y1: number }): void {
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
  drawClipped(ctx, st.ground, st.extent.x0, st.extent.y0, st.extent.x1, st.extent.y1, view);
}

/** Crowd layers with a jump animation driven by excitement. */
export function drawCrowd(ctx: CanvasRenderingContext2D, st: StadiumView, time: number, excite: number, view: { x0: number; y0: number; x1: number; y1: number }): void {
  for (const sec of st.sections) {
    if (!sec.layer) continue;
    if (sec.x1 < view.x0 || sec.x0 > view.x1 || sec.y1 < view.y0 || sec.y0 > view.y1) continue;
    const amp = excite * 0.2;
    const b = Math.sin(time * (8 + excite * 6) + sec.phase) * amp;
    const horizontal = sec.side === 'N' || sec.side === 'S';
    const dx = horizontal ? Math.sin(time * 3.1 + sec.phase) * amp * 0.5 : b, dy = horizontal ? b : Math.sin(time * 3.1 + sec.phase) * amp * 0.5;
    drawClipped(ctx, sec.layer, sec.x0, sec.y0, sec.x1, sec.y1, view, dx, dy);
  }
}

/** Roof canopy, drawn above the crowd. */
export function drawRoofs(ctx: CanvasRenderingContext2D, st: StadiumView, night: boolean): void {
  const style = st.style;
  if (style.roof === 'none') return;
  for (const sec of st.sections) {
    if (sec.roofFrac <= 0) continue;
    const horizontal = sec.side === 'N' || sec.side === 'S';
    const w = sec.x1 - sec.x0, h = sec.y1 - sec.y0;
    const f = sec.roofFrac;
    // roof covers the outer fraction of the stand
    let rx = sec.x0, ry = sec.y0, rw = w, rh = h;
    if (horizontal) { rh = h * f; ry = sec.side === 'N' ? sec.y0 : sec.y1 - rh; } else { rw = w * f; rx = sec.side === 'W' ? sec.x0 : sec.x1 - rw; }
    // soft shadow thrown toward the pitch
    const sh = 2.4;
    const gr = horizontal ? ctx.createLinearGradient(0, sec.side === 'N' ? ry + rh : ry, 0, sec.side === 'N' ? ry + rh + sh : ry - sh) : ctx.createLinearGradient(sec.side === 'W' ? rx + rw : rx, 0, sec.side === 'W' ? rx + rw + sh : rx - sh, 0);
    gr.addColorStop(0, night ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    if (horizontal) ctx.fillRect(rx, sec.side === 'N' ? ry + rh : ry - sh, rw, sh); else ctx.fillRect(sec.side === 'W' ? rx + rw : rx - sh, ry, sh, rh);
    // canopy: translucent so the crowd stays faintly visible
    ctx.fillStyle = style.roofColor; ctx.globalAlpha = style.roof === 'ring' ? 0.5 : 0.62;
    ctx.fillRect(rx, ry, rw, rh); ctx.globalAlpha = 1;
    // ribs
    ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 0.12;
    ctx.beginPath();
    if (horizontal) { for (let x = rx; x <= rx + rw; x += 6) { ctx.moveTo(x, ry); ctx.lineTo(x, ry + rh); } } else { for (let y = ry; y <= ry + rh; y += 6) { ctx.moveTo(rx, y); ctx.lineTo(rx + rw, y); } }
    ctx.stroke();
    // leading edge (steel truss)
    ctx.strokeStyle = 'rgba(20,24,32,0.55)'; ctx.lineWidth = 0.28;
    ctx.beginPath();
    if (horizontal) { const ey = sec.side === 'N' ? ry + rh : ry; ctx.moveTo(rx, ey); ctx.lineTo(rx + rw, ey); } else { const ex = sec.side === 'W' ? rx + rw : rx; ctx.moveTo(ex, ry); ctx.lineTo(ex, ry + rh); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 0.08;
    ctx.beginPath();
    if (horizontal) { const ey = sec.side === 'N' ? ry + rh - 0.2 : ry + 0.2; ctx.moveTo(rx, ey); ctx.lineTo(rx + rw, ey); } else { const ex = sec.side === 'W' ? rx + rw - 0.2 : rx + 0.2; ctx.moveTo(ex, ry); ctx.lineTo(ex, ry + rh); }
    ctx.stroke();
  }
}

/** Advertising boards around the pitch; `set` cycles sponsors; `fade` crossfades to the next set. */
export function drawBoards(ctx: CanvasRenderingContext2D, st: StadiumView, set: number, fade: number, ledText: string | null, time: number): void {
  const sets = st.boardSets;
  const cur = sets[set % sets.length]!, next = sets[(set + 1) % sets.length]!;
  const ix = BOARD_X + BOARD_T, iy = BOARD_Y + BOARD_T;
  const draw = (cv: HTMLCanvasElement, x: number, y: number, w: number, h: number, rot: number, alpha: number): void => {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot); ctx.drawImage(cv, 0, 0, w, h); ctx.restore();
  };
  const sides: Array<[number, number, number, number, number]> = [
    // index, x, y, length, rotation: N (top), S (bottom), W (left), E (right)
    [0, -ix, -iy, ix * 2, 0], [1, -ix, iy - BOARD_T, ix * 2, 0], [2, -ix + BOARD_T, -iy, iy * 2, Math.PI / 2], [3, ix, -iy, iy * 2, Math.PI / 2],
  ];
  for (const [i, x, y, len, rot] of sides) {
    draw(cur[i]!, x, y, len, BOARD_T, rot, 1);
    if (fade > 0) draw(next[i]!, x, y, len, BOARD_T, rot, fade);
  }
  // soft top highlight so the boards read as a raised strip
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(-ix, -iy, ix * 2, 0.1); ctx.fillRect(-ix, iy - 0.1, ix * 2, 0.1);
  if (ledText) {
    ctx.save(); ctx.font = '800 0.62px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#05080f'; ctx.fillRect(-13, iy - BOARD_T, 26, BOARD_T); ctx.fillRect(-13, -iy, 26, BOARD_T);
    ctx.fillStyle = '#ffd23f';
    const shift = Math.sin(time * 2) * 0.0;
    ctx.fillText(ledText, shift, iy - BOARD_T / 2 + 0.03); ctx.fillText(ledText, shift, -iy + BOARD_T / 2 + 0.03);
    ctx.restore();
  }
}
