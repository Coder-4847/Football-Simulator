import { clamp, clamp01 } from '../core/math';
import { BALL_R, BOX_L, GOAL_H, HALF_L, HALF_W, other, PEN_SPOT, SIX_L, type Side } from './constants';
import type { MPlayer } from './entities';
import type { Match, PassInfo } from './match';
import type { SetPieceType } from './types';
import { executePass, executeShot, ballisticTo, type PassSpec, type ShotSpec } from './actions';
import { shapeTarget } from './ai';

// =====================================================================
// SET PIECES
// =====================================================================

export interface SetPiece {
  type: SetPieceType;
  side: Side;
  x: number; y: number;
  taker: MPlayer | null;
  phase: 'setup' | 'ready' | 'done';
  t: number;
  maxSetup: number;
  readyAt: number;
  aimY: number; aimH: number; power: number; curve: number;
  wall: MPlayer[]; wallShift: number;
  cornerStyle: 'in' | 'out' | 'short';
  indirect: boolean;
  /** shot target direction memory for penalties */
  penaltyKeeperGuess: -1 | 0 | 1;
  /** time the human has been aiming */
  aimT: number;
  shootout: boolean;
  takenAt: number;
}

export interface SetPieceInit { type: SetPieceType; side: Side; x: number; y: number; indirect?: boolean; shootout?: boolean; taker?: MPlayer }

function pickTaker(m: Match, init: SetPieceInit): MPlayer | null {
  const t = m.teams[init.side];
  const field = t.players.filter((p) => p.active() && !p.isGK() && !p.injured);
  const gk = m.keeperOf(init.side);
  const byDist = (arr: MPlayer[]): MPlayer[] => [...arr].sort((a, b) => Math.hypot(a.x - init.x, a.y - init.y) - Math.hypot(b.x - init.x, b.y - init.y));
  switch (init.type) {
    case 'kickoff': {
      const c = field.filter((p) => ['ST', 'CF', 'CAM', 'CM'].includes(p.slotPos));
      return (c.length ? c : field).sort((a, b) => b.data.attrs.shortPass - a.data.attrs.shortPass)[0] ?? null;
    }
    case 'goalKick': return gk ?? field[0] ?? null;
    case 'throwIn': {
      const near = byDist(field).slice(0, 3);
      return near.find((p) => p.data.traits.includes('Long Throw')) ?? near[0] ?? null;
    }
    case 'corner': return [...field].sort((a, b) => (b.data.attrs.crossing + b.data.attrs.curve) - (a.data.attrs.crossing + a.data.attrs.curve)).filter((p) => Math.hypot(p.x - init.x, p.y - init.y) < 45)[0] ?? byDist(field)[0] ?? null;
    case 'penalty': return [...field].sort((a, b) => b.data.attrs.penalties - a.data.attrs.penalties)[0] ?? null;
    case 'freeKick': case 'indirectFreeKick': {
      const g = m.dirOf(init.side) * HALF_L;
      const dist = Math.hypot(g - init.x, init.y);
      if (dist < 34 && init.type === 'freeKick') {
        return [...field].sort((a, b) => (b.data.attrs.freeKick + b.data.attrs.shotPower * 0.3 + b.data.attrs.curve * 0.4) - (a.data.attrs.freeKick + a.data.attrs.shotPower * 0.3 + a.data.attrs.curve * 0.4))[0] ?? null;
      }
      const near = byDist(field).slice(0, 5);
      return near.sort((a, b) => b.data.attrs.longPass - a.data.attrs.longPass)[0] ?? null;
    }
  }
  return null;
}

export function startSetPiece(m: Match, init: SetPieceInit): void {
  // end of the period takes priority over anything except a penalty
  if (m.periodExpired && init.type !== 'penalty' && m.phase !== 'shootout') {
    if (m.maybeEndPeriod()) return;
  }
  const b = m.ball;
  m.applyQueuedSubs();
  m.owner = null; m.ballInGoalKeeperHands = null; m.passInfo = null; m.shotInfo = null; m.adv = null;
  let { x, y } = init;
  // clamp ball position to legal spots
  if (init.type === 'throwIn') { y = Math.sign(y) * HALF_W; x = clamp(x, -HALF_L + 1, HALF_L - 1); }
  b.reset(x, y);
  const taker = init.taker ?? pickTaker(m, init);
  const sp: SetPiece = {
    type: init.type, side: init.side, x, y, taker, phase: 'setup', t: 0,
    maxSetup: init.type === 'kickoff' ? 3 : init.type === 'throwIn' ? 2.2 : init.type === 'penalty' ? 4 : init.type === 'goalKick' ? 2.6 : 4.5,
    readyAt: 0, aimY: 0, aimH: 0.3, power: 0.5, curve: 0, wall: [], wallShift: 0,
    cornerStyle: 'in', indirect: init.type === 'indirectFreeKick', penaltyKeeperGuess: 0, aimT: 0,
    shootout: !!init.shootout, takenAt: 0,
  };
  m.sp = sp;
  m.phase = m.phase === 'shootout' ? 'shootout' : 'setpiece';
  m.phaseT = 0;
  const teamSide = init.side;
  switch (init.type) {
    case 'throwIn': m.bus.emit('throwIn', { side: teamSide }); break;
    case 'corner': m.bus.emit('corner', { side: teamSide }); m.teams[teamSide].stats.corners++; break;
    case 'goalKick': m.bus.emit('goalKick', { side: teamSide }); break;
    case 'freeKick': case 'indirectFreeKick': m.bus.emit('freeKick', { side: teamSide, x, y }); m.teams[teamSide].stats.freeKicks++; break;
    case 'penalty': m.bus.emit('penalty', { side: teamSide }); break;
    case 'kickoff': break;
  }
  m.stoppageAcc += init.type === 'penalty' ? 60 : init.type === 'freeKick' || init.type === 'indirectFreeKick' ? 12 : 0;
  m.bus.emit('restart', { type: init.type, side: teamSide });
  // human control: the human on the taking team controls the taker; others pick sensible defenders
  for (let i = 0; i < m.humans.length; i++) {
    const h = m.humans[i]!;
    if (h.side === teamSide && taker && !h.keeperOnly) {
      const first = m.humans.findIndex((q) => q.side === teamSide && !q.keeperOnly);
      if (first === i) { h.player = taker; taker.human = i; }
    }
  }
  computeSetPieceTargets(m, sp);
  // dead-ball substitutions for AI teams
  for (const t of m.teams) aiSubstitutions(m, t.side);
}

/** AI managers make substitutions at dead balls. */
function aiSubstitutions(m: Match, side: Side): void {
  const t = m.teams[side];
  if (t.controlled.length > 0 && !m.cfg.headless) return;
  if (t.subsMade >= m.cfg.maxSubs || t.bench.length === 0) return;
  const min = m.gameMinutes();
  const slots = [58, 70, 80, 88];
  const due = slots.filter((s) => min >= s && m.windowsUsedFor(side) < m.cfg.subWindows).length;
  const doneWindows = m.windowsUsedFor(side);
  if (due <= doneWindows) return;
  const cand = t.players.filter((p) => p.active() && !p.isGK()).sort((a, b) => a.stamina - b.stamina);
  let made = 0;
  for (const p of cand) {
    if (made >= 2 || t.subsMade >= m.cfg.maxSubs) break;
    if (p.stamina > 0.72 && !p.injured) continue;
    const on = m.pickSubFor(p);
    if (on && m.substitute(side, p, on)) made++;
  }
  if (made === 0) m.closeSubWindow(side);
}

function setTargets(p: MPlayer, x: number, y: number): void { p.tx = x; p.ty = y; p.runTarget = null; }

export function computeSetPieceTargets(m: Match, sp: SetPiece): void {
  const att = m.teams[sp.side];
  const def = m.teams[other(sp.side)];
  const aDir = att.dir;
  const goalX = aDir * HALF_L;      // goal being attacked by the taking team
  const ownGoalX = -aDir * HALF_L;
  const taker = sp.taker;
  const fieldOf = (t: typeof att): MPlayer[] => t.players.filter((p) => p.active() && !p.isGK());
  const gkA = m.keeperOf(att.side), gkD = m.keeperOf(def.side);

  // default: everyone holds shape relative to the ball spot
  for (const t of [att, def]) {
    for (const p of t.players) {
      if (!p.active()) continue;
      const s = shapeTarget(m, p, sp.x, sp.y, t.side === sp.side);
      setTargets(p, s.x, s.y);
    }
  }
  const assign = (p: MPlayer | null | undefined, x: number, y: number): void => { if (p) setTargets(p, x, y); };

  switch (sp.type) {
    case 'kickoff': {
      for (const t of [att, def]) for (const p of t.players) {
        if (!p.active()) continue;
        const s = t.formation.slots[p.slot]!;
        let wx = t.dir * (-HALF_L + Math.min(s.x, 0.47) * 105);
        const wy = t.dir * (s.y - 0.5) * 68;
        if (p.isGK()) wx = t.dir * (-HALF_L + 3);
        // opposing team stays out of the circle
        if (t === def && Math.hypot(wx, wy) < 10.5) wx = t.dir * -(Math.sqrt(Math.max(0, 10.5 ** 2 - wy * wy)) + 0.5) * -1;
        setTargets(p, wx, wy);
      }
      if (taker) {
        assign(taker, -aDir * 0.6, 0.3);
        const mate = fieldOf(att).filter((p) => p !== taker).sort((a, b) => Math.hypot(a.tx, a.ty) - Math.hypot(b.tx, b.ty))[0];
        assign(mate, -aDir * 1.5, -5);
      }
      break;
    }
    case 'throwIn': {
      const side = Math.sign(sp.y) || 1;
      assign(taker, sp.x, sp.y + side * 0.8);
      const mates = fieldOf(att).filter((p) => p !== taker).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y)).slice(0, 3);
      const offs = [{ dx: -aDir * 6, dy: -side * 6 }, { dx: aDir * 9, dy: -side * 9 }, { dx: aDir * 3, dy: -side * 14 }];
      mates.forEach((p, i) => assign(p, clamp(sp.x + offs[i]!.dx, -HALF_L + 3, HALF_L - 3), clamp(sp.y + offs[i]!.dy, -HALF_W + 2, HALF_W - 2)));
      // opponents mark them
      const opps = fieldOf(def).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y)).slice(0, 3);
      opps.forEach((o, i) => { const mt = mates[i]; if (mt) assign(o, mt.tx - aDir * 1.5, mt.ty + (mt.ty > 0 ? -1 : 1) * 0.8); });
      break;
    }
    case 'goalKick': {
      const gk = taker;
      assign(gk, sp.x - aDir * 0.8, sp.y);
      for (const p of fieldOf(att)) {
        const s = shapeTarget(m, p, aDir * -10, 0, true);
        setTargets(p, s.x, s.y);
      }
      for (const p of fieldOf(def)) {
        const s = shapeTarget(m, p, aDir * -5, 0, false);
        // stay out of the penalty area
        const inside = Math.abs(s.x - ownGoalX) < BOX_L + 1 && Math.abs(s.y) < 21;
        setTargets(p, inside ? ownGoalX * 0 + aDir * (HALF_L - BOX_L - 2) * -1 + aDir * 0 : s.x, s.y);
      }
      assign(gkD, -ownGoalX * 0 + ownGoalX * 1 - Math.sign(ownGoalX) * 0.5, 0);
      break;
    }
    case 'corner': {
      const cs = Math.sign(sp.y) || 1;
      const gx = goalX;
      assign(taker, sp.x - Math.sign(sp.x) * 0.4, sp.y + cs * 0.4);
      const attackers = fieldOf(att).filter((p) => p !== taker)
        .sort((a, b) => (b.data.attrs.heading + b.data.attrs.jumping + b.data.heightCm) - (a.data.attrs.heading + a.data.attrs.jumping + a.data.heightCm));
      const spots = [
        { x: gx - aDir * 4.2, y: -cs * 1.5 }, { x: gx - aDir * 9, y: cs * 0.5 }, { x: gx - aDir * 5.8, y: -cs * 6 },
        { x: gx - aDir * 12, y: -cs * 5 }, { x: gx - aDir * 7, y: cs * 4.5 }, { x: gx - aDir * 17, y: -cs * 8 }, { x: gx - aDir * 17, y: cs * 8 },
      ];
      attackers.slice(0, spots.length).forEach((p, i) => assign(p, spots[i]!.x, spots[i]!.y));
      attackers.slice(spots.length).forEach((p) => { const s = shapeTarget(m, p, aDir * 30, 0, true); setTargets(p, s.x, s.y); });
      // defenders: man mark the box attackers, two on the posts
      const defenders = fieldOf(def).sort((a, b) => b.data.attrs.marking + b.data.attrs.heading - (a.data.attrs.marking + a.data.attrs.heading));
      assign(defenders[0], gx - aDir * 0.6, 3.1); assign(defenders[1], gx - aDir * 0.6, -3.1);
      const marks = attackers.slice(0, 5);
      defenders.slice(2, 7).forEach((d, i) => { const a = marks[i]; if (a) assign(d, a.tx + aDir * 1.1, a.ty + (a.ty > 0 ? -0.5 : 0.5)); });
      defenders.slice(7).forEach((d, i) => assign(d, gx - aDir * (30 + i * 3), (i % 2 ? 1 : -1) * 10));
      assign(gkD, gx - aDir * 1.2, -cs * 1.4);
      assign(gkA, aDir * (HALF_L * 0.1), 0);
      break;
    }
    case 'freeKick': case 'indirectFreeKick': {
      const gx = goalX;
      const toGoal = Math.atan2(0 - sp.y, gx - sp.x);
      const dist = Math.hypot(gx - sp.x, sp.y);
      assign(taker, sp.x - Math.cos(toGoal) * 1.0, sp.y - Math.sin(toGoal) * 1.0);
      const n = dist < 17 ? 5 : dist < 23 ? 4 : dist < 30 ? 3 : dist < 42 ? 2 : 0;
      const defs = fieldOf(def).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y));
      sp.wall = n > 0 && sp.type === 'freeKick' || (n > 0 && sp.indirect) ? defs.slice(0, n) : [];
      layoutWall(m, sp);
      // attackers crowd the box for crosses / rebounds when close, otherwise hold shape
      const attackers = fieldOf(att).filter((p) => p !== taker).sort((a, b) => b.data.attrs.heading - a.data.attrs.heading);
      if (dist < 40) attackers.slice(0, 4).forEach((p, i) => assign(p, gx - aDir * (8 + (i % 2) * 4), (i - 1.5) * 5));
      defs.filter((d) => !sp.wall.includes(d)).slice(0, 4).forEach((d, i) => assign(d, gx - aDir * (6 + (i % 2) * 3), (i - 1.5) * 4.5));
      assign(gkD, ownGoalXFor(def, m) * 1 - Math.sign(ownGoalXFor(def, m)) * 1.0, clamp(sp.y * 0.12, -2.5, 2.5) - (sp.wall.length ? Math.sign(sp.y) * 0.8 : 0));
      break;
    }
    case 'penalty': {
      const gx = goalX;
      const spotX = gx - aDir * PEN_SPOT;
      assign(taker, spotX - aDir * 3.5, 0);
      assign(gkD, gx - aDir * 0.3, 0);
      const outside = (side: Side, i: number): { x: number; y: number } => {
        const a = ((i + 1) / 11) * Math.PI - Math.PI / 2;
        return { x: gx - aDir * (BOX_L + 1.2 + (side === sp.side ? 0 : 2.5)), y: Math.sin(a) * 19 + (side === sp.side ? 1 : -1) * 0 };
      };
      let i = 0;
      for (const t of [att, def]) for (const p of fieldOf(t)) {
        if (p === taker) continue;
        const o = outside(t.side, i++);
        setTargets(p, o.x, o.y);
      }
      assign(gkA, aDir * 0, 0);
      // other keeper/non-participants in a shootout wait at the halfway line
      if (sp.shootout) {
        for (const t of [att, def]) for (const p of fieldOf(t)) if (p !== taker) setTargets(p, ((t.side === 0 ? -1 : 1) * 2.5), (p.slot - 5) * 2.2);
        assign(gkA, aDir * 1 * -30, 0);
      }
      break;
    }
  }
  clampOutOfBox(m, sp);
}

const ownGoalXFor = (t: { dir: number }, _m: Match): number => -t.dir * HALF_L;

function layoutWall(m: Match, sp: SetPiece): void {
  const att = m.teams[sp.side];
  const gx = att.dir * HALF_L;
  const ang = Math.atan2(0 - sp.y, gx - sp.x);
  const cx = sp.x + Math.cos(ang) * 9.5;
  const cy = sp.y + Math.sin(ang) * 9.5;
  const px = -Math.sin(ang), py = Math.cos(ang);
  const n = sp.wall.length;
  sp.wall.forEach((p, i) => {
    const off = (i - (n - 1) / 2) * 0.75 + sp.wallShift;
    setTargets(p, cx + px * off, cy + py * off);
  });
}

export function nudgeWall(m: Match, dir: -1 | 1): void {
  const sp = m.sp;
  if (!sp || sp.wall.length === 0) return;
  sp.wallShift = clamp(sp.wallShift + dir * 0.5, -2.5, 2.5);
  layoutWall(m, sp);
}

function clampOutOfBox(m: Match, sp: SetPiece): void {
  // opponents must stay >= 9.15 m from the ball at free kicks/corners/kickoffs/throw-ins
  if (sp.type === 'penalty') return;
  const opp = m.teams[other(sp.side)];
  for (const p of opp.players) {
    if (!p.active() || sp.wall.includes(p) || p.isGK()) continue;
    const d = Math.hypot(p.tx - sp.x, p.ty - sp.y);
    const minD = sp.type === 'throwIn' ? 2.5 : 9.3;
    if (d < minD && sp.type !== 'kickoff' && sp.type !== 'corner') {
      const ux = (p.tx - sp.x) / (d || 1), uy = (p.ty - sp.y) / (d || 1);
      p.tx = sp.x + ux * minD; p.ty = sp.y + uy * minD;
    }
    if (sp.type === 'corner' && d < 9.15 && !(Math.abs(p.tx) > HALF_L - 18 && Math.abs(p.ty) < 22)) {
      const ux = (p.tx - sp.x) / (d || 1), uy = (p.ty - sp.y) / (d || 1);
      p.tx = sp.x + ux * 9.3; p.ty = sp.y + uy * 9.3;
    }
  }
}

/** Frame update while a set piece is being set up / waiting to be taken. */
export function updateSetPiece(m: Match, dt: number): void {
  const sp = m.sp;
  if (!sp) { m.phase = 'play'; return; }
  sp.t += dt;
  if (sp.phase === 'done') return;
  // keep the ball on its spot
  const b = m.ball;
  if (sp.phase === 'setup' || sp.phase === 'ready') {
    if (sp.type === 'throwIn') { /* ball sits on the line */ }
    b.x = sp.x; b.y = sp.y; b.z = BALL_R; b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
  }
  if (sp.phase === 'setup') {
    let ready = sp.t >= 0.6;
    if (ready) {
      for (const p of m.all) {
        if (p.human >= 0 && p !== sp.taker) continue;
        const d = Math.hypot(p.tx - p.x, p.ty - p.y);
        if (d > 1.4 && p.state !== 'down') { ready = false; break; }
      }
    }
    if (sp.type === 'kickoff' && sp.t < 1.2) ready = false;
    if (ready || sp.t >= sp.maxSetup) {
      sp.phase = 'ready';
      sp.readyAt = sp.t;
      m.bus.emit('whistle', { kind: 'restart' });
    }
  }
  // auto-take for AI (ai.ts handles decisions through m.aiTakeSetPiece) and unattended human timeouts
  if (sp.phase === 'ready') {
    const taker = sp.taker;
    const isHuman = taker !== null && taker.human >= 0;
    const wait = isHuman ? 14 : (sp.type === 'penalty' ? 1.6 : sp.type === 'kickoff' ? 1.0 : 0.9) + (1 - m.diffQuality) * 0.8;
    if (sp.t - sp.readyAt >= wait && m.aiTakeSetPiece) m.aiTakeSetPiece(m, sp);
  }
}

/** Execute the dead-ball strike, then resume play. `act` must call a kick action. */
export function takeSetPiece(m: Match, act: () => void): void {
  const sp = m.sp;
  if (!sp || sp.phase === 'done') return;
  act();
  sp.phase = 'done';
  sp.takenAt = m.time;
  m.sp = null;
  if (m.phase === 'setpiece') { m.phase = 'play'; m.phaseT = 0; }
  if (sp.type === 'penalty') m.penaltyKick = { taker: sp.taker!, t: m.time, side: sp.side };
  if (sp.type === 'kickoff') m.bus.emit('whistle', { kind: 'start' });
}

// ---- executors used by human & AI for set-piece takes ----

export function doThrowIn(m: Match, taker: MPlayer, tx: number, ty: number, receiver: MPlayer | null, long: boolean): void {
  takeSetPiece(m, () => {
    const b = m.ball;
    const dir = Math.atan2(ty - b.y, tx - b.x);
    b.reset(m.sp!.x, m.sp!.y, 2.1);
    const dist = Math.hypot(tx - b.x, ty - b.y);
    const maxD = long ? 30 + (taker.data.traits.includes('Long Throw') ? 12 : 0) : 14;
    const d = Math.min(dist, maxD);
    const T = clamp(d / (long ? 15 : 10) + 0.35, 0.5, 2.2);
    const err = m.rng.gauss(0, 0.05 + (1 - taker.data.attrs.shortPass / 100) * 0.06);
    const bal = ballisticTo(b.x, b.y, b.z, b.x + Math.cos(dir + err) * d, b.y + Math.sin(dir + err) * d, 0.4, T);
    m.kickBall(taker, bal.vx, bal.vy, bal.vz * 0.95, 0, 0, 0, 0, 'throw');
    taker.setState('throw', 0.6);
    m.registerPass(taker, receiver, 'short', tx, ty);
    taker.stats.passes++; m.teams[taker.side].stats.passes++;
    m.bus.emit('pass', { player: taker, target: receiver, kind: 'short' });
  });
}

export function doPassSetPiece(m: Match, taker: MPlayer, spec: PassSpec): void {
  takeSetPiece(m, () => executePass(m, taker, spec));
}
export function doShotSetPiece(m: Match, taker: MPlayer, spec: ShotSpec): void {
  const wall = m.sp?.wall ?? [];
  takeSetPiece(m, () => {
    if (m.sp?.type === 'penalty') m.lastGoalFromPenalty = true;
    if (m.sp?.type === 'penalty') m.notifyPenaltyTaken(taker, spec);
    executeShot(m, taker, spec);
    // the wall jumps as the ball is struck
    for (const w of wall) if (w.active() && m.rng.chance(0.75)) w.setState('jump', 0.7);
  });
}

// =====================================================================
// OUT OF PLAY
// =====================================================================

export function handleOutOfPlay(m: Match): void {
  const b = m.ball;
  if (b.inNet) return;
  const lt = m.lastTouch;
  const lastSide: Side = lt ? lt.side : 0;
  if (Math.abs(b.y) > HALF_W + BALL_R) {
    const side = other(lastSide);
    m.bus.emit('whistle', { kind: 'restart' });
    startSetPiece(m, { type: 'throwIn', side, x: b.x, y: Math.sign(b.y) * HALF_W });
    return;
  }
  if (Math.abs(b.x) > HALF_L + BALL_R) {
    const endSign = Math.sign(b.x);
    const defSide: Side = m.teams[0].dir === -endSign ? 0 : 1;
    if (lastSide === defSide) {
      startSetPiece(m, { type: 'corner', side: other(defSide), x: endSign * HALF_L, y: Math.sign(b.y || 1) * HALF_W });
    } else {
      startSetPiece(m, { type: 'goalKick', side: defSide, x: endSign * (HALF_L - SIX_L), y: Math.sign(b.y || 1) * 9.16 });
    }
  }
}

// =====================================================================
// OFFSIDE
// =====================================================================

export function adjudicateOffsideTouch(m: Match, p: MPlayer, pi: PassInfo): boolean {
  if (!m.cfg.offside || pi.noOffside) return false;
  if (p.side !== pi.passer.side || p === pi.passer) return false;
  if (!pi.offside.has(p.id)) return false;
  if (m.time - pi.time > 8) return false;
  // marginal offsides can be missed by the assistant (VAR may overturn the goal later)
  const margin = pi.offside.get(p.id) ?? 1;
  if (margin < 0.25 && m.rng.chance(0.4)) { m.missedOffside = { player: p, t: m.time }; return false; }
  p.stats.offsides++; m.teams[p.side].stats.offsides++;
  m.raiseFlag();
  m.bus.emit('offside', { player: p });
  m.bus.emit('whistle', { kind: 'offside' });
  const x = clamp(p.x, -HALF_L + 1, HALF_L - 1), y = clamp(p.y, -HALF_W + 1, HALF_W - 1);
  startSetPiece(m, { type: 'indirectFreeKick', side: other(p.side), x, y });
  return true;
}

// =====================================================================
// TACKLES & FOULS
// =====================================================================

export interface TackleReq { slide: boolean; dx: number; dy: number }

export function requestTackle(p: MPlayer, slide: boolean, dx: number, dy: number): void {
  p.tackleReq = { slide, dx, dy };
}

export function resolveTackleIntent(m: Match): void {
  for (const p of m.all) {
    const req = p.tackleReq;
    if (!req) continue;
    p.tackleReq = null;
    if (m.phase !== 'play') continue;
    if (p.tackleCooldown > m.time || (p.state !== 'normal' && p.state !== 'jump')) continue;
    doTackle(m, p, req);
  }
}

function doTackle(m: Match, t: MPlayer, req: TackleReq): void {
  const b = m.ball;
  const slide = req.slide;
  const len = Math.hypot(req.dx, req.dy);
  let ux = len > 0.01 ? req.dx / len : Math.cos(t.face), uy = len > 0.01 ? req.dy / len : Math.sin(t.face);
  const o = m.owner && m.owner.side !== t.side ? m.owner : null;
  const target = o ?? null;
  // auto-aim toward the ball owner / ball when assisted
  const refX = target ? target.x : b.x, refY = target ? target.y : b.y;
  const toRef = Math.hypot(refX - t.x, refY - t.y);
  if (toRef < (slide ? 3.2 : 1.8) && (len < 0.01 || toRef < 3)) {
    ux = (refX - t.x) / (toRef || 1); uy = (refY - t.y) / (toRef || 1);
  }
  t.face = Math.atan2(uy, ux);
  t.tackleCooldown = m.time + (slide ? 1.5 : 0.75);
  t.stats.tackles++; m.teams[t.side].stats.tackles++;
  if (slide) {
    t.setState('slide', 0.95);
    t.vx = ux * 7.4; t.vy = uy * 7.4;
  } else {
    t.setState('tackle', 0.5);
  }
  const range = slide ? 2.4 : 1.3;
  const att = t.data.attrs;
  const strict = m.cfg.refStrictness;

  if (target) {
    const d = Math.hypot(target.x - t.x, target.y - t.y);
    // for slides, the target counts if it's roughly in the sliding direction
    const along = ((target.x - t.x) * ux + (target.y - t.y) * uy);
    const ok = d <= range && (along > -0.2 || d < 0.9);
    if (ok) {
      const def = target.data.attrs;
      const tk = slide ? att.slidingTackle : att.standingTackle;
      const atk = tk * 0.55 + att.reactions * 0.15 + att.aggression * 0.1 + att.strength * 0.1 + att.interceptions * 0.1;
      const dribble = def.dribbling * 0.3 + def.balance * 0.2 + def.strength * 0.2 + def.ballControl * 0.2 + def.agility * 0.1 + (target.intent.shield ? 6 : 0);
      // approach geometry: from behind is easier to win but riskier
      const vf = Math.cos(target.face), vy = Math.sin(target.face);
      const dot = ((t.x - target.x) * vf + (t.y - target.y) * vy) / (d || 1);
      const behind = dot < -0.45;
      const speedBonus = clamp((t.speed - target.speed) / 12, -0.1, 0.1);
      let pWin = 0.5 + (atk - dribble) / 130 + speedBonus - (target.state === 'skill' ? 0.12 : 0);
      if (slide) pWin = pWin * 0.92 + 0.02;
      if (t.data.traits.includes('Tackler')) pWin += 0.05;
      if (target.data.traits.includes('Press Proven')) pWin -= 0.05;
      pWin = clamp(pWin, 0.1, 0.86);
      let pFoul = (slide ? 0.34 : 0.17) * (0.5 + att.aggression / 90) * m.cfg.foulFrequency * (0.75 + strict * 0.5);
      if (behind) pFoul *= 2.4;
      if (t.data.traits.includes('Tackler')) pFoul *= 0.85;
      const roll = m.rng.next();
      target.stats.dribbles++;
      if (roll < pWin) {
        // clean win (small foul chance even on a win for studs-up slides)
        if (m.rng.chance(pFoul * 0.35)) { callFoul(m, t, target, slide ? 'reckless' : 'trip', 0.3 + m.rng.float(0, 0.4)); return; }
        t.stats.tacklesWon++;
        m.bus.emit('tackle', { player: t, victim: target, success: true, slide });
        m.owner = null;
        m.setTouch(t);
        const k = m.rng.chance(slide ? 0.28 : 0.55) ? 'control' : 'loose';
        if (k === 'control' && !slide) {
          b.vx = t.vx; b.vy = t.vy; m.owner = t; m.possessionSide = t.side; m.passInfo = null;
        } else {
          const sp = slide ? 8 : 5;
          const ang = Math.atan2(uy, ux) + m.rng.gauss(0, 0.5);
          b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp; b.vz = m.rng.float(0, 1.2);
          m.passInfo = null;
        }
        target.setState('stumble', 0.5);
        target.noTouchUntil = m.time + 0.5;
        t.noTouchUntil = m.time + 0.12;
      } else if (roll < pWin + pFoul) {
        callFoul(m, t, target, slide ? (behind ? 'fromBehind' : 'reckless') : (behind ? 'fromBehind' : 'trip'), slide ? 0.45 + m.rng.float(0, 0.5) : 0.2 + m.rng.float(0, 0.5));
      } else {
        // missed: dribbler beats the tackle
        target.stats.dribblesWon++;
        m.bus.emit('tackle', { player: t, victim: target, success: false, slide });
        if (slide && m.rng.chance(0.2)) t.setState('down', 0.7);
      }
      return;
    }
  }
  // nothing to tackle: maybe a loose ball
  if (!o && b.z < 0.5 && !m.sp) {
    const d = Math.hypot(b.x - t.x, b.y - t.y);
    if (d <= range) {
      const sp = slide ? 8 : 4;
      const ang = Math.atan2(uy, ux);
      m.setTouch(t);
      b.vx = Math.cos(ang) * sp + t.vx * 0.3; b.vy = Math.sin(ang) * sp + t.vy * 0.3;
      t.noTouchUntil = m.time + 0.1;
      m.passInfo = null;
      return;
    }
  }
  // sliding into an empty space next to a player = possible late foul
  if (slide) {
    for (const v of m.teams[other(t.side)].players) {
      if (!v.active()) continue;
      const d = Math.hypot(v.x - t.x, v.y - t.y);
      if (d < 1.4 && m.rng.chance(0.4 * m.cfg.foulFrequency)) { callFoul(m, t, v, 'reckless', 0.45 + m.rng.float(0, 0.4)); return; }
    }
  }
}

/** Decide and execute a foul call. severity: ~0..1 (0.5 = clear yellow territory). */
export function callFoul(m: Match, offender: MPlayer, victim: MPlayer, kind: string, severity: number): void {
  if (m.phase !== 'play') return;
  const t = m.teams[offender.side];
  const x = kind === 'handball' ? offender.x : victim.x, y = kind === 'handball' ? offender.y : victim.y;
  const ownGoalX = -t.dir * HALF_L;
  const inBox = Math.abs(x - ownGoalX) < BOX_L && Math.abs(y) < 20.16;
  offender.stats.fouls++; victim.stats.fouled++; t.stats.fouls++;
  // advantage
  if (m.cfg.var && kind !== 'handball' && severity > 0.3 && !inBox && m.rng.chance(0.08)) {
    // the referee misses it; the VAR may still rule the goal out later
    m.missedFoul = { t: m.time, offender, victim };
    return;
  }
  const vt = m.teams[victim.side];
  const victimKeeps = (m.owner && m.owner.side === victim.side) || (!m.owner && m.lastTouch && m.lastTouch.side === victim.side && m.ball.speedXY() > 4);
  const attackingDepth = m.depth(victim.side, m.ball.x);
  let card: 'yellow' | 'red' | null = null;
  const strict = m.cfg.refStrictness;
  const dogso = isDogso(m, offender, victim);
  if (dogso && severity > 0.15 && kind !== 'handball' && !inBox) card = 'red';
  else if (dogso && inBox && severity > 0.5) card = 'yellow';
  else if (kind === 'handball' && inBox && m.ball.speedXY() > 14 && severity > 0.3 && dogso) card = 'red';
  else if (severity > 0.88 - strict * 0.25) card = 'red';
  else if (severity > 0.52 - strict * 0.3 || (offender.stats.fouls >= 3 && m.rng.chance(0.4))) card = 'yellow';
  if (offender.yellowCards >= 1 && card === 'yellow') card = 'red';

  const advOk = !inBox && victimKeeps && attackingDepth > -20 && severity < 0.75 && m.cfg.refStrictness < 0.9 && m.rng.chance(0.65);
  m.bus.emit('foul', { offender, victim, x, y, severity });
  m.moments.push({ t: m.time, kind: 'foul', side: offender.side, minute: m.minute(), text: offender.data.shortName });
  // victim goes down
  victim.setState('down', 0.8 + severity * 2.2);
  victim.noTouchUntil = m.time + 1;
  if (m.cfg.injuries && !advOk && m.rng.chance(0.01 + 0.12 * severity * severity)) {
    victim.injured = true;
    victim.setState('down', 4);
    m.injuryQueue.push(victim);
  }
  if (advOk) {
    m.adv = { side: victim.side, until: m.time + 4, x, y, offender, victim, card, penalty: inBox };
    m.bus.emit('advantage', { side: victim.side });
    return;
  }
  awardFoul(m, offender, victim, x, y, inBox, card, kind);
  void vt;
}

export function awardFoul(m: Match, offender: MPlayer, victim: MPlayer, x: number, y: number, inBox: boolean, card: 'yellow' | 'red' | null, kind: string): void {
  m.bus.emit('whistle', { kind: 'foul' });
  m.owner = null;
  if (card) giveCard(m, offender, card);
  let pen = inBox && kind !== 'offsideLike';
  const side = victim.side;
  if (m.cfg.var && pen && kind !== 'handball' && offender.stats.fouls > 0 && m.rng.chance(0.12)) {
    m.bus.emit('var', { kind: 'penalty', outcome: 'overturned', reason: 'Not enough contact' });
    pen = false; card = null;
    startSetPiece(m, { type: 'indirectFreeKick', side: other(side), x: clamp(offender.x, -HALF_L + 1, HALF_L - 1), y: clamp(offender.y, -HALF_W + 1, HALF_W - 1) }); void y; void x;
    return;
  }
  if (m.cfg.var && card === 'red' && m.rng.chance(0.2)) { m.bus.emit('var', { kind: 'red', outcome: 'overturned', reason: 'Downgraded to yellow' }); card = 'yellow'; }
  if (m.cfg.var && (pen || card === 'red')) { /* review handled in rules timers via flag */ m.varCheck = { kind: pen ? 'penalty' : 'red', offender, victim, card }; }
  if (m.injuryQueue.length) { m.phase = 'injury'; m.phaseT = 0; }
  if (pen) {
    const goalX = m.teams[side].dir * HALF_L;
    startSetPieceDeferred(m, { type: 'penalty', side, x: goalX - m.teams[side].dir * PEN_SPOT, y: 0 });
  } else {
    startSetPieceDeferred(m, { type: 'freeKick', side, x: clamp(x, -HALF_L + 0.5, HALF_L - 0.5), y: clamp(y, -HALF_W + 0.3, HALF_W - 0.3) });
  }
}

function startSetPieceDeferred(m: Match, init: { type: SetPieceType; side: Side; x: number; y: number }): void {
  const prevPhase = m.phase;
  startSetPiece(m, init);
  if (prevPhase === 'injury' && m.sp) { m.phase = 'injury'; m.phaseT = 0; }
}

function isDogso(m: Match, offender: MPlayer, victim: MPlayer): boolean {
  // victim is through on goal: last defender fouls, no other covering defender, close to goal and moving toward it
  const dir = m.teams[victim.side].dir;
  const goalX = dir * HALF_L;
  const dist = Math.hypot(goalX - victim.x, victim.y);
  if (dist > 32) return false;
  if (victim.vx * dir < 1.5) return false;
  const opp = m.teams[offender.side].players.filter((q) => q.active() && q !== offender);
  const covering = opp.filter((q) => (q.x * dir) > victim.x * dir && Math.abs(q.y - victim.y) < 22 && !q.isGK());
  const keeperOnly = covering.length === 0;
  return keeperOnly && (m.ball.x * dir > victim.x * dir - 3);
}

export function giveCard(m: Match, p: MPlayer, color: 'yellow' | 'red'): void {
  const t = m.teams[p.side];
  if (color === 'yellow') {
    p.yellowCards++;
    p.stats.yellow++; t.stats.yellow++;
    p.data.yellow++;
    if (p.yellowCards >= 2) { m.bus.emit('card', { player: p, color: 'yellow', second: true }); sendOff(m, p, true); return; }
    m.bus.emit('card', { player: p, color: 'yellow', second: false });
  } else {
    sendOff(m, p, false);
    m.bus.emit('card', { player: p, color: 'red', second: false });
  }
  m.stoppageAcc += 30;
}

function sendOff(m: Match, p: MPlayer, second: boolean): void {
  p.sentOff = true; p.stats.red++; p.data.red++;
  m.teams[p.side].stats.red++;
  p.vx = p.vy = 0;
  if (second) m.bus.emit('card', { player: p, color: 'red', second: true });
  if (m.owner === p) m.owner = null;
  m.refreshAll();
  for (const h of m.humans) if (h.player === p) h.player = null;
  // goalkeeper sent off: bring on the sub GK or put an outfield player in goal
  const t = m.teams[p.side];
  if (p.isGK()) {
    const gk = t.bench.find((b) => b.positions[0] === 'GK');
    const out = t.players.filter((q) => q.active() && !q.isGK());
    if (gk && t.subsMade < m.cfg.maxSubs && out.length) {
      const victim = [...out].sort((a, b) => a.data.overall - b.data.overall)[0]!;
      m.substitute(p.side, victim, gk, true);
      const np = t.players.find((q) => q.data === gk);
      if (np) { np.slotPos = 'GK'; np.role = 'goalkeeper'; }
    } else if (out.length) {
      const q = [...out].sort((a, b) => b.data.attrs.gkReflexes - a.data.attrs.gkReflexes)[0]!;
      q.slotPos = 'GK'; q.role = 'goalkeeper';
    }
  }
}

// =====================================================================
// ADVANTAGE
// =====================================================================

export function checkAdvantage(m: Match, _ended: boolean): void {
  const a = m.adv;
  if (!a) return;
  const opponentHas = m.owner !== null && m.owner.side !== a.side;
  if (opponentHas && m.time < a.until - 1.2) {
    // advantage did not materialise: return to the foul
    m.adv = null;
    awardFoul(m, a.offender, a.victim, a.x, a.y, a.penalty, a.card, 'advantageReturn');
    return;
  }
  if (m.time >= a.until) {
    m.adv = null;
    if (a.card) giveCard(m, a.offender, a.card);
    return;
  }
  // ball out of play during advantage: treat as normal
  if (Math.abs(m.ball.y) > HALF_W + BALL_R + 1 || Math.abs(m.ball.x) > HALF_L + BALL_R + 1) {
    m.adv = null;
    if (a.card) giveCard(m, a.offender, a.card);
  }
}

// =====================================================================
// PERIODIC RULE TIMERS
// =====================================================================

export function updateRulesTimers(m: Match, dt: number): void {
  if (m.phase === 'play') {
    // holding / shirt-pulling: a defender sprinting alongside the carrier from behind
    const o = m.owner;
    if (o && m.tick % 20 === 0) {
      for (const d of m.teams[other(o.side)].players) {
        if (!d.active() || d.state !== 'normal') continue;
        const dist = Math.hypot(d.x - o.x, d.y - o.y);
        if (dist < 1.0 && o.speed > 5 && d.intent.sprint) {
          const dot = ((d.x - o.x) * Math.cos(o.face) + (d.y - o.y) * Math.sin(o.face)) / (dist || 1);
          if (dot < 0.2 && m.rng.chance(0.012 * m.cfg.foulFrequency * (d.data.attrs.aggression / 70))) {
            callFoul(m, d, o, 'holding', 0.25 + m.rng.float(0, 0.3));
            break;
          }
        }
      }
    }
    if (m.passInfo && m.time - m.passInfo.time > 10) m.passInfo = null;
  }
  // pending sub prompts fall back to AI after the stoppage
  if (m.pendingSubPrompt && m.phaseT > 12) {
    const { side, player } = m.pendingSubPrompt;
    const on = m.pickSubFor(player);
    if (on) m.substitute(side, player, on, true);
    m.pendingSubPrompt = null;
  }
  void dt;
}

export { clamp01, GOAL_H };
