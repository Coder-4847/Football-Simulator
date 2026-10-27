import { angleDiff, clamp, clamp01, lerp } from '../core/math';
import { BALL_R, BOX_L, HALF_GOAL, HALF_L, HALF_W, other, PITCH_L, PITCH_W, type Side } from './constants';
import type { MPlayer, Team } from './entities';
import type { Match } from './match';
import { executePass, executeShot, expectedGoals, pressureOn, type PassSpec } from './actions';
import { doPassSetPiece, doShotSetPiece, doThrowIn, requestTackle, type SetPiece } from './rules';
import { gkAI } from './keeper';
import { startSkill } from './skillrun';
import { SKILL_MOVES } from './skills';
import type { PassKind } from './types';

// ---------- helpers ----------

export function distSegPoint(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-9 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function laneQuality(m: Match, side: Side, ax: number, ay: number, bx: number, by: number): number {
  let worst = 1;
  for (const o of m.teams[other(side)].players) {
    if (!o.active()) continue;
    const d = distSegPoint(ax, ay, bx, by, o.x, o.y);
    // opponents near the passer matter less (they cannot step across), and keepers rarely intercept
    const near = Math.hypot(o.x - ax, o.y - ay);
    const q = clamp((d - 1.0) / 2.4, 0, 1) + (near < 2 ? 0.2 : 0);
    if (q < worst) worst = Math.min(worst, clamp01(q));
  }
  return worst;
}

function nearestOppDist(m: Match, side: Side, x: number, y: number): number {
  let best = 99;
  for (const o of m.teams[other(side)].players) {
    if (!o.active()) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < best) best = d;
  }
  return best;
}

/** Positional value of a spot for a team: closer to the goal and more central is better. */
export function zoneValue(m: Match, side: Side, x: number, y: number): number {
  const dir = m.teams[side].dir;
  const d01 = clamp01((x * dir + HALF_L) / PITCH_L);
  const cen = 1 - Math.abs(y) / HALF_W * 0.5;
  return Math.pow(d01, 1.9) + 0.35 * cen * Math.pow(d01, 3.2);
}

export function secondLastDepth(m: Match, side: Side): number {
  const dir = m.teams[side].dir;
  const depths = m.teams[other(side)].players.filter((q) => q.active()).map((q) => q.x * dir).sort((a, b) => b - a);
  return depths[1] ?? depths[0] ?? HALF_L;
}

function goToward(p: MPlayer, tx: number, ty: number, opts: { sprintFar?: number; slowNear?: number } = {}): void {
  const dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  const it = p.intent;
  if (d < 0.25) { it.mx = 0; it.my = 0; it.sprint = false; return; }
  const slow = opts.slowNear ?? 2.5;
  const mag = d < slow ? clamp(d / slow, 0.25, 1) : 1;
  it.mx = (dx / d) * mag; it.my = (dy / d) * mag;
  it.sprint = d > (opts.sprintFar ?? 9);
}

function resetIntent(p: MPlayer): void {
  const it = p.intent;
  it.mx = 0; it.my = 0; it.sprint = false; it.jockey = false; it.precise = false; it.shield = false; it.faceAngle = null;
}

// ---------- team shape ----------

const ROLE_ATTACK_PUSH: Record<string, number> = {
  goalkeeper: 0, sweeperKeeper: 0, centreBack: 0, ballPlayingDefender: 0.02, fullBack: 0.08, wingBack: 0.14, anchor: 0.0,
  boxToBox: 0.1, playmaker: 0.06, winger: 0.1, invertedWinger: 0.1, shadowStriker: 0.08, targetMan: 0.06, poacher: 0.1, advancedForward: 0.1,
};

export function shapeTarget(m: Match, p: MPlayer, ballX: number, ballY: number, attacking: boolean): { x: number; y: number } {
  const t = m.teams[p.side];
  const dir = t.dir;
  const slot = t.formation.slots[p.slot]!;
  const tac = t.tactics;
  const line = tac.lineHeight / 100, comp = tac.compactness / 100, wid = tac.width / 100;
  const ballDepth = clamp01((ballX * dir + HALF_L) / PITCH_L);
  if (p.isGK()) {
    return { x: dir * (-HALF_L + 2.5), y: clamp(ballY * 0.1, -3, 3) };
  }
  let d = slot.x;
  const shift = (ballDepth - 0.5) * (0.5 + 0.3 * line);
  d += shift * (d < 0.3 ? 0.85 : 1);
  d += (ballDepth - d) * comp * 0.2;
  const push = ROLE_ATTACK_PUSH[p.role] ?? 0.05;
  if (attacking) {
    d += push * (0.4 + ballDepth);
    d += (line - 0.5) * 0.1;
  } else {
    d -= (1 - line) * 0.1 * (slot.x < 0.5 ? 1 : 0.5);
    // when defending, nobody (but the most advanced) stays much beyond the ball
    if (slot.x < 0.65) d = Math.min(d, ballDepth + 0.04);
    if (ballDepth < 0.3) d = Math.min(d, ballDepth + 0.1);
  }
  // offside line discipline for the defensive line when the trap is on: stay level with the last line
  if (!attacking && tac.offsideTrap && (p.slotPos === 'CB' || p.slotPos === 'LB' || p.slotPos === 'RB')) d += 0.03;
  d = clamp(d, 0.03, 0.97);
  let yn = 0.5 + (slot.y - 0.5) * (0.65 + 0.7 * wid);
  const yBall = 0.5 + (dir * ballY) / PITCH_W;
  yn += (yBall - yn) * (comp * 0.28 + (attacking ? 0.0 : 0.08));
  yn = clamp(yn, 0.03, 0.97);
  return { x: dir * (-HALF_L + d * PITCH_L), y: dir * (yn - 0.5) * PITCH_W };
}

// ---------- team-level context ----------

interface TeamCtx { attacking: boolean; pressers: MPlayer[]; chasers: MPlayer[]; marks: Map<number, MPlayer> }
const ctxCache = new WeakMap<Team, { tick: number; ctx: TeamCtx }>();

function interceptTime(m: Match, p: MPlayer): { t: number; x: number; y: number } {
  const track = m.getBallTrack();
  const v = m.maxSpeed(p) * 0.95;
  const reach = 0.5;
  for (const s of track) {
    if (s.z > 2.2) continue;
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d <= v * s.t + reach) return { t: s.t, x: s.x, y: s.y };
  }
  const last = track[track.length - 1]!;
  return { t: 9 + Math.hypot(last.x - p.x, last.y - p.y) / v, x: last.x, y: last.y };
}

function buildCtx(m: Match, team: Team): TeamCtx {
  const hit = ctxCache.get(team);
  if (hit && hit.tick === m.tick) return hit.ctx;
  const owner = m.owner;
  const attacking = owner ? owner.side === team.side : (m.possessionSide === team.side && !!m.lastTouch && m.lastTouch.side === team.side);
  const field = team.players.filter((p) => p.active() && !p.isGK());
  const pressers: MPlayer[] = [];
  const chasers: MPlayer[] = [];
  const marks = new Map<number, MPlayer>();
  if (m.phase === 'play' || m.phase === 'shootout') {
    if (!owner) {
      const pi = m.passInfo;
      const reacting = !!pi && pi.passer.side !== team.side && m.time - pi.time < m.diff.reaction * 0.9 + 0.1;
      const times = field.map((p) => ({ p, ...interceptTime(m, p) })).sort((a, b) => a.t - b.t);
      const n = times[0] && times[0].t < 1.0 ? 1 : 2;
      if (pi && pi.passer.side === team.side && pi.receiver && pi.receiver.active() && !pi.receiver.isGK()) chasers.push(pi.receiver);
      if (!reacting) for (const e of times.slice(0, n)) { if (!chasers.includes(e.p)) chasers.push(e.p); }
    } else if (owner.side !== team.side) {
      const sorted = field.filter((p) => !p.sentOff).map((p) => ({ p, d: Math.hypot(p.x - owner.x, p.y - owner.y) })).sort((a, b) => a.d - b.d);
      const press = team.tactics.pressing / 100 * m.diff.press;
      const ballDepth = clamp01((m.ball.x * team.dir + HALF_L) / PITCH_L);
      let n = 1;
      if (press > 0.6 || ballDepth < 0.35) n = 2;
      if (press > 0.95 && ballDepth > 0.5) n = 3;
      for (const e of sorted.slice(0, n)) pressers.push(e.p);
      // marking assignment: each non-presser takes the nearest unmarked opponent threat
      const opp = m.teams[other(team.side)].players.filter((q) => q.active() && q !== owner && !q.isGK());
      const taken = new Set<MPlayer>();
      const defenders = field.filter((p) => !pressers.includes(p)).sort((a, b) => a.slot - b.slot);
      for (const d of defenders) {
        let best: MPlayer | null = null; let bd = 1e9;
        const home = shapeTarget(m, d, m.ball.x, m.ball.y, false);
        for (const o of opp) {
          if (taken.has(o)) continue;
          const dd = Math.hypot(o.x - home.x, o.y - home.y);
          if (dd < bd) { bd = dd; best = o; }
        }
        if (best && bd < (team.tactics.marking === 'man' ? 30 : team.tactics.marking === 'mixed' ? 14 : 8)) { taken.add(best); marks.set(d.id, best); }
      }
    }
  }
  const ctx = { attacking, pressers, chasers, marks };
  ctxCache.set(team, { tick: m.tick, ctx });
  return ctx;
}

// ---------- entry points ----------

export function updateTeamAI(m: Match, team: Team, dt: number): void {
  if (m.phase === 'intro' || m.phase === 'paused') return;
  const ctx = buildCtx(m, team);
  const ball = m.ball;
  for (const p of team.players) {
    if (!p.active()) continue;
    if (p.human >= 0 && m.humans[p.human]?.player === p) continue; // human-driven
    if (team.frozen) { resetIntent(p); continue; }
    p.thinkT -= dt;
    if (p.state === 'down' || p.state === 'slide' || p.state === 'dive' || p.state === 'skill') { resetIntent(p); continue; }
    switch (m.phase) {
      case 'setpiece': case 'injury': setPieceAI(m, p); break;
      case 'goal': if (p.celebrate <= 0) goToward(p, p.anchorX, p.anchorY); else if (m.goalInfo && p.side !== m.goalInfo.side) { resetIntent(p); } break;
      case 'play': playAI(m, team, p, ctx, dt); break;
      case 'shootout': setPieceAI(m, p); break;
      default: resetIntent(p);
    }
  }
  void ball;
}

export function updateHalfBreakAI(m: Match, team: Team): void {
  for (const p of team.players) { if (p.active()) resetIntent(p); }
  void m;
}

function setPieceAI(m: Match, p: MPlayer): void {
  resetIntent(p);
  const sp = m.sp;
  if (sp && p.human >= 0 && p === sp.taker) return;
  if (sp && p === sp.taker && sp.phase === 'ready') { goToward(p, p.tx, p.ty, { slowNear: 1.5 }); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 0.6) { p.intent.mx = 0; p.intent.my = 0; } p.intent.faceAngle = Math.atan2(sp.y - p.y, sp.x - p.x); return; }
  goToward(p, p.tx, p.ty, { sprintFar: 7 });
  if (Math.hypot(p.tx - p.x, p.ty - p.y) < 1) {
    // face the ball while waiting
    p.intent.faceAngle = Math.atan2(m.ball.y - p.y, m.ball.x - p.x);
  }
}

function playAI(m: Match, team: Team, p: MPlayer, ctx: TeamCtx, dt: number): void {
  const owner = m.owner;
  if (p.isGK()) { gkAI(m, p, dt); return; }
  if (p.celebrate > 0) { resetIntent(p); return; }
  if (owner === p) { carrierAI(m, team, p, dt); return; }
  if (owner && owner.side === team.side) { supportAI(m, team, p, owner, ctx); return; }
  if (owner && owner.side !== team.side) { defendAI(m, team, p, owner, ctx); return; }
  looseBallAI(m, team, p, ctx);
}

// ---------- loose ball ----------

function looseBallAI(m: Match, team: Team, p: MPlayer, ctx: TeamCtx): void {
  const it = p.intent;
  it.jockey = false; it.precise = false; it.shield = false; it.faceAngle = null;
  if (ctx.chasers.includes(p)) {
    const r = interceptTime(m, p);
    const tx = r.x, ty = r.y;
    goToward(p, tx, ty, { sprintFar: 2.5, slowNear: 0.6 });
    it.sprint = true;
    // slide for a loose ball that's about to be lost over the line / near an opponent
    return;
  }
  const attacking = !!m.lastTouch && m.lastTouch.side === team.side;
  const s = shapeTarget(m, p, m.ball.x, m.ball.y, attacking);
  goToward(p, s.x, s.y);
  it.sprint = Math.hypot(s.x - p.x, s.y - p.y) > 14;
}

// ---------- defending ----------

function defendAI(m: Match, team: Team, p: MPlayer, owner: MPlayer, ctx: TeamCtx): void {
  const it = p.intent;
  it.jockey = false; it.precise = false; it.shield = false; it.faceAngle = null;
  const dist = Math.hypot(owner.x - p.x, owner.y - p.y);
  const q = m.diffQuality;
  if (ctx.pressers.includes(p)) {
    // intercept point slightly ahead of the carrier
    const lead = clamp(dist / 9, 0.1, 0.55);
    const tx = owner.x + owner.vx * lead, ty = owner.y + owner.vy * lead;
    const first = ctx.pressers[0] === p;
    // contain when close; otherwise sprint at the carrier
    const toGoalX = team.dir * -HALF_L - tx;
    if (dist < 2.8) {
      // jockey: stay goal-side, mirror lateral movement
      const gx = -team.dir * HALF_L, gy = 0;
      const gd = Math.hypot(gx - owner.x, gy - owner.y) || 1;
      const sx = owner.x + ((gx - owner.x) / gd) * 1.15, sy = owner.y + ((gy - owner.y) / gd) * 1.15;
      goToward(p, sx, sy, { slowNear: 1.2 });
      it.jockey = dist < 2.2;
      it.faceAngle = Math.atan2(owner.y - p.y, owner.x - p.x);
      it.sprint = owner.speed > 6.5 && dist > 1.6;
      // tackle opportunities
      if (p.thinkT <= 0 && (first || dist < 1.6)) {
        p.thinkT = lerp(0.6, 0.18, q) * (0.7 + m.rng.next() * 0.6);
        const aggr = p.data.attrs.aggression / 100;
        const urgency = clamp01(0.4 + aggr * 0.5 + (team.tactics.pressing / 100) * 0.3);
        if (dist < 1.45 && p.tackleCooldown <= m.time) {
          const turnedAway = Math.abs(angleDiff(owner.face, Math.atan2(p.y - owner.y, p.x - owner.x))) > 1.7;
          let pTackle = 0.4 + 0.5 * urgency + (turnedAway ? 0.15 : 0);
          if (m.depth(team.side, owner.x) < -35) pTackle += 0.2; // danger near our goal
          if (m.rng.chance(pTackle * (0.55 + q * 0.5))) requestTackle(p, false, owner.x - p.x, owner.y - p.y);
        } else if (dist < 2.4 && dist > 1.5 && p.tackleCooldown <= m.time) {
          const desperate = m.depth(team.side, owner.x) < -38 && owner.speed > 5.5;
          if (desperate && m.rng.chance(0.07 + aggr * 0.12)) requestTackle(p, true, owner.x - p.x, owner.y - p.y);
        }
      }
    } else {
      goToward(p, tx, ty, { sprintFar: 3 });
      it.sprint = true;
    }
    void toGoalX;
    return;
  }
  // marking / shape
  const mark = ctx.marks.get(p.id);
  const s = shapeTarget(m, p, owner.x, owner.y, false);
  let tx = s.x, ty = s.y;
  if (mark) {
    const gx = -team.dir * HALF_L;
    const gd = Math.hypot(gx - mark.x, 0 - mark.y) || 1;
    // goal-side of the attacker, plus lead on the attacker's velocity
    const mx = mark.x + mark.vx * 0.25 + ((gx - mark.x) / gd) * 1.6;
    const my = mark.y + mark.vy * 0.25 + ((0 - mark.y) / gd) * 1.6;
    const w = team.tactics.marking === 'man' ? 0.85 : team.tactics.marking === 'mixed' ? 0.6 : 0.35;
    tx = lerp(s.x, mx, w); ty = lerp(s.y, my, w);
  }
  // never stand level with the attackers while the ball is dangerous: retreat to cover the line
  goToward(p, tx, ty, { sprintFar: 8 });
  it.sprint = Math.hypot(tx - p.x, ty - p.y) > 6 || (m.depth(team.side, owner.x) < -20 && Math.hypot(tx - p.x, ty - p.y) > 2.5);
  it.faceAngle = Math.hypot(tx - p.x, ty - p.y) < 1.5 ? Math.atan2(owner.y - p.y, owner.x - p.x) : null;
}

// ---------- supporting (off the ball, team in possession) ----------

function supportAI(m: Match, team: Team, p: MPlayer, owner: MPlayer, ctx: TeamCtx): void {
  const it = p.intent;
  it.jockey = false; it.precise = false; it.shield = false; it.faceAngle = null;
  const dir = team.dir;
  const base = shapeTarget(m, p, owner.x, owner.y, true);
  void ctx;
  const q = m.diffQuality;
  const offLine = secondLastDepth(m, team.side);
  const slot = team.formation.slots[p.slot]!;
  const forward = slot.pos === 'ST' || slot.pos === 'CF' || slot.pos === 'LW' || slot.pos === 'RW';
  // active run in progress
  if (p.runTarget && p.runTarget.until > m.time) {
    goToward(p, p.runTarget.x, p.runTarget.y, { sprintFar: 0 });
    it.sprint = true;
    return;
  }
  if (p.thinkT > 0) {
    // keep heading to last chosen target
    goToward(p, p.tx, p.ty, { sprintFar: 10 });
    return;
  }
  p.thinkT = lerp(0.7, 0.3, q) * (0.8 + m.rng.next() * 0.4);
  const carrierSpeed = owner.speed;
  const ownDepth = owner.x * dir;
  // forwards make runs in behind when the carrier can see them and space exists
  const canRun = (forward || p.role === 'boxToBox' || p.role === 'shadowStriker') && ownDepth > -10 && p.stamina > 0.35;
  if (canRun && m.rng.chance(0.14 * (p.data.workAtt === 'high' ? 1.5 : p.data.workAtt === 'low' ? 0.6 : 1) * (0.5 + team.tactics.directness / 100))) {
    const limit = (m.cfg.offside ? Math.min(offLine - 0.8 + m.rng.gauss(0.5 - q * 0.6, 0.9), HALF_L - 3) : HALF_L - 3);
    const targetDepth = Math.min(limit, Math.max(p.x * dir + 12, ownDepth + 14));
    if (targetDepth > p.x * dir + 4) {
      const ty = clamp(base.y + (p.y > 0 ? -1 : 1) * m.rng.float(2, 8), -HALF_W + 4, HALF_W - 4);
      p.runTarget = { x: dir * targetDepth, y: ty, until: m.time + 2.2 };
      return;
    }
  }
  // wing-back / full-back overlap when the winger on my side has the ball
  if ((p.role === 'fullBack' || p.role === 'wingBack') && owner.y * p.y > 0 && Math.abs(owner.y) > 16 && ownDepth > 0 && m.rng.chance(0.18)) {
    p.runTarget = { x: dir * clamp(ownDepth + 14, 20, HALF_L - 6), y: Math.sign(p.y) * (HALF_W - 4), until: m.time + 2.5 };
    return;
  }
  // sample candidate support positions around the shape target
  let best = { x: base.x, y: base.y, s: -1e9 };
  const step = 7;
  for (let ix = -1; ix <= 1; ix++) {
    for (let iy = -1; iy <= 1; iy++) {
      let cx = base.x + ix * step * dir, cy = base.y + iy * step;
      cx = clamp(cx, -HALF_L + 2, HALF_L - 2); cy = clamp(cy, -HALF_W + 2, HALF_W - 2);
      const dOwner = Math.hypot(cx - owner.x, cy - owner.y);
      if (dOwner < 4) continue;
      const lane = laneQuality(m, team.side, owner.x, owner.y, cx, cy);
      const space = clamp01(nearestOppDist(m, team.side, cx, cy) / 8);
      let sc = lane * 1.1 + space * 0.9 + (1 - Math.abs(dOwner - 16) / 30) * 0.5 - Math.hypot(cx - base.x, cy - base.y) * 0.035;
      sc += zoneValue(m, team.side, cx, cy) * (forward ? 0.9 : 0.4);
      if (m.cfg.offside && cx * dir > offLine - 0.6 && !(p.runTarget)) sc -= 3;
      if (sc > best.s) best = { x: cx, y: cy, s: sc };
    }
  }
  // forwards hold the line of the last defender
  if (forward && m.cfg.offside) {
    const lim = (offLine - 0.4 - q * 0.7) * dir;
    if (dir > 0 && best.x > lim) best.x = lim; else if (dir < 0 && best.x < lim) best.x = lim;
  }
  p.tx = best.x; p.ty = best.y;
  goToward(p, p.tx, p.ty, { sprintFar: 10 });
  void carrierSpeed;
}

// ---------- ball carrier ----------

type Option =
  | { kind: 'shoot'; score: number; aimY: number; aimH: number; shotKind: 'normal' | 'finesse' | 'driven' | 'power' | 'chip' }
  | { kind: 'pass'; score: number; target: MPlayer; pass: PassKind; tx: number; ty: number; power: number }
  | { kind: 'dribble'; score: number; dx: number; dy: number; sprint: boolean }
  | { kind: 'clear'; score: number; tx: number; ty: number };

function carrierAI(m: Match, team: Team, p: MPlayer, dt: number): void {
  const it = p.intent;
  const dir = team.dir;
  it.jockey = false; it.faceAngle = null;
  const sinceTouch = m.time - m.lastTouchT;
  const q = m.diffQuality;
  const pressure = pressureOn(m, p);
  // chose and keep a dribble direction between thinks
  if (p.thinkT > 0 && sinceTouch > 0.05) {
    const dx = p.tx, dy = p.ty;
    const mag = Math.hypot(dx, dy) || 1;
    it.mx = dx / mag; it.my = dy / mag;
    it.precise = pressure > 0.7 && p.speed < 3;
    it.shield = pressure > 0.6;
    return;
  }
  // reaction time after receiving
  const hold = lerp(0.55, 0.12, q) * (1 - clamp01(pressure * 0.5));
  if (sinceTouch < hold && p.speed < 3 && pressure < 0.4) { it.mx = it.my = 0; return; }
  p.thinkT = lerp(0.42, 0.12, q) * (0.8 + m.rng.next() * 0.4);

  const opts = evaluateOptions(m, team, p, pressure);
  opts.sort((a, b) => b.score - a.score);
  let choice = opts[0]!;
  if (!m.rng.chance(0.55 + 0.45 * q) && opts.length > 1) choice = opts[Math.min(opts.length - 1, m.rng.int(0, Math.min(2, opts.length - 1)))]!;
  void dt;

  switch (choice.kind) {
    case 'shoot': {
      p.face = Math.atan2(choice.aimY * 0 + 0 - p.y, dir * HALF_L - p.x);
      executeShot(m, p, { kind: choice.shotKind, aimY: choice.aimY, aimH: choice.aimH, power: clamp(0.65 + m.rng.float(0, 0.3), 0, 1), assist: 0.35 });
      p.thinkT = 0.6;
      break;
    }
    case 'pass': {
      const spec: PassSpec = { kind: choice.pass, tx: choice.tx, ty: choice.ty, receiver: choice.target, power: choice.power, assist: 0.25 + q * 0.3 };
      p.face = Math.atan2(choice.ty - p.y, choice.tx - p.x);
      executePass(m, p, spec);
      p.thinkT = 0.5;
      break;
    }
    case 'clear': {
      executePass(m, p, { kind: 'clear', tx: choice.tx, ty: choice.ty, receiver: null, power: 0.8, assist: 0.2 });
      p.stats.clearances++; m.teams[p.side].stats.clearances++;
      p.thinkT = 0.5;
      break;
    }
    case 'dribble': {
      p.tx = choice.dx; p.ty = choice.dy;
      const mag = Math.hypot(choice.dx, choice.dy) || 1;
      it.mx = choice.dx / mag; it.my = choice.dy / mag;
      it.sprint = choice.sprint && p.stamina > 0.12;
      it.precise = pressure > 0.7 && p.speed < 3;
      it.shield = pressure > 0.6;
      // skill moves: occasionally when a defender is directly in front
      maybeSkill(m, p, choice.dx, choice.dy);
      break;
    }
  }
}

function maybeSkill(m: Match, p: MPlayer, dx: number, dy: number): void {
  const flair = m.diff.flair * (p.data.skillMoves / 5) * (p.data.traits.includes('Flair') ? 1.8 : 1);
  if (!m.rng.chance(flair * 0.5)) return;
  let defender: MPlayer | null = null; let bd = 3.2;
  for (const o of m.teams[other(p.side)].players) {
    if (!o.active()) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    const ang = Math.abs(angleDiff(Math.atan2(dy, dx), Math.atan2(o.y - p.y, o.x - p.x)));
    if (d < bd && ang < 0.9) { bd = d; defender = o; }
  }
  if (!defender) return;
  const allowed = SKILL_MOVES.filter((s) => s.stars <= p.data.skillMoves && s.stars >= Math.max(1, p.data.skillMoves - 2));
  if (!allowed.length) return;
  startSkill(m, p, m.rng.pick(allowed), m.rng.chance(0.5) ? 1 : -1);
}

function evaluateOptions(m: Match, team: Team, p: MPlayer, pressure: number): Option[] {
  const dir = team.dir;
  const opts: Option[] = [];
  const goalX = dir * HALF_L;
  const a = p.data.attrs;
  const tac = team.tactics;
  const q = m.diffQuality;
  const dGoal = Math.hypot(goalX - p.x, p.y);
  const ownDepth01 = clamp01((p.x * dir + HALF_L) / PITCH_L);

  // ---- shooting
  if (dGoal < 32) {
    const xg = expectedGoals(p.x, p.y, goalX) * (1 - pressure * 0.25);
    // aim away from the keeper
    const gk = m.keeperOf(other(p.side));
    const gkY = gk ? gk.y * dir : 0; // in shooter's frame
    const aimY = clamp((gkY > 0 ? -1 : 1) * m.rng.float(0.55, 0.9), -0.92, 0.92);
    const finesse = dGoal > 14 && dGoal < 26 && (a.curve > 68 || p.data.traits.includes('Finesse Shot'));
    const kind = finesse ? 'finesse' : dGoal > 24 ? 'power' : pressure > 0.5 ? 'driven' : 'normal';
    let score = xg * 1.15;
    if (xg < 0.045) score *= 0.35;
    if (dGoal > 24 && !(a.longShots > 75)) score *= 0.5;
    opts.push({ kind: 'shoot', score: score + (m.rng.next() - 0.5) * 0.03, aimY, aimH: m.rng.float(0.1, 0.55), shotKind: kind });
  }

  // ---- passing
  const mates = team.players.filter((t) => t.active() && t !== p);
  const offLine = secondLastDepth(m, team.side);
  const baseV = zoneValue(m, team.side, p.x, p.y);
  for (const t of mates) {
    const dist = Math.hypot(t.x - p.x, t.y - p.y);
    if (dist < 4 || dist > 60) continue;
    // goalkeepers only receive from the back
    if (t.isGK() && ownDepth01 > 0.35) continue;
    const kinds: Array<{ k: PassKind; tx: number; ty: number }> = [{ k: 'ground', tx: t.x + t.vx * 0.35, ty: t.y + t.vy * 0.35 }];
    // through ball
    const runSpeed = t.speed;
    if (runSpeed > 3 && (t.vx * dir) > 1.5) kinds.push({ k: 'through', tx: t.x + t.vx * 1.1, ty: t.y + t.vy * 1.1 });
    if (dist > 22) kinds.push({ k: 'lob', tx: t.x + t.vx * 0.9, ty: t.y + t.vy * 0.9 });
    // cross from wide areas
    const wide = Math.abs(p.y) > 18 && ownDepth01 > 0.7;
    const inBox = Math.abs(t.x - goalX) < BOX_L && Math.abs(t.y) < 20;
    if (wide && inBox) kinds.push({ k: 'cross', tx: t.x + t.vx * 0.5, ty: t.y + t.vy * 0.5 });
    for (const kd of kinds) {
      const depthT = kd.tx * dir;
      const awareOfOffside = m.rng.chance(0.5 + 0.5 * q);
      if (m.cfg.offside && awareOfOffside && depthT > offLine + 0.2 && depthT > p.x * dir) continue; // don't pass to offside spots
      const lane = kd.k === 'lob' || kd.k === 'cross' ? clamp01(0.55 + 0.45 * laneQuality(m, team.side, p.x, p.y, kd.tx, kd.ty)) : laneQuality(m, team.side, p.x, p.y, kd.tx, kd.ty);
      const rp = clamp01(nearestOppDist(m, team.side, kd.tx, kd.ty) / 6);
      const skill = kd.k === 'cross' ? a.crossing : kd.k === 'lob' || kd.k === 'through' ? a.longPass * 0.5 + a.vision * 0.5 : a.shortPass;
      let pc = (0.99 - 0.0055 * dist) * (0.2 + 0.8 * Math.pow(lane, 1.4)) * (0.8 + 0.2 * skill / 100) * (0.6 + 0.4 * rp);
      if (kd.k === 'through') pc *= 0.72; if (kd.k === 'lob') pc *= 0.8; if (kd.k === 'cross') pc *= 0.62;
      pc = clamp(pc - pressure * 0.06, 0.02, 0.98);
      const v = zoneValue(m, team.side, kd.tx, kd.ty);
      let gain = v - baseV;
      const goalDist = Math.hypot(goalX - kd.tx, kd.ty);
      if (kd.k === 'cross') gain += expectedGoals(kd.tx, kd.ty, goalX, true) * 0.55;
      if (kd.k === 'through' && goalDist < 30) gain += expectedGoals(kd.tx, kd.ty, goalX) * 0.5;
      gain *= 0.75 + tac.directness / 160;
      const loss = 0.04 + 0.2 * (1 - clamp01((kd.tx * dir + HALF_L) / PITCH_L));
      let score = pc * (gain + 0.05) - (1 - pc) * loss;
      // keep-ball tactics value short passes; long-ball tactics favour direct ones
      if (kd.k === 'ground' && dist < 18) score += (0.04 * (100 - tac.directness)) / 100 * pc;
      if (kd.k === 'lob') score += (0.05 * tac.directness) / 100 * pc;
      score += (m.rng.next() - 0.5) * 0.02;
      const power = kd.k === 'through' ? 0.5 : kd.k === 'lob' || kd.k === 'cross' ? 0.6 : clamp01(0.3 + dist / 70);
      opts.push({ kind: 'pass', score, target: t, pass: kd.k, tx: kd.tx, ty: kd.ty, power });
    }
  }

  // ---- dribble
  const dd = bestDribble(m, team, p);
  let dscore = 0.045 + dd.space * 0.1 + dd.progress * 0.06 - pressure * 0.05;
  if (p.data.attrs.dribbling > 78) dscore += 0.03;
  if (ownDepth01 > 0.85 && dGoal < 20) dscore += 0.04;
  opts.push({ kind: 'dribble', score: dscore + (m.rng.next() - 0.5) * 0.02, dx: dd.dx, dy: dd.dy, sprint: dd.space > 0.35 || ownDepth01 < 0.3 });

  // ---- clear
  if (ownDepth01 < 0.22 && pressure > 0.55) {
    const side = p.y > 0 ? 1 : -1;
    opts.push({ kind: 'clear', score: 0.1 + pressure * 0.12 + (ownDepth01 < 0.12 ? 0.08 : 0), tx: dir * (HALF_L * 0.2), ty: side * 28 });
  }
  void q;
  return opts;
}

function bestDribble(m: Match, team: Team, p: MPlayer): { dx: number; dy: number; space: number; progress: number } {
  const dir = team.dir;
  const goalX = dir * HALF_L;
  const toGoal = Math.atan2(0 - p.y, goalX - p.x);
  let best = { dx: dir, dy: 0, score: -1e9, space: 0, progress: 0 };
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    // free space along the ray (opponents within a corridor)
    let free = 7;
    for (const o of m.teams[other(p.side)].players) {
      if (!o.active()) continue;
      const rx = o.x - p.x, ry = o.y - p.y;
      const along = rx * cx + ry * cy;
      if (along < 0 || along > 9) continue;
      const lateral = Math.abs(rx * -cy + ry * cx);
      if (lateral < 2.4) free = Math.min(free, Math.max(0.5, along - 1.2));
    }
    const ex = p.x + cx * 6, ey = p.y + cy * 6;
    const outside = Math.abs(ex) > HALF_L - 1 || Math.abs(ey) > HALF_W - 1;
    const prog = Math.cos(angleDiff(ang, toGoal));
    const spaceN = free / 7;
    let score = spaceN * 1.0 + prog * 0.7 - (outside ? 1.2 : 0);
    // prefer to keep the current heading (avoid jitter)
    score += Math.cos(angleDiff(ang, p.face)) * 0.15;
    if (score > best.score) best = { dx: cx, dy: cy, score, space: spaceN, progress: prog };
  }
  return best;
}

// ---------- set-piece decisions for AI takers ----------

export function installSetPieceAI(m: Match): void {
  m.aiTakeSetPiece = (mm: Match, sp: SetPiece): void => aiTake(mm, sp);
}

function aiTake(m: Match, sp: SetPiece): void {
  const taker = sp.taker;
  if (!taker) return;
  const team = m.teams[sp.side];
  const dir = team.dir;
  const goalX = dir * HALF_L;
  const q = m.diffQuality;
  const mates = team.players.filter((t) => t.active() && t !== taker);
  const nearestMate = (maxD = 40, pred: (t: MPlayer) => boolean = () => true): MPlayer | null => {
    let best: MPlayer | null = null; let bs = -1e9;
    for (const t of mates) {
      if (!pred(t)) continue;
      const d = Math.hypot(t.x - sp.x, t.y - sp.y);
      if (d < 3 || d > maxD) continue;
      const lane = laneQuality(m, team.side, sp.x, sp.y, t.x, t.y);
      const s = lane * 2 + clamp01(nearestOppDist(m, team.side, t.x, t.y) / 8) - d / 40 + zoneValue(m, team.side, t.x, t.y) * 0.5;
      if (s > bs) { bs = s; best = t; }
    }
    return best;
  };
  switch (sp.type) {
    case 'kickoff': {
      const mate = nearestMate(14, (t) => !t.isGK()) ?? mates.find((t) => !t.isGK()) ?? null;
      if (mate) doPassSetPiece(m, taker, { kind: 'ground', tx: mate.x, ty: mate.y, receiver: mate, power: 0.3, assist: 1, sloppy: 0.001 });
      else m.forceResume();
      break;
    }
    case 'throwIn': {
      const t = nearestMate(26, (x) => !x.isGK());
      if (t) doThrowIn(m, taker, t.tx, t.ty, t, Math.hypot(t.x - sp.x, t.y - sp.y) > 14);
      else doThrowIn(m, taker, sp.x, sp.y - Math.sign(sp.y) * 10, null, false);
      break;
    }
    case 'goalKick': {
      const longBall = m.rng.chance(0.2 + team.tactics.directness / 160 * (1 - q * 0.4));
      if (!longBall) {
        const t = nearestMate(26, (x) => x.slotPos === 'CB' || x.slotPos === 'LB' || x.slotPos === 'RB' || x.slotPos === 'CDM');
        if (t) { doPassSetPiece(m, taker, { kind: 'ground', tx: t.x, ty: t.y, receiver: t, power: 0.45, assist: 0.6 }); break; }
      }
      const tgt = mates.filter((x) => x.slotPos === 'ST' || x.slotPos === 'CF' || x.slotPos === 'CAM').sort((a, b) => b.data.attrs.heading - a.data.attrs.heading)[0] ?? mates[mates.length - 1]!;
      doPassSetPiece(m, taker, { kind: 'keeperKick', tx: tgt.x - dir * 2, ty: tgt.y, receiver: tgt, power: 0.9, assist: 0.4 });
      break;
    }
    case 'corner': {
      const inBox = mates.filter((t) => Math.abs(t.x - goalX) < 20 && Math.abs(t.y) < 20);
      const shortOpt = m.rng.chance(0.18);
      if (shortOpt) {
        const t = nearestMate(16, (x) => !x.isGK());
        if (t) { doPassSetPiece(m, taker, { kind: 'ground', tx: t.x, ty: t.y, receiver: t, power: 0.35, assist: 0.6 }); break; }
      }
      const target = inBox.sort((a, b) => b.data.attrs.heading + b.data.attrs.jumping - (a.data.attrs.heading + a.data.attrs.jumping))[m.rng.int(0, Math.min(2, Math.max(0, inBox.length - 1)))];
      const spot = target ?? null;
      const tx = spot ? spot.x : goalX - dir * 9, ty = spot ? spot.y : 0;
      doPassSetPiece(m, taker, { kind: 'cross', tx, ty, receiver: spot, power: 0.7, assist: 0.5, curve: sp.cornerStyle === 'out' ? -1 : 1 });
      break;
    }
    case 'freeKick': case 'indirectFreeKick': {
      const dist = Math.hypot(goalX - sp.x, sp.y);
      const direct = sp.type === 'freeKick' && dist < 32;
      if (direct && (dist < 27 || taker.data.attrs.freeKick > 74) && m.rng.chance(0.75)) {
        const side = m.rng.chance(0.5) ? 1 : -1;
        doShotSetPiece(m, taker, { kind: 'freeKick', aimY: side * m.rng.float(0.4, 0.85), aimH: m.rng.float(0.45, 0.8), power: 0.75 + m.rng.float(0, 0.2), assist: 0.3 });
        break;
      }
      if (dist < 45 && m.rng.chance(0.55)) {
        const inBox = mates.filter((t) => Math.abs(t.x - goalX) < 22 && Math.abs(t.y) < 20).sort((a, b) => b.data.attrs.heading - a.data.attrs.heading)[0];
        if (inBox) { doPassSetPiece(m, taker, { kind: 'cross', tx: inBox.x, ty: inBox.y, receiver: inBox, power: 0.65, assist: 0.5 }); break; }
      }
      const t = nearestMate(35, (x) => !x.isGK());
      if (t) doPassSetPiece(m, taker, { kind: 'ground', tx: t.x, ty: t.y, receiver: t, power: 0.4, assist: 0.7 });
      else doPassSetPiece(m, taker, { kind: 'lob', tx: goalX - dir * 20, ty: 0, receiver: null, power: 0.7, assist: 0.5 });
      break;
    }
    case 'penalty': {
      const side = m.rng.chance(0.5) ? 1 : -1;
      const chip = taker.data.traits.includes('Flair') && taker.data.attrs.penalties > 82 && m.rng.chance(0.04);
      doShotSetPiece(m, taker, { kind: chip ? 'chip' : 'penalty', aimY: side * m.rng.float(0.55, 0.88), aimH: m.rng.float(0.1, 0.7), power: 0.78 + m.rng.float(0, 0.18), assist: 0.2 });
      break;
    }
  }
}

export { BALL_R, HALF_GOAL, lerp, resetIntent };
