import { angleDiff, clamp, clamp01, lerp } from '../core/math';
import { BALL_R, GOAL_H, GRAVITY, HALF_GOAL, HALF_L, HALF_W } from './constants';
import { rollSpeedFor } from './ball';
import type { MPlayer } from './entities';
import type { Match } from './match';
import type { PassKind, ShotKind } from './types';

const K_DRAG = 0.0132;

export interface Strike { vx: number; vy: number; vz: number; wx: number; wy: number; wz: number; knuckle: number }

/** Launch velocity to reach (tx,ty,tz) from (x,y,z) in time T under gravity, with drag compensation. */
export function ballisticTo(x: number, y: number, z: number, tx: number, ty: number, tz: number, T: number): { vx: number; vy: number; vz: number } {
  T = Math.max(0.25, T);
  const dx = tx - x, dy = ty - y;
  let vx = dx / T, vy = dy / T;
  let vz = (tz - z + 0.5 * GRAVITY * T * T) / T;
  const vh = Math.hypot(vx, vy);
  const comp = 1 + K_DRAG * Math.hypot(vh, vz) * T * 0.5;
  vx *= comp; vy *= comp; vz *= 1 + K_DRAG * Math.hypot(vh, vz) * T * 0.35;
  return { vx, vy, vz };
}

export function pressureOn(m: Match, p: MPlayer): number {
  let best = 99;
  for (const o of m.teams[p.side === 0 ? 1 : 0].players) {
    if (!o.active()) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < best) best = d;
  }
  return clamp01(1 - (best - 0.6) / 3.2);
}

/** xG for a shot from (x,y) at a goal at gx. */
export function expectedGoals(x: number, y: number, gx: number, header = false): number {
  const dx = Math.abs(gx - x);
  const d = Math.hypot(dx, y);
  const a = Math.atan2(7.32 * dx, dx * dx + y * y - (7.32 / 2) ** 2);
  const ang = a < 0 ? a + Math.PI : a;
  const logit = -0.4 - 0.115 * d + 1.55 * ang - (header ? 0.7 : 0);
  return 1 / (1 + Math.exp(-logit));
}

/** Which foot strikes the ball for a target angle; weak-foot multipliers. */
export function footFor(p: MPlayer, targetAngle: number): { foot: 'L' | 'R'; weak: boolean; accMult: number; powMult: number } {
  if (p.state === 'jump') return { foot: p.data.foot, weak: false, accMult: 1, powMult: 1 };
  const d = angleDiff(p.face, targetAngle);
  let foot: 'L' | 'R' = d > 0.35 ? 'R' : d < -0.35 ? 'L' : p.data.foot;
  // players with a good weak foot use it more freely
  if (Math.abs(d) <= 0.35 && p.ballSide) foot = p.data.foot;
  const weak = foot !== p.data.foot;
  const wf = p.data.weakFoot;
  return { foot, weak, accMult: weak ? 1 + (5 - wf) * 0.3 : 1, powMult: weak ? 0.8 + wf * 0.04 : 1 };
}

function attackGoalX(m: Match, p: MPlayer): number { return m.teams[p.side].dir * HALF_L; }

// ---------- PASSING ----------

export interface PassSpec {
  kind: PassKind;
  tx: number; ty: number;
  receiver: MPlayer | null;
  /** 0..1 hold power; 0.35 ≈ "natural weight" */
  power: number;
  /** extra error multiplier (e.g. first-time) */
  sloppy?: number;
  /** 0..1 assist level from settings */
  assist?: number;
  curve?: number; // -1..1 desired curl
}

export function executePass(m: Match, p: MPlayer, s: PassSpec): void {
  const b = m.ball;
  const a = p.data.attrs;
  let tx = s.tx, ty = s.ty;
  const ang = Math.atan2(ty - b.y, tx - b.x);
  const f = footFor(p, ang);
  const press = pressureOn(m, p);
  const kindSkill = s.kind === 'cross' || s.kind === 'lowCross' ? a.crossing : s.kind === 'lob' || s.kind === 'throughLob' || s.kind === 'clear' ? a.longPass : a.shortPass;
  const vis = (a.vision + kindSkill) / 2;
  const assist = s.assist ?? 0.5;
  const speedFactor = clamp01(p.speed / 9);
  let sigma = (0.085 - 0.07 * (kindSkill / 100)) * (1 + press * 0.55 + speedFactor * 0.15 + (p.tired * 0.25)) * f.accMult * (s.sloppy ?? 1);
  sigma *= 1 - assist * 0.82;
  if (s.power > 0.75) sigma *= 1 + (s.power - 0.75) * 1.4;
  const dist = Math.hypot(tx - b.x, ty - b.y);
  // kick-power quality: distance error
  const lenErr = 1 + m.rng.gauss(0, sigma * 0.9) * (s.kind === 'ground' || s.kind === 'through' ? 1 : 0.6);
  const yaw = m.rng.gauss(0, sigma);
  const dirAng = ang + yaw;
  const cos = Math.cos(dirAng), sin = Math.sin(dirAng);
  void vis;

  let vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0;
  const comfy = clamp(p.data.attrs.longPass / 100, 0.3, 1);
  switch (s.kind) {
    case 'ground': case 'through': case 'short': {
      const overhit = lerp(0.85, 1.55, clamp01((s.power - 0.2) / 0.8));
      const reachDist = Math.max(2, dist * (s.power <= 0.1 ? 1 : overhit) * lenErr);
      const arrive = lerp(6.8, 13.5, s.power);
      let v = rollSpeedFor(reachDist, arrive, m.ball.surface) * f.powMult;
      v = Math.min(v, 14 + 20 * comfy);
      vx = cos * v; vy = sin * v;
      // slight roll spin matches the ground roll
      wy = vx / BALL_R; wx = -vy / BALL_R;
      break;
    }
    case 'lob': case 'throughLob': case 'clear': case 'cross': case 'lowCross': case 'keeperKick': {
      const d = Math.max(4, dist * lenErr);
      const low = s.kind === 'lowCross';
      const clearing = s.kind === 'clear' || s.kind === 'keeperKick';
      const T = clamp(d / (low ? 26 : clearing ? 20 : s.kind === 'cross' ? 17 : 15) + (low ? 0.15 : clearing ? 0.9 : 0.55), 0.6, 3.4);
      const tz = low ? 0.6 : s.kind === 'cross' ? 1.8 : 0.2;
      const bal = ballisticTo(b.x, b.y, b.z, b.x + cos * d, b.y + sin * d, tz, T);
      const pm = lerp(0.96, 1.06, clamp01(s.power));
      vx = bal.vx * pm * (f.powMult * 0.1 + 0.9); vy = bal.vy * pm * (f.powMult * 0.1 + 0.9); vz = bal.vz * pm * (low ? 0.9 : 1) + (low ? 0 : m.rng.gauss(0, sigma * 3));
      // sidespin for crosses
      const curl = s.curve ?? (s.kind === 'cross' || s.kind === 'lowCross' ? (f.foot === 'R' ? -1 : 1) * 0.4 : 0);
      wz = curl * (12 + a.curve * 0.25);
      wy = -vx / 18; wx = vy / 18; // mild backspin
      break;
    }
    case 'keeperThrow': {
      const d = Math.max(3, dist);
      const T = clamp(d / 14 + 0.3, 0.5, 2);
      const bal = ballisticTo(b.x, b.y, b.z, b.x + cos * d, b.y + sin * d, 0.3, T);
      vx = bal.vx; vy = bal.vy; vz = bal.vz * 0.7;
      break;
    }
  }
  m.kickBall(p, vx, vy, vz, wx, wy, wz, 0, `pass:${s.kind}`);
  p.stats.passes++; m.teams[p.side].stats.passes++;
  p.ballSide = f.foot;
  m.registerPass(p, s.receiver, s.kind, tx, ty);
  m.bus.emit('pass', { player: p, target: s.receiver, kind: s.kind });
  m.bus.emit('kick', { player: p, power: clamp01(Math.hypot(vx, vy, vz) / 30), kind: s.kind });
}

// ---------- SHOOTING ----------

export interface ShotSpec {
  kind: ShotKind;
  /** -1..1 across the goal mouth (relative to attack direction: -1 = left post from shooter's view) */
  aimY: number;
  /** 0..1 height within the frame */
  aimH: number;
  power: number; // 0..1
  assist?: number;
  /** override target for set pieces */
  header?: boolean;
}

export function executeShot(m: Match, p: MPlayer, s: ShotSpec): { xg: number; speed: number } {
  const b = m.ball;
  const a = p.data.attrs;
  const dir = m.teams[p.side].dir;
  const gx = attackGoalX(m, p);
  const dx = Math.abs(gx - b.x);
  const dist = Math.hypot(dx, b.y);
  // world y of aim: "left from shooter's view" depends on attack dir
  const ty = dir * s.aimY * HALF_GOAL * 0.94;
  const tz = clamp(s.aimH * (GOAL_H - 0.25) + 0.15, 0.12, GOAL_H - 0.12);
  const ang = Math.atan2(ty - b.y, gx - b.x);
  const f = footFor(p, ang);
  const press = pressureOn(m, p);
  const longRange = clamp01((dist - 14) / 20);
  const finEff = lerp(a.finishing, a.longShots, longRange);
  const kindSkill = s.kind === 'volley' || s.kind === 'bicycle' ? (finEff * 0.6 + a.volleys * 0.4) : s.kind === 'header' ? (finEff * 0.4 + a.heading * 0.6) : s.kind === 'finesse' ? (finEff * 0.6 + a.curve * 0.4) : s.kind === 'penalty' ? a.penalties : s.kind === 'freeKick' ? a.freeKick : finEff;
  // angle quality: wide angles are harder
  const angleF = 1 + clamp01(Math.abs(b.y) / 22) * 0.25;
  let sigma = (0.12 - 0.09 * (kindSkill / 100)) * 1.75;
  sigma *= 1 + press * 0.5 + p.tired * 0.2;
  sigma *= f.accMult * angleF;
  const kindMult: Record<ShotKind, number> = { normal: 1, power: 1.35, finesse: 0.78, chip: 1.0, driven: 1.05, volley: 1.5, header: 1.3, bicycle: 2.0, outside: 1.2, penalty: 0.8, freeKick: 0.9 };
  sigma *= kindMult[s.kind];
  if (s.power > 0.8) sigma *= 1 + (s.power - 0.8) * 2.2;
  if (s.power < 0.25) sigma *= 1.1;
  sigma *= 1 - (s.assist ?? 0) * 0.75;
  if (p.data.traits.includes('Clinical Finisher') && dist < 22) sigma *= 0.82;
  if (p.data.traits.includes('Finesse Shot') && s.kind === 'finesse') sigma *= 0.85;
  if (p.data.traits.includes('Long Shot Taker') && dist > 20) sigma *= 0.85;

  const maxSpeed = 20 + 13 * (a.shotPower / 100);
  let speed = maxSpeed * lerp(0.62, 1, s.power) * f.powMult;
  const speedMult: Record<ShotKind, number> = { normal: 1, power: 1.12, finesse: 0.82, chip: 0.5, driven: 1.0, volley: 0.95, header: 0.55, bicycle: 0.85, outside: 0.95, penalty: 0.95, freeKick: 1.0 };
  speed *= speedMult[s.kind];
  speed = Math.max(8, speed);
  const d3 = Math.hypot(gx - b.x, ty - b.y);
  let T = d3 / speed;
  let tzAim = tz;
  let wx = 0, wy = 0, wz = 0, knuckle = 0;
  const curlSide = f.foot === 'R' ? 1 : -1; // finesse curls toward the far post from the dominant foot

  if (s.kind === 'chip') { T = clamp(d3 / 13, 0.6, 1.6); tzAim = clamp(tz + 0.5, 1.6, GOAL_H - 0.15); }
  if (s.kind === 'driven') { tzAim = Math.min(tzAim, 0.7); T = d3 / (speed * 1.05); }
  let aimYw = ty;
  if (s.kind === 'finesse' || s.kind === 'freeKick') {
    // aim off-line; spin curls it back in
    const spin = (s.kind === 'freeKick' ? 52 : 42) * (0.6 + a.curve / 250);
    wz = spin * curlSide * dir;
    const lateral = 0.5 * 0.0045 * spin * speed * T * T; // approx Magnus drift
    aimYw = ty - curlSide * dir * lateral * 0.85;
    wy = 3; wx = 3;
  }
  if (s.kind === 'power' || (s.kind === 'normal' && p.data.traits.includes('Long Shot Taker') && dist > 24 && m.rng.chance(0.3))) {
    knuckle = clamp01((a.shotPower - 70) / 40);
  }
  const bal = ballisticTo(b.x, b.y, b.z, gx, aimYw, tzAim, T);
  // inject errors: rotate yaw, perturb pitch
  const yaw = m.rng.gauss(0, sigma);
  const pitch = m.rng.gauss(0, sigma * 0.8);
  const vh = Math.hypot(bal.vx, bal.vy);
  const ha = Math.atan2(bal.vy, bal.vx) + yaw;
  let vz = bal.vz + vh * pitch * 0.8;
  if (s.kind === 'chip') vz += 0.4;
  const vxN = Math.cos(ha) * vh, vyN = Math.sin(ha) * vh;
  const xg = expectedGoals(b.x, b.y, gx, s.kind === 'header' || s.header === true);
  // is it on target? predict crossing
  m.kickBall(p, vxN, vyN, vz, wx, wy, wz, knuckle, `shot:${s.kind}`);
  const pr = m.predictGoalCrossing();
  const onTarget = !!pr && Math.abs(pr.y) < HALF_GOAL && pr.z < GOAL_H && pr.z > 0;
  p.stats.shots++; m.teams[p.side].stats.shots++;
  p.stats.xg += xg; m.teams[p.side].stats.xg += xg;
  if (onTarget) { p.stats.shotsOnTarget++; m.teams[p.side].stats.onTarget++; }
  m.registerShot(p, xg, onTarget);
  p.ballSide = f.foot;
  const sp = Math.hypot(vxN, vyN, vz);
  m.bus.emit('shot', { player: p, kind: s.kind, xg, speed: sp, onTarget });
  m.bus.emit('kick', { player: p, power: clamp01(sp / 34), kind: 'shot' });
  void HALF_W;
  return { xg, speed: sp };
}
