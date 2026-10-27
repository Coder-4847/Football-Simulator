import { clamp, clamp01, lerp } from '../core/math';
import { BALL_R, BOX_L, GOAL_H, HALF_GOAL, HALF_L, other } from './constants';
import { predictCrossing } from './ball';
import type { MPlayer } from './entities';
import type { Match } from './match';
import { executePass } from './actions';
import { distSegPoint } from './ai';

export interface GkPlan { y: number; z: number; startAt: number; tCross: number; dive: boolean; fromPenalty: boolean; dir: number; done: boolean }
export interface GkClaim { x: number; y: number; t: number; punch: boolean }

export interface GkState {
  plan: GkPlan | null;
  claim: GkClaim | null;
  holdT: number;
  /** human requested a dive: -1 left, 1 right (relative to the keeper's facing), 0 none */
  diveReq: number;
  lastSaveT: number;
  smotherT: number;
}

export const newGkState = (): GkState => ({ plan: null, claim: null, holdT: 0, diveReq: 0, lastSaveT: -9, smotherT: 0 });

function ownGoalX(m: Match, gk: MPlayer): number { return -m.teams[gk.side].dir * HALF_L; }
function inOwnBox(m: Match, gk: MPlayer, x: number, y: number): boolean { return Math.abs(x - ownGoalX(m, gk)) < BOX_L + 0.5 && Math.abs(y) < 20.7; }

/** AI keeper: positioning, rushing out, distribution. */
export function gkAI(m: Match, gk: MPlayer, dt: number): void {
  const it = gk.intent;
  it.jockey = false; it.precise = false; it.shield = false; it.faceAngle = null; it.sprint = false;
  const team = m.teams[gk.side];
  const gx = ownGoalX(m, gk);
  const gs = gk.gk;
  const b = m.ball;
  const sign = Math.sign(gx) || 1;
  // distributing
  if (m.ballInGoalKeeperHands === gk) {
    it.mx = 0; it.my = 0;
    gs.holdT += dt;
    const wait = lerp(3.2, 1.2, m.diffQuality);
    if (gs.holdT > wait) distribute(m, gk);
    return;
  }
  // busy: diving / claiming
  if (gk.state === 'dive' || gk.state === 'save' || gk.state === 'down') return;
  if (gs.claim && m.time < gs.claim.t + 0.6) {
    const c = gs.claim;
    const dx = c.x - gk.x, dy = c.y - gk.y;
    const d = Math.hypot(dx, dy);
    it.mx = d > 0.2 ? dx / d : 0; it.my = d > 0.2 ? dy / d : 0; it.sprint = true;
    if (d < 1.4 && Math.abs(c.t - m.time) < 0.45 && gk.state === 'normal') { gk.setState('jump', 0.7); }
    return;
  }
  gs.claim = null;

  const owner = m.owner;
  const distBallGoal = Math.hypot(b.x - gx, b.y);
  const sweeper = gk.data.traits.includes('Sweeper Keeper');
  // aerial claims
  tryPlanClaim(m, gk);
  if (gs.claim) return;

  // 1v1 / loose ball in the box: come out
  if (!owner || owner.side !== gk.side) {
    const isLoose = !owner;
    const ownerThreat = owner ? Math.hypot(owner.x - gx, owner.y) < 20 && (owner.vx * -sign) > 0.5 : false;
    if (isLoose && inOwnBox(m, gk, b.x, b.y) && b.z < 1.2) {
      const tracks = m.getBallTrack();
      let myT = 99;
      for (const s of tracks) { if (Math.hypot(s.x - gk.x, s.y - gk.y) <= m.maxSpeed(gk) * s.t + 0.7) { myT = s.t; break; } }
      let oppT = 99;
      for (const o of m.teams[other(gk.side)].players) {
        if (!o.active()) continue;
        for (const s of tracks) { if (Math.hypot(s.x - o.x, s.y - o.y) <= m.maxSpeed(o) * s.t + 0.5) { oppT = Math.min(oppT, s.t); break; } }
      }
      if (myT < oppT + 0.25 || (sweeper && myT < oppT + 0.5)) {
        const s = tracks.find((t) => t.t >= myT) ?? tracks[0]!;
        const dx = s.x - gk.x, dy = s.y - gk.y; const d = Math.hypot(dx, dy) || 1;
        it.mx = dx / d; it.my = dy / d; it.sprint = true;
        return;
      }
    }
    if (owner && ownerThreat) {
      // narrow the angle / charge down
      const od = Math.hypot(owner.x - gx, owner.y);
      const charge = clamp((20 - od) / 16, 0.15, 0.85) * (0.55 + gk.data.attrs.gkPositioning / 220);
      const tx = gx + (owner.x - gx) * charge * 0.45;
      const ty = owner.y * charge * 0.35;
      moveTo(gk, tx, ty, true);
      if (Math.hypot(owner.x - gk.x, owner.y - gk.y) < 1.7 && m.rng.chance(0.07)) smother(m, gk, owner);
      return;
    }
  }
  // standard positioning on the ball–goal line
  let target: { x: number; y: number };
  const aim = Math.atan2(b.y, b.x - gx);
  const far = clamp01((distBallGoal - 8) / 38);
  let r = lerp(1.0, sweeper ? 13 : 5.0, far);
  if (owner && owner.side === gk.side) r = lerp(r, sweeper ? 16 : 9, 0.6); // team has the ball: higher line
  const lateral = clamp(b.y * (0.1 + 0.08 * (1 - far)), -HALF_GOAL * 0.95, HALF_GOAL * 0.95);
  target = { x: gx + Math.cos(aim) * r * 0 - sign * -r * 1, y: lateral };
  // x: step off the line toward the pitch
  target.x = gx - sign * r;
  void aim; void team;
  moveTo(gk, target.x, target.y, false);
  it.faceAngle = Math.atan2(b.y - gk.y, b.x - gk.x);
}

function moveTo(gk: MPlayer, tx: number, ty: number, sprint: boolean): void {
  const it = gk.intent;
  const dx = tx - gk.x, dy = ty - gk.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.2) { it.mx = 0; it.my = 0; return; }
  const mag = d < 2 ? clamp(d / 2, 0.2, 1) : 1;
  it.mx = (dx / d) * mag; it.my = (dy / d) * mag; it.sprint = sprint || d > 3;
}

function smother(m: Match, gk: MPlayer, o: MPlayer): void {
  gk.setState('dive', 0.7);
  gk.vx = (o.x - gk.x) * 3; gk.vy = (o.y - gk.y) * 3;
  const win = clamp(0.35 + (gk.data.attrs.gkReflexes - o.data.attrs.dribbling) / 160 + gk.data.attrs.gkPositioning / 400, 0.15, 0.8);
  if (m.rng.chance(win)) { catchBall(m, gk); }
  else if (m.rng.chance(0.18)) { /* clumsy: foul handled by rules for contact */ m.callFoulAt(gk, o, 'reckless', 0.45); }
}

function distribute(m: Match, gk: MPlayer): void {
  const team = m.teams[gk.side];
  const dir = team.dir;
  m.ballInGoalKeeperHands = null;
  gk.gk.holdT = 0;
  const mates = team.players.filter((t) => t.active() && t !== gk);
  // open short target
  let best: MPlayer | null = null; let bs = -1e9;
  for (const t of mates) {
    const d = Math.hypot(t.x - gk.x, t.y - gk.y);
    if (d < 8 || d > 45) continue;
    let opp = 99;
    for (const o of m.teams[other(gk.side)].players) { if (!o.active()) continue; opp = Math.min(opp, Math.hypot(o.x - t.x, o.y - t.y)); }
    const lane = (() => { let w = 9; for (const o of m.teams[other(gk.side)].players) { if (!o.active()) continue; w = Math.min(w, distSegPoint(gk.x, gk.y, t.x, t.y, o.x, o.y)); } return clamp01(w / 4); })();
    const s = lane * 2 + clamp01(opp / 8) * 1.2 - d / 70 + (t.x * dir + HALF_L) / 105 * 0.5;
    if (s > bs) { bs = s; best = t; }
  }
  const longBall = m.rng.chance(0.15 + team.tactics.directness / 220);
  m.setTouch(gk, true);
  if (best && !longBall && bs > 1.4) {
    const d = Math.hypot(best.x - gk.x, best.y - gk.y);
    const kind = d < 28 ? 'keeperThrow' : 'keeperKick';
    executePass(m, gk, { kind, tx: best.x, ty: best.y, receiver: best, power: 0.5, assist: 0.5 });
  } else {
    const t = mates.filter((q) => q.slotPos === 'ST' || q.slotPos === 'CF').sort((a, b) => b.data.attrs.heading - a.data.attrs.heading)[0] ?? mates[mates.length - 1]!;
    executePass(m, gk, { kind: 'keeperKick', tx: t.x, ty: t.y, receiver: t, power: 0.9, assist: 0.4 });
  }
  m.owner = null;
}

function tryPlanClaim(m: Match, gk: MPlayer): void {
  const b = m.ball;
  const gs = gk.gk;
  if (b.z < 0.9 && Math.abs(b.vz) < 1.5) return;
  const gx = ownGoalX(m, gk);
  // only for balls heading into our box
  const sign = Math.sign(gx);
  if (b.vx * sign < -0.5 && Math.abs(b.x - gx) > 22) return;
  const lastWasOpp = !!m.lastTouch && m.lastTouch.side !== gk.side;
  if (!lastWasOpp && !m.passInfo) return;
  let landing: { x: number; y: number; t: number } | null = null;
  for (let t = 0.3; t < 3.2; t += 0.1) {
    const p = m.ballAt(t);
    if (p.z <= 2.7 && p.z >= 1.2 && inOwnBox(m, gk, p.x, p.y)) { landing = { x: p.x, y: p.y, t }; break; }
  }
  if (!landing) return;
  const myD = Math.hypot(landing.x - gk.x, landing.y - gk.y);
  const myT = myD / (m.maxSpeed(gk) * 0.9) + 0.25;
  if (myT > landing.t + 0.1) return;
  let oppT = 99;
  for (const o of m.teams[other(gk.side)].players) {
    if (!o.active()) continue;
    const t = Math.hypot(landing.x - o.x, landing.y - o.y) / (m.maxSpeed(o) * 0.9) + (o.data.attrs.jumping > 70 ? 0 : 0.15);
    oppT = Math.min(oppT, t);
  }
  const claimSkill = (gk.data.attrs.gkHandling + gk.data.attrs.gkPositioning) / 200 + (gk.data.traits.includes('Cross Claimer') ? 0.12 : 0);
  if (myT + 0.1 < oppT + claimSkill * 0.5 && m.rng.chance(0.55 + claimSkill * 0.4)) {
    gs.claim = { x: landing.x, y: landing.y, t: m.time + landing.t, punch: m.rng.chance(0.25 - claimSkill * 0.15) };
  }
}

function catchBall(m: Match, gk: MPlayer): void {
  const b = m.ball;
  m.ballInGoalKeeperHands = gk;
  m.owner = gk;
  m.setTouch(gk, true);
  b.vx = b.vy = b.vz = 0;
  m.passInfo = null;
  gk.gk.holdT = 0;
  gk.gk.plan = null; gk.gk.claim = null;
  if (gk.state !== 'dive') gk.setState('save', 0.5);
  m.bus.emit('keeperCatch', { keeper: gk });
  m.possessionSide = gk.side;
}

/** Per-tick keeper mechanics: shot reading, dives, contact. */
export function updateKeepers(m: Match, dt: number): void {
  const b = m.ball;
  for (const side of [0, 1] as const) {
    const gk = m.keeperOf(side);
    if (!gk) continue;
    const gs = gk.gk;
    const gx = ownGoalX(m, gk);
    const sign = Math.sign(gx) || 1;
    // hold the ball in hands
    if (m.ballInGoalKeeperHands === gk) {
      const hx = gk.x + Math.cos(gk.face) * 0.3, hy = gk.y + Math.sin(gk.face) * 0.3;
      b.x = hx; b.y = hy; b.z = 1.15; b.vx = b.vy = b.vz = 0;
      m.owner = gk;
      continue;
    }
    if (m.phase === 'setpiece' || m.phase === 'goal' || m.phase === 'halftime' || m.phase === 'intro') continue;
    if (m.sp && m.sp.phase !== 'done') continue;

    // ---- shot detection
    const toward = b.vx * -sign * -1; // positive when moving towards our goal (x increases in sign direction)
    const incoming = b.vx * sign > 3 && b.speed() > 7;
    void toward;
    if (incoming && (!gs.plan || gs.plan.done)) {
      const pred = predictCrossing(b, gx, 2.6);
      if (pred && Math.abs(pred.y) < HALF_GOAL + 1.4 && pred.z < GOAL_H + 1.2 && pred.t > 0.05) {
        const a = gk.data.attrs;
        const penalty = m.penaltyKick !== null && m.time - m.penaltyKick.t < 1;
        let react = m.diff.gkReaction * (1.35 - a.gkReflexes / 180);
        if (gk.human >= 0) react = 0.12 + (1 - m.cfg.assist.keeper) * 0.18;
        let py = pred.y;
        if (penalty) {
          // the keeper commits early and guesses a side
          const guess = clamp(0.36 + a.gkDiving / 400 + (gk.data.traits.includes('Penalty Saver') ? 0.1 : 0), 0.3, 0.6);
          const right = pred.y > 0;
          const correct = m.rng.chance(guess);
          py = correct ? pred.y : (right ? -1 : 1) * (HALF_GOAL * 0.7);
          if (m.rng.chance(0.12)) py = pred.y * 0.1; // stays central
          react = 0;
        }
        gs.plan = { y: py, z: clamp(pred.z, 0.3, 2.3), startAt: m.time + react, tCross: m.time + pred.t, dive: false, fromPenalty: penalty, dir: Math.sign(py - gk.y) || 1, done: false };
        // penalties and top-class keepers read the shot quicker; also slower reaction when the ball is knuckling
        if (b.knuckle > 0.3) gs.plan.startAt += 0.08;
      }
    }
    const plan = gs.plan;
    if (plan && !plan.done) {
      if (m.time >= plan.startAt && gk.state === 'normal') {
        const humanControlled = gk.human >= 0;
        let allow = true;
        if (humanControlled) allow = gs.diveReq !== 0 || m.rng.chance(m.cfg.assist.keeper * 1.0);
        if (allow) {
          const dy = plan.y - gk.y;
          const tLeft = Math.max(0.12, plan.tCross - m.time);
          const need = Math.abs(dy);
          const diving = need > 1.3 || plan.z > 1.9 || plan.z < 0.55;
          if (humanControlled && gs.diveReq !== 0) {
            // manual: dive to the requested side regardless; assisted target if it matches
            const wantSign = gs.diveReq * (m.teams[gk.side].dir > 0 ? 1 : -1) * 1; // left/right relative to facing
            const targetY = Math.sign(plan.y) === Math.sign(wantSign) || need < 1 ? plan.y : wantSign * HALF_GOAL * 0.9;
            plan.y = targetY;
          }
          if (diving) {
            plan.dive = true;
            gk.setState('dive', clamp(tLeft + 0.5, 0.7, 1.3), 'dive');
            gk.sx = Math.sign(plan.y - gk.y); gk.sz = plan.z;
            const maxV = 6.0 + 3.2 * (gk.data.attrs.gkDiving / 100);
            const vy = clamp((plan.y - gk.y) / tLeft, -maxV, maxV);
            gk.vy = vy; gk.vx = -sign * 0.5;
          } else {
            plan.dive = false;
            // step across
            gk.intent.mx = 0; gk.intent.my = Math.sign(dy); gk.intent.sprint = true;
            gk.setState('jump', 0.6);
          }
          gs.diveReq = 0;
        }
      }
      if (m.time > plan.tCross + 0.8) plan.done = true;
    }

    // ---- contact: hands
    const canHands = inOwnBox(m, gk, gk.x, gk.y) && !(m.lastTouch && m.lastTouch.side === gk.side && m.lastTouch !== gk && m.lastTouchByFoot && m.time - m.lastTouchT < 6);
    if (m.owner !== null && m.owner !== gk) continue;
    const diving = gk.state === 'dive';
    const jumping = gk.state === 'jump';
    const plan2 = gs.plan;
    let handZ = 1.0;
    if (diving && plan2) handZ = lerp(1.0, plan2.z, clamp01(gk.stateT / 0.35));
    else if (jumping) handZ = 1.9;
    else handZ = clamp(b.z, 0.25, 2.2);
    const dxy = Math.hypot(b.x - gk.x, b.y - gk.y);
    const dist3 = Math.hypot(dxy, (b.z - handZ) * 0.6);
    const a = gk.data.attrs;
    const reach = 0.82 + 0.3 * (a.gkHandling / 100) + (diving ? 0.55 : 0) + (jumping ? 0.25 : 0);
    const spd = b.speed();
    if (dist3 < reach && spd > 0.8 && b.z < 2.9 && gk.noTouchUntil <= m.time) {
      if (canHands && (m.lastTouch === null || m.lastTouch.side !== gk.side || !m.lastTouchByFoot || m.lastTouch === gk)) {
        resolveSave(m, gk, spd, diving, dist3 / reach);
      }
    } else if (canHands && !m.owner && b.z < 0.5 && spd < 5 && dxy < 0.9 && gk.noTouchUntil <= m.time && m.lastTouch && m.lastTouch.side !== gk.side) {
      catchBall(m, gk);
    }
    // approach keeper claims
    const cl = gs.claim;
    if (cl && m.time > cl.t - 0.25 && dist3 < reach + 0.35 && b.z < 3) {
      if (cl.punch) punch(m, gk); else if (canHands) resolveSave(m, gk, spd, false, 0.4); else punch(m, gk);
      gs.claim = null;
    }
    void dt; void BALL_R;
  }
}

function punch(m: Match, gk: MPlayer): void {
  const b = m.ball;
  const sign = Math.sign(ownGoalX(m, gk)) || 1;
  m.setTouch(gk);
  const sideY = (b.y >= 0 ? 1 : -1);
  b.vx = -sign * (9 + m.rng.float(0, 4)); b.vy = sideY * m.rng.float(3, 8); b.vz = m.rng.float(5, 9);
  gk.noTouchUntil = m.time + 0.6;
  gk.gk.lastSaveT = m.time;
  m.passInfo = null;
  m.bus.emit('save', { keeper: gk, caught: false });
}

function resolveSave(m: Match, gk: MPlayer, spd: number, diving: boolean, offCenter: number): void {
  const b = m.ball;
  const a = gk.data.attrs;
  const sign = Math.sign(ownGoalX(m, gk)) || 1;
  const wasShot = !!m.shotInfo && m.shotInfo.shooter.side !== gk.side && m.time - m.shotInfo.time < 3.5;
  let pCatch = 0.93 - Math.max(0, spd - 9) * 0.03 + (a.gkHandling - 60) / 230 - offCenter * 0.35 - (diving ? 0.1 : 0) - (b.knuckle > 0.3 ? 0.18 : 0);
  if (gk.data.traits.includes('Penalty Saver') && m.penaltyKick) pCatch += 0.05;
  pCatch = clamp(pCatch, 0.04, 0.97);
  if (wasShot) { gk.stats.saves++; m.teams[gk.side].stats.saves++; gk.stats.ratingEvents += 1; }
  gk.gk.lastSaveT = m.time;
  if (m.rng.chance(pCatch)) {
    catchBall(m, gk);
    m.bus.emit('save', { keeper: gk, caught: true });
  } else {
    // parry: wide and up, away from goal
    m.setTouch(gk);
    const sideY = b.y - gk.y >= 0 ? 1 : -1;
    const keep = clamp(0.35 + (a.gkHandling - 50) / 200, 0.2, 0.6);
    if (m.rng.chance(0.42)) {
      // tipped around the post / over the bar: a corner
      b.vx = sign * m.rng.float(2.5, 5); b.vy = sideY * m.rng.float(4, 8); b.vz = m.rng.float(1, 4);
    } else {
      b.vx = -sign * Math.max(3, spd * keep * 0.7) + m.rng.gauss(0, 1.5);
      b.vy = (sideY * 0.7 + m.rng.gauss(0, 0.4)) * Math.max(3, spd * 0.3);
      b.vz = m.rng.float(1.5, 5);
    }
    gk.noTouchUntil = m.time + 0.5;
    m.passInfo = null;
    m.bus.emit('save', { keeper: gk, caught: false });
  }
  m.shotInfo = null;
  void distSegPoint;
}
