import type { MPlayer } from './entities';
import type { Match } from './match';

/** 3.0–10.0 performance rating derived from event stats. */
export function playerRating(p: MPlayer, won: boolean, drew: boolean, goalsAgainst: number): number {
  const s = p.stats;
  let r = 6.0 + (won ? 0.35 : drew ? 0.1 : -0.25);
  r += s.goals * 0.95 + s.assists * 0.6 + s.shotsOnTarget * 0.12 + s.keyPasses * 0.25;
  r += s.tacklesWon * 0.14 + s.interceptions * 0.1 + s.clearances * 0.04 + s.headers * 0.02;
  r += s.passes > 8 ? ((s.passesCompleted / s.passes) - 0.7) * 1.5 : 0;
  r -= (s.tackles - s.tacklesWon) * 0.05 + s.fouls * 0.15 + s.yellow * 0.4 + s.red * 2 + s.offsides * 0.1;
  if (p.isGK()) { r += s.saves * 0.3; r -= goalsAgainst * 0.35; if (goalsAgainst === 0) r += 0.7; }
  else if (p.slotPos === 'CB' || p.slotPos === 'LB' || p.slotPos === 'RB') { if (goalsAgainst === 0) r += 0.4; else r -= goalsAgainst * 0.1; }
  if (s.minutes < 1) r = 6.0;
  return Math.max(3, Math.min(10, Math.round(r * 10) / 10));
}

export interface TeamSummary {
  name: string; short: string; goals: number; possession: number; shots: number; onTarget: number; xg: number; passes: number; passAcc: number;
  tackles: number; fouls: number; offsides: number; corners: number; yellow: number; red: number; saves: number;
}

export function summarize(m: Match): [TeamSummary, TeamSummary] {
  const tot = m.stats.possessionTime[0] + m.stats.possessionTime[1] || 1;
  return [0, 1].map((i) => {
    const t = m.teams[i as 0 | 1];
    return {
      name: t.name, short: t.short, goals: t.score, possession: Math.round((m.stats.possessionTime[i as 0 | 1] / tot) * 100), shots: t.stats.shots, onTarget: t.stats.onTarget,
      xg: Math.round(t.stats.xg * 100) / 100, passes: t.stats.passes, passAcc: t.stats.passes ? Math.round((t.stats.passesCompleted / t.stats.passes) * 100) : 0,
      tackles: t.stats.tackles, fouls: t.stats.fouls, offsides: t.stats.offsides, corners: t.stats.corners, yellow: t.stats.yellow, red: t.stats.red, saves: t.stats.saves,
    };
  }) as [TeamSummary, TeamSummary];
}

export interface PlayerResult { id: string; name: string; side: 0 | 1; rating: number; goals: number; assists: number; minutes: number; yellow: number; red: number; injured: boolean; stamina: number }

export function playerResults(m: Match): PlayerResult[] {
  const out: PlayerResult[] = [];
  for (const side of [0, 1] as const) {
    const t = m.teams[side];
    const mine = t.score, theirs = m.teams[side === 0 ? 1 : 0].score;
    const all = [...t.players, ...m.removedPlayers.filter((p) => p.side === side)];
    for (const p of all) {
      if (p.stats.minutes < 0.5 && p.sentOff === false && p.subbedOff) continue;
      out.push({ id: p.data.id, name: p.data.name, side, rating: playerRating(p, mine > theirs, mine === theirs, theirs), goals: p.stats.goals, assists: p.stats.assists, minutes: Math.round(p.stats.minutes), yellow: p.stats.yellow, red: p.stats.red, injured: p.injured, stamina: p.stamina });
    }
  }
  return out;
}
