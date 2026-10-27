import { RNG } from '../core/rng';
import { clamp } from '../core/math';
import { generatePlayer, assignShirtNumbers } from '../data/generate';
import { POS_WEIGHTS, overallFor, playerValue, wageFor } from '../data/rating';
import { ATTR_KEYS, type AttrKey, type Club, type Nation, type Player, type Pos } from '../data/types';

const PHYS: AttrKey[] = ['acceleration', 'sprintSpeed', 'stamina', 'agility', 'jumping'];

/** Applies one season of ageing/progression to a player (does not change age). */
export function progressPlayer(p: Player, rng: RNG, facilities = 50, focusBoost = 0): void {
  const pos = p.positions[0]!;
  const gap = Math.max(0, p.potential - p.overall);
  let d: number;
  if (p.age <= 20) d = rng.float(1.5, 5.5) * (0.5 + gap / 18);
  else if (p.age <= 23) d = rng.float(0.4, 3.4) * (0.4 + gap / 14);
  else if (p.age <= 28) d = rng.gauss(0.2, 1.1);
  else if (p.age <= 31) d = rng.gauss(-0.7, 1.2);
  else if (p.age <= 34) d = rng.gauss(-2, 1.4);
  else d = rng.gauss(-3.4, 1.5);
  d += (facilities - 50) * 0.01 + focusBoost;
  if (d > 0) d = Math.min(d, gap + 1.5);
  const keys = Object.keys(POS_WEIGHTS[pos]) as AttrKey[];
  for (const k of ATTR_KEYS) {
    const isKey = keys.includes(k);
    let delta = isKey ? d + rng.gauss(0, 0.7) : d * 0.35 + rng.gauss(0, 0.6);
    if (PHYS.includes(k) && p.age > 28) delta -= (p.age - 28) * 0.35;
    if (k.startsWith('gk') && pos !== 'GK') delta = 0;
    p.attrs[k] = clamp(Math.round(p.attrs[k] + delta), 5, 97);
  }
  p.overall = overallFor(p.attrs, pos);
  if (p.age >= 24) p.potential = Math.max(p.overall, p.potential - (p.age > 27 ? 1 : 0));
  else p.potential = Math.max(p.overall, p.potential + Math.round(rng.gauss(0, 1.2)));
  p.value = playerValue(p.overall, p.age, p.potential);
  p.wage = wageFor(p.value, p.overall);
  p.skillMoves = clamp(p.skillMoves + (rng.chance(0.04) ? 1 : 0) - (p.age > 31 && rng.chance(0.1) ? 1 : 0), 1, 5);
  p.weakFoot = clamp(p.weakFoot + (p.age < 27 && rng.chance(0.06) ? 1 : 0), 1, 5);
}

export function generateYouthPlayer(rng: RNG, club: Club, nation: Nation, id: string, season: number): Player {
  const pos = rng.pick<Pos>(['GK', 'CB', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'ST', 'CF']);
  const base = clamp(Math.round(30 + club.youthRating * 0.22 + rng.gauss(0, 5)), 28, 62);
  const p = generatePlayer(rng, nation, pos, base, { id, age: rng.int(15, 18), clubId: club.id, season });
  p.potential = clamp(Math.round(base + 10 + club.youthRating * 0.28 + rng.gauss(0, 7)), base + 2, 92);
  p.value = playerValue(p.overall, p.age, p.potential); p.wage = Math.round(wageFor(p.value, p.overall) * 0.4);
  return p;
}

export function assignNumbers(players: Player[]): void { assignShirtNumbers(players); }
