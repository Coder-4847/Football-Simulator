import { angleDiff, clamp, clamp01, lerp } from '../core/math';

/** Everything the painter needs to know about a player for one frame (shared by live play and replays). */
export interface RenderPlayer {
  visible: boolean; x: number; z: number; face: number;
  state: string; stateName: string; stateT: number; stateDur: number; speed: number; stride: number;
  hasBall: boolean; ballSide: 'L' | 'R'; dominantFoot: 'L' | 'R'; weakFoot: number; tired: number; keeper: boolean;
  skillAnim: string | null; skillU: number; skillSide: number; diveSide: number; diveH: number; celebT: number; kickPower: number;
}

export const SKIN_TONES = ['#f1c9a5', '#e0ac82', '#c68642', '#a96f43', '#7a4a2b', '#4d2e1a'];
export const HAIR_COLORS = ['#15110e', '#3a2616', '#6b4a2b', '#a77a3f', '#c9b17a', '#7a2d1c'];
export const BOOT_COLORS = ['#111827', '#f8fafc', '#f59e0b', '#2563eb', '#dc2626', '#16a34a'];

export interface PlayerStyle {
  primary: string; secondary: string; shorts: string; socks: string; pattern: string;
  keeper: boolean;
  skin: string; hair: string; hairStyle: number; beard: number; boot: string; longSleeves: boolean; gloves: string | null;
  number: number;
  /** body proportions */
  build: number; // 0.9..1.1
  celeb: number;
  role: 'player' | 'referee' | 'assistant';
}

/** Per-player animation memory (smoothed pose, head look, foot trails). */
export class PlayerAnim {
  // smoothed pose
  fLx = 0; fLy = -0.14; fLl = 0; fRx = 0; fRy = 0.14; fRl = 0;
  hLx = 0; hLy = -0.4; hRx = 0; hRy = 0.4;
  tx = 0; ty = 0; trot = 0; tsx = 1; tsy = 1;
  hx = 0.02; hy = 0; look = 0;
  bodyRot = 0; air = 0; lie = 0;
  prevFace = 0; turn = 0;
  seed = Math.random() * 100;
  trailL: number[] = []; trailR: number[] = [];
  lastTrailT = 0;
  slideDust = 0;
  init = false;
}

interface Pose {
  fLx: number; fLy: number; fLl: number; fRx: number; fRy: number; fRl: number;
  hLx: number; hLy: number; hRx: number; hRy: number;
  tx: number; ty: number; trot: number; tsx: number; tsy: number;
  hx: number; hy: number;
  bodyRot: number; air: number; lie: number;
  /** extra arm raise 0..1 used for glove/celebration emphasis */
  armUp: number;
  /** force sprite rotation to world angle (dives) */
  worldRot: number | null;
  /** hand-over-ball (keeper catches) */
  catching: boolean;
}

const newPose = (): Pose => ({ fLx: 0, fLy: -0.14, fLl: 0, fRx: 0, fRy: 0.14, fRl: 0, hLx: 0, hLy: -0.4, hRx: 0, hRy: 0.4, tx: 0, ty: 0, trot: 0, tsx: 1, tsy: 1, hx: 0.02, hy: 0, bodyRot: 0, air: 0, lie: 0, armUp: 0, worldRot: null, catching: false });

const easeOut = (u: number): number => 1 - (1 - u) * (1 - u);
const easeIn = (u: number): number => u * u;
const easeInOut = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
const bump = (u: number): number => Math.sin(clamp01(u) * Math.PI);
const smooth01 = (a: number, b: number, v: number): number => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

const HIP = 0.14;
const SHOULDER = 0.3;

/** Where the ball is relative to the player (player frame: +x forward, +y right) and how high. */
export interface BallLocal { x: number; y: number; z: number }

/** Solve a target pose for this frame. All lengths are metres in the player's frame. */
function solve(p: Pose, rp: RenderPlayer, a: PlayerAnim, bl: BallLocal | null, time: number, role: PlayerStyle['role']): void {
  // defaults: reset
  p.fLx = 0; p.fLy = -HIP; p.fLl = 0; p.fRx = 0; p.fRy = HIP; p.fRl = 0;
  p.hLx = 0; p.hLy = -0.38; p.hRx = 0; p.hRy = 0.38;
  p.tx = 0; p.ty = 0; p.trot = 0; p.tsx = 1; p.tsy = 1; p.hx = 0.03; p.hy = 0;
  p.bodyRot = 0; p.air = 0; p.lie = 0; p.armUp = 0; p.worldRot = null; p.catching = false;

  const u = rp.stateDur > 0 ? clamp01(rp.stateT / rp.stateDur) : 0;
  const spd = rp.speed;
  const run = clamp01(spd / 8.2);
  const side = rp.ballSide === 'R' ? 1 : -1; // +1 = right foot

  const locomotion = (amp: number, armAmp: number): void => {
    const ph = rp.stride * Math.PI * 2 + a.seed;
    const A = (0.04 + 0.4 * run) * amp * (1 - rp.tired * 0.12);
    const s = Math.sin(ph), c = Math.cos(ph);
    p.fLx = s * A; p.fRx = -s * A;
    p.fLl = Math.max(0, c) * run; p.fRl = Math.max(0, -c) * run;
    // inner foot swings slightly across the body line
    p.fLy = -HIP + (-c) * 0.03 * run; p.fRy = HIP + c * 0.03 * run;
    const AA = (0.05 + 0.34 * run) * armAmp;
    p.hLx = -s * AA; p.hRx = s * AA;             // each arm swings against the leg on its own side
    p.hLy = -(0.36 - run * 0.07); p.hRy = 0.36 - run * 0.07;
    p.trot = s * 0.12 * (0.3 + run);
    p.tx = 0.01 + run * 0.045;           // lean into the run
    p.hx = 0.03 + run * 0.03;
    // idle breathing
    if (run < 0.1) { const br = Math.sin(time * 2.1 + a.seed) * 0.012; p.tsx = 1 + br; p.tsy = 1 - br * 0.6; p.hLy -= br * 2; p.hRy += br * 2; }
  };
  locomotion(1, 1);

  // dribbling: the foot nearest the ball reaches for it
  const reach = (): void => {
    if (!bl) return;
    const d = Math.hypot(bl.x, bl.y);
    if (d > 1.15 || bl.z > 0.6) return;
    const w = smooth01(1.15, 0.5, d) * (rp.hasBall ? 1 : 0.7);
    const right = bl.y >= 0;
    const tx = bl.x - 0.16, ty = bl.y * 0.9;
    if (right) { p.fRx = lerp(p.fRx, tx, w); p.fRy = lerp(p.fRy, ty, w); p.fRl = Math.max(p.fRl, 0.25 * w); }
    else { p.fLx = lerp(p.fLx, tx, w); p.fLy = lerp(p.fLy, ty, w); p.fLl = Math.max(p.fLl, 0.25 * w); }
    // arms out for balance while carrying
    p.hLy -= 0.06 * w; p.hRy += 0.06 * w;
  };

  switch (rp.state) {
    case 'kick': {
      const kp = 0.55 + 0.45 * clamp01(rp.kickPower);
      const isHeader = rp.stateName.includes('header');
      const sd = rp.ballSide === 'R' ? 1 : -1;
      if (isHeader) { p.air = bump(u) * 0.6; p.tx = 0.1 * bump(u); p.hx = 0.1 * bump(u); p.hLy = -0.5; p.hRy = 0.5; p.hLx = 0.3; p.hRx = 0.3; break; }
      let kx: number, kl: number, lean: number;
      if (u < 0.3) { const k = easeOut(u / 0.3); kx = lerp(0, -0.5 * kp, k); kl = 0.9 * k; lean = -0.05 * k; }
      else if (u < 0.5) { const k = easeIn((u - 0.3) / 0.2); kx = lerp(-0.5 * kp, 1.0 * kp, k); kl = lerp(0.9, 0.55, k); lean = lerp(-0.05, 0.09, k); }
      else { const k = easeOut((u - 0.5) / 0.5); kx = lerp(1.0 * kp, 0.3, k); kl = lerp(0.55, 0, k); lean = lerp(0.09, 0.02, k); }
      const ky = sd * lerp(0.2, -0.04, smooth01(0.3, 0.5, u)) * (u > 0.5 ? 1 : 1);
      // plant foot beside where the ball was
      const plantX = u < 0.5 ? lerp(0.1, 0.22, u / 0.5) : 0.22 - (u - 0.5) * 0.3;
      if (sd > 0) { p.fRx = kx; p.fRy = ky; p.fRl = kl; p.fLx = plantX; p.fLy = -0.2; p.fLl = 0; }
      else { p.fLx = kx; p.fLy = ky; p.fLl = kl; p.fRx = plantX; p.fRy = 0.2; p.fRl = 0; }
      p.tx = lean; p.trot = -sd * 0.28 * bump((u - 0.2) / 0.7);
      // arms: opposite arm swings across, kicking-side arm goes out
      const sw = bump(u);
      p.hLx = sd > 0 ? 0.28 * sw : -0.18 * sw; p.hRx = sd > 0 ? -0.18 * sw : 0.28 * sw;
      p.hLy = -0.5 - 0.1 * sw; p.hRy = 0.5 + 0.1 * sw;
      p.hx = lean * 0.6;
      break;
    }
    case 'tackle': {
      const sd = side;
      const k = u < 0.4 ? easeOut(u / 0.4) : 1 - easeIn((u - 0.4) / 0.6);
      const fx = 1.05 * k;
      if (sd > 0) { p.fRx = fx; p.fRy = 0.12; p.fRl = 0.35 * k; p.fLx = -0.25 * k; } else { p.fLx = fx; p.fLy = -0.12; p.fLl = 0.35 * k; p.fRx = -0.25 * k; }
      p.tx = 0.2 * k; p.hx = 0.2 * k; p.trot = -sd * 0.2 * k; p.hLy = -0.55; p.hRy = 0.55; p.hLx = -0.1; p.hRx = -0.1;
      p.tsx = 1 + 0.06 * k;
      break;
    }
    case 'slide': {
      // drop, glide with the lead leg out, get up
      const down = smooth01(0, 0.18, u) * (1 - smooth01(0.78, 1, u));
      p.lie = down;
      const lead = 1.05 + 0.35 * down;
      p.fRx = lerp(p.fRx, lead, down); p.fRy = lerp(p.fRy, 0.14, down); p.fRl = 0.1 * down;
      p.fLx = lerp(p.fLx, 0.35, down); p.fLy = lerp(p.fLy, -0.32, down);
      p.tx = -0.05 * down; p.tsx = 1 + 0.55 * down; p.tsy = 1 - 0.18 * down;
      p.hLx = -0.35 * down; p.hRx = -0.3 * down; p.hLy = -0.5 - 0.1 * down; p.hRy = 0.5 + 0.1 * down;
      p.hx = -0.1 * down;
      break;
    }
    case 'down': {
      const k = smooth01(0, 0.25, u > 0 ? Math.min(u, 1) : 0);
      const writhe = Math.sin(time * 6 + a.seed) * 0.05;
      p.lie = k;
      p.tsx = 1.35; p.tsy = 0.9;
      p.fRx = -0.3 + writhe; p.fRy = 0.28; p.fLx = 0.35; p.fLy = -0.3 - writhe;
      p.hLx = 0.4; p.hLy = -0.55; p.hRx = -0.2; p.hRy = 0.6 + writhe;
      p.bodyRot = Math.sin(a.seed) * 0.7;
      p.hx = 0.05;
      break;
    }
    case 'stumble': {
      const w = Math.sin(time * 22 + a.seed);
      p.hLx = 0.2 * w; p.hRx = -0.2 * w; p.hLy = -0.62; p.hRy = 0.62;
      p.fLx = 0.2 * w; p.fRx = -0.2 * w; p.ty = 0.07 * w; p.trot = 0.2 * w; p.tx = 0.05;
      break;
    }
    case 'jump': {
      const h = bump(u);
      p.air = h;
      p.fLx = -0.25 * h; p.fRx = -0.15 * h; p.fLl = 0.6 * h; p.fRl = 0.6 * h;
      p.hLx = 0.3 * h; p.hRx = 0.3 * h; p.hLy = -0.5; p.hRy = 0.5;
      p.tx = 0.05 * h; p.hx = 0.08 * h;
      break;
    }
    case 'dive': {
      // goalkeeper stretches sideways along the dive direction
      const ds = rp.diveSide;
      const launch = easeOut(clamp01(u / 0.28));
      const land = smooth01(0.72, 1, u);
      const ext = launch * (1 - land * 0.4);
      p.worldRot = ds > 0 ? Math.PI / 2 : -Math.PI / 2;
      p.lie = ext * 0.85;
      p.air = 0.55 * bump(clamp01(u / 0.85)) * (0.6 + rp.diveH * 0.25);
      p.tsx = 1 + 0.45 * ext; p.tsy = 1 - 0.12 * ext; p.tx = 0.25 * ext;
      p.hLx = 1.0 * ext; p.hRx = 1.0 * ext; p.hLy = -0.14; p.hRy = 0.14;
      p.fLx = -0.6 * ext; p.fRx = -0.75 * ext; p.fLy = -0.14; p.fRy = 0.16;
      p.hx = 0.45 * ext;
      p.catching = true;
      break;
    }
    case 'save': {
      const k = bump(u);
      p.hLx = 0.55 * k; p.hRx = 0.55 * k; p.hLy = -0.2; p.hRy = 0.2; p.tx = 0.1 * k; p.hx = 0.12 * k; p.tsx = 1 + 0.1 * k;
      p.catching = true;
      break;
    }
    case 'throw': {
      // over-the-head throw-in
      const wind = u < 0.5 ? easeOut(u / 0.5) : 1 - easeIn((u - 0.5) / 0.5) * 0.6;
      p.hLx = lerp(0.05, -0.1, wind) + (u > 0.5 ? (u - 0.5) * 0.9 : 0); p.hRx = p.hLx; p.hLy = -0.2; p.hRy = 0.2;
      p.armUp = 1; p.tx = u < 0.5 ? -0.07 * wind : 0.1 * (u - 0.5) * 2; p.hx = p.tx * 0.7;
      p.fLx = 0.12; p.fRx = -0.14; p.air = 0;
      break;
    }
    case 'celebrate': {
      const t = rp.celebT;
      const style = Math.floor(a.seed) % 6;
      const bounce = Math.abs(Math.sin(t * 5.5 + a.seed)) ;
      switch (style) {
        case 0: p.hLx = 0.1; p.hRx = 0.1; p.hLy = -0.8; p.hRy = 0.8; p.armUp = 0.8; p.air = bounce * 0.25; break;           // arms wide
        case 1: p.hRx = 0.45; p.hRy = 0.3; p.armUp = 1; p.hLx = 0; p.hLy = -0.35; p.air = bounce * 0.3; break;                 // fist pump
        case 2: p.lie = 0.7; p.tsx = 1.4; p.fRx = 0.7; p.fLx = -0.3; p.hLx = -0.3; p.hRx = -0.3; p.hLy = -0.8; p.hRy = 0.8; break; // knee slide
        case 3: p.bodyRot = t * 6; p.hLy = -0.7; p.hRy = 0.7; p.air = bounce * 0.2; break;                                      // spin
        case 4: p.hLx = 0.1; p.hLy = -0.3; p.hRx = 0.4; p.hRy = 0.15; p.armUp = 1; p.air = bounce * 0.15; break;              // point up
        default: p.air = bounce * 0.5; p.hLx = 0.35; p.hRx = 0.35; p.hLy = -0.4; p.hRy = 0.4; p.armUp = 0.9; p.fLx = -0.2; p.fRx = -0.2; break; // jump
      }
      p.hx = 0.02;
      break;
    }
    case 'wait': {
      p.hLx = 0.08; p.hRx = 0.08; p.hLy = -0.36; p.hRy = 0.36;
      break;
    }
    case 'skill': {
      skillPose(p, rp, a, bl, u, time);
      break;
    }
    default: reach(); break;
  }

  if (role !== 'player') { p.armUp = 0; }
}

function footTo(p: Pose, right: boolean, x: number, y: number, lift: number): void {
  if (right) { p.fRx = x; p.fRy = y; p.fRl = lift; } else { p.fLx = x; p.fLy = y; p.fLl = lift; }
}

/** Skill-move animation: feet are driven toward the ball so every touch looks connected. */
function skillPose(p: Pose, rp: RenderPlayer, a: PlayerAnim, bl: BallLocal | null, u: number, time: number): void {
  const sd = rp.skillSide >= 0 ? 1 : -1;
  const bx = bl ? bl.x : 0.6, by = bl ? bl.y : 0;
  const nearRight = by >= 0;
  const spread = (): void => { p.hLy = -0.55; p.hRy = 0.55; };
  switch (rp.skillAnim) {
    case 'feint': case 'fakeKick': {
      const k = bump(u);
      const kicker = rp.skillAnim === 'fakeKick';
      p.ty = sd * 0.1 * Math.sin(u * Math.PI * 2); p.trot = sd * 0.35 * Math.sin(u * Math.PI * 2); p.tx = 0.02;
      if (kicker) { const wind = u < 0.45 ? easeOut(u / 0.45) : 1 - easeInOut((u - 0.45) / 0.55); footTo(p, true, lerp(0.2, -0.45, wind), 0.2, 0.9 * wind); p.fLx = 0.18; p.tx = -0.04 * wind; }
      else footTo(p, nearRight, bx - 0.18, by * 0.9, 0.2 * k);
      spread(); p.hLx = -0.1 * k; p.hRx = 0.1 * k;
      break;
    }
    case 'dragBack': {
      const k = u < 0.3 ? easeOut(u / 0.3) : 1;
      const dx = lerp(bx + 0.12, bx - 0.5, easeInOut(clamp01((u - 0.25) / 0.6)));
      footTo(p, nearRight, lerp(0.35, dx, k), by * 0.8, 0.15);
      p.tx = -0.05 * k; spread(); p.hLx = -0.15; p.hRx = -0.15; p.trot = sd * 0.15 * bump(u);
      break;
    }
    case 'stepOver': {
      const loops = 1.5;
      const ang = u * Math.PI * 2 * loops * sd + (nearRight ? 0 : Math.PI);
      const r = 0.42 * (0.6 + 0.4 * bump(u * loops % 1));
      const right = Math.floor(u * loops) % 2 === 0 ? nearRight : !nearRight;
      footTo(p, right, bx + Math.cos(ang) * r, by + Math.sin(ang) * r, 0.65 * bump((u * loops) % 1));
      // support foot stays planted behind the ball
      if (right) { p.fLx = bx - 0.3; p.fLy = -0.2; } else { p.fRx = bx - 0.3; p.fRy = 0.2; }
      p.trot = Math.sin(u * Math.PI * 2 * loops) * 0.3 * sd; p.ty = Math.sin(u * Math.PI * 2 * loops) * 0.05;
      spread(); p.hLx = 0.12; p.hRx = -0.12;
      break;
    }
    case 'spin': {
      const k = u;
      footTo(p, nearRight, bx - 0.15, by * 0.8, 0.2 * bump(k * 3 % 1)); p.fLy = -0.2;
      p.hLy = -0.7; p.hRy = 0.7; p.hLx = 0.1; p.hRx = -0.1; p.tsx = 1.05;
      break;
    }
    case 'flick': {
      const k = u < 0.4 ? easeOut(u / 0.4) : 1 - easeIn((u - 0.4) / 0.6);
      footTo(p, !nearRight, bx - 0.36 + 0.55 * easeInOut(clamp01((u - 0.2) / 0.35)), by * 0.5 + (nearRight ? -0.12 : 0.12), 1.0 * k);
      p.tx = 0.04; spread(); p.hLx = -0.2; p.hRx = -0.2; p.trot = -sd * 0.2 * k;
      break;
    }
    case 'lift': {
      const k = bump(u);
      footTo(p, nearRight, bx + 0.05, by * 0.6, 0.9 * k);
      p.fLy = -0.18; p.tx = 0.08 * k; p.air = 0.12 * k; spread(); p.hLx = 0.2; p.hRx = 0.2;
      break;
    }
    case 'hop': {
      const hop = Math.abs(Math.sin(u * Math.PI * 4));
      const right = Math.floor(u * 4) % 2 === 0;
      footTo(p, right, bx - 0.05, by * 0.5 + (right ? 0.08 : -0.08), 0.7 * hop);
      p.air = hop * 0.22; p.hLx = 0.1 * hop; p.hRx = 0.1 * hop; spread();
      break;
    }
    case 'roll': {
      const lat = lerp(-0.28, 0.28, easeInOut(u)) * sd;
      footTo(p, nearRight, bx - 0.04, by * 0.5 + lat, 0.25);
      p.trot = sd * 0.2 * Math.sin(u * Math.PI); p.tx = 0.02; spread();
      break;
    }
    case 'stop': {
      const k = easeOut(clamp01(u / 0.3));
      footTo(p, nearRight, lerp(0.3, bx - 0.02, k), by * 0.7, 0.35);
      p.tx = -0.07 * k; spread(); p.hLx = -0.18; p.hRx = -0.18; p.tsx = 1 - 0.05 * k;
      break;
    }
    case 'burst': {
      const k = u < 0.25 ? easeIn(u / 0.25) : 1;
      footTo(p, nearRight, lerp(-0.2, bx + 0.25, k), by * 0.8, 0.6 * (1 - Math.abs(u - 0.2) * 3));
      p.tx = 0.12 * k; p.hLx = -0.35; p.hRx = 0.35; spread();
      break;
    }
    case 'shuffle': {
      const f = Math.sin(u * Math.PI * 7);
      p.fLx = bx - 0.1 + f * 0.18; p.fLy = -0.2; p.fRx = bx - 0.1 - f * 0.18; p.fRy = 0.2; p.fLl = Math.max(0, f) * 0.5; p.fRl = Math.max(0, -f) * 0.5;
      p.ty = sd * 0.1 * Math.sin(u * Math.PI * 2); p.trot = sd * 0.25 * Math.sin(u * Math.PI * 2);
      spread(); p.hLx = -f * 0.1; p.hRx = f * 0.1;
      break;
    }
    default: break;
  }
  void time;
}

// ------------------------------------------------------------------ painting

const torsoCache = new Map<string, HTMLCanvasElement>();
const TORSO_PPM = 360;
const TORSO_W = 0.62, TORSO_H = 0.9;

function darken(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

/** Shirt seen from above, pre-rendered per kit: pattern, volume shading, seams. Local frame: +x forward, +y right. */
function torsoSprite(st: PlayerStyle): HTMLCanvasElement {
  const key = `${st.primary}|${st.secondary}|${st.pattern}|${st.keeper ? 'k' : 'p'}`;
  const hit = torsoCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = Math.round(TORSO_W * TORSO_PPM); c.height = Math.round(TORSO_H * TORSO_PPM);
  const g = c.getContext('2d')!;
  g.translate(c.width / 2, c.height / 2); g.scale(TORSO_PPM, TORSO_PPM);
  // body shape: rounded shoulders, narrower in depth
  const path = (): void => { g.beginPath(); g.ellipse(0, 0, 0.215, 0.335, 0, 0, Math.PI * 2); };
  path(); g.fillStyle = st.primary; g.fill();
  g.save(); path(); g.clip();
  g.fillStyle = st.secondary;
  switch (st.pattern) {
    case 'stripes': for (let i = -4; i <= 4; i += 2) g.fillRect(-0.3, i * 0.075 - 0.0375, 0.6, 0.075); break; // stripes run front→back
    case 'hoops': for (let i = -3; i <= 3; i += 2) g.fillRect(i * 0.07 - 0.035, -0.4, 0.07, 0.8); break;
    case 'halves': g.fillRect(-0.3, 0, 0.6, 0.4); break;
    case 'sash': g.beginPath(); g.moveTo(-0.25, -0.34); g.lineTo(-0.08, -0.34); g.lineTo(0.25, 0.34); g.lineTo(0.08, 0.34); g.closePath(); g.fill(); break;
    case 'checks': for (let i = -4; i < 4; i++) for (let j = -5; j < 5; j++) if ((i + j) % 2 === 0) g.fillRect(i * 0.07, j * 0.07, 0.07, 0.07); break;
    case 'pinstripe': g.globalAlpha = 0.6; for (let i = -6; i <= 6; i++) g.fillRect(-0.3, i * 0.055 - 0.004, 0.6, 0.008); g.globalAlpha = 1; break;
    case 'chevron': g.strokeStyle = st.secondary; g.lineWidth = 0.05; for (let r = -1; r <= 1; r++) { g.beginPath(); g.moveTo(0.18 + r * 0.1, -0.3); g.lineTo(-0.02 + r * 0.1, 0); g.lineTo(0.18 + r * 0.1, 0.3); g.stroke(); } break;
    default: break;
  }
  // volume: lighter across the shoulders' top (+x is toward the head so the back highlights near the middle), darker at the rim
  const gr = g.createRadialGradient(-0.03, 0, 0.02, 0, 0, 0.36);
  gr.addColorStop(0, 'rgba(255,255,255,0.20)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.02)'); gr.addColorStop(1, 'rgba(0,0,0,0.42)');
  g.fillStyle = gr; g.fillRect(-0.4, -0.4, 0.8, 0.8);
  // shoulder seams + collar
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.012;
  g.beginPath(); g.moveTo(0.02, -0.3); g.lineTo(0.03, -0.12); g.moveTo(0.02, 0.3); g.lineTo(0.03, 0.12); g.stroke();
  g.restore();
  // collar (front)
  g.fillStyle = st.secondary; g.beginPath(); g.ellipse(0.14, 0, 0.06, 0.1, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = st.skin; g.beginPath(); g.ellipse(0.145, 0, 0.04, 0.075, 0, 0, Math.PI * 2); g.fill();
  // outline
  path(); g.lineWidth = 0.022; g.strokeStyle = 'rgba(8,12,20,0.55)'; g.stroke();
  torsoCache.set(key, c);
  return c;
}

export function clearPlayerCaches(): void { torsoCache.clear(); }

const SHORTS_FALLBACK = '#111827';

/** Animated painter for one human figure. Call `update` then `drawLegs`/`drawBody`. */
export class FigurePainter {
  readonly pose = newPose();
  /** world-space foot positions this frame (for trails) */
  footWorld = { lx: 0, ly: 0, rx: 0, ry: 0 };

  update(a: PlayerAnim, rp: RenderPlayer, bl: BallLocal | null, lookAng: number | null, dt: number, time: number, role: PlayerStyle['role']): void {
    const p = this.pose;
    solve(p, rp, a, bl, time, role);
    const k = a.init ? 1 - Math.exp(-(rp.state === 'kick' || rp.state === 'skill' || rp.state === 'tackle' ? 42 : 26) * dt) : 1;
    a.init = true;
    a.fLx += (p.fLx - a.fLx) * k; a.fLy += (p.fLy - a.fLy) * k; a.fLl += (p.fLl - a.fLl) * k;
    a.fRx += (p.fRx - a.fRx) * k; a.fRy += (p.fRy - a.fRy) * k; a.fRl += (p.fRl - a.fRl) * k;
    a.hLx += (p.hLx - a.hLx) * k; a.hLy += (p.hLy - a.hLy) * k; a.hRx += (p.hRx - a.hRx) * k; a.hRy += (p.hRy - a.hRy) * k;
    a.tx += (p.tx - a.tx) * k; a.ty += (p.ty - a.ty) * k; a.trot += (p.trot - a.trot) * k; a.tsx += (p.tsx - a.tsx) * k; a.tsy += (p.tsy - a.tsy) * k;
    a.hx += (p.hx - a.hx) * k; a.air += (p.air - a.air) * Math.min(1, k * 1.3); a.lie += (p.lie - a.lie) * k;
    a.bodyRot = p.bodyRot;
    // head looks toward the ball / target, limited
    const want = lookAng === null ? 0 : clamp(lookAng, -1.15, 1.15);
    a.look += (want - a.look) * (1 - Math.exp(-9 * dt));
    // turning rate for body lean
    const dF = angleDiff(a.prevFace, rp.face);
    a.turn += (clamp(dF / Math.max(dt, 1e-3), -9, 9) - a.turn) * (1 - Math.exp(-10 * dt));
    a.prevFace = rp.face;
  }

  /** Legs, boots and foot trails: drawn before the ball so feet appear to touch it. `ctx` is in screen space; `u` = pixels per metre * figure scale. */
  drawLegs(ctx: CanvasRenderingContext2D, a: PlayerAnim, st: PlayerStyle, rp: RenderPlayer, sx: number, sy: number, u: number): void {
    const p = this.pose;
    ctx.save();
    const rot = p.worldRot ?? rp.face + a.bodyRot;
    ctx.translate(sx, sy - a.air * 0.18 * u);
    ctx.rotate(rot);
    ctx.scale(u, u);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const shorts = st.shorts || SHORTS_FALLBACK;
    const drawLeg = (fx: number, fy: number, lift: number, hipY: number): void => {
      const mx = lerp(0.0, fx, 0.45) + (fy - hipY) * 0.0, my = lerp(hipY, fy, 0.5);
      // thigh (shorts), shin (sock) — thickness shrinks as the foot lifts toward the viewer? it grows (closer to the camera)
      const th = 1 + lift * 0.18;
      ctx.strokeStyle = shorts; ctx.lineWidth = 0.205 * th; ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(mx, my); ctx.stroke();
      ctx.strokeStyle = st.socks; ctx.lineWidth = 0.15 * th; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(fx, fy); ctx.stroke();
      // boot
      ctx.save(); ctx.translate(fx, fy); const ang = Math.atan2(fy - my, fx - mx); ctx.rotate(ang * 0.5);
      const bs = 1 + lift * 0.22;
      ctx.fillStyle = st.boot; ctx.beginPath(); (ctx as CanvasRenderingContext2D & { roundRect: (...a: number[]) => void }).roundRect(-0.07 * bs, -0.085 * bs, 0.3 * bs, 0.17 * bs, 0.07 * bs); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.ellipse(0.1 * bs, -0.03 * bs, 0.07 * bs, 0.028 * bs, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };
    // the foot that is higher (nearer the camera) is painted last
    if (a.fLl <= a.fRl) { drawLeg(a.fLx, a.fLy, a.fLl, -0.12); drawLeg(a.fRx, a.fRy, a.fRl, 0.12); } else { drawLeg(a.fRx, a.fRy, a.fRl, 0.12); drawLeg(a.fLx, a.fLy, a.fLl, -0.12); }
    ctx.restore();
  }

  /** Torso, arms and head, drawn after the ball for low balls (so the head covers it) with a small upward parallax. */
  drawBody(ctx: CanvasRenderingContext2D, a: PlayerAnim, st: PlayerStyle, rp: RenderPlayer, sx: number, sy: number, u: number, showNumber: boolean): void {
    const p = this.pose;
    ctx.save();
    const par = (0.13 + a.air * 0.12) * u;
    ctx.translate(sx, sy - a.air * 0.18 * u - par);
    ctx.rotate(p.worldRot ?? rp.face + a.bodyRot);
    ctx.scale(u, u);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const lean = clamp(a.turn * 0.012, -0.09, 0.09);
    // torso
    ctx.save();
    ctx.translate(a.tx, a.ty + lean);
    ctx.rotate(a.trot);
    ctx.scale(a.tsx, a.tsy);
    const spr = torsoSprite(st);
    ctx.drawImage(spr, -TORSO_W / 2, -TORSO_H / 2, TORSO_W, TORSO_H);
    if (showNumber && st.role === 'player') {
      ctx.save(); ctx.rotate(Math.PI / 2); ctx.fillStyle = st.keeper ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.78)';
      ctx.font = '700 0.2px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(st.number), 0.0, -0.02);
      ctx.restore();
    }
    ctx.restore();
    // arms (short sleeves in shirt colour, forearms skin, gloves for keepers)
    const arm = (hx: number, hy: number, shY: number): void => {
      const ex = lerp(a.tx + 0.0, hx, 0.5) + 0.0, ey = lerp(shY, hy, 0.5) + (shY < 0 ? -0.04 : 0.04);
      ctx.strokeStyle = st.primary; ctx.lineWidth = 0.13; ctx.beginPath(); ctx.moveTo(a.tx + 0.01, shY); ctx.lineTo(lerp(a.tx, ex, 0.9), lerp(shY, ey, 0.9)); ctx.stroke();
      ctx.strokeStyle = st.longSleeves ? st.primary : st.skin; ctx.lineWidth = st.longSleeves ? 0.115 : 0.095; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = st.gloves ?? st.skin; ctx.beginPath(); ctx.arc(hx, hy, st.gloves ? 0.095 : 0.065, 0, Math.PI * 2); ctx.fill();
      if (st.gloves) { ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.014; ctx.beginPath(); ctx.arc(hx, hy, 0.095, 0, Math.PI * 2); ctx.stroke(); }
    };
    arm(a.hLx, a.hLy, -0.285 * a.tsy); arm(a.hRx, a.hRy, 0.285 * a.tsy);
    // head
    ctx.save();
    ctx.translate(a.hx + a.tx * 0.6, a.hy + a.ty * 0.7 + lean);
    ctx.rotate(a.look + a.trot * 0.4);
    ctx.fillStyle = darken(st.skin, 0.88); ctx.beginPath(); ctx.arc(0, -0.125, 0.032, 0, Math.PI * 2); ctx.arc(0, 0.125, 0.032, 0, Math.PI * 2); ctx.fill(); // ears
    ctx.fillStyle = st.skin; ctx.beginPath(); ctx.ellipse(0.005, 0, 0.14, 0.125, 0, 0, Math.PI * 2); ctx.fill();
    if (st.beard > 0) { ctx.fillStyle = darken(st.hair, 0.9); ctx.globalAlpha = st.beard === 1 ? 0.35 : 0.85; ctx.beginPath(); ctx.ellipse(0.07, 0, 0.08, 0.1, 0, -1.6, 1.6); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = st.hair;
    switch (st.hairStyle) {
      case 0: ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(-0.02, -0.03, 0.05, 0.03, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 2: ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.ellipse(-0.015, 0, 0.115, 0.108, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; break;
      case 3: ctx.beginPath(); ctx.ellipse(-0.03, 0, 0.165, 0.158, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 4: ctx.beginPath(); ctx.ellipse(-0.1, 0, 0.17, 0.13, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(-0.02, 0, 0.12, 0.118, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 5: ctx.beginPath(); ctx.ellipse(-0.02, 0, 0.12, 0.115, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(-0.17, 0, 0.055, 0, Math.PI * 2); ctx.fill(); break;
      case 6: ctx.beginPath(); ctx.ellipse(-0.01, 0, 0.14, 0.04, 0, 0, Math.PI * 2); ctx.fill(); break;
      default: ctx.beginPath(); ctx.ellipse(-0.04, 0, 0.1, 0.106, 0, 0, Math.PI * 2); ctx.fill(); break;
    }
    // soft highlight
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.ellipse(-0.02, -0.04, 0.05, 0.035, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(8,12,20,0.4)'; ctx.lineWidth = 0.014; ctx.beginPath(); ctx.ellipse(0.005, 0, 0.14, 0.125, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  /** World position of each boot (for foot trails), valid after update. */
  computeFeet(a: PlayerAnim, rp: RenderPlayer): void {
    const rot = this.pose.worldRot ?? rp.face + a.bodyRot;
    const c = Math.cos(rot), s = Math.sin(rot);
    this.footWorld.lx = rp.x + a.fLx * c - a.fLy * s; this.footWorld.ly = rp.z + a.fLx * s + a.fLy * c;
    this.footWorld.rx = rp.x + a.fRx * c - a.fRy * s; this.footWorld.ry = rp.z + a.fRx * s + a.fRy * c;
  }
}

export function pushTrail(buf: number[], x: number, y: number, max = 7): void {
  buf.push(x, y);
  while (buf.length > max * 2) buf.splice(0, 2);
}
