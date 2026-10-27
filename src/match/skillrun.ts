import { clamp } from '../core/math';
import { other } from './constants';
import type { MPlayer } from './entities';
import type { Match } from './match';
import { skillSuccess, type SkillMove } from './skills';
import { skillById } from './skills';

const ease = (u: number): number => 1 - (1 - u) * (1 - u);

/** Begin a skill move for the ball carrier. `lateralSign` (+1/-1) chooses the side for lateral moves. */
export function startSkill(m: Match, p: MPlayer, move: SkillMove, lateralSign: number): boolean {
  if (m.owner !== p || (p.state !== 'normal' && p.state !== 'kick') || m.phase !== 'play') return false;
  if (move.stars > p.data.skillMoves) return false;
  // nearest defender ahead
  const baseFace = p.speed > 1 ? Math.atan2(p.vy, p.vx) : p.face;
  let def: MPlayer | null = null; let bd = 4.2;
  for (const o of m.teams[other(p.side)].players) {
    if (!o.active()) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    const a = Math.abs(Math.atan2(Math.sin(Math.atan2(o.y - p.y, o.x - p.x) - baseFace), Math.cos(Math.atan2(o.y - p.y, o.x - p.x) - baseFace)));
    if (d < bd && a < 1.3) { bd = d; def = o; }
  }
  const a = p.data.attrs;
  const pressure = def ? clamp(1 - (bd - 0.6) / 3.5, 0, 1) : 0;
  const prob = skillSuccess(move, { dribbling: a.dribbling, agility: a.agility, ballControl: a.ballControl, skillMoves: p.data.skillMoves, balance: a.balance }, def ? { reactions: def.data.attrs.reactions, agility: def.data.attrs.agility, standingTackle: def.data.attrs.standingTackle } : null, pressure);
  const ok = m.rng.chance(prob);
  p.skill = { id: move.id, t: 0, dur: move.dur, dx: lateralSign, dy: p.speed, ok };
  p.sz = baseFace;
  p.setState('skill', move.dur, move.id);
  p.stats.dribbles++;
  m.bus.emit('skill', { player: p, id: move.id, success: ok });
  return true;
}

/** Where the carried ball should be during a skill move (null when none is active). */
export function skillBallTarget(p: MPlayer): { x: number; y: number } | null {
  const s = p.skill;
  if (!s) return null;
  const mv = skillById(s.id);
  if (!mv) return null;
  const u = clamp(s.t / s.dur, 0, 1);
  const base = p.sz;
  const fwd = 0.45 + mv.fwd * ease(u) * 0.55;
  const lat = mv.lat * s.dx * Math.sin(u * Math.PI) * 0.8;
  const c = Math.cos(base), sn = Math.sin(base);
  // sideways = rotate +90°
  return { x: p.x + c * fwd - sn * lat, y: p.y + sn * fwd + c * lat };
}

export function applyActiveSkills(m: Match, dt: number): void {
  for (const p of m.all) {
    const s = p.skill;
    if (!s) continue;
    const mv = skillById(s.id);
    if (!mv || m.owner !== p || p.state !== 'skill') { p.skill = null; if (p.state === 'skill') p.setState('normal'); continue; }
    s.t += dt;
    const u = clamp(s.t / s.dur, 0, 1);
    const base = p.sz;
    const v0 = clamp(s.dy, 1.5, 7);
    // body keeps moving gently along the original heading with a lateral drift for lateral moves
    const sp = v0 * 0.55;
    p.vx = Math.cos(base) * sp - Math.sin(base) * mv.lat * s.dx * 0.9 * Math.cos(u * Math.PI);
    p.vy = Math.sin(base) * sp + Math.cos(base) * mv.lat * s.dx * 0.9 * Math.cos(u * Math.PI);
    p.face = base + mv.turn * s.dx * ease(u);
    if (s.t >= s.dur) {
      p.skill = null;
      const newFace = base + mv.turn * s.dx;
      if (s.ok) {
        const full = m.maxSpeed(p);
        const spd = clamp(Math.max(3.5, v0) * mv.burst, 0, full);
        p.face = newFace;
        p.vx = Math.cos(newFace) * spd; p.vy = Math.sin(newFace) * spd;
        p.setState('normal');
        p.stats.dribblesWon++;
        // wrong-foot the nearest defender
        let def: MPlayer | null = null; let bd = 3.8;
        for (const o of m.teams[other(p.side)].players) {
          if (!o.active() || o.isGK()) continue;
          const d = Math.hypot(o.x - p.x, o.y - p.y);
          if (d < bd) { bd = d; def = o; }
        }
        if (def && mv.fool > 0.1) { def.setState('stumble', mv.fool * 0.9); def.vx *= 0.3; def.vy *= 0.3; }
      } else {
        // botched: the ball squirts loose
        p.setState('stumble', 0.45);
        const ang = base + m.rng.gauss(0, 1.1);
        m.owner = null;
        m.ball.vx = Math.cos(ang) * 4.5; m.ball.vy = Math.sin(ang) * 4.5;
        p.noTouchUntil = m.time + 0.35;
      }
    }
  }
}
