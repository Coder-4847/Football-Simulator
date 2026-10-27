import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Vector3, LineSegments, LineBasicMaterial,
} from 'three';
import { createCanvas } from '../animation/rig';
import { BOX_L, BOX_W, CENTER_R, GOAL_DEPTH, GOAL_H, GOAL_W, HALF_GOAL, HALF_L, HALF_W, PEN_SPOT, PITCH_L, PITCH_W, POST_R, SIX_L, SIX_W } from '../match/constants';
import { RNG } from '../core/rng';

export const MARGIN = 9; // run-off beyond the lines (m)

export interface PitchTextures {
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  bump: CanvasTexture;
  size: [number, number];
  /** pixels per metre */
  ppm: number;
}

/** Grass canvas covering the pitch + margin. Lines are painted into the same texture. */
export function makePitchTexture(res: number, snow: boolean, wet: boolean): PitchTextures {
  const totalW = PITCH_L + MARGIN * 2, totalH = PITCH_W + MARGIN * 2;
  const W = res, H = Math.round((res * totalH) / totalW);
  const ppm = W / totalW;
  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d')!;
  const rng = new RNG('pitch');
  // base mow stripes (across the length, every 5.25 m)
  const dark = wet ? '#27602a' : '#2c7a2c', light = wet ? '#2f6e30' : '#388c34';
  const stripe = PITCH_L / 20;
  for (let i = -2; i < 24; i++) {
    g.fillStyle = i % 2 === 0 ? dark : light;
    g.fillRect(((i * stripe) + MARGIN - stripe * 2 + stripe * 2 - 0) * ppm - 0, 0, stripe * ppm + 1, H);
  }
  // run-off area slightly different, darker
  g.fillStyle = 'rgba(10,40,10,0.25)';
  g.fillRect(0, 0, W, MARGIN * ppm); g.fillRect(0, H - MARGIN * ppm, W, MARGIN * ppm);
  g.fillRect(0, 0, MARGIN * ppm, H); g.fillRect(W - MARGIN * ppm, 0, MARGIN * ppm, H);
  // grass grain
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * 22;
    d[i] = Math.max(0, Math.min(255, d[i]! + n * 0.6));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n * 0.5));
  }
  g.putImageData(img, 0, 0);
  // lines
  const lw = Math.max(2, 0.12 * ppm);
  g.strokeStyle = snow ? '#e8eef2' : '#f2f5ef'; g.lineWidth = lw; g.lineCap = 'butt';
  const X = (x: number): number => (x + HALF_L + MARGIN) * ppm;
  const Y = (y: number): number => (y + HALF_W + MARGIN) * ppm;
  g.strokeRect(X(-HALF_L), Y(-HALF_W), PITCH_L * ppm, PITCH_W * ppm);
  g.beginPath(); g.moveTo(X(0), Y(-HALF_W)); g.lineTo(X(0), Y(HALF_W)); g.stroke();
  g.beginPath(); g.arc(X(0), Y(0), CENTER_R * ppm, 0, Math.PI * 2); g.stroke();
  g.fillStyle = g.strokeStyle;
  const dot = (x: number, y: number): void => { g.beginPath(); g.arc(X(x), Y(y), 0.22 * ppm, 0, Math.PI * 2); g.fill(); };
  dot(0, 0);
  for (const s of [-1, 1]) {
    g.strokeRect(s > 0 ? X(HALF_L - BOX_L) : X(-HALF_L), Y(-BOX_W / 2), BOX_L * ppm, BOX_W * ppm);
    g.strokeRect(s > 0 ? X(HALF_L - SIX_L) : X(-HALF_L), Y(-SIX_W / 2), SIX_L * ppm, SIX_W * ppm);
    dot(s * (HALF_L - PEN_SPOT), 0);
    // penalty arc
    g.beginPath();
    const a = Math.acos((BOX_L - PEN_SPOT) / CENTER_R);
    const cx = s * (HALF_L - PEN_SPOT);
    if (s > 0) g.arc(X(cx), Y(0), CENTER_R * ppm, Math.PI - a, Math.PI + a); else g.arc(X(cx), Y(0), CENTER_R * ppm, -a, a);
    g.stroke();
    // corner arcs
    for (const t of [-1, 1]) {
      g.beginPath();
      const cxn = s * HALF_L, cyn = t * HALF_W;
      const start = s > 0 ? (t > 0 ? Math.PI : Math.PI * 1.5) : (t > 0 ? Math.PI * 0.5 : 0);
      g.arc(X(cxn), Y(cyn), 1 * ppm, start, start + Math.PI / 2);
      g.stroke();
    }
  }
  if (snow) { g.fillStyle = 'rgba(235,242,248,0.55)'; g.fillRect(0, 0, W, H); }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; texture.anisotropy = 8; texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter;

  // tiling bump for blade-level micro detail
  const bc = createCanvas(256, 256);
  const bg = bc.getContext('2d')!;
  const bi = bg.createImageData(256, 256);
  for (let i = 0; i < bi.data.length; i += 4) { const v = 110 + rng.next() * 90; bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = v; bi.data[i + 3] = 255; }
  bg.putImageData(bi, 0, 0);
  const bump = new CanvasTexture(bc);
  bump.wrapS = bump.wrapT = RepeatWrapping; bump.repeat.set(PITCH_L * 1.5, PITCH_W * 1.5);
  return { canvas, texture, bump, size: [W, H], ppm };
}

/** Adds wear marks (goalmouths, centre) to the pitch canvas. */
export function paintWear(pt: PitchTextures, x: number, y: number, strength: number): void {
  const g = pt.canvas.getContext('2d')!;
  const px = (x + HALF_L + MARGIN) * pt.ppm, py = (y + HALF_W + MARGIN) * pt.ppm;
  const r = 1.4 * pt.ppm;
  const grad = g.createRadialGradient(px, py, 0, px, py, r);
  grad.addColorStop(0, `rgba(96,84,52,${0.1 * strength})`);
  grad.addColorStop(1, 'rgba(96,84,52,0)');
  g.fillStyle = grad;
  g.fillRect(px - r, py - r, r * 2, r * 2);
}

export function buildGround(pt: PitchTextures, wet: boolean): Mesh {
  const geo = new PlaneGeometry(PITCH_L + MARGIN * 2, PITCH_W + MARGIN * 2, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new MeshStandardMaterial({ map: pt.texture, bumpMap: pt.bump, bumpScale: 0.6, roughness: wet ? 0.62 : 0.95, metalness: 0 });
  const m = new Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** Goal frame (posts + bar) and an animated net. */
export class GoalView {
  readonly group = new Group();
  private netGeo: BufferGeometry;
  private rest: Float32Array;
  private offs: Float32Array;
  private vel: Float32Array;
  private pos: BufferAttribute;
  private cols: number; private rows: number;
  private panels: Array<{ start: number; count: number }> = [];
  constructor(readonly sign: 1 | -1, netPhysics: boolean) {
    const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.1 });
    const post = (x: number, z: number): void => {
      const m = new Mesh(new CylinderGeometry(POST_R, POST_R, GOAL_H + POST_R, 12), mat);
      m.position.set(x, (GOAL_H + POST_R) / 2, z); m.castShadow = true; this.group.add(m);
    };
    post(0, -HALF_GOAL); post(0, HALF_GOAL);
    const bar = new Mesh(new CylinderGeometry(POST_R, POST_R, GOAL_W + POST_R * 2, 12), mat);
    bar.rotation.x = Math.PI / 2; bar.position.set(0, GOAL_H, 0); bar.castShadow = true; this.group.add(bar);
    // rear supports
    const D = GOAL_DEPTH;
    const supMat = new MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
    for (const z of [-HALF_GOAL, HALF_GOAL]) {
      const back = new Mesh(new CylinderGeometry(0.04, 0.04, GOAL_H * 0.9, 8), supMat); back.position.set(-D, GOAL_H * 0.45, z); this.group.add(back);
      const top = new Mesh(new CylinderGeometry(0.03, 0.03, D, 8), supMat); top.rotation.z = Math.PI / 2; top.position.set(-D / 2, GOAL_H, z); this.group.add(top);
      const bot = new Mesh(new CylinderGeometry(0.03, 0.03, D, 8), supMat); bot.rotation.z = Math.PI / 2; bot.position.set(-D / 2, 0.03, z); this.group.add(bot);
    }
    const backBar = new Mesh(new CylinderGeometry(0.03, 0.03, GOAL_W, 8), supMat); backBar.rotation.x = Math.PI / 2; backBar.position.set(-D, GOAL_H * 0.9, 0); this.group.add(backBar);

    // net: back panel + two side panels + top, as one line-segment-free mesh with an alpha mesh texture
    const cols = 16, rows = 9; this.cols = cols; this.rows = rows;
    const verts: number[] = []; const idx: number[] = []; const uvs: number[] = [];
    const addPanel = (fn: (u: number, v: number) => [number, number, number], su: number, sv: number): void => {
      const base = verts.length / 3;
      this.panels.push({ start: base, count: (cols + 1) * (rows + 1) });
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { const [x, y, z] = fn(i / cols, j / rows); verts.push(x, y, z); uvs.push((i / cols) * su, (j / rows) * sv); }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = base + j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    };
    addPanel((u, v) => [-D, v * GOAL_H, -HALF_GOAL + u * GOAL_W], 40, 22);                 // back
    addPanel((u, v) => [-u * D, v * GOAL_H * (1 - u * 0.1), -HALF_GOAL], 14, 22);            // side -z
    addPanel((u, v) => [-u * D, v * GOAL_H * (1 - u * 0.1), HALF_GOAL], 14, 22);             // side +z
    addPanel((u, v) => [-u * D, GOAL_H - u * GOAL_H * 0.1, -HALF_GOAL + v * GOAL_W], 14, 40); // top
    this.netGeo = new BufferGeometry();
    const arr = new Float32Array(verts);
    this.pos = new BufferAttribute(arr, 3);
    this.rest = new Float32Array(arr);
    this.offs = new Float32Array(arr.length); this.vel = new Float32Array(arr.length);
    this.netGeo.setAttribute('position', this.pos);
    this.netGeo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.netGeo.setIndex(idx);
    this.netGeo.computeVertexNormals();
    const nc = createCanvas(32, 32); const ng = nc.getContext('2d')!;
    ng.clearRect(0, 0, 32, 32); ng.strokeStyle = 'rgba(245,245,245,0.9)'; ng.lineWidth = 3; ng.strokeRect(0, 0, 32, 32);
    const nt = new CanvasTexture(nc); nt.wrapS = nt.wrapT = RepeatWrapping; nt.colorSpace = SRGBColorSpace;
    const netMat = new MeshBasicMaterial({ map: nt, transparent: true, side: DoubleSide, depthWrite: false, alphaTest: 0.2 });
    const net = new Mesh(this.netGeo, netMat);
    net.frustumCulled = false;
    this.group.add(net);
    // mirror: goal at +x opens towards -x; for the -x goal rotate by π
    this.group.position.x = sign * HALF_L;
    if (sign === -1) this.group.rotation.y = Math.PI;
    this.physics = netPhysics;
  }
  private physics: boolean;

  /** Push the net where the ball (in world coords) is hitting it. */
  impulse(world: Vector3, speed: number): void {
    if (!this.physics) return;
    const local = this.group.worldToLocal(world.clone());
    const amp = Math.min(0.9, speed * 0.04);
    for (let i = 0; i < this.rest.length; i += 3) {
      const dx = this.rest[i]! - local.x, dy = this.rest[i + 1]! - local.y, dz = this.rest[i + 2]! - local.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1.6) {
        const f = (1 - d / 1.6) * amp;
        // outward (away from the pitch) along -x for back, lateral/top handled by the surface normal approx
        this.vel[i] += -f * 6;
        this.vel[i + 1] += (this.rest[i + 1]! > GOAL_H * 0.9 ? f * 2 : 0);
      }
    }
  }

  update(dt: number): void {
    if (!this.physics) return;
    let moving = false;
    const k = 55, damp = 5.5;
    for (let i = 0; i < this.offs.length; i++) {
      const a = -k * this.offs[i]! - damp * this.vel[i]!;
      this.vel[i] += a * dt; this.offs[i] += this.vel[i]! * dt;
      if (Math.abs(this.offs[i]!) > 1e-4 || Math.abs(this.vel[i]!) > 1e-3) moving = true;
      this.pos.array[i] = this.rest[i]! + this.offs[i]!;
    }
    if (moving) this.pos.needsUpdate = true;
  }
}

/** Corner flags + mowed-in markings handled by texture. */
export function buildCornerFlags(): Group {
  const g = new Group();
  const pole = new MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 });
  const flag = new MeshBasicMaterial({ color: 0xf7d046, side: DoubleSide });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = new Mesh(new CylinderGeometry(0.02, 0.02, 1.6, 8), pole);
    p.position.set(sx * HALF_L, 0.8, sz * HALF_W); p.castShadow = true; g.add(p);
    const f = new Mesh(new PlaneGeometry(0.4, 0.3), flag);
    f.position.set(sx * HALF_L - sx * 0.2, 1.45, sz * HALF_W); f.rotation.y = Math.PI / 2 * 0; g.add(f);
  }
  return g;
}

export function buildLineHelper(): LineSegments {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
  return new LineSegments(geo, new LineBasicMaterial({ color: 0xffffff }));
}

export { BoxGeometry };
