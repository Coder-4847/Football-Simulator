import { Matrix4, Quaternion, Vector3 } from 'three';
import { clamp, clamp01, lerp, angleDiff } from '../core/math';
import { DIM, type Rig } from './rig';

/** Channel indices of the procedural pose vector. */
export const CH = {
  pelvisX: 0, pelvisY: 1, pelvisZ: 2, pelvisDy: 3,
  spineX: 4, spineY: 5, spineZ: 6,
  chestX: 7, chestY: 8, chestZ: 9,
  neckX: 10, neckY: 11, neckZ: 12,
  headX: 13, headY: 14, headZ: 15,
  uaLX: 16, uaLY: 17, uaLZ: 18, faLX: 19, faLY: 20, faLZ: 21,
  uaRX: 22, uaRY: 23, uaRZ: 24, faRX: 25, faRY: 26, faRZ: 27,
  thLX: 28, thLY: 29, thLZ: 30, shnLX: 31, ftLX: 32,
  thRX: 33, thRY: 34, thRZ: 35, shnRX: 36, ftRX: 37,
  rootPitch: 38, rootRoll: 39, rootDy: 40, rootYaw: 41,
  N: 42,
} as const;

export interface PoseInput {
  state: string;
  stateName: string;
  stateT: number;
  stateDur: number;
  speed: number;
  maxSpeed: number;
  stride: number;
  /** angular velocity of the heading (rad/s) */
  turn: number;
  /** forward acceleration (m/s^2) */
  accel: number;
  hasBall: boolean;
  ballSide: 'L' | 'R';
  dominantFoot: 'L' | 'R';
  weakFoot: number;
  isKeeper: boolean;
  tired: number;
  /** ball position relative to the player in its local frame (x = left, z = forward, y = up) */
  ballLocal: { x: number; y: number; z: number } | null;
  skillAnim: string | null;
  skillU: number;
  skillSide: number;
  /** dive direction in the player's local frame: +1 = left side, -1 = right side */
  diveSide: number;
  diveHeight: number;
  celebrateId: number;
  celebrateT: number;
  /** pose style of non-player characters */
  role: 'player' | 'referee' | 'assistant';
  /** referee arm: 0 none, 1 card raised */
  armUp: number;
  flag: number;
  /** idle phase offset to desync players */
  seed: number;
  time: number;
  kickPower: number;
}

export class PoseState {
  cur = new Float32Array(CH.N);
  tgt = new Float32Array(CH.N);
  hair = 0; hairV = 0;
  prevTurnFace = 0;
  smoothSpeed = 0;
  lastKickStateT = 0;
  kickIk = 0;
  lastState = 'normal';
}

const sin = Math.sin, cos = Math.cos, PI = Math.PI;
const smooth = (u: number): number => u * u * (3 - 2 * u);

function legSwing(t: Float32Array, side: 'L' | 'R', phase: number, A: number, K: number, walkF: number): void {
  const s = sin(phase), c = cos(phase);
  const th = side === 'L' ? CH.thLX : CH.thRX;
  const shn = side === 'L' ? CH.shnLX : CH.shnRX;
  const ft = side === 'L' ? CH.ftLX : CH.ftRX;
  t[th] = -A * s;
  t[shn] = K * Math.max(0, c) + 0.1 * walkF + 0.25 * Math.max(0, -s) * A;
  t[ft] = -(t[th]! + t[shn]!) * 0.3 + 0.35 * Math.max(0, -s) * walkF;
}

/** Fills the target vector for the current state. Pure function of the input. */
export function solveTarget(inp: PoseInput, ps: PoseState): void {
  const t = ps.tgt;
  t.fill(0);
  const sf = clamp(inp.speed / Math.max(inp.maxSpeed, 1), 0, 1.1);
  const walkF = clamp(inp.speed / 2.0, 0, 1);
  const phase = inp.stride * PI * 2;
  const L = (n: number): number => n; void L;
  const kickFoot = inp.ballSide;
  const keeper = inp.isKeeper;

  // ---------------- locomotion base ----------------
  const A = lerp(0.28, 0.95, sf) * walkF;
  const K = lerp(0.3, 1.75, sf) * walkF;
  legSwing(t, 'L', phase, A, K, walkF);
  legSwing(t, 'R', phase + PI, A, K, walkF);
  const aa = lerp(0.25, 0.9, sf) * walkF * (inp.hasBall ? 0.55 : 1) * (inp.role === 'assistant' ? 0.5 : 1);
  t[CH.uaLX] = aa * sin(phase); t[CH.uaRX] = -aa * sin(phase);
  t[CH.uaLZ] = 0.1 + 0.05 * sf; t[CH.uaRZ] = -0.1 - 0.05 * sf;
  t[CH.faLX] = -(0.35 + 0.9 * sf) * (keeper ? 1.3 : 1); t[CH.faRX] = -(0.35 + 0.9 * sf) * (keeper ? 1.3 : 1);
  t[CH.pelvisY] = 0.14 * sf * sin(phase);
  t[CH.spineY] = -0.2 * sf * sin(phase);
  t[CH.chestY] = -0.1 * sf * sin(phase);
  t[CH.pelvisDy] = -0.025 * walkF - 0.045 * sf * Math.abs(cos(phase)) * 0 + (0.03 * sf * Math.abs(sin(phase * 1)));
  const lean = 0.05 + 0.32 * sf + clamp(inp.accel * 0.02, -0.12, 0.2) + inp.tired * 0.12;
  t[CH.spineX] = lean * 0.6; t[CH.chestX] = lean * 0.4;
  t[CH.neckX] = -lean * 0.5; t[CH.headX] = -lean * 0.3 + (inp.hasBall ? 0.18 : 0);
  t[CH.rootRoll] = clamp(-inp.turn * 0.04 * sf, -0.3, 0.3);

  // idle life
  const breathe = sin(inp.time * 1.9 + inp.seed) * 0.02;
  if (walkF < 0.4) {
    t[CH.spineX] += breathe + inp.tired * 0.2; t[CH.chestX] += breathe * 0.6;
    t[CH.uaLZ] += 0.05; t[CH.uaRZ] -= 0.05;
    if (inp.tired > 0.62 && inp.role === 'player' && !keeper) {
      // hands on hips
      t[CH.uaLX] = -0.25; t[CH.uaLZ] = 0.75; t[CH.faLX] = -1.7;
      t[CH.uaRX] = -0.25; t[CH.uaRZ] = -0.75; t[CH.faRX] = -1.7;
      t[CH.headX] = 0.25;
    }
  }
  if (keeper && inp.state === 'normal') {
    // goalkeeper ready stance: knees bent, arms out
    const crouch = (1 - walkF) * 0.9 + 0.25;
    t[CH.pelvisDy] -= 0.1 * crouch;
    t[CH.thLX] -= 0.35 * crouch; t[CH.thRX] -= 0.35 * crouch;
    t[CH.shnLX] += 0.65 * crouch; t[CH.shnRX] += 0.65 * crouch;
    t[CH.spineX] += 0.25 * crouch; t[CH.neckX] -= 0.2 * crouch;
    t[CH.uaLX] = -0.55; t[CH.uaRX] = -0.55; t[CH.uaLZ] = 0.55; t[CH.uaRZ] = -0.55;
    t[CH.faLX] = -0.9; t[CH.faRX] = -0.9;
  }

  // look at the ball
  if (inp.ballLocal && inp.role !== 'assistant') {
    const b = inp.ballLocal;
    let yaw = Math.atan2(b.x, Math.max(b.z, 0.01));
    if (b.z < 0) yaw = Math.sign(b.x || 1) * Math.min(1.3, Math.abs(Math.atan2(b.x, b.z)));
    yaw = clamp(yaw, -1.1, 1.1);
    const dist = Math.hypot(b.x, b.z);
    const pitch = clamp(Math.atan2(1.55 - b.y, Math.max(dist, 0.4)), -0.5, 0.9);
    t[CH.neckY] = yaw * 0.45; t[CH.headY] = yaw * 0.45;
    t[CH.neckX] += pitch * 0.4; t[CH.headX] += pitch * 0.3;
  }

  // ---------------- states ----------------
  const u = inp.stateDur > 0 ? clamp01(inp.stateT / inp.stateDur) : 0;
  const tt = inp.stateT;
  switch (inp.state) {
    case 'kick': {
      const kickIsL = kickFoot === 'L';
      const K_th = kickIsL ? CH.thLX : CH.thRX, K_shn = kickIsL ? CH.shnLX : CH.shnRX, K_ft = kickIsL ? CH.ftLX : CH.ftRX;
      const P_th = kickIsL ? CH.thRX : CH.thLX, P_shn = kickIsL ? CH.shnRX : CH.shnLX;
      const weakAwk = inp.dominantFoot !== kickFoot && inp.weakFoot <= 2 ? (3 - inp.weakFoot) * 0.5 : 0;
      const power = 0.7 + inp.kickPower * 0.5;
      let back: number, fwd: number;
      if (tt < 0.08) { const s = tt / 0.08; back = s; fwd = 0; t[K_th] = 0.9 * s * power; t[K_shn] = 1.35 * s; }
      else if (tt < 0.18) { const s = smooth((tt - 0.08) / 0.1); t[K_th] = lerp(0.9 * power, -1.3 * power, s); t[K_shn] = lerp(1.35, 0.15, s); back = 1 - s; fwd = s; }
      else { const s = smooth((tt - 0.18) / 0.14); t[K_th] = lerp(-1.3 * power, -0.35, s); t[K_shn] = lerp(0.15, 0.5, s); back = 0; fwd = 1 - s; }
      t[K_ft] = 0.5 * fwd - 0.2;
      t[P_th] = -0.18; t[P_shn] = 0.3 + 0.2 * fwd;
      t[CH.spineX] += -0.18 * back + 0.3 * fwd + weakAwk * 0.2;
      t[CH.pelvisY] += (kickIsL ? -1 : 1) * (0.25 * fwd - 0.15 * back) * (1 + weakAwk);
      const wide = 0.5 + weakAwk * 0.6;
      t[CH.uaLZ] = wide + 0.3 * fwd; t[CH.uaRZ] = -(wide + 0.3 * fwd);
      t[CH.uaLX] = (kickIsL ? 0.3 : -0.5) * fwd; t[CH.uaRX] = (kickIsL ? -0.5 : 0.3) * fwd;
      t[CH.pelvisDy] -= 0.05;
      break;
    }
    case 'tackle': {
      const lead = inp.ballSide === 'L' ? CH.thLX : CH.thRX, leadK = inp.ballSide === 'L' ? CH.shnLX : CH.shnRX;
      const s = sin(clamp01(u * 1.3) * PI);
      t[lead] = -1.05 * s; t[leadK] = 0.15 * s;
      const plant = inp.ballSide === 'L' ? CH.thRX : CH.thLX, plantK = inp.ballSide === 'L' ? CH.shnRX : CH.shnLX;
      t[plant] = 0.35 * s; t[plantK] = 0.9 * s;
      t[CH.spineX] += 0.4 * s; t[CH.pelvisDy] -= 0.2 * s;
      t[CH.uaLZ] = 0.9; t[CH.uaRZ] = -0.9; t[CH.uaLX] = -0.3; t[CH.uaRX] = -0.3;
      break;
    }
    case 'slide': {
      const s = smooth(clamp01(u * 5));
      const rec = smooth(clamp01((u - 0.7) / 0.3));
      const k = s * (1 - rec);
      t[CH.pelvisX] = -1.25 * k; t[CH.pelvisDy] = -0.7 * k;
      t[CH.thRX] = -0.15 * k; t[CH.shnRX] = 0.05 * k;
      t[CH.thLX] = -0.4 * k; t[CH.shnLX] = 1.5 * k;
      t[CH.uaLX] = 0.9 * k; t[CH.uaRX] = 0.9 * k; t[CH.uaLZ] = 0.9 * k; t[CH.uaRZ] = -0.9 * k;
      t[CH.spineX] = 0.45 * k; t[CH.neckX] = 0.2 * k;
      break;
    }
    case 'jump': {
      const s = sin(u * PI);
      t[CH.rootDy] = (keeper ? 0.55 : 0.4) * s;
      t[CH.thLX] = -0.5 * s; t[CH.shnLX] = 1.0 * s; t[CH.thRX] = -0.2 * s; t[CH.shnRX] = 0.5 * s;
      const arm = keeper ? -2.7 : -1.1;
      t[CH.uaLX] = arm * s; t[CH.uaRX] = arm * s; t[CH.uaLZ] = (keeper ? 0.25 : 0.7) * s; t[CH.uaRZ] = -(keeper ? 0.25 : 0.7) * s;
      t[CH.faLX] = (keeper ? -0.1 : -0.8) * s; t[CH.faRX] = (keeper ? -0.1 : -0.8) * s;
      t[CH.spineX] += (u < 0.5 ? -0.25 : 0.35) * s; t[CH.headX] += (u > 0.4 ? 0.3 : -0.2) * s;
      break;
    }
    case 'dive': case 'save': {
      if (inp.state === 'save') { t[CH.uaLX] = -1.5; t[CH.uaRX] = -1.5; t[CH.faLX] = -1.0; t[CH.faRX] = -1.0; t[CH.spineX] += 0.3; t[CH.thLX] = -0.3; t[CH.thRX] = -0.3; t[CH.shnLX] = 0.6; t[CH.shnRX] = 0.6; break; }
      const side = inp.diveSide; // +1 = to the player's left
      const s = smooth(clamp01(u * 3.2));
      const ground = smooth(clamp01((u - 0.55) / 0.3));
      const hi = clamp01((inp.diveHeight - 0.4) / 1.8);
      t[CH.rootRoll] = -side * (1.25 + 0.1 * (1 - hi)) * s;
      t[CH.rootDy] = (0.35 + 0.5 * hi) * sin(clamp01(u * 1.5) * PI) * (1 - ground * 0.8) - 0.1 * ground;
      t[CH.uaLX] = -2.55 * s; t[CH.uaRX] = -2.55 * s; t[CH.uaLZ] = 0.15; t[CH.uaRZ] = -0.15;
      t[CH.faLX] = -0.1; t[CH.faRX] = -0.1;
      t[CH.thLX] = 0.2 * s; t[CH.thRX] = -0.4 * s; t[CH.shnRX] = 0.6 * s; t[CH.shnLX] = 0.2 * s;
      t[CH.spineX] += -0.1 * s; t[CH.headY] = 0;
      break;
    }
    case 'down': {
      const s = smooth(clamp01(u * 4));
      const injured = inp.stateDur > 3;
      t[CH.pelvisX] = -1.35 * s; t[CH.pelvisDy] = -0.78 * s;
      t[CH.thLX] = -0.4 * s; t[CH.thRX] = -0.2 * s; t[CH.shnLX] = 0.8 * s; t[CH.shnRX] = 0.3 * s;
      t[CH.uaLX] = (injured ? -1.0 : 0.6) * s; t[CH.uaRX] = (injured ? -0.4 : 0.6) * s; t[CH.uaLZ] = 0.6 * s; t[CH.uaRZ] = -0.6 * s;
      t[CH.spineX] = (injured ? 0.9 : 0.2) * s;
      if (injured) { t[CH.faLX] = -1.2; t[CH.rootRoll] = 0.0; }
      // get up
      const gu = smooth(clamp01((u - 0.82) / 0.18));
      for (const c of [CH.pelvisX, CH.pelvisDy, CH.thLX, CH.thRX, CH.shnLX, CH.shnRX, CH.uaLX, CH.uaRX, CH.uaLZ, CH.uaRZ, CH.spineX]) t[c] = t[c]! * (1 - gu);
      break;
    }
    case 'stumble': {
      const s = sin(u * PI);
      t[CH.spineX] += 0.55 * s; t[CH.uaLX] = -0.7 * s + sin(inp.time * 22) * 0.3 * s; t[CH.uaRX] = -0.7 * s - sin(inp.time * 22) * 0.3 * s;
      t[CH.uaLZ] = 0.9 * s; t[CH.uaRZ] = -0.9 * s; t[CH.thLX] -= 0.2 * s; t[CH.shnRX] += 0.3 * s;
      break;
    }
    case 'throw': {
      const s1 = smooth(clamp01(u / 0.45)), s2 = smooth(clamp01((u - 0.45) / 0.25));
      const raise = -2.9 * s1 + 1.3 * s2;
      t[CH.uaLX] = raise; t[CH.uaRX] = raise; t[CH.faLX] = -1.4 * s1 * (1 - s2); t[CH.faRX] = -1.4 * s1 * (1 - s2);
      t[CH.uaLZ] = 0.15; t[CH.uaRZ] = -0.15;
      t[CH.spineX] += -0.35 * s1 + 0.7 * s2; t[CH.thLX] = -0.2; t[CH.thRX] = 0.1;
      break;
    }
    case 'celebrate': {
      celebration(t, inp);
      break;
    }
    case 'sit': {
      t[CH.pelvisDy] = -0.5; t[CH.thLX] = -1.55; t[CH.thRX] = -1.55; t[CH.shnLX] = 1.5; t[CH.shnRX] = 1.5; t[CH.ftLX] = 0.1; t[CH.ftRX] = 0.1;
      t[CH.spineX] = 0.12 + sin(inp.time * 0.7 + inp.seed) * 0.02; t[CH.uaLX] = -0.5; t[CH.uaRX] = -0.5; t[CH.faLX] = -1.2; t[CH.faRX] = -1.2;
      t[CH.headY] = sin(inp.time * 0.4 + inp.seed) * 0.4;
      break;
    }
    case 'crew': {
      t[CH.uaLX] = -1.5; t[CH.uaRX] = -1.4; t[CH.faLX] = -1.3; t[CH.faRX] = -1.4; t[CH.uaLZ] = 0.1; t[CH.uaRZ] = -0.1; t[CH.spineX] = 0.12; t[CH.headX] = 0.1;
      break;
    }
    case 'skill': {
      skillPose(t, inp);
      break;
    }
    default: break;
  }

  // role-specific overrides
  if (inp.role === 'referee' && inp.armUp > 0) { t[CH.uaRX] = -2.9; t[CH.uaRZ] = -0.1; t[CH.faRX] = -0.15; }
  if (inp.role === 'assistant' && inp.flag > 0) { t[CH.uaRX] = -2.7; t[CH.uaRZ] = -0.2; t[CH.faRX] = -0.1; }
  if (inp.role === 'assistant' && inp.flag === 0) { t[CH.uaRX] = -0.2; t[CH.uaRZ] = -0.15; t[CH.faRX] = -0.4; }
}

function celebration(t: Float32Array, inp: PoseInput): void {
  const id = inp.celebrateId % 6;
  const tt = inp.celebrateT;
  const bounce = Math.abs(sin(tt * 7));
  switch (id) {
    case 0: // airplane run
      t[CH.uaLZ] = 1.45; t[CH.uaRZ] = -1.45; t[CH.uaLX] = 0; t[CH.uaRX] = 0; t[CH.faLX] = 0; t[CH.faRX] = 0;
      t[CH.rootRoll] = sin(tt * 3) * 0.12; t[CH.headX] = -0.2; t[CH.spineX] += 0.1;
      break;
    case 1: // fist pump
      t[CH.uaRX] = -2.5 + sin(tt * 9) * 0.25; t[CH.faRX] = -1.2; t[CH.uaLX] = -0.5; t[CH.faLX] = -1.6; t[CH.uaLZ] = 0.4;
      t[CH.headX] = -0.4; t[CH.rootDy] = bounce * 0.12; t[CH.spineX] = -0.1;
      break;
    case 2: { // knee slide
      t[CH.pelvisDy] = -0.42; t[CH.thRX] = -1.45; t[CH.shnRX] = 1.5; t[CH.thLX] = 0.3; t[CH.shnLX] = 1.9;
      t[CH.uaLX] = -2.4; t[CH.uaRX] = -2.4; t[CH.uaLZ] = 0.6; t[CH.uaRZ] = -0.6; t[CH.spineX] = -0.25; t[CH.headX] = -0.5;
      break;
    }
    case 3: // point to sky
      t[CH.uaRX] = -3.0; t[CH.uaRZ] = -0.15; t[CH.faRX] = -0.05; t[CH.uaLX] = -0.3; t[CH.faLX] = -1.2; t[CH.headX] = -0.6; t[CH.neckX] = -0.3; t[CH.rootDy] = bounce * 0.08;
      break;
    case 4: // cup ears
      t[CH.uaLX] = -1.0; t[CH.uaLZ] = 1.2; t[CH.faLX] = -2.0; t[CH.uaRX] = -1.0; t[CH.uaRZ] = -1.2; t[CH.faRX] = -2.0; t[CH.headZ] = 0.2; t[CH.spineX] = -0.1; t[CH.rootDy] = bounce * 0.05;
      break;
    default: // crossed arms
      t[CH.uaLX] = -0.9; t[CH.uaLZ] = -0.5; t[CH.faLX] = -2.3; t[CH.uaRX] = -0.9; t[CH.uaRZ] = 0.5; t[CH.faRX] = -2.3; t[CH.headX] = -0.2; t[CH.spineX] = -0.12;
  }
}

function skillPose(t: Float32Array, inp: PoseInput): void {
  const u = clamp01(inp.skillU);
  const side = inp.skillSide;
  const ballFoot = inp.ballSide === 'L' ? [CH.thLX, CH.shnLX, CH.thLZ] : [CH.thRX, CH.shnRX, CH.thRZ];
  const otherFoot = inp.ballSide === 'L' ? [CH.thRX, CH.shnRX, CH.thRZ] : [CH.thLX, CH.shnLX, CH.thLZ];
  const s = sin(u * PI);
  const fast = sin(u * PI * 4);
  t[CH.uaLZ] = 0.6; t[CH.uaRZ] = -0.6; t[CH.spineX] += 0.2; t[CH.pelvisDy] = -0.08;
  switch (inp.skillAnim) {
    case 'feint': t[CH.rootRoll] = side * 0.3 * sin(u * PI * 2); t[CH.spineZ] = side * 0.3 * sin(u * PI * 2); t[CH.thLX] = -0.3 * s; t[CH.thRX] = -0.3 * s; t[CH.shnLX] = 0.6 * s; t[CH.shnRX] = 0.6 * s; break;
    case 'stepOver': t[ballFoot[0]!] = -0.9 * s; t[ballFoot[1]!] = 0.5 * s; t[ballFoot[2]!] = side * 0.55 * sin(u * PI * 2); t[otherFoot[1]!] = 0.35; t[CH.pelvisY] = 0.3 * fast; break;
    case 'dragBack': t[ballFoot[0]!] = -0.75 * s; t[ballFoot[1]!] = 0.25 * s; t[CH.spineX] += -0.15 * s; t[otherFoot[1]!] = 0.4 * s; break;
    case 'roll': t[ballFoot[0]!] = -0.6 * s; t[ballFoot[2]!] = side * 0.45 * s; t[ballFoot[1]!] = 0.3; t[CH.spineZ] = side * 0.18 * s; break;
    case 'spin': t[CH.uaLZ] = 1.0; t[CH.uaRZ] = -1.0; t[CH.spineX] += 0.15; t[CH.thLX] = -0.4 * s; t[CH.shnRX] = 0.6 * s; t[CH.pelvisDy] = -0.12 * s; break;
    case 'flick': t[ballFoot[0]!] = -1.25 * s; t[ballFoot[1]!] = 0.7 * s; t[otherFoot[1]!] = 0.5 * s; t[CH.rootDy] = 0.08 * s; t[CH.spineX] += -0.2 * s; break;
    case 'lift': t[ballFoot[0]!] = -1.0 * s; t[ballFoot[1]!] = 0.9 * s; t[CH.rootDy] = 0.15 * s; t[CH.uaLX] = -0.9 * s; t[CH.uaRX] = -0.9 * s; break;
    case 'hop': t[CH.rootDy] = 0.2 * Math.abs(sin(u * PI * 2)); t[CH.thLX] = -0.4 * Math.abs(fast); t[CH.thRX] = -0.4 * Math.abs(fast); t[CH.shnLX] = 0.8 * Math.abs(fast); t[CH.shnRX] = 0.8 * Math.abs(fast); break;
    case 'stop': t[CH.spineX] += -0.35 * s; t[CH.thLX] = -0.55 * s; t[CH.thRX] = 0.3 * s; t[CH.shnLX] = 0.4 * s; t[CH.pelvisDy] = -0.15 * s; break;
    case 'burst': t[CH.spineX] += 0.45 * s; t[CH.thLX] = -0.9 * s; t[CH.shnRX] = 1.0 * s; break;
    case 'shuffle': t[CH.thLX] = -0.5 * fast; t[CH.thRX] = 0.5 * fast; t[CH.shnLX] = 0.6 * Math.abs(fast); t[CH.shnRX] = 0.6 * Math.abs(fast); t[CH.spineZ] = side * 0.2 * sin(u * PI * 2); break;
    case 'fakeKick': { const k = u < 0.4 ? u / 0.4 : 1 - (u - 0.4) / 0.6; t[ballFoot[0]!] = 0.9 * k * (u < 0.4 ? 1 : 0.3) - 1.0 * (u > 0.35 ? s : 0); t[ballFoot[1]!] = 1.3 * k; t[CH.spineX] += -0.15 * k; break; }
    default: break;
  }
}

const tmpQ = new Quaternion(); const tmpV = new Vector3(); const tmpV2 = new Vector3(); const restDir = new Vector3(0, -1, 0);

/** Smooths towards the target and writes bone transforms. */
export function applyPose(rig: Rig, inp: PoseInput, ps: PoseState, dt: number, ballWorld: Vector3 | null): void {
  solveTarget(inp, ps);
  // blend speed: fast for impact states, softer otherwise
  const fastState = inp.state === 'kick' || inp.state === 'tackle' || inp.state === 'slide' || inp.state === 'dive' || inp.state === 'save';
  const rate = fastState ? 28 : inp.state === 'skill' ? 22 : 14;
  const k = 1 - Math.exp(-rate * dt);
  const c = ps.cur, t = ps.tgt;
  if (ps.lastState !== inp.state) ps.lastState = inp.state;
  for (let i = 0; i < CH.N; i++) c[i] = c[i]! + (t[i]! - c[i]!) * k;
  const b = rig.bones;
  b.pelvis.rotation.set(c[CH.pelvisX]!, c[CH.pelvisY]!, c[CH.pelvisZ]!);
  b.pelvis.position.y = DIM.pelvisY + c[CH.pelvisDy]!;
  b.spine.rotation.set(c[CH.spineX]!, c[CH.spineY]!, c[CH.spineZ]!);
  b.chest.rotation.set(c[CH.chestX]!, c[CH.chestY]!, c[CH.chestZ]!);
  b.neck.rotation.set(c[CH.neckX]!, c[CH.neckY]!, c[CH.neckZ]!);
  b.head.rotation.set(c[CH.headX]!, c[CH.headY]!, c[CH.headZ]!);
  b.uaL.rotation.set(c[CH.uaLX]!, c[CH.uaLY]!, c[CH.uaLZ]!);
  b.faL.rotation.set(c[CH.faLX]!, c[CH.faLY]!, c[CH.faLZ]!);
  b.uaR.rotation.set(c[CH.uaRX]!, c[CH.uaRY]!, c[CH.uaRZ]!);
  b.faR.rotation.set(c[CH.faRX]!, c[CH.faRY]!, c[CH.faRZ]!);
  b.thL.rotation.set(c[CH.thLX]!, c[CH.thLY]!, c[CH.thLZ]!);
  b.shnL.rotation.set(c[CH.shnLX]!, 0, 0);
  b.ftL.rotation.set(c[CH.ftLX]!, 0, 0);
  b.thR.rotation.set(c[CH.thRX]!, c[CH.thRY]!, c[CH.thRZ]!);
  b.shnR.rotation.set(c[CH.shnRX]!, 0, 0);
  b.ftR.rotation.set(c[CH.ftRX]!, 0, 0);
  const root = rig.root;
  root.userData.pitch = c[CH.rootPitch]!; root.userData.roll = c[CH.rootRoll]!; root.userData.dy = c[CH.rootDy]!;

  // hair spring (secondary motion)
  const target = clamp(inp.speed * 0.05, 0, 0.5) + (inp.state === 'jump' ? -0.2 : 0);
  ps.hairV += ((target - ps.hair) * 80 - ps.hairV * 9) * dt;
  ps.hair += ps.hairV * dt;
  b.hair1.rotation.x = ps.hair + 0.1; b.hair2.rotation.x = ps.hair * 0.8;

  // ball-contact IK for the striking / touching leg
  let w = 0;
  let legSide: 'L' | 'R' = inp.ballSide;
  if (ballWorld && inp.state === 'kick') {
    const tt = inp.stateT;
    w = tt < 0.07 ? tt / 0.07 * 0.5 : tt < 0.2 ? 1 : clamp01(1 - (tt - 0.2) / 0.1);
    w *= 0.85;
  } else if (ballWorld && inp.state === 'skill' && inp.skillAnim && ['stepOver', 'dragBack', 'roll', 'flick', 'fakeKick', 'lift'].includes(inp.skillAnim)) {
    w = 0.7 * Math.sin(clamp01(inp.skillU) * PI);
  } else if (ballWorld && inp.state === 'tackle') {
    w = 0.8 * Math.sin(clamp01(inp.stateT / Math.max(inp.stateDur, 0.01)) * PI);
  }
  ps.kickIk += (w - ps.kickIk) * Math.min(1, dt * 30);
  if (ballWorld && ps.kickIk > 0.02) {
    root.updateMatrixWorld(true);
    const hip = legSide === 'L' ? b.thL : b.thR;
    const knee = legSide === 'L' ? b.shnL : b.shnR;
    // target in hip-local space
    tmpV.copy(ballWorld);
    tmpV.y = Math.max(0.12, ballWorld.y - 0.02);
    b.pelvis.worldToLocal(tmpV);
    // aim the ankle slightly behind-below the ball centre so the boot meets it
    tmpV.z -= 0.1 / rig.scale; tmpV.y += 0.06 / rig.scale;
    solveLeg(hip as unknown as Object3DLike, knee as unknown as Object3DLike, tmpV, DIM.thigh, DIM.shin, ps.kickIk);
  }
  void legSide; void angleDiff; void tmpV2;
}

/** Two-bone leg IK. `target` is the wanted ankle position in the hip's PARENT space. */
function solveLeg(hip: Object3DLike, knee: Object3DLike, target: Vector3, l1: number, l2: number, weight: number): void {
  const hp = hip.position;
  const v = tmpV2.copy(target).sub(hp);
  const dist = clamp(v.length(), 0.15, l1 + l2 - 0.002);
  const vhat = v.normalize();
  const cosHip = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const hipOff = Math.acos(cosHip);
  const pole = tmpPole.set(0, 0, 1);
  const axis = tmpAxis.crossVectors(vhat, pole);
  if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
  axis.normalize();
  const a = tmpA.copy(vhat).applyAxisAngle(axis, hipOff).normalize();           // thigh direction
  const ankle = tmpAnkle.copy(vhat).multiplyScalar(dist).add(hp);
  const kneePos = tmpKnee.copy(a).multiplyScalar(l1).add(hp);
  const sd = tmpS.copy(ankle).sub(kneePos).normalize();                          // shin direction
  const n = tmpN.crossVectors(a, sd);
  if (n.lengthSq() < 1e-8) n.set(1, 0, 0);
  n.normalize();
  // basis: local x = n (knee hinge), local y = -a (thigh points down at rest), z = x × y
  const yAxis = tmpY.copy(a).multiplyScalar(-1);
  const zAxis = tmpZ.crossVectors(n, yAxis);
  basisM.makeBasis(n, yAxis, zAxis);
  tmpQ.setFromRotationMatrix(basisM);
  const flex = Math.acos(clamp(a.dot(sd), -1, 1));
  hip.quaternion.slerp(tmpQ, weight);
  knee.rotation.x = lerp(knee.rotation.x, flex, weight);
}

const tmpPole = new Vector3(), tmpAxis = new Vector3(), tmpA = new Vector3(), tmpAnkle = new Vector3(), tmpKnee = new Vector3(), tmpS = new Vector3(), tmpN = new Vector3(), tmpY = new Vector3(), tmpZ = new Vector3();
const basisM = new Matrix4();

interface Object3DLike { quaternion: Quaternion; rotation: { x: number }; position: Vector3; worldToLocal(v: Vector3): Vector3; parent: { worldToLocal(v: Vector3): Vector3 } | null }
