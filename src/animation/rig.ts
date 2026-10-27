import {
  Bone, BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  Skeleton, SkinnedMesh, SphereGeometry, Uint16BufferAttribute, Vector3, type Material, type Object3D, type Texture, DoubleSide, PlaneGeometry, MeshBasicMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Appearance, BodyType } from '../data/types';

export const SKIN_TONES = ['#f1c9a5', '#e0ac82', '#c68642', '#a96f43', '#7a4a2b', '#4d2e1a'];
export const HAIR_COLORS = ['#15110e', '#3a2616', '#6b4a2b', '#a77a3f', '#c9b17a', '#7a2d1c'];
export const BOOT_COLORS = ['#111827', '#f8fafc', '#f59e0b', '#2563eb', '#dc2626', '#16a34a'];

export const BONE_NAMES = [
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'shL', 'uaL', 'faL', 'handL', 'shR', 'uaR', 'faR', 'handR',
  'thL', 'shnL', 'ftL', 'thR', 'shnR', 'ftR', 'hair1', 'hair2',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

export const DIM = {
  thigh: 0.44, shin: 0.44, ankle: 0.08, pelvisY: 0.96, spine: 0.1, chest: 0.2, neck: 0.1, head: 0.13,
  upperArm: 0.29, foreArm: 0.26, hipW: 0.095, shoulderW: 0.2,
};

export interface RigOptions {
  look: Appearance;
  bodyType: BodyType;
  heightCm: number;
  shirt: Texture;
  shorts: string;
  socks: string;
  isKeeper: boolean;
  gloves?: string;
  shirtColor: string;
  longSleeves: boolean;
  number: number;
  name: string;
  role?: 'player' | 'referee' | 'assistant';
}

export interface Rig {
  root: Group;
  body: SkinnedMesh;
  shirtMesh: SkinnedMesh;
  bones: Record<BoneName, Bone>;
  numberPlane: Mesh;
  materials: Material[];
  scale: number;
  dirt: { value: number };
  sweat: { value: number };
  legLen: number;
}

type Part = { geo: BufferGeometry; bone: BoneName; color: Color };

function seg(radiusTop: number, radiusBottom: number, length: number, color: string, bone: BoneName, opts: { y?: number; x?: number; z?: number; sx?: number; sz?: number; radial?: number } = {}): Part {
  const g = new CylinderGeometry(radiusTop, radiusBottom, length, opts.radial ?? 16, 1, false);
  g.translate(opts.x ?? 0, (opts.y ?? 0) - length / 2, opts.z ?? 0);
  if (opts.sx || opts.sz) g.scale(opts.sx ?? 1, 1, opts.sz ?? 1);
  return { geo: g, bone, color: new Color(color) };
}

function capsule(r: number, len: number, color: string, bone: BoneName, o: { x?: number; y?: number; z?: number; sx?: number; sy?: number; sz?: number } = {}): Part {
  const g = new CapsuleGeometry(r, len, 6, 16);
  if (o.sx || o.sy || o.sz) g.scale(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  g.translate(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  return { geo: g, bone, color: new Color(color) };
}

function sphere(r: number, color: string, bone: BoneName, o: { x?: number; y?: number; z?: number; sx?: number; sy?: number; sz?: number } = {}): Part {
  const g = new SphereGeometry(r, 20, 14);
  if (o.sx || o.sy || o.sz) g.scale(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  g.translate(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  return { geo: g, bone, color: new Color(color) };
}

function box(w: number, h: number, d: number, color: string, bone: BoneName, o: { x?: number; y?: number; z?: number } = {}): Part {
  const g = new BoxGeometry(w, h, d);
  g.translate(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  return { geo: g, bone, color: new Color(color) };
}

function bake(parts: Part[], boneIndex: Record<BoneName, number>, rest: Record<BoneName, Vector3>): BufferGeometry {
  const geos: BufferGeometry[] = [];
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const r = rest[p.bone]; g.translate(r.x, r.y, r.z);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      col[i * 3] = p.color.r; col[i * 3 + 1] = p.color.g; col[i * 3 + 2] = p.color.b;
      si[i * 4] = boneIndex[p.bone]; sw[i * 4] = 1;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new BufferAttribute(sw, 4));
    geos.push(g);
  }
  return mergeGeometries(geos, false)!;
}

function numberTexture(name: string, num: number, color: string, canvasFn: (w: number, h: number) => HTMLCanvasElement): MeshBasicMaterial {
  const c = canvasFn(128, 128);
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = color; ctx.textAlign = 'center';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.fillText(name.toUpperCase().slice(0, 11), 64, 24);
  ctx.font = 'bold 84px system-ui, sans-serif';
  ctx.fillText(String(num), 64, 112);
  return new MeshBasicMaterial({ map: canvasTexture(c), transparent: true, depthWrite: false, side: DoubleSide });
}

import { CanvasTexture, SRGBColorSpace } from 'three';
function canvasTexture(c: HTMLCanvasElement): CanvasTexture { const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t; }

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  throw new Error('no DOM');
}

const BODY_W: Record<BodyType, number> = { lean: 0.92, normal: 1, stocky: 1.1, tall: 0.97 };

export function buildHumanoid(opts: RigOptions): Rig {
  const scale = opts.heightCm / 180;
  const w = BODY_W[opts.bodyType];
  const skin = SKIN_TONES[opts.look.skin % SKIN_TONES.length]!;
  const skinDark = new Color(skin).multiplyScalar(0.8).getStyle();
  const hair = HAIR_COLORS[opts.look.hairColor % HAIR_COLORS.length]!;
  const boot = opts.isKeeper ? '#0f172a' : BOOT_COLORS[opts.look.bootColor % BOOT_COLORS.length]!;
  const glove = opts.gloves ?? skin;
  const D = DIM;

  // ---- bones
  const bones = {} as Record<BoneName, Bone>;
  for (const n of BONE_NAMES) { const b = new Bone(); b.name = n; bones[n] = b; }
  const add = (parent: BoneName, child: BoneName, x: number, y: number, z = 0): void => { bones[parent].add(bones[child]); bones[child].position.set(x, y, z); };
  add('pelvis', 'spine', 0, D.spine, 0);
  add('spine', 'chest', 0, D.chest, 0);
  add('chest', 'neck', 0, D.chest * 0.9 + 0.02, 0);
  add('neck', 'head', 0, D.neck, 0);
  add('chest', 'shL', D.shoulderW * w, D.chest * 0.75, 0); add('shL', 'uaL', 0, 0, 0); add('uaL', 'faL', 0, -D.upperArm, 0); add('faL', 'handL', 0, -D.foreArm, 0);
  add('chest', 'shR', -D.shoulderW * w, D.chest * 0.75, 0); add('shR', 'uaR', 0, 0, 0); add('uaR', 'faR', 0, -D.upperArm, 0); add('faR', 'handR', 0, -D.foreArm, 0);
  add('pelvis', 'thL', D.hipW * w, -0.02, 0); add('thL', 'shnL', 0, -D.thigh, 0); add('shnL', 'ftL', 0, -D.shin, 0);
  add('pelvis', 'thR', -D.hipW * w, -0.02, 0); add('thR', 'shnR', 0, -D.thigh, 0); add('shnR', 'ftR', 0, -D.shin, 0);
  add('head', 'hair1', 0, 0.12, -0.1); add('hair1', 'hair2', 0, -0.12, 0);
  const root = new Group();
  root.add(bones.pelvis);
  bones.pelvis.position.set(0, D.pelvisY, 0);
  root.updateMatrixWorld(true);
  const rest = {} as Record<BoneName, Vector3>;
  for (const n of BONE_NAMES) rest[n] = new Vector3().setFromMatrixPosition(bones[n].matrixWorld);
  const order = [...BONE_NAMES];
  const boneIndex = Object.fromEntries(order.map((n, i) => [n, i])) as Record<BoneName, number>;

  // ---- body (vertex coloured) parts
  const parts: Part[] = [];
  const sleeve = opts.longSleeves;
  // pelvis & shorts
  parts.push(capsule(0.15 * w, 0.06, opts.shorts, 'pelvis', { y: 0.0, sx: 1.1, sz: 0.85 }));
  // thighs: shorts upper, skin lower
  for (const s of ['L', 'R'] as const) {
    const th = `th${s}` as BoneName, sh = `shn${s}` as BoneName, ft = `ft${s}` as BoneName;
    parts.push(seg(0.095 * w, 0.075 * w, D.thigh * 0.62, opts.shorts, th, { y: 0, radial: 10 }));
    parts.push(seg(0.075 * w, 0.062 * w, D.thigh * 0.38, skin, th, { y: -D.thigh * 0.62, radial: 10 }));
    parts.push(sphere(0.066 * w, skin, sh));
    // shin: skin knee + sock
    parts.push(seg(0.06 * w, 0.045 * w, D.shin * 0.22, skin, sh, { y: 0 }));
    parts.push(seg(0.058 * w, 0.042 * w, D.shin * 0.78, opts.socks, sh, { y: -D.shin * 0.22 }));
    parts.push(box(0.1 * w, 0.075, 0.27, boot, ft, { y: -0.04, z: 0.07 }));
  }
  // arms
  for (const s of ['L', 'R'] as const) {
    const ua = `ua${s}` as BoneName, fa = `fa${s}` as BoneName, ha = `hand${s}` as BoneName;
    parts.push(sphere(0.06 * w, opts.shirtColor, `sh${s}` as BoneName));
    parts.push(seg(0.052 * w, 0.045 * w, D.upperArm * 0.4, sleeve ? opts.shirtColor : skin, ua, { y: -D.upperArm * 0.6 }));
    parts.push(seg(0.044 * w, 0.036 * w, D.foreArm, sleeve ? opts.shirtColor : skin, fa, { y: 0 }));
    if (opts.look.tattoo && s === 'L' && !sleeve) parts.push(seg(0.046 * w, 0.04 * w, D.foreArm * 0.45, skinDark, fa, { y: -D.foreArm * 0.15 }));
    parts.push(sphere(opts.isKeeper ? 0.052 : 0.04, opts.isKeeper ? glove : skin, ha, { y: -0.03 }));
  }
  // neck & head
  parts.push(seg(0.05, 0.055, D.neck * 1.1, skin, 'neck', { y: 0.02 }));
  parts.push(sphere(0.105, skin, 'head', { y: 0.12, sy: 1.12, sz: 1.0, sx: 0.93 }));
  // nose / ears for orientation read
  parts.push(sphere(0.02, skin, 'head', { y: 0.115, z: 0.105 }));
  // hair
  const hs = opts.look.hairStyle;
  if (hs !== 0) {
    if (hs === 1) parts.push(sphere(0.112, hair, 'head', { y: 0.15, z: -0.012, sx: 0.95, sy: 0.72, sz: 1.0 }));
    if (hs === 2) parts.push(sphere(0.108, hair, 'head', { y: 0.14, z: -0.005, sx: 0.94, sy: 0.6, sz: 1.0 }));
    if (hs === 3) parts.push(sphere(0.15, hair, 'head', { y: 0.17, z: -0.01, sx: 1, sy: 0.85, sz: 1.0 }));
    if (hs === 4) { parts.push(sphere(0.114, hair, 'head', { y: 0.15, z: -0.02, sx: 0.98, sy: 0.8, sz: 1.05 })); parts.push(capsule(0.08, 0.08, hair, 'head', { y: 0.06, z: -0.1, sx: 1.3 })); }
    if (hs === 5) { parts.push(sphere(0.11, hair, 'head', { y: 0.15, z: -0.01, sx: 0.95, sy: 0.7 })); parts.push(sphere(0.045, hair, 'hair1', { y: -0.02, z: 0 })); parts.push(seg(0.035, 0.02, 0.14, hair, 'hair2', { y: 0 })); }
    if (hs === 6) parts.push(box(0.04, 0.09, 0.2, hair, 'head', { y: 0.25, z: -0.01 }));
  }
  if (hs === 4) parts.push(seg(0.04, 0.02, 0.12, hair, 'hair1', { y: 0 }));
  // beard
  if (opts.look.beard === 1) parts.push(sphere(0.1, new Color(hair).multiplyScalar(0.7).getStyle(), 'head', { y: 0.075, z: 0.03, sx: 0.92, sy: 0.55, sz: 0.9 }));
  if (opts.look.beard === 2) parts.push(sphere(0.108, hair, 'head', { y: 0.065, z: 0.035, sx: 0.95, sy: 0.7, sz: 0.95 }));
  // captain etc handled by caller
  const bodyGeo = bake(parts, boneIndex, rest);

  // ---- shirt (textured) parts: torso + short sleeve
  const shirtParts: Part[] = [];
  const torso = new CapsuleGeometry(0.14 * w, D.chest + D.spine + 0.04, 8, 24);
  torso.scale(1.0, 1, 0.72);
  torso.translate(0, D.spine * 0.5 + D.chest * 0.5 - 0.02, 0);
  shirtParts.push({ geo: torso, bone: 'spine', color: new Color('#ffffff') });
  const geos: BufferGeometry[] = [];
  const addShirt = (g: BufferGeometry, bone: BoneName): void => {
    const gi = g.index ? g.toNonIndexed() : g;
    gi.translate(rest[bone].x, rest[bone].y, rest[bone].z);
    const n = gi.getAttribute('position').count;
    const si = new Uint16Array(n * 4); const sw = new Float32Array(n * 4);
    const col = new Float32Array(n * 3).fill(1);
    for (let i = 0; i < n; i++) { si[i * 4] = boneIndex[bone]; sw[i * 4] = 1; }
    gi.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4)); gi.setAttribute('skinWeight', new BufferAttribute(sw, 4)); gi.setAttribute('color', new BufferAttribute(col, 3));
    geos.push(gi);
  };
  addShirt(torso, 'spine');
  if (!sleeve) for (const s of ['L', 'R'] as const) {
    const g = new CylinderGeometry(0.056 * w, 0.05 * w, D.upperArm * 0.55, 16, 1, false);
    g.translate(0, -D.upperArm * 0.27, 0);
    addShirt(g, `ua${s}` as BoneName);
  }
  const shirtGeo = mergeGeometries(geos, false)!;

  const dirt = { value: 0 };
  const sweat = { value: 0 };
  const bodyMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  const shirtMat = new MeshStandardMaterial({ map: opts.shirt, roughness: 0.78, metalness: 0 });
  for (const mat of [bodyMat, shirtMat]) {
    mat.onBeforeCompile = (sh): void => {
      sh.uniforms.uDirt = dirt; sh.uniforms.uSweat = sweat;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vRestY;\nvarying vec3 vRestP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRestY = position.y; vRestP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uDirt; uniform float uSweat; varying float vRestY; varying vec3 vRestP;\nfloat h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }')
        .replace('#include <color_fragment>', '#include <color_fragment>\n float low = 1.0 - smoothstep(0.0, 1.25, vRestY + 0.85);\n float nz = h31(floor(vRestP*40.0));\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20,0.22,0.09), clamp(uDirt * low * (0.5 + nz*0.7), 0.0, 0.85));\n diffuseColor.rgb *= 1.0 - uSweat * 0.16 * (0.6 + nz * 0.4);');
    };
  }
  const body = new SkinnedMesh(bodyGeo, bodyMat);
  const shirtMesh = new SkinnedMesh(shirtGeo, shirtMat);
  body.castShadow = true; shirtMesh.castShadow = true;
  body.frustumCulled = false; shirtMesh.frustumCulled = false;

  root.add(body);
  root.add(shirtMesh);
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(order.map((n) => bones[n]));
  body.bind(skeleton); shirtMesh.bind(skeleton);

  // number plane on the back
  const numMat = numberTexture(opts.name, opts.number, luminanceOf(opts.shirtColor) > 0.55 ? '#111827' : '#f8fafc', createCanvas);
  const numberPlane = new Mesh(new PlaneGeometry(0.3, 0.3), numMat);
  numberPlane.position.set(0, 0.08, -0.108);
  numberPlane.rotation.y = Math.PI;
  bones.chest.add(numberPlane);

  root.scale.set(w * scale * 0.96 + 0.04 * scale, scale, w * scale * 0.96 + 0.04 * scale);
  return { root, body, shirtMesh, bones, numberPlane, materials: [bodyMat, shirtMat, numMat], scale, dirt, sweat, legLen: D.pelvisY };
}

function luminanceOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

export function disposeRig(r: Rig): void {
  r.body.geometry.dispose(); r.shirtMesh.geometry.dispose();
  for (const m of r.materials) m.dispose();
  (r.numberPlane.geometry as BufferGeometry).dispose();
}

export type { Object3D };
