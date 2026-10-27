import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CapsuleGeometry, Color, CylinderGeometry, DoubleSide, Group, InstancedBufferAttribute, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, SphereGeometry, SRGBColorSpace, SpotLight, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCanvas } from '../animation/rig';
import { HALF_L, HALF_W, PITCH_L } from '../match/constants';
import { RNG } from '../core/rng';

export type Side = 'N' | 'S' | 'E' | 'W';
export type RoofKind = 'none' | 'flat' | 'cantilever' | 'arch' | 'ring' | 'partial';

interface StandSpec { rows: number; rise: number; run: number; setback: number; tiers: 1 | 2 | 3; tierGap: number; lengthTrim: number }

export interface StadiumStyle {
  name: string;
  stands: Record<Side, StandSpec | null>;
  roof: RoofKind;
  seatA: string; seatB: string; concrete: string; roofColor: string;
  mast: 'corner' | 'roof' | 'none';
  cornerFill: boolean;
  bank?: Side; // grassy bank instead of seating
  jumbotron: boolean;
  tower?: Side;
}

const S = (rows: number, rise = 0.42, run = 0.82, setback = 7, tiers: 1 | 2 | 3 = 1, tierGap = 3, lengthTrim = 0): StandSpec => ({ rows, rise, run, setback, tiers, tierGap, lengthTrim });

export const STADIUM_STYLES: StadiumStyle[] = [
  { name: 'Foundry Park', stands: { N: S(26), S: S(30), E: S(22, 0.4, 0.8, 10), W: S(22, 0.4, 0.8, 10) }, roof: 'cantilever', seatA: '#1d4ed8', seatB: '#e5e7eb', concrete: '#9ca3af', roofColor: '#cbd5e1', mast: 'corner', cornerFill: false, jumbotron: true },
  { name: 'Meridian Arena', stands: { N: S(34, 0.45, 0.85, 7, 2, 4), S: S(34, 0.45, 0.85, 7, 2, 4), E: S(30, 0.45, 0.85, 10, 2, 4), W: S(30, 0.45, 0.85, 10, 2, 4) }, roof: 'ring', seatA: '#b91c1c', seatB: '#111827', concrete: '#d1d5db', roofColor: '#f8fafc', mast: 'roof', cornerFill: true, jumbotron: true },
  { name: 'Harbour Ground', stands: { N: S(24, 0.4, 0.8, 7), S: S(34, 0.45, 0.85, 7, 2, 3), E: S(10, 0.35, 0.8, 11), W: S(10, 0.35, 0.8, 11) }, roof: 'flat', seatA: '#0f766e', seatB: '#fbbf24', concrete: '#a8a29e', roofColor: '#57534e', mast: 'corner', cornerFill: false, jumbotron: true, tower: 'S' },
  { name: 'Lantern Stadium', stands: { N: S(30), S: S(30), E: S(26, 0.42, 0.82, 10), W: S(26, 0.42, 0.82, 10) }, roof: 'arch', seatA: '#7c3aed', seatB: '#f1f5f9', concrete: '#94a3b8', roofColor: '#e2e8f0', mast: 'roof', cornerFill: true, jumbotron: true },
  { name: 'Old Citadel', stands: { N: S(16, 0.36, 0.7, 5), S: S(18, 0.36, 0.7, 5), E: S(14, 0.34, 0.7, 7), W: S(14, 0.34, 0.7, 7) }, roof: 'partial', seatA: '#374151', seatB: '#9ca3af', concrete: '#78716c', roofColor: '#44403c', mast: 'corner', cornerFill: true, jumbotron: false, tower: 'N' },
  { name: 'Hillside Park', stands: { N: S(30), S: null, E: S(18, 0.38, 0.8, 10), W: S(18, 0.38, 0.8, 10) }, roof: 'flat', seatA: '#ea580c', seatB: '#1f2937', concrete: '#9ca3af', roofColor: '#9ca3af', mast: 'corner', cornerFill: false, bank: 'S', jumbotron: true },
  { name: 'Skyline Bowl', stands: { N: S(40, 0.46, 0.86, 8, 3, 3), S: S(40, 0.46, 0.86, 8, 3, 3), E: S(36, 0.46, 0.86, 11, 3, 3), W: S(36, 0.46, 0.86, 11, 3, 3) }, roof: 'ring', seatA: '#0369a1', seatB: '#f8fafc', concrete: '#cbd5e1', roofColor: '#e5e7eb', mast: 'roof', cornerFill: true, jumbotron: true },
  { name: 'Anvil Road', stands: { N: S(20, 0.38, 0.74, 6), S: S(22, 0.38, 0.74, 6), E: S(18, 0.36, 0.74, 8), W: S(18, 0.36, 0.74, 8) }, roof: 'cantilever', seatA: '#be123c', seatB: '#fde68a', concrete: '#a1a1aa', roofColor: '#6b7280', mast: 'corner', cornerFill: true, jumbotron: true },
];

export interface StadiumView {
  group: Group;
  crowdUniform: { value: number };
  timeUniform: { value: number };
  lights: SpotLight[];
  floodMeshes: Mesh[];
  boards: { tex: CanvasTexture; draw: (t: number) => void };
  jumbotron: { tex: CanvasTexture; ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement } | null;
  dispose(): void;
}

const SPONSORS = ['AXIOM', 'NORTHBEAM', 'VELOCITY', 'QUARTZ BANK', 'LUMEN AIR', 'HALCYON', 'TERRA FOODS', 'ZENITH', 'ORBITAL TELECOM', 'PINEWOOD', 'KESTREL', 'MARLOW & CO', 'ATLAS TYRES', 'BLUEFIN'];

function seatTexture(a: string, b: string): CanvasTexture {
  const c = createCanvas(128, 64); const g = c.getContext('2d')!;
  g.fillStyle = a; g.fillRect(0, 0, 128, 64);
  g.fillStyle = b; for (let i = 0; i < 8; i++) { if ((i * 7) % 5 < 2) g.fillRect(i * 16, 0, 16, 64); }
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < 8; i++) { g.fillRect(i * 16, 0, 2, 64); g.fillRect(i * 16 + 3, 40, 10, 24); }
  g.fillStyle = 'rgba(255,255,255,0.12)'; for (let i = 0; i < 8; i++) g.fillRect(i * 16 + 3, 4, 10, 30);
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function scaleUV(g: BufferGeometry, su: number, sv: number): void {
  const uv = g.getAttribute('uv') as BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

interface Row { cx: number; cy: number; cz: number; len: number; yaw: number; y: number; faceX: number; faceZ: number; stand: Side; tier: number }

export function buildStadium(styleIndex: number, opts: { crowd: number; home: { primary: string; secondary: string }; away: { primary: string; secondary: string }; night: boolean; seed: string; capacity: number }): StadiumView {
  const style = STADIUM_STYLES[styleIndex % STADIUM_STYLES.length]!;
  const rng = new RNG(`stadium:${opts.seed}`);
  const group = new Group();
  const crowdUniform = { value: 0.25 };
  const timeUniform = { value: 0 };
  const rowsOut: Row[] = [];
  const concrete = new Color(style.concrete);
  const structGeos: BufferGeometry[] = [];
  const seatGeos: BufferGeometry[] = [];

  const pushBox = (list: BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, yaw: number, su = 1, sv = 1): void => {
    const g = new BoxGeometry(w, h, d);
    scaleUV(g, su, sv);
    g.rotateY(yaw); g.translate(x, y, z);
    list.push(g);
  };

  const sides: Side[] = ['N', 'S', 'E', 'W'];
  const dims = (side: Side): { front: number; len: number; yaw: number; nx: number; nz: number; axX: number; axZ: number } => {
    const spec = style.stands[side]!;
    const corner = style.cornerFill;
    switch (side) {
      case 'N': return { front: HALF_W + spec.setback, len: PITCH_L + (corner ? 40 : 18) - spec.lengthTrim, yaw: 0, nx: 0, nz: -1, axX: 1, axZ: 0 };
      case 'S': return { front: HALF_W + spec.setback, len: PITCH_L + (corner ? 40 : 18) - spec.lengthTrim, yaw: 0, nx: 0, nz: 1, axX: 1, axZ: 0 };
      case 'E': return { front: HALF_L + spec.setback, len: 68 + (corner ? 0 : -10) + 2 * (style.stands.N?.setback ?? 7) - spec.lengthTrim, yaw: Math.PI / 2, nx: 1, nz: 0, axX: 0, axZ: 1 };
      case 'W': return { front: HALF_L + spec.setback, len: 68 + (corner ? 0 : -10) + 2 * (style.stands.N?.setback ?? 7) - spec.lengthTrim, yaw: Math.PI / 2, nx: -1, nz: 0, axX: 0, axZ: 1 };
    }
  };

  let maxHeight = 0;
  for (const side of sides) {
    const spec = style.stands[side];
    if (!spec) continue;
    const d = dims(side);
    let outward = d.front;
    let y = 1.2;
    let rowIdx = 0;
    const perTier = Math.ceil(spec.rows / spec.tiers);
    for (let tier = 0; tier < spec.tiers; tier++) {
      if (tier > 0) { outward += 1.6; y += spec.tierGap * 0.5; }
      for (let r = 0; r < perTier && rowIdx < spec.rows; r++, rowIdx++) {
        y += spec.rise; outward += spec.run;
        const cx = d.nx * (outward - spec.run / 2), cz = d.nz * (outward - spec.run / 2);
        const sizeAlong = d.len - (side === 'E' || side === 'W' ? 0 : 0);
        // solid terrace block: top at y
        const w = d.nx !== 0 ? spec.run : sizeAlong, dd = d.nx !== 0 ? sizeAlong : spec.run;
        pushBox(seatGeos, w, y, dd, cx, y / 2, cz, 0, d.nx !== 0 ? 1 : sizeAlong / 0.9, d.nx !== 0 ? sizeAlong / 0.9 : 1);
        rowsOut.push({ cx, cy: y, cz, len: sizeAlong, yaw: d.yaw, y, faceX: -d.nx, faceZ: -d.nz, stand: side, tier });
      }
      if (tier < spec.tiers - 1) {
        // concourse fascia between tiers
        const cx = d.nx * (outward + 0.4), cz = d.nz * (outward + 0.4);
        const w = d.nx !== 0 ? 0.8 : d.len, dd = d.nx !== 0 ? d.len : 0.8;
        pushBox(structGeos, w, spec.tierGap * 0.5 + 1.2, dd, cx, y - 0.4, cz, 0);
      }
    }
    maxHeight = Math.max(maxHeight, y);
    // back wall
    const bx = d.nx * (outward + 0.4), bz = d.nz * (outward + 0.4);
    const bw = d.nx !== 0 ? 0.8 : d.len, bd = d.nx !== 0 ? d.len : 0.8;
    pushBox(structGeos, bw, y + 3, bd, bx, (y + 3) / 2, bz, 0);
    // roof
    if (style.roof !== 'none') {
      const roofY = y + 4.5;
      const depth = outward - d.front + (style.roof === 'ring' ? 8 : 4);
      const cx = d.nx * (d.front + depth / 2 - 2), cz = d.nz * (d.front + depth / 2 - 2);
      const w = d.nx !== 0 ? depth : d.len + (style.roof === 'ring' ? 14 : 0), dd = d.nx !== 0 ? d.len + (style.roof === 'ring' ? 14 : 0) : depth;
      if (style.roof === 'partial' && (side === 'E' || side === 'W')) continue;
      const roofGeo = new BoxGeometry(w, style.roof === 'flat' ? 0.5 : 0.4, dd);
      roofGeo.translate(cx, roofY, cz);
      if (style.roof === 'cantilever' || style.roof === 'ring' || style.roof === 'arch') {
        // slope towards the pitch
        const rg = new BoxGeometry(w, 0.35, dd);
        rg.rotateX(0);
        const tilt = 0.12;
        if (d.nz !== 0) rg.rotateX(-d.nz * tilt); else rg.rotateZ(d.nx * tilt);
        rg.translate(cx, roofY + 0.4, cz);
        structGeos.push(rg);
      } else structGeos.push(roofGeo);
      // roof supports
      const n = Math.max(3, Math.round(d.len / 18));
      for (let i = 0; i <= n; i++) {
        const t = -d.len / 2 + (d.len * i) / n;
        const px = d.nz !== 0 ? t : d.nx * (outward + 0.5), pz = d.nz !== 0 ? d.nz * (outward + 0.5) : t;
        const col = new CylinderGeometry(0.35, 0.45, roofY, 8); col.translate(px, roofY / 2, pz);
        structGeos.push(col);
      }
      if (style.roof === 'arch') {
        for (let i = 0; i <= n; i++) {
          const t = -d.len / 2 + (d.len * i) / n;
          const arch = new CylinderGeometry(0.25, 0.25, depth + 8, 6);
          arch.rotateZ(Math.PI / 2);
          if (d.nx !== 0) arch.rotateY(0); else arch.rotateY(Math.PI / 2);
          const px = d.nz !== 0 ? t : cx, pz = d.nz !== 0 ? cz : t;
          arch.translate(px, roofY + 1.6, pz);
          structGeos.push(arch);
        }
      }
    }
  }
  // grassy bank
  if (style.bank) {
    const bank = new BoxGeometry(PITCH_L + 40, 14, 30);
    bank.translate(0, 0, 0);
    const m = new Mesh(bank, new MeshStandardMaterial({ color: '#4d7c3a', roughness: 1 }));
    const sg = style.bank === 'S' ? 1 : -1;
    m.scale.set(1, 1, 1); m.position.set(0, 3, sg * (HALF_W + 20));
    m.rotation.x = -sg * 0.0;
    m.geometry = (() => { const g = new BoxGeometry(PITCH_L + 30, 1, 24); return g; })();
    // sloped plane
    const slope = new Mesh(new PlaneGeometry(PITCH_L + 30, 28), new MeshStandardMaterial({ color: '#527f3e', roughness: 1, side: DoubleSide }));
    slope.rotation.x = -Math.PI / 2 + sg * -0.38; slope.position.set(0, 5, sg * (HALF_W + 22));
    group.add(slope);
  }

  const seatTex = seatTexture(style.seatA, style.seatB);
  if (seatGeos.length) {
    const seats = new Mesh(mergeGeometries(seatGeos, false)!, new MeshStandardMaterial({ map: seatTex, roughness: 0.7, color: '#ffffff' }));
    seats.receiveShadow = true; seats.castShadow = true;
    group.add(seats);
  }
  if (structGeos.length) {
    const struct = new Mesh(mergeGeometries(structGeos, false)!, new MeshStandardMaterial({ color: style.roofColor, roughness: 0.55, metalness: 0.2 }));
    struct.castShadow = true; struct.receiveShadow = true;
    group.add(struct);
  }
  // concrete apron under stands
  const apron = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: concrete, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02; apron.receiveShadow = true;
  group.add(apron);

  // ---- crowd
  const fans: Array<{ x: number; y: number; z: number; yaw: number; stand: Side }> = [];
  const density = Math.max(0.05, opts.crowd) * (0.7 + 0.3 * Math.min(1, opts.capacity / 50000));
  for (const r of rowsOut) {
    const step = 0.56 / Math.max(0.2, density);
    const n = Math.floor((r.len - 4) / step);
    for (let i = 0; i < n; i++) {
      if (rng.chance(0.07 + (r.tier > 0 ? 0.03 : 0))) continue;
      const along = -r.len / 2 + 2 + i * step + rng.float(-0.05, 0.05);
      // seats lie along the stand's long axis
      const alongX = r.faceZ !== 0 ? along : 0, alongZ = r.faceZ !== 0 ? 0 : along;
      fans.push({ x: r.cx + alongX, y: r.y, z: r.cz + alongZ, yaw: Math.atan2(r.faceX, r.faceZ), stand: r.stand });
    }
  }
  const maxFans = Math.min(fans.length, Math.floor(18000 * opts.crowd) + 300);
  // thin evenly instead of truncating
  const keepEvery = fans.length / Math.max(1, maxFans);
  const picked: typeof fans = [];
  for (let i = 0; i < fans.length; i += keepEvery) picked.push(fans[Math.floor(i)]!);
  if (picked.length) {
    const bodyG = new CapsuleGeometry(0.2, 0.32, 3, 8); bodyG.translate(0, 0.4, 0);
    const headG = new SphereGeometry(0.115, 8, 6); headG.translate(0, 0.86, 0);
    const mkMat = (): MeshLambertMaterial => {
      const m = new MeshLambertMaterial({});
      m.onBeforeCompile = (sh): void => {
        sh.uniforms.uTime = timeUniform; sh.uniforms.uExcite = crowdUniform;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSeed; uniform float uTime; uniform float uExcite;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          float stand = step(0.62, fract(aSeed * 7.31)) * smoothstep(0.35, 0.8, uExcite);
          float bob = sin(uTime * (3.0 + fract(aSeed*3.7)*5.0) + aSeed * 40.0);
          transformed.y = transformed.y * (1.0 + stand * 0.32) + (0.5 + 0.5 * bob) * (0.02 + uExcite * 0.14) + stand * 0.25;
          transformed.x += sin(uTime * 2.0 + aSeed * 12.0) * 0.03 * uExcite;`);
      };
      return m;
    };
    const bodies = new InstancedMesh(bodyG, mkMat(), picked.length);
    const heads = new InstancedMesh(headG, mkMat(), picked.length);
    const seed = new Float32Array(picked.length);
    const m4 = new Matrix4(), q = new Object3D(); const col = new Color();
    const skin = ['#f1c9a5', '#e0ac82', '#c68642', '#a96f43', '#7a4a2b', '#4d2e1a'];
    const neutral = ['#e5e7eb', '#111827', '#6b7280', '#d1d5db', '#f59e0b', '#0ea5e9', '#a3a3a3'];
    picked.forEach((f, i) => {
      q.position.set(f.x, f.y, f.z); q.rotation.set(0, f.yaw, 0); q.scale.setScalar(rng.float(0.92, 1.08)); q.updateMatrix(); m4.copy(q.matrix);
      bodies.setMatrixAt(i, m4); heads.setMatrixAt(i, m4);
      const homeEnd = f.stand === 'W', awayEnd = f.stand === 'E';
      const roll = rng.next();
      let c = rng.pick(neutral);
      if (homeEnd && roll < 0.8) c = opts.home.primary; else if (awayEnd && roll < 0.7) c = opts.away.primary;
      else if (roll < 0.3) c = opts.home.primary; else if (roll < 0.4) c = opts.away.primary;
      bodies.setColorAt(i, col.set(c));
      heads.setColorAt(i, col.set(skin[rng.weighted([0, 1, 2, 3, 4, 5], (k) => [3, 3, 2.5, 2, 1.5, 1.2][k]!)]!));
      seed[i] = rng.next();
    });
    bodyG.setAttribute('aSeed', new InstancedBufferAttribute(seed, 1));
    headG.setAttribute('aSeed', new InstancedBufferAttribute(seed, 1));
    bodies.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
    bodies.frustumCulled = false; heads.frustumCulled = false;
    group.add(bodies, heads);
  }

  // ---- advertising boards
  const boardCanvas = createCanvas(2048, 64);
  const bctx = boardCanvas.getContext('2d')!;
  const boardTex = new CanvasTexture(boardCanvas); boardTex.wrapS = RepeatWrapping; boardTex.colorSpace = SRGBColorSpace;
  const palette = ['#0b3d91', '#c2410c', '#0f766e', '#7c3aed', '#be123c', '#1d4ed8', '#15803d'];
  const draw = (t: number): void => {
    bctx.fillStyle = '#0b0f19'; bctx.fillRect(0, 0, 2048, 64);
    const shift = Math.floor(t / 6);
    for (let i = 0; i < 8; i++) {
      const name = SPONSORS[(i + shift) % SPONSORS.length]!;
      bctx.fillStyle = palette[(i + shift) % palette.length]!; bctx.fillRect(i * 256, 4, 252, 56);
      bctx.fillStyle = '#fff'; bctx.font = 'bold 30px system-ui, sans-serif'; bctx.textAlign = 'center';
      bctx.fillText(name, i * 256 + 126, 42);
    }
    boardTex.needsUpdate = true;
  };
  draw(0);
  const boardMat = new MeshBasicMaterial({ map: boardTex });
  const boardRing = new Group();
  const bw = 0.9;
  const mkBoard = (len: number, x: number, z: number, yaw: number): void => {
    const g = new BoxGeometry(len, bw, 0.12);
    const m = new Mesh(g, [new MeshStandardMaterial({ color: '#111' }), new MeshStandardMaterial({ color: '#111' }), new MeshStandardMaterial({ color: '#111' }), new MeshStandardMaterial({ color: '#111' }), boardMat, new MeshStandardMaterial({ color: '#111' })]);
    const uv = g.getAttribute('uv') as BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 20));
    m.position.set(x, bw / 2, z); m.rotation.y = yaw;
    boardRing.add(m);
  };
  const offZ = HALF_W + 5, offX = HALF_L + 6;
  mkBoard(PITCH_L + 12, 0, offZ, 0); mkBoard(PITCH_L + 12, 0, -offZ, Math.PI);
  mkBoard(2 * offZ, offX, 0, -Math.PI / 2); mkBoard(2 * offZ, -offX, 0, Math.PI / 2);
  group.add(boardRing);

  // ---- floodlights
  const lights: SpotLight[] = [];
  const floodMeshes: Mesh[] = [];
  const mastPositions: Array<[number, number]> = style.mast === 'roof'
    ? [[-HALF_L * 0.55, -HALF_W - 22], [HALF_L * 0.55, -HALF_W - 22], [-HALF_L * 0.55, HALF_W + 22], [HALF_L * 0.55, HALF_W + 22]]
    : [[-HALF_L - 18, -HALF_W - 14], [HALF_L + 18, -HALF_W - 14], [-HALF_L - 18, HALF_W + 14], [HALF_L + 18, HALF_W + 14]];
  const mastH = style.mast === 'roof' ? Math.max(30, maxHeight + 9) : 44;
  const lampMat = new MeshBasicMaterial({ color: opts.night ? '#d9d2bd' : '#bbbbbb' });
  for (const [mx, mz] of mastPositions) {
    if (style.mast === 'none') break;
    const pole = new Mesh(new CylinderGeometry(0.4, 0.7, mastH, 8), new MeshStandardMaterial({ color: '#6b7280', roughness: 0.6, metalness: 0.4 }));
    pole.position.set(mx, mastH / 2, mz); pole.castShadow = true; group.add(pole);
    const head = new Mesh(new BoxGeometry(7, 4.5, 0.6), new MeshStandardMaterial({ color: '#374151' }));
    head.position.set(mx, mastH + 1.5, mz); head.lookAt(0, 0, 0); group.add(head);
    const lamps = new Mesh(new PlaneGeometry(6.4, 4), lampMat); lamps.position.copy(head.position); lamps.position.addScaledVector(new Vector3(-mx, 0, -mz).normalize(), 0.4); lamps.lookAt(0, 4, 0); group.add(lamps); floodMeshes.push(lamps);
    const sp = new SpotLight(0xfff3dc, 0, 220, 0.9, 0.55, 1.2);
    sp.position.set(mx, mastH + 1, mz); sp.target.position.set(mx * 0.1, 0, mz * 0.1); group.add(sp, sp.target);
    lights.push(sp);
  }

  // ---- jumbotron
  let jumbotron: StadiumView['jumbotron'] = null;
  if (style.jumbotron) {
    const c = createCanvas(512, 192); const ctx = c.getContext('2d')!;
    const tex = new CanvasTexture(c); tex.colorSpace = SRGBColorSpace;
    const screen = new Mesh(new PlaneGeometry(14, 5.25), new MeshBasicMaterial({ map: tex }));
    const frame = new Mesh(new BoxGeometry(14.8, 5.9, 0.6), new MeshStandardMaterial({ color: '#0f172a' }));
    const ex = style.stands.E ? HALF_L + (style.stands.E.setback) + (style.stands.E.rows * style.stands.E.run) * 0.45 : HALF_L + 25;
    const h = (style.stands.E?.rows ?? 20) * (style.stands.E?.rise ?? 0.4) * 0.7 + 4;
    screen.position.set(-ex + 0.35, h, 0); screen.rotation.y = Math.PI / 2; frame.position.set(-ex, h, 0); frame.rotation.y = Math.PI / 2;
    // west stand screen faces east (+x), placed on the far side to be visible
    screen.position.x = ex - 0.35; screen.rotation.y = -Math.PI / 2; frame.position.x = ex; frame.rotation.y = -Math.PI / 2;
    group.add(frame, screen);
    jumbotron = { tex, ctx, canvas: c };
  }

  // ---- tunnel
  const tunnel = new Mesh(new BoxGeometry(5, 3.2, 7), new MeshStandardMaterial({ color: '#1f2937', roughness: 0.9 }));
  tunnel.position.set(0, 1.6, HALF_W + 6.5); group.add(tunnel);

  // ---- distant skyline backdrop
  const sky = new Group();
  const bMat = new MeshStandardMaterial({ color: '#8b95a5', roughness: 1 });
  const win = createCanvas(64, 64); const wg = win.getContext('2d')!; wg.fillStyle = '#20242c'; wg.fillRect(0, 0, 64, 64); wg.fillStyle = opts.night ? '#ffd27a' : '#566073';
  for (let y = 4; y < 64; y += 10) for (let x = 4; x < 64; x += 10) if (rng.chance(opts.night ? 0.5 : 0.8)) wg.fillRect(x, y, 5, 6);
  const winTex = new CanvasTexture(win); winTex.wrapS = winTex.wrapT = RepeatWrapping; winTex.colorSpace = SRGBColorSpace;
  const wMat = new MeshStandardMaterial({ map: winTex, roughness: 0.9, emissive: opts.night ? new Color('#aa8844') : new Color('#000'), emissiveMap: opts.night ? winTex : null, emissiveIntensity: opts.night ? 0.6 : 0 });
  void bMat;
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rng.float(-0.03, 0.03), r = rng.float(150, 260);
    const h = rng.float(12, 60), w = rng.float(10, 26), d = rng.float(10, 26);
    const g = new BoxGeometry(w, h, d); const uv = g.getAttribute('uv') as BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 12, uv.getY(k) * h / 12);
    const b = new Mesh(g, wMat);
    b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); b.rotation.y = rng.float(0, 3);
    sky.add(b);
  }
  group.add(sky);

  return {
    group, crowdUniform, timeUniform, lights, floodMeshes, boards: { tex: boardTex, draw }, jumbotron,
    dispose: (): void => { group.traverse((o) => { const m = o as Mesh; m.geometry?.dispose?.(); }); },
  };
}

export { BoxGeometry };
