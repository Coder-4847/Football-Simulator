import type { AttrKey, Attrs, Player, Pos } from './types';
import { clamp } from '../core/math';

type W = Partial<Record<AttrKey, number>>;

/** Overall-rating weights per position. */
export const POS_WEIGHTS: Record<Pos, W> = {
  GK: { gkDiving: 3, gkHandling: 3, gkPositioning: 3, gkReflexes: 3, gkKicking: 1, reactions: 1 },
  CB: { interceptions: 2, marking: 3, standingTackle: 3, slidingTackle: 1.5, heading: 2.5, strength: 2, jumping: 1, aggression: 1, shortPass: 1, sprintSpeed: 1 },
  LB: { sprintSpeed: 2, acceleration: 1.5, stamina: 2, crossing: 1.5, standingTackle: 2, marking: 1.5, interceptions: 1.5, dribbling: 1, shortPass: 1 },
  RB: { sprintSpeed: 2, acceleration: 1.5, stamina: 2, crossing: 1.5, standingTackle: 2, marking: 1.5, interceptions: 1.5, dribbling: 1, shortPass: 1 },
  LWB: { sprintSpeed: 2, acceleration: 1.5, stamina: 2.5, crossing: 2, standingTackle: 1.5, interceptions: 1, dribbling: 1.5, shortPass: 1 },
  RWB: { sprintSpeed: 2, acceleration: 1.5, stamina: 2.5, crossing: 2, standingTackle: 1.5, interceptions: 1, dribbling: 1.5, shortPass: 1 },
  CDM: { interceptions: 3, standingTackle: 3, marking: 2, shortPass: 2.5, strength: 1.5, stamina: 2, longPass: 1, vision: 1, aggression: 1 },
  CM: { shortPass: 3, vision: 2.5, longPass: 2, ballControl: 2, stamina: 2, dribbling: 1.5, interceptions: 1, longShots: 1, standingTackle: 1 },
  CAM: { vision: 3, shortPass: 2.5, dribbling: 2.5, ballControl: 2.5, longShots: 1.5, finishing: 1.5, agility: 1.5, curve: 1 },
  LM: { sprintSpeed: 2.5, acceleration: 2.5, dribbling: 3, crossing: 2, ballControl: 2, agility: 2, shortPass: 1.5, finishing: 1 },
  RM: { sprintSpeed: 2.5, acceleration: 2.5, dribbling: 3, crossing: 2, ballControl: 2, agility: 2, shortPass: 1.5, finishing: 1 },
  LW: { sprintSpeed: 2.5, acceleration: 2.5, dribbling: 3, crossing: 1.5, ballControl: 2, agility: 2, finishing: 1.5, shortPass: 1 },
  RW: { sprintSpeed: 2.5, acceleration: 2.5, dribbling: 3, crossing: 1.5, ballControl: 2, agility: 2, finishing: 1.5, shortPass: 1 },
  CF: { finishing: 2.5, shotPower: 1.5, ballControl: 2, vision: 1.5, shortPass: 1.5, dribbling: 2, acceleration: 1.5, reactions: 1 },
  ST: { finishing: 4, shotPower: 2, heading: 1.5, acceleration: 2, sprintSpeed: 2, ballControl: 1.5, strength: 1.5, volleys: 1, reactions: 1.5 },
};

export function overallFor(attrs: Attrs, pos: Pos): number {
  const w = POS_WEIGHTS[pos];
  let sum = 0, tot = 0;
  for (const k in w) {
    const wt = w[k as AttrKey] ?? 0;
    sum += attrs[k as AttrKey] * wt;
    tot += wt;
  }
  return Math.round(sum / tot);
}

/** Rating of a player when deployed at `slotPos` (penalty for being out of position). */
export function ratingAt(p: Player, slotPos: Pos): number {
  if (p.positions.includes(slotPos)) return overallFor(p.attrs, slotPos) - (p.positions[0] === slotPos ? 0 : 1);
  const base = overallFor(p.attrs, slotPos);
  const related = RELATED[slotPos] ?? [];
  const close = p.positions.some((q) => related.includes(q));
  return clamp(base - (close ? 5 : 18), 1, 99);
}

export const RELATED: Record<Pos, Pos[]> = {
  GK: [], CB: ['CDM'], LB: ['LWB', 'RB', 'LM'], RB: ['RWB', 'LB', 'RM'], LWB: ['LB', 'LM'], RWB: ['RB', 'RM'],
  CDM: ['CM', 'CB'], CM: ['CDM', 'CAM'], CAM: ['CM', 'CF', 'LM', 'RM'], LM: ['LW', 'LWB', 'CM'], RM: ['RW', 'RWB', 'CM'],
  LW: ['LM', 'ST', 'CF'], RW: ['RM', 'ST', 'CF'], CF: ['ST', 'CAM'], ST: ['CF', 'LW', 'RW'],
};

export const POS_GROUP: Record<Pos, 'GK' | 'DEF' | 'MID' | 'ATT'> = {
  GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF',
  CDM: 'MID', CM: 'MID', CAM: 'MID', LM: 'MID', RM: 'MID', LW: 'ATT', RW: 'ATT', CF: 'ATT', ST: 'ATT',
};

export function playerValue(overall: number, age: number, potential: number): number {
  const base = Math.pow(Math.max(overall - 40, 1) / 50, 4.2) * 60_000_000;
  const ageF = age <= 21 ? 1.25 : age <= 25 ? 1.1 : age <= 29 ? 1 : age <= 32 ? 0.6 : 0.3;
  const potF = 1 + Math.max(0, potential - overall) / 60;
  return Math.max(10_000, Math.round((base * ageF * potF) / 10_000) * 10_000);
}

export function wageFor(value: number, overall: number): number {
  return Math.max(500, Math.round((value * 0.004 + overall * 120) / 100) * 100);
}
