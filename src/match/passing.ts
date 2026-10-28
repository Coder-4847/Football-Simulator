import { angleDiff, clamp01 } from '../core/math';
import { BOX_L, HALF_L, other } from './constants';
import type { MPlayer } from './entities';
import type { Match } from './match';
import type { PassKind } from './types';
import { distSegPoint, secondLastDepth, zoneValue } from './ai';
import { clamp } from '../core/math';
import { HALF_W } from './constants';

export interface PassChoice { target: MPlayer | null; tx: number; ty: number }

export function pickPassTarget(m: Match, p: MPlayer, sx: number, sy: number, kind: PassKind, assist: number): PassChoice {
  const team = m.teams[p.side];
  const dir = team.dir;
  const has = Math.hypot(sx, sy) > 0.25;
  const ang = has ? Math.atan2(sy, sx) : (p.speed > 1 ? Math.atan2(p.vy, p.vx) : p.face);
  const cone = 0.8 + assist * 1.1; // radians half-angle
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

