import { RNG } from '../core/rng';
import { clamp } from '../core/math';
import type { Club, Player, Tactics } from '../data/types';
import { formationById } from '../data/formations';
import { ratingAt, POS_GROUP } from '../data/rating';
import { pickLineup } from '../match/setup';

export interface SimTeam {
  club: Club;
  /** starters in formation slot order + bench (injured/suspended already filtered) */
  starters: Player[];
  bench: Player[];
  tactics: Tactics;
  formationId: string;
  /** 0..1 extra morale factor */
  morale?: number;
}

export interface SimEvent { minute: number; type: 'goal' | 'yellow' | 'red' | 'injury' | 'sub'; side: 0 | 1; player: string; assist?: string; text: string }

export interface SimPlayerLine { id: string; side: 0 | 1; rating: number; goals: number; assists: number; yellow: number; red: number; injured: boolean; minutes: number; shots: number }

export interface SimResult {
  score: [number, number];
  events: SimEvent[];
  stats: { possession: [number, number]; shots: [number, number]; onTarget: [number, number]; xg: [number, number]; corners: [number, number]; fouls: [number, number]; yellow: [number, number]; red: [number, number] };
  players: SimPlayerLine[];
  /** penalty shootout score if the tie was settled that way */
  shootout?: [number, number];
  winner: 0 | 1 | null;
}

export interface Strength { att: number; mid: number; def: number; gk: number; aggression: number }

export function strengthOf(t: SimTeam): Strength {
  const f = formationById(t.formationId);
  let att = 0, na = 0, mid = 0, nm = 0, def = 0, nd = 0, gk = 50, aggr = 0;
  t.starters.forEach((p, i) => {
    const slot = f.slots[i]!;
    const r = ratingAt(p, slot.pos) * (0.85 + 0.15 * (p.fitness / 100)) * (1 + p.form * 0.02);
    const g = POS_GROUP[slot.pos];
    if (g === 'GK') gk = r; else if (g === 'DEF') { def += r; nd++; } else if (g === 'MID') { mid += r; nm++; } else { att += r; na++; }
    aggr += p.attrs.aggression;
  });
  const tac = t.tactics;
  const attack = (na ? att / na : 60) * 0.65 + (nm ? mid / nm : 60) * 0.35 + (tac.directness - 50) * 0.02;
  return { att: attack, mid: nm ? mid / nm : 60, def: (nd ? def / nd : 60) * 0.85 + gk * 0.15, gk, aggression: aggr / Math.max(1, t.starters.length) };
}

/** Fast statistical match: Poisson goals from relative strengths, then events are attributed to players. */
export function simulateMatch(home: SimTeam, away: SimTeam, rng: RNG, opts: { neutral?: boolean; knockout?: boolean } = {}): SimResult {
  const H = strengthOf(home), A = strengthOf(away);
  const adv = opts.neutral ? 0 : 0.2;
  const lamH = 1.3 * Math.exp((H.att - A.def) * 0.045 + (H.mid - A.mid) * 0.02 + adv * 0.5 + ((home.morale ?? 0.5) - 0.5) * 0.15) * (1 + (home.tactics.tempo - 50) * 0.002);
  const lamA = 1.15 * Math.exp((A.att - H.def) * 0.045 + (A.mid - H.mid) * 0.02 + ((away.morale ?? 0.5) - 0.5) * 0.15) * (1 + (away.tactics.tempo - 50) * 0.002);
  const luck = (): number => Math.exp(rng.gauss(0, 0.22));
  const gH = Math.min(9, rng.poisson(lamH * luck())), gA = Math.min(9, rng.poisson(lamA * luck()));
  const teams = [home, away] as const;
  const events: SimEvent[] = [];
  const lines = new Map<string, SimPlayerLine>();
  teams.forEach((t, side) => t.starters.forEach((p) => lines.set(p.id, { id: p.id, side: side as 0 | 1, rating: 6, goals: 0, assists: 0, yellow: 0, red: 0, injured: false, minutes: 90, shots: 0 })));
  const line = (p: Player): SimPlayerLine => lines.get(p.id)!;

  const pickScorer = (t: SimTeam): Player => rng.weighted(t.starters, (p) => {
    const g = POS_GROUP[p.positions[0]!];
    return Math.pow(p.attrs.finishing / 50, 3) * (g === 'ATT' ? 5 : g === 'MID' ? 1.6 : g === 'DEF' ? 0.35 : 0.01);
  });
  const pickAssist = (t: SimTeam, not: Player): Player | null => {
    if (rng.chance(0.25)) return null;
    return rng.weighted(t.starters.filter((p) => p !== not), (p) => Math.pow((p.attrs.vision + p.attrs.shortPass + p.attrs.crossing) / 150, 2) * (POS_GROUP[p.positions[0]!] === 'GK' ? 0.02 : POS_GROUP[p.positions[0]!] === 'DEF' ? 0.6 : 1.5));
  };
  const goalsBy: [number, number] = [gH, gA];
  for (const side of [0, 1] as const) {
    const t = teams[side];
    for (let i = 0; i < goalsBy[side]; i++) {
      const minute = rng.int(1, 94);
      if (rng.chance(0.03)) { const og = rng.pick(teams[1 - side as 0 | 1].starters.filter((p) => POS_GROUP[p.positions[0]!] !== 'GK')); events.push({ minute, type: 'goal', side, player: og.id, text: `Own goal (${og.shortName})` }); line(og).rating -= 0.8; continue; }
      const sc = pickScorer(t); const as = pickAssist(t, sc);
      line(sc).goals++; line(sc).rating += 0.9; if (as) { line(as).assists++; line(as).rating += 0.5; }
      events.push({ minute, type: 'goal', side, player: sc.id, assist: as?.id, text: `${sc.shortName}${as ? ` (assist ${as.shortName})` : ''}` });
    }
  }
  // cards & injuries
  const strictness = 0.5;
  for (const side of [0, 1] as const) {
    const t = teams[side]; const S = side === 0 ? H : A;
    const yc = rng.poisson(1.5 * (S.aggression / 60) * (0.6 + strictness));
    for (let i = 0; i < yc; i++) { const p = rng.weighted(t.starters, (q) => q.attrs.aggression * (POS_GROUP[q.positions[0]!] === 'GK' ? 0.2 : 1)); line(p).yellow++; line(p).rating -= 0.2; events.push({ minute: rng.int(5, 90), type: 'yellow', side, player: p.id, text: p.shortName }); }
    if (rng.chance(0.035 * (S.aggression / 60))) { const p = rng.pick(t.starters); line(p).red++; line(p).minutes = rng.int(20, 80); line(p).rating -= 1.6; events.push({ minute: line(p).minutes, type: 'red', side, player: p.id, text: p.shortName }); }
    for (const p of t.starters) if (rng.chance(0.012 + (100 - p.fitness) * 0.0004)) { line(p).injured = true; line(p).minutes = rng.int(10, 85); events.push({ minute: line(p).minutes, type: 'injury', side, player: p.id, text: p.shortName }); }
  }
  events.sort((a, b) => a.minute - b.minute);

  // stats
  const poss = clamp(50 + (H.mid - A.mid) * 1.1 + (home.tactics.style === 'possession' ? 5 : 0) - (away.tactics.style === 'possession' ? 5 : 0) + rng.gauss(0, 3), 28, 72);
  const shots: [number, number] = [Math.max(gH, Math.round(lamH * 8.5 + rng.gauss(0, 2.2))), Math.max(gA, Math.round(lamA * 8.5 + rng.gauss(0, 2.2)))];
  const onT: [number, number] = [Math.min(shots[0], Math.max(gH, Math.round(shots[0] * 0.38 + rng.gauss(0, 1)))), Math.min(shots[1], Math.max(gA, Math.round(shots[1] * 0.38 + rng.gauss(0, 1))))];
  const stats = {
    possession: [Math.round(poss), 100 - Math.round(poss)] as [number, number], shots, onTarget: onT,
    xg: [Math.round(lamH * 100) / 100, Math.round(lamA * 100) / 100] as [number, number],
    corners: [Math.max(0, Math.round(shots[0] * 0.4 + rng.gauss(0, 1.5))), Math.max(0, Math.round(shots[1] * 0.4 + rng.gauss(0, 1.5)))] as [number, number],
    fouls: [Math.round(9 + rng.gauss(0, 3)), Math.round(9 + rng.gauss(0, 3))] as [number, number],
    yellow: [events.filter((e) => e.type === 'yellow' && e.side === 0).length, events.filter((e) => e.type === 'yellow' && e.side === 1).length] as [number, number],
    red: [events.filter((e) => e.type === 'red' && e.side === 0).length, events.filter((e) => e.type === 'red' && e.side === 1).length] as [number, number],
  };
  // ratings
  for (const side of [0, 1] as const) {
    const my = goalsBy[side], their = goalsBy[1 - side as 0 | 1];
    for (const p of teams[side].starters) {
      const l = line(p);
      let r = l.rating + (my > their ? 0.4 : my < their ? -0.3 : 0.05) + rng.gauss(0, 0.4) + (p.overall - 70) * 0.01;
      const g = POS_GROUP[p.positions[0]!];
      if (g === 'GK') r += their === 0 ? 0.8 : -their * 0.3; else if (g === 'DEF') r += their === 0 ? 0.4 : -their * 0.1;
      l.rating = Math.round(clamp(r, 3.5, 10) * 10) / 10;
    }
  }
  let shootout: [number, number] | undefined;
  let winner: 0 | 1 | null = gH === gA ? null : gH > gA ? 0 : 1;
  if (winner === null && opts.knockout) {
    // extra time goals
    const etH = rng.poisson(lamH * 0.3), etA = rng.poisson(lamA * 0.3);
    goalsBy[0] += etH; goalsBy[1] += etA;
    for (const side of [0, 1] as const) for (let i = 0; i < (side === 0 ? etH : etA); i++) { const sc = pickScorer(teams[side]); line(sc).goals++; events.push({ minute: rng.int(91, 119), type: 'goal', side, player: sc.id, text: `${sc.shortName} (ET)` }); }
    if (goalsBy[0] === goalsBy[1]) {
      const pa = (t: SimTeam): number => clamp(0.76 + (t.starters.reduce((s, p) => s + p.attrs.penalties, 0) / t.starters.length - 65) * 0.002, 0.65, 0.88);
      let a = 0, b = 0;
      for (let k = 0; k < 5; k++) { if (rng.chance(pa(home))) a++; if (rng.chance(pa(away))) b++; }
      while (a === b) { if (rng.chance(pa(home))) a++; if (rng.chance(pa(away))) b++; if (a !== b) break; a = b = 0; }
      shootout = [a, b]; winner = a > b ? 0 : 1;
    } else winner = goalsBy[0] > goalsBy[1] ? 0 : 1;
  }
  return { score: [goalsBy[0], goalsBy[1]], events: events.sort((a, b) => a.minute - b.minute), stats, players: [...lines.values()], shootout, winner };
}

/** Convenience: best-XI SimTeam for a club straight from the player table. */
export function simTeamFor(club: Club, players: Record<string, Player>, lineup?: string[]): SimTeam {
  const squad = club.squad.map((id) => players[id]!).filter(Boolean);
  const f = formationById(club.formation);
  if (lineup && lineup.length === 11 && lineup.every((id) => players[id] && players[id]!.injuredUntil === 0 && players[id]!.suspended === 0)) {
    return { club, starters: lineup.map((id) => players[id]!), bench: squad.filter((p) => !lineup.includes(p.id)).slice(0, 9), tactics: club.tactics, formationId: club.formation };
  }
  const { starters, bench } = pickLineup(squad, f);
  return { club, starters, bench, tactics: club.tactics, formationId: club.formation };
}
