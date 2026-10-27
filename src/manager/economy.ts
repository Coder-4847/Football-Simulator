import type { Club, League, Player } from '../data/types';

export const TV_BY_TIER = [0, 340_000, 90_000, 40_000];

export function weeklyWages(club: Club, players: Record<string, Player>): number {
  let s = 0; for (const id of club.squad) s += players[id]?.wage ?? 0; return s;
}

/** Revenue for one week; matchday revenue only when `homeGames` > 0. */
export function weeklyIncome(club: Club, league: League, position: number, homeGames: number, stadiumLevel = 0): { gate: number; sponsors: number; tv: number; merch: number } {
  const rep = club.reputation;
  const cap = club.stadium.capacity * (1 + stadiumLevel * 0.08);
  const fill = Math.min(0.98, 0.45 + rep / 160 + Math.max(0, 8 - position) * 0.01);
  const price = 18 + rep * 0.7 + (league.tier === 1 ? 14 : 0);
  return {
    gate: Math.round(cap * fill * price * homeGames),
    sponsors: Math.round(rep * rep * 52 + 18_000),
    tv: Math.round((TV_BY_TIER[league.tier] ?? 30_000) * (1.3 - position / league.clubs.length * 0.6)),
    merch: Math.round(rep * rep * 14),
  };
}

export const facilityUpgradeCost = (level: number, club: Club): number => Math.round((2_000_000 + level * 3_500_000) * (0.5 + club.reputation / 100));
