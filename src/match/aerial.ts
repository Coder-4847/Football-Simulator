import { clamp, clamp01 } from '../core/math';
import { BOX_L, HALF_L, other } from './constants';
import type { MPlayer } from './entities';
import type { Match } from './match';
import { executePass, executeShot } from './actions';
import { pickPassTarget } from './human';

/** Header contests for balls between ~1.0 and 2.7 m. */
export function resolveAerial(m: Match): void {
  const b = m.ball;
  if (m.owner || b.z < 1.0 || b.z > 2.8 || b.speed() > 27 || b.inNet) return;
  if (m.sp && m.sp.phase !== 'done') return;
  if (m.phase !== 'play' && m.phase !== 'shootout') return;
  let best: MPlayer | null = null; let bs = -1e9;
  for (const p of m.all) {
    if (p.noTouchUntil > m.time || p.state === 'down' || p.state === 'dive' || p.state === 'slide') continue;
    if (p.isGK()) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    const reach = 0.78 + (p.state === 'jump' ? 0.2 : 0) + (p.data.heightCm - 175) / 250;
    if (d > reach) continue;
    const a = p.data.attrs;
    const heightReach = p.data.heightCm / 100 + 0.25 + a.jumping / 100 * 0.5;
    if (b.z > heightReach) continue;
    const s = a.heading * 0.4 + a.jumping * 0.35 + a.strength * 0.1 + p.data.heightCm * 0.25 + m.rng.next() * 18 + (p.data.traits.includes('Aerial Threat') ? 6 : 0);
    if (s > bs) { bs = s; best = p; }
  }
  if (!best) return;
  const p = best;
  // intercept: header by `p`
  p.setState('jump', 0.7);
  p.noTouchUntil = m.time + 0.4;
  m.setTouch(p);
  m.lastTouchByFoot = false;
  p.stats.headers++;
  m.bus.emit('header', { player: p });
  const team = m.teams[p.side];
  const dir = team.dir;
  const goalX = dir * HALF_L;
  const wasOpp = !!m.prevTouch && m.prevTouch.side !== p.side;
  if (m.passInfo) {
    if (m.passInfo.passer.side === p.side && !m.passInfo.completed && m.passInfo.passer !== p) {
      m.passInfo.completed = true; m.passInfo.passer.stats.passesCompleted++; m.teams[p.side].stats.passesCompleted++;
    } else if (m.passInfo.passer.side !== p.side) { p.stats.interceptions++; m.teams[p.side].stats.interceptions++; m.passInfo = null; }
  }
  void wasOpp;
  // ---- direction of the header
  const hIdx = p.human;
  const h = hIdx >= 0 ? m.humans[hIdx] : undefined;
  const nearGoal = Math.abs(p.x - goalX) < BOX_L + 6 && Math.abs(p.y) < 24;
  let mode: 'shot' | 'pass' | 'clear' = 'clear';
  if (h) {
    const q = h.queued;
    if (h.input.down.b4 || h.input.pressed.b4 || q?.btn === 'b4') mode = 'shot';
    else if (h.input.down.b1 || h.input.down.b2 || h.input.down.b3 || q) mode = 'pass';
    h.queued = null;
  } else {
    const defendingBox = Math.abs(p.x + goalX) < BOX_L + 4;
    if (nearGoal && m.rng.chance(0.85)) mode = 'shot';
    else if (defendingBox) mode = 'clear';
    else mode = m.rng.chance(0.55) ? 'pass' : 'clear';
  }
  if (mode === 'shot' && nearGoal) {
    executeShot(m, p, { kind: 'header', aimY: m.rng.chance(0.5) ? m.rng.float(0.35, 0.85) : -m.rng.float(0.35, 0.85), aimH: m.rng.float(0.1, 0.5), power: 0.6 + m.rng.float(0, 0.3), assist: 0.2, header: true });
  } else if (mode === 'pass') {
    const sx = h ? h.input.mx : Math.cos(p.face), sy = h ? h.input.my : Math.sin(p.face);
    const ch = pickPassTarget(m, p, sx, sy, 'ground', 0.6);
    if (ch.target && Math.hypot(ch.tx - p.x, ch.ty - p.y) < 22) executePass(m, p, { kind: 'ground', tx: ch.tx, ty: ch.ty, receiver: ch.target, power: 0.35, assist: 0.5, sloppy: 1.6 });
    else executePass(m, p, { kind: 'lowCross', tx: p.x + dir * 9, ty: p.y + (p.y >= 0 ? 1 : -1) * 12, receiver: null, power: 0.5, assist: 0.1, sloppy: 1.6 });
  } else {
    const away = -dir;
    void away;
    const sy = p.y >= 0 ? 1 : -1;
    executePass(m, p, { kind: 'lowCross', tx: p.x + dir * 9, ty: p.y + sy * 12, receiver: null, power: 0.5, assist: 0.1, sloppy: 1.6 });
    p.stats.clearances++; m.teams[p.side].stats.clearances++;
  }
  void clamp; void clamp01; void other;
}
