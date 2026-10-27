import { angleDiff, clamp, clamp01 } from '../core/math';
import { BOX_L, HALF_GOAL, HALF_L, HALF_W, other, PITCH_L } from './constants';
import type { MPlayer } from './entities';
import type { Match } from './match';
import type { HumanSlot, PassKind, ShotKind } from './types';
import { executePass, executeShot, pressureOn, type PassSpec } from './actions';
import { doPassSetPiece, doShotSetPiece, doThrowIn, nudgeWall, requestTackle } from './rules';
import { distSegPoint, secondLastDepth, zoneValue } from './ai';
import { resolveLoadout, skillById } from './skills';
import { startSkill } from './skillrun';

const POWER_TIME = 0.85; // seconds to fully charge

export function chargeOf(h: HumanSlot, held: number): number { return clamp01(held / POWER_TIME); }

export function humanContext(m: Match, h: HumanSlot): 'attack' | 'defend' | 'setpiece' | 'keeper' | 'penalty' {
  const p = h.player;
  if (!p) return 'defend';
  if (m.sp && m.sp.taker === p && m.sp.phase !== 'done') return m.sp.type === 'penalty' ? 'penalty' : 'setpiece';
  if (p.isGK() && m.ballInGoalKeeperHands === p) return 'keeper';
  if (p.isGK() && m.owner !== p) return 'keeper';
  if (m.owner === p) return 'attack';
  if (m.owner && m.owner.side === h.side) return 'attack';
  if (!m.owner && m.lastTouch && m.lastTouch.side === h.side && m.possessionSide === h.side) return 'attack';
  return 'defend';
}

export function updateHumans(m: Match, dt: number): void {
  for (let i = 0; i < m.humans.length; i++) {
    const h = m.humans[i]!;
    h.manualSwitchT += dt;
    ensurePlayer(m, h, i);
    const p = h.player;
    if (!p || !p.active()) continue;
    const inp = h.input;
    const it = p.intent;
    it.faceAngle = null; it.jockey = false; it.precise = false; it.shield = false;

    const ctx = humanContext(m, h);
    // ---- movement
    let mx = inp.mx, my = inp.my;
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }
    it.mx = mx; it.my = my;
    it.sprint = inp.down.sprint;
    if (m.phase !== 'play' && !(m.sp && m.sp.taker === p)) {
      // dead ball: non-takers move freely but not into the opposing set-piece zone (AI handles takers)
    }

    if (ctx === 'attack') attackControls(m, h, i, p);
    else if (ctx === 'defend') defendControls(m, h, i, p);
    else if (ctx === 'keeper') keeperControls(m, h, i, p);
    else setPieceControls(m, h, i, p, ctx);

    // buffered pass/shoot for the ball that is about to arrive handled in attackControls via h.queued
  }
}

// ---------- selection ----------

function ensurePlayer(m: Match, h: HumanSlot, idx: number): void {
  const team = m.teams[h.side];
  const valid = (p: MPlayer | null): p is MPlayer => !!p && p.active() && team.players.includes(p);
  if (!valid(h.player)) h.player = null;
  const takenByOther = (p: MPlayer): boolean => m.humans.some((o, j) => j !== idx && o.player === p);

  if (h.keeperOnly) {
    const gk = m.keeperOf(h.side);
    if (gk && h.player !== gk) { setSelected(m, h, idx, gk); }
    return;
  }
  // a set piece taker is assigned by startSetPiece for the first human; others pick as usual
  if (m.sp && m.sp.phase !== 'done' && m.sp.taker && m.sp.side === h.side && m.humans.findIndex((q) => q.side === h.side && !q.keeperOnly) === idx) {
    if (h.player !== m.sp.taker) setSelected(m, h, idx, m.sp.taker);
    return;
  }
  if (m.phase !== 'play' && m.phase !== 'shootout' && h.player && !(m.sp && m.sp.phase !== 'done')) return;
  if (m.phase === 'shootout') {
    // human controls the shooter or the keeper in a shootout
    const sp = m.sp;
    const gk = m.keeperOf(h.side);
    if (sp && sp.type === 'penalty') {
      const want = sp.side === h.side ? sp.taker : gk;
      if (want && h.player !== want) setSelected(m, h, idx, want);
    }
    return;
  }
  const owner = m.owner;
  if (owner && owner.side === h.side && !takenByOther(owner)) {
    if (h.player !== owner) setSelected(m, h, idx, owner);
    return;
  }
  if (!valid(h.player)) {
    const near = nearestTo(m, h, idx, m.ball.x, m.ball.y);
    if (near) setSelected(m, h, idx, near);
    return;
  }
  // auto-switch when defending / loose
  if (!m.cfg.assist.autoSwitch || h.manualSwitchT < 1.4) return;
  if (m.tick % 8 !== 0) return;
  // a pass in flight from a teammate: switch to the receiver
  const pi = m.passInfo;
  if (pi && pi.passer.side === h.side && pi.receiver && !takenByOther(pi.receiver) && pi.receiver.active() && h.player !== pi.receiver && !pi.completed && m.time - pi.time < 2) {
    setSelected(m, h, idx, pi.receiver);
    return;
  }
  if (h.player.isGK() && !h.keeperOnly && m.ballInGoalKeeperHands !== h.player) {
    const near = nearestTo(m, h, idx, m.ball.x, m.ball.y);
    if (near && !near.isGK()) setSelected(m, h, idx, near);
    return;
  }
  const near = nearestTo(m, h, idx, m.ball.x, m.ball.y);
  if (near && near !== h.player) {
    const dNew = Math.hypot(near.x - m.ball.x, near.y - m.ball.y);
    const dOld = Math.hypot(h.player.x - m.ball.x, h.player.y - m.ball.y);
    if (dNew + 3.5 < dOld) setSelected(m, h, idx, near);
  }
}

function nearestTo(m: Match, h: HumanSlot, idx: number, x: number, y: number, exclude?: MPlayer, dirx = 0, diry = 0): MPlayer | null {
  let best: MPlayer | null = null; let bd = 1e9;
  for (const p of m.teams[h.side].players) {
    if (!p.active() || p === exclude || p.isGK() && !h.keeperOnly) continue;
    if (m.humans.some((o, j) => j !== idx && o.player === p)) continue;
    let d = Math.hypot(p.x - x, p.y - y);
    if (dirx !== 0 || diry !== 0) {
      const ang = Math.abs(angleDiff(Math.atan2(diry, dirx), Math.atan2(p.y - m.humans[idx]!.player!.y, p.x - m.humans[idx]!.player!.x)));
      d += ang * 4;
    }
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function setSelected(m: Match, h: HumanSlot, idx: number, p: MPlayer): void {
  if (h.player) { h.player.human = -1; }
  h.player = p; p.human = idx;
  h.queued = null; h.charge = null;
  m.bus.emit('switchPlayer', { human: idx, player: p });
}

// ---------- shared target picking ----------

export interface PassChoice { target: MPlayer | null; tx: number; ty: number }

export function pickPassTarget(m: Match, p: MPlayer, sx: number, sy: number, kind: PassKind, assist: number): PassChoice {
  const team = m.teams[p.side];
  const dir = team.dir;
  const has = Math.hypot(sx, sy) > 0.25;
  const ang = has ? Math.atan2(sy, sx) : (p.speed > 1 ? Math.atan2(p.vy, p.vx) : p.face);
  const cone = 0.7 + assist * 0.9; // radians half-angle
  let best: MPlayer | null = null; let bs = -1e9;
  const offLine = secondLastDepth(m, p.side);
  for (const t of team.players) {
    if (!t.active() || t === p) continue;
    const dx = t.x - p.x, dy = t.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) continue;
    const dAng = Math.abs(angleDiff(ang, Math.atan2(dy, dx)));
    if (has && dAng > cone) continue;
    const minD = kind === 'lob' || kind === 'cross' ? 12 : 0;
    if (d < minD) continue;
    if (t.isGK() && m.depth(p.side, p.x) > -30) continue;
    let s = -dAng * 2.2 - d * (kind === 'through' ? 0.005 : 0.02);
    // lane quality
    let lane = 9;
    for (const o of m.teams[other(p.side)].players) { if (!o.active()) continue; lane = Math.min(lane, distSegPoint(p.x, p.y, t.x, t.y, o.x, o.y)); }
    s += clamp01(lane / 4) * (0.8 + assist);
    if (kind === 'through') s += zoneValue(m, p.side, t.x, t.y) * 1.3 + (t.vx * dir > 2 ? 0.8 : 0);
    if (kind === 'cross') { const inBox = Math.abs(t.x - dir * HALF_L) < BOX_L + 2 && Math.abs(t.y) < 21; if (!inBox) continue; s += t.data.attrs.heading / 150; }
    if (m.cfg.offside && t.x * dir > offLine + 0.3 && kind !== 'cross') s -= 1.2;
    if (s > bs) { bs = s; best = t; }
  }
  if (best) {
    const lead = kind === 'through' || kind === 'throughLob' ? 1.2 : kind === 'lob' || kind === 'cross' ? 0.8 : 0.35;
    return { target: best, tx: best.x + best.vx * lead + (kind === 'through' ? dir * 3 : 0), ty: best.y + best.vy * lead };
  }
  // no target: pass into space in the stick / facing direction
  const dist = kind === 'lob' || kind === 'cross' ? 28 : 15;
  return { target: null, tx: clamp(p.x + Math.cos(ang) * dist, -HALF_L + 1, HALF_L - 1), ty: clamp(p.y + Math.sin(ang) * dist, -HALF_W + 1, HALF_W - 1) };
}

function shotAim(m: Match, p: MPlayer, h: HumanSlot, power: number): { aimY: number; aimH: number } {
  const dir = m.teams[p.side].dir;
  const inp = h.input;
  const assist = m.cfg.assist.shot;
  let aimY = clamp(inp.my * dir * 1.05, -1, 1);
  if (Math.hypot(inp.mx, inp.my) < 0.2 && assist > 0.2) {
    // assisted placement: far corner away from the keeper
    const gk = m.keeperOf(other(p.side));
    const gkY = gk ? gk.y * dir : 0;
    aimY = (gkY > 0 ? -1 : 1) * (0.55 + 0.25 * m.rng.next());
  } else if (assist > 0) {
    aimY = clamp(aimY * (1 + assist * 0.2), -0.98, 0.98);
  }
  const aimH = clamp(0.25 + 0.3 * power + 0.25 * (inp.mx * dir), 0.1, 0.95);
  return { aimY, aimH };
}

// ---------- attack with ball ----------

function attackControls(m: Match, h: HumanSlot, idx: number, p: MPlayer): void {
  const inp = h.input;
  const it = p.intent;
  const hasBall = m.owner === p;
  const assistP = m.cfg.assist.pass;
  it.precise = inp.down.precise && hasBall;
  it.shield = inp.down.precise && hasBall;
  if (inp.down.precise && !hasBall) { /* slow approach */ it.precise = true; }

  // run call (off-ball) / send a runner (on ball)
  if (inp.pressed.modB && !hasBall) m.calledForPass = { player: p, until: m.time + 2.5 };
  if (inp.pressed.modB && hasBall && !inp.down.b4) m.requestRun(h.side);

  // skills
  if (hasBall && (inp.skillSlot >= 0 || inp.skillMoveId)) {
    const loadout = resolveLoadout(m.cfg.loadout, m.cfg.loadoutOverrides[p.data.id], p.data.skillMoves);
    const move = inp.skillMoveId ? skillById(inp.skillMoveId) ?? null : loadout[inp.skillSlot] ?? null;
    if (move) {
      const fx = Math.hypot(inp.rx, inp.ry) > 0.3 ? inp.rx : inp.mx;
      const fy = Math.hypot(inp.rx, inp.ry) > 0.3 ? inp.ry : inp.my;
      const lateralSign = Math.hypot(fx, fy) > 0.2 ? (angleDiff(p.face, Math.atan2(fy, fx)) >= 0 ? 1 : -1) : (m.rng.chance(0.5) ? 1 : -1);
      if (move.stars <= p.data.skillMoves) startSkill(m, p, move, lateralSign);
      else m.bus.emit('skill', { player: p, id: move.id, success: false });
    }
  }

  // buffered action: first-time / volley when the ball isn't owned yet
  if (!hasBall) {
    for (const b of ['b1', 'b2', 'b3', 'b4'] as const) {
      if (inp.pressed[b]) h.queued = { btn: b, t: m.time, hold: 0, mods: [inp.down.modA ? 'modA' : '', inp.down.modB ? 'modB' : '', inp.down.precise ? 'precise' : ''].filter(Boolean) };
    }
    if (h.queued && m.time - h.queued.t > 0.6) h.queued = null;
    if (h.queued) {
      const b = m.ball;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      // execute the buffered strike as soon as the ball is within striking range (first-time)
      if (d < 1.15 && b.z < 1.4 && p.noTouchUntil <= m.time) {
        const q = h.queued; h.queued = null;
        performFirstTime(m, h, p, q.btn, q.mods);
      }
    }
    return;
  }
  h.queued = null;

  // pass buttons — act on release for power; quick tap = natural weight
  const modA = inp.down.modA, modB = inp.down.modB;
  const sx = inp.mx, sy = inp.my;
  if (inp.released.b1) {
    const power = clamp(inp.heldAtRelease.b1 / POWER_TIME, 0.05, 1);
    const ch = pickPassTarget(m, p, sx, sy, 'ground', assistP);
    const spec: PassSpec = { kind: 'ground', tx: ch.tx, ty: ch.ty, receiver: ch.target, power: inp.heldAtRelease.b1 < 0.18 ? 0.3 : power, assist: assistP };
    executePass(m, p, spec);
    if (ch.target) switchToReceiver(m, h, idx, ch.target);
    return;
  }
  if (inp.released.b2) {
    const power = clamp(inp.heldAtRelease.b2 / POWER_TIME, 0.05, 1);
    const kind: PassKind = modA ? 'throughLob' : 'through';
    const ch = pickPassTarget(m, p, sx, sy, 'through', assistP);
    executePass(m, p, { kind: kind === 'throughLob' ? 'lob' : 'through', tx: ch.tx, ty: ch.ty, receiver: ch.target, power: inp.heldAtRelease.b2 < 0.18 ? 0.5 : 0.35 + power * 0.65, assist: assistP });
    if (ch.target) switchToReceiver(m, h, idx, ch.target);
    return;
  }
  if (inp.released.b3) {
    const dir = m.teams[p.side].dir;
    const goalX = dir * HALF_L;
    const wide = Math.abs(p.y) > 17 && Math.abs(p.x - goalX) < 38;
    const inOwnThird = m.depth(p.side, p.x) < -HALF_L * 0.55 && pressureOn(m, p) > 0.5;
    const power = clamp(inp.heldAtRelease.b3 / POWER_TIME, 0.1, 1);
    if (wide && !inOwnThird) {
      const kind: PassKind = modA ? 'lowCross' : 'cross';
      const ch = pickPassTarget(m, p, sx, sy, 'cross', m.cfg.assist.cross);
      if (ch.target) { executePass(m, p, { kind, tx: ch.tx, ty: ch.ty, receiver: ch.target, power, assist: m.cfg.assist.cross }); switchToReceiver(m, h, idx, ch.target); }
      else executePass(m, p, { kind, tx: goalX - dir * 9, ty: -Math.sign(p.y) * 2, receiver: null, power, assist: m.cfg.assist.cross });
    } else if (inOwnThird && p.x * dir < -HALF_L * 0.6) {
      executePass(m, p, { kind: 'clear', tx: dir * 10, ty: Math.sign(p.y || 1) * 28, receiver: null, power: 0.9, assist: 0.2 });
    } else {
      const ch = pickPassTarget(m, p, sx, sy, 'lob', assistP);
      executePass(m, p, { kind: 'lob', tx: ch.tx, ty: ch.ty, receiver: ch.target, power, assist: assistP });
      if (ch.target) switchToReceiver(m, h, idx, ch.target);
    }
    return;
  }
  if (inp.released.b4) {
    const power = clamp(inp.heldAtRelease.b4 / POWER_TIME, 0.1, 1);
    const kind: ShotKind = modB ? 'finesse' : modA ? 'chip' : inp.down.precise ? 'driven' : power > 0.92 ? 'power' : 'normal';
    const { aimY, aimH } = shotAim(m, p, h, power);
    executeShot(m, p, { kind, aimY, aimH, power, assist: m.cfg.assist.shot });
    return;
  }
}

function switchToReceiver(m: Match, h: HumanSlot, idx: number, target: MPlayer): void {
  if (!m.cfg.assist.autoSwitch) return;
  if (m.humans.some((o, j) => j !== idx && o.player === target)) return;
  if (target.isGK() && !h.keeperOnly) return;
  setSelected(m, h, idx, target);
  h.manualSwitchT = 0.5;
}

function performFirstTime(m: Match, h: HumanSlot, p: MPlayer, btn: string, mods: string[]): void {
  const inp = h.input;
  const dir = m.teams[p.side].dir;
  const sloppy = 1.5;
  if (btn === 'b4') {
    const power = 0.75;
    const kind: ShotKind = m.ball.z > 0.7 ? 'volley' : mods.includes('modB') ? 'finesse' : mods.includes('modA') ? 'chip' : 'normal';
    const { aimY, aimH } = shotAim(m, p, h, power);
    executeShot(m, p, { kind, aimY, aimH, power, assist: m.cfg.assist.shot * 0.8 });
    return;
  }
  const kind: PassKind = btn === 'b2' ? 'through' : btn === 'b3' ? 'lob' : 'ground';
  const ch = pickPassTarget(m, p, inp.mx, inp.my, kind, m.cfg.assist.pass);
  p.face = Math.atan2(ch.ty - p.y, ch.tx - p.x);
  executePass(m, p, { kind, tx: ch.tx, ty: ch.ty, receiver: ch.target, power: 0.45, assist: m.cfg.assist.pass * 0.8, sloppy });
  void dir;
}

// ---------- defending ----------

function defendControls(m: Match, h: HumanSlot, idx: number, p: MPlayer): void {
  const inp = h.input;
  const it = p.intent;
  const owner = m.owner && m.owner.side !== h.side ? m.owner : null;
  const b = m.ball;
  // contain / jockey
  if (inp.down.precise) {
    it.jockey = true;
    const tx = owner ? owner.x : b.x, ty = owner ? owner.y : b.y;
    it.faceAngle = Math.atan2(ty - p.y, tx - p.x);
  }
  // hold tackle = press: steer towards the carrier
  if (inp.down.b1 && inp.held.b1 > 0.18) {
    const tx = owner ? owner.x + owner.vx * 0.3 : b.x, ty = owner ? owner.y + owner.vy * 0.3 : b.y;
    const dx = tx - p.x, dy = ty - p.y; const d = Math.hypot(dx, dy) || 1;
    const w = d > 2.5 ? 0.8 : 0.5;
    it.mx = it.mx * (1 - w) + (dx / d) * w; it.my = it.my * (1 - w) + (dy / d) * w;
    it.sprint = d > 3;
  }
  if (inp.released.b1 && inp.heldAtRelease.b1 < 0.3) {
    requestTackle(p, false, owner ? owner.x - p.x : b.x - p.x, owner ? owner.y - p.y : b.y - p.y);
  }
  // b3: slide, or clear when the ball is loose near our box
  if (inp.pressed.b3) {
    const ownGoalX = -m.teams[p.side].dir * HALF_L;
    const nearBall = Math.hypot(b.x - p.x, b.y - p.y) < 2.6;
    const nearOwnBox = Math.abs(b.x - ownGoalX) < BOX_L + 8;
    if (!owner && nearBall && nearOwnBox && b.z < 1.2) {
      executeClear(m, p, h);
    } else {
      requestTackle(p, true, owner ? owner.x - p.x : (inp.mx || Math.cos(p.face)), owner ? owner.y - p.y : (inp.my || Math.sin(p.face)));
    }
  }
  // b4 / modA: switch to the best player (direction aware)
  if (inp.pressed.b4 || inp.pressed.modA) manualSwitch(m, h, idx, p);
  // modB: second presser; hold: call teammate to press
  if (inp.pressed.modB) m.requestPress(h.side, p);
  // b2: keeper charge
  if (inp.pressed.b2) m.keeperCharge(h.side);
}

function executeClear(m: Match, p: MPlayer, h: HumanSlot): void {
  const dir = m.teams[p.side].dir;
  const sy = Math.abs(h.input.my) > 0.2 ? Math.sign(h.input.my) : Math.sign(p.y || 1);
  m.setTouch(p, true);
  executePass(m, p, { kind: 'clear', tx: dir * 10, ty: sy * 30, receiver: null, power: 0.9, assist: 0.2 });
  p.stats.clearances++; m.teams[p.side].stats.clearances++;
}

export function manualSwitch(m: Match, h: HumanSlot, idx: number, p: MPlayer): void {
  const inp = h.input;
  const ref = m.owner && m.owner.side !== h.side ? m.owner : null;
  const bx = ref ? ref.x : m.ball.x, by = ref ? ref.y : m.ball.y;
  const hasDir = Math.hypot(inp.rx, inp.ry) > 0.4 || Math.hypot(inp.mx, inp.my) > 0.4;
  const dx = Math.hypot(inp.rx, inp.ry) > 0.4 ? inp.rx : inp.mx;
  const dy = Math.hypot(inp.rx, inp.ry) > 0.4 ? inp.ry : inp.my;
  const target = hasDir
    ? bestInDirection(m, h, idx, p, dx, dy)
    : nearestTo(m, h, idx, bx, by, p);
  if (target) { setSelected(m, h, idx, target); h.manualSwitchT = 0; }
}

function bestInDirection(m: Match, h: HumanSlot, idx: number, p: MPlayer, dx: number, dy: number): MPlayer | null {
  let best: MPlayer | null = null; let bs = 1e9;
  const a = Math.atan2(dy, dx);
  for (const q of m.teams[h.side].players) {
    if (!q.active() || q === p || (q.isGK() && !h.keeperOnly)) continue;
    if (m.humans.some((o, j) => j !== idx && o.player === q)) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    const ang = Math.abs(angleDiff(a, Math.atan2(q.y - p.y, q.x - p.x)));
    if (ang > 1.2) continue;
    const s = ang * 6 + d * 0.5 + Math.hypot(q.x - m.ball.x, q.y - m.ball.y) * 0.3;
    if (s < bs) { bs = s; best = q; }
  }
  return best ?? nearestTo(m, h, idx, m.ball.x, m.ball.y, p);
}

// ---------- goalkeeper ----------

function keeperControls(m: Match, h: HumanSlot, idx: number, p: MPlayer): void {
  const inp = h.input;
  const dir = m.teams[p.side].dir;
  if (m.ballInGoalKeeperHands === p) {
    p.intent.mx = 0; p.intent.my = 0;
    p.gk.holdT += 0; // AI timer only advances for AI keepers; humans wait for input (auto-release after 6 s)
    p.gk.holdT += 1 / 60;
    const mates = m.teams[p.side].players;
    void mates;
    if (inp.released.b1 || inp.released.b2 || p.gk.holdT > 6) {
      m.ballInGoalKeeperHands = null; m.owner = null; p.gk.holdT = 0;
      const ch = pickPassTarget(m, p, inp.mx, inp.my, 'ground', 0.7);
      const throwD = ch.target ? Math.hypot(ch.target.x - p.x, ch.target.y - p.y) : 0;
      executePass(m, p, { kind: throwD < 32 ? 'keeperThrow' : 'keeperKick', tx: ch.tx, ty: ch.ty, receiver: ch.target, power: 0.5, assist: 0.6 });
    } else if (inp.released.b3) {
      m.ballInGoalKeeperHands = null; m.owner = null; p.gk.holdT = 0;
      const ch = pickPassTarget(m, p, inp.mx, inp.my, 'lob', 0.6);
      executePass(m, p, { kind: 'keeperKick', tx: ch.tx, ty: ch.ty, receiver: ch.target, power: clamp(inp.heldAtRelease.b3 / POWER_TIME, 0.4, 1), assist: 0.5 });
    }
    return;
  }
  // free keeper: dives and rush
  if (inp.pressed.modA) p.gk.diveReq = -1;
  if (inp.pressed.modB) p.gk.diveReq = 1;
  if (Math.abs(inp.rx) > 0.6 && Math.abs(inp.ry) > 0) { /* right stick dive aiming reserved */ }
  if (inp.pressed.b2) {
    // rush out towards the ball
    p.intent.mx = (m.ball.x - p.x) / (Math.hypot(m.ball.x - p.x, m.ball.y - p.y) || 1);
    p.intent.my = (m.ball.y - p.y) / (Math.hypot(m.ball.x - p.x, m.ball.y - p.y) || 1);
    p.intent.sprint = true;
  }
  if (inp.pressed.b1 && Math.hypot(m.ball.x - p.x, m.ball.y - p.y) < 2.2 && m.owner && m.owner.side !== p.side) {
    requestTackle(p, true, m.ball.x - p.x, m.ball.y - p.y);
  }
  void dir; void h; void idx; void HALF_GOAL; void PITCH_L;
}

// ---------- set pieces ----------

function setPieceControls(m: Match, h: HumanSlot, idx: number, p: MPlayer, ctx: 'setpiece' | 'penalty'): void {
  const sp = m.sp;
  if (!sp || sp.taker !== p) return;
  const inp = h.input;
  const dir = m.teams[p.side].dir;
  const it = p.intent;
  // the taker doesn't walk away from the ball
  it.mx = 0; it.my = 0; it.sprint = false;
  if (sp.phase !== 'ready') return;
  const dt = 1 / 60;
  const fine = inp.down.precise ? 0.35 : 1;
  sp.aimT += dt;
  if (ctx === 'penalty' || sp.type === 'freeKick' || sp.type === 'indirectFreeKick') {
    sp.aimY = clamp(sp.aimY + inp.my * dir * dt * 1.6 * fine, -1, 1);
    sp.aimH = clamp(sp.aimH + inp.mx * dir * dt * 1.2 * fine, 0.05, 1);
    sp.curve = clamp(sp.curve + inp.rx * dt * 1.2, -1, 1);
  }
  if (sp.type === 'freeKick' || sp.type === 'indirectFreeKick') {
    if (inp.pressed.modA) nudgeWall(m, -1);
    if (inp.pressed.modB) nudgeWall(m, 1);
  }
  if (sp.type === 'corner') {
    if (inp.pressed.modA) sp.cornerStyle = sp.cornerStyle === 'out' ? 'in' : 'out';
    if (inp.pressed.modB) sp.cornerStyle = 'in';
  }
  const chargeP = clamp(inp.held.b4 / POWER_TIME, 0, 1);
  switch (sp.type) {
    case 'kickoff': {
      for (const b of ['b1', 'b2', 'b3', 'b4'] as const) if (inp.released[b]) {
        const ch = pickPassTarget(m, p, inp.mx, inp.my, 'ground', 0.9);
        doPassSetPiece(m, p, { kind: 'ground', tx: ch.tx, ty: ch.ty, receiver: ch.target, power: 0.3, assist: 0.9 });
        if (ch.target) switchToReceiver(m, h, idx, ch.target);
        return;
      }
      break;
    }
    case 'throwIn': {
      const quick = inp.released.b4;
      if (inp.released.b1 || inp.released.b3 || quick) {
        const long = inp.released.b3;
        const ch = pickPassTarget(m, p, inp.mx, inp.my, long ? 'lob' : 'ground', 0.9);
        const t = ch.target;
        doThrowIn(m, p, t ? t.x + t.vx * 0.5 : ch.tx, t ? t.y + t.vy * 0.5 : ch.ty, t, long);
        if (t) switchToReceiver(m, h, idx, t);
      }
      break;
    }
    case 'goalKick': {
      if (inp.released.b1) {
        const ch = pickPassTarget(m, p, inp.mx, inp.my, 'ground', 0.9);
        doPassSetPiece(m, p, { kind: 'ground', tx: ch.tx, ty: ch.ty, receiver: ch.target, power: 0.45, assist: 0.8 });
        if (ch.target) switchToReceiver(m, h, idx, ch.target);
      } else if (inp.released.b3 || inp.released.b4) {
        const ch = pickPassTarget(m, p, inp.mx, inp.my, 'lob', 0.6);
        doPassSetPiece(m, p, { kind: 'keeperKick', tx: ch.tx, ty: ch.ty, receiver: ch.target, power: 0.4 + 0.6 * clamp(inp.heldAtRelease.b3 / POWER_TIME, 0, 1), assist: 0.4 });
        if (ch.target) switchToReceiver(m, h, idx, ch.target);
      }
      break;
    }
    case 'corner': {
      if (inp.released.b1) {
        const ch = pickPassTarget(m, p, inp.mx, inp.my, 'ground', 0.8);
        doPassSetPiece(m, p, { kind: 'ground', tx: ch.tx, ty: ch.ty, receiver: ch.target, power: 0.35, assist: 0.7 });
        if (ch.target) switchToReceiver(m, h, idx, ch.target);
      } else if (inp.released.b3 || inp.released.b4 || inp.released.b2) {
        const goalX = dir * HALF_L;
        // aim zone from the stick: near post / penalty spot / far post / edge of box
        const ch = pickPassTarget(m, p, inp.mx, inp.my, 'cross', 0.8);
        const tx = ch.target ? ch.target.x : goalX - dir * 9, ty = ch.target ? ch.target.y : -Math.sign(p.y) * 1.5;
        const power = clamp((inp.heldAtRelease.b3 || inp.heldAtRelease.b4 || inp.heldAtRelease.b2) / POWER_TIME, 0.25, 1);
        doPassSetPiece(m, p, { kind: 'cross', tx, ty, receiver: ch.target, power, assist: 0.6, curve: sp.cornerStyle === 'out' ? -1 : 1 });
        if (ch.target) switchToReceiver(m, h, idx, ch.target);
      }
      break;
    }
    case 'freeKick': case 'indirectFreeKick': {
      if (inp.released.b4 && sp.type === 'freeKick') {
        const power = clamp(inp.heldAtRelease.b4 / POWER_TIME, 0.2, 1);
        doShotSetPiece(m, p, { kind: 'freeKick', aimY: sp.aimY, aimH: sp.aimH, power, assist: m.cfg.assist.shot * 0.6 });
      } else if (inp.released.b3) {
        const ch = pickPassTarget(m, p, inp.mx, inp.my, 'cross', 0.8);
        doPassSetPiece(m, p, { kind: 'cross', tx: ch.tx, ty: ch.ty, receiver: ch.target, power: clamp(inp.heldAtRelease.b3 / POWER_TIME, 0.3, 1), assist: 0.6, curve: sp.curve });
        if (ch.target) switchToReceiver(m, h, idx, ch.target);
      } else if (inp.released.b1 || inp.released.b2 || (inp.released.b4 && sp.type === 'indirectFreeKick')) {
        const ch = pickPassTarget(m, p, inp.mx, inp.my, inp.released.b2 ? 'through' : 'ground', 0.8);
        doPassSetPiece(m, p, { kind: inp.released.b2 ? 'through' : 'ground', tx: ch.tx, ty: ch.ty, receiver: ch.target, power: 0.4, assist: 0.7 });
        if (ch.target) switchToReceiver(m, h, idx, ch.target);
      }
      break;
    }
    case 'penalty': {
      if (inp.released.b4 || inp.released.b3 || inp.released.b1) {
        const chip = inp.released.b3;
        const power = clamp((inp.heldAtRelease.b4 || 0.5 * POWER_TIME) / POWER_TIME, 0.25, 1);
        doShotSetPiece(m, p, { kind: chip ? 'chip' : 'penalty', aimY: sp.aimY, aimH: inp.released.b1 ? 0.12 : sp.aimH, power: inp.released.b1 ? 0.8 : power, assist: m.cfg.assist.shot * 0.4 });
      }
      break;
    }
  }
  void chargeP;
}

export { PITCH_L };
