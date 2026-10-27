import { RNG } from '../core/rng';
import type { World } from '../data/types';
import { CUP_WEEKS, LEAGUE_ROUNDS, type CareerState, type Fixture, type TableRow } from './state';

/** Circle-method double round robin; returns rounds of [home, away] pairs. */
export function roundRobin(ids: string[], rng: RNG): Array<Array<[string, string]>> {
  const teams = rng.shuffle([...ids]);
  if (teams.length % 2) teams.push('BYE');
  const n = teams.length;
  const rounds: Array<Array<[string, string]>> = [];
  for (let r = 0; r < n - 1; r++) {
    const round: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i]!, b = teams[n - 1 - i]!;
      if (a === 'BYE' || b === 'BYE') continue;
      round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    teams.splice(1, 0, teams.pop()!);
  }
  const second = rounds.map((rd) => rd.map(([a, b]) => [b, a] as [string, string]));
  return [...rounds, ...second];
}

export const leagueWeek = (round: number): number => 3 + Math.round(((round - 1) * 43) / (LEAGUE_ROUNDS - 1));

export function generateSeasonFixtures(world: World, season: number, seed: string): Fixture[] {
  const out: Fixture[] = [];
  const rng = new RNG(`fixtures:${seed}:${season}`);
  for (const lg of Object.values(world.leagues)) {
    const rounds = roundRobin(lg.clubs, rng);
    rounds.forEach((rd, ri) => rd.forEach(([h, a], k) => out.push({ id: `${season}-${lg.id}-${ri + 1}-${k}`, comp: lg.id, round: ri + 1, week: leagueWeek(ri + 1), home: h, away: a, played: false })));
  }
  return out;
}

/** Draws the next cup round for a nation among the surviving clubs. */
export function drawCupRound(state: CareerState, nation: string, roundIdx: number): Fixture[] {
  const alive = state.cupAlive[nation] ?? [];
  const rng = new RNG(`cup:${state.seed}:${state.season}:${nation}:${roundIdx}`);
  const ids = rng.shuffle([...alive]);
  const out: Fixture[] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) out.push({ id: `${state.season}-cup:${nation}-${roundIdx + 1}-${i / 2}`, comp: `cup:${nation}`, round: roundIdx + 1, week: CUP_WEEKS[roundIdx] ?? 50, home: ids[i]!, away: ids[i + 1]!, played: false });
  return out;
}

export function table(fixtures: Fixture[], leagueId: string, clubs: string[]): TableRow[] {
  const rows = new Map<string, TableRow>(clubs.map((c) => [c, { club: c, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const f of fixtures) {
    if (f.comp !== leagueId || !f.played) continue;
    const h = rows.get(f.home), a = rows.get(f.away);
    if (!h || !a) continue;
    h.p++; a.p++; h.gf += f.hg!; h.ga += f.ag!; a.gf += f.ag!; a.ga += f.hg!;
    if (f.hg! > f.ag!) { h.w++; a.l++; h.pts += 3; } else if (f.hg! < f.ag!) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  return [...rows.values()].sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.club.localeCompare(y.club));
}
