import { RNG } from '../core/rng';
import { clamp } from '../core/math';
import { POS_GROUP } from '../data/rating';
import type { Club, Player } from '../data/types';
import { isWindowOpen, type CareerState, type NewsItem } from './state';

export const SQUAD_MAX = 32;
export const SQUAD_MIN = 18;

export const club = (s: CareerState, id: string): Club => s.world.clubs[id]!;
export const player = (s: CareerState, id: string): Player => s.world.players[id]!;

export function addNews(s: CareerState, text: string, kind: NewsItem['kind'] = 'info'): void {
  s.news.unshift({ week: s.week, season: s.season, text, kind });
  if (s.news.length > 80) s.news.length = 80;
}

/** Squad importance rank of a player inside his club (0 = best). */
function rankInClub(s: CareerState, p: Player): number {
  const c = club(s, p.clubId!);
  return c.squad.map((id) => player(s, id)).sort((a, b) => b.overall - a.overall).findIndex((q) => q.id === p.id);
}

/** What the selling club wants for a player. */
export function askingPrice(s: CareerState, p: Player): number {
  if (!p.clubId) return 0;
  const rank = rankInClub(s, p);
  const importance = rank < 5 ? 1.35 : rank < 11 ? 1.15 : 1;
  const years = Math.max(0, p.contractEnd - s.season);
  const contractF = years <= 0 ? 0.35 : years === 1 ? 0.75 : 1;
  return Math.round((p.value * importance * contractF) / 10_000) * 10_000;
}

export interface BidResult { status: 'accepted' | 'rejected' | 'counter' | 'refused'; counter?: number; reason: string }

/** The user's club offers `fee` + `wage` for a player. */
export function evaluateBid(s: CareerState, playerId: string, fee: number, wage: number, years: number, buyerId = s.userClubId): BidResult {
  const p = player(s, playerId);
  const buyer = club(s, buyerId);
  if (buyer.squad.length >= SQUAD_MAX) return { status: 'refused', reason: 'Your squad is full.' };
  if (!isWindowOpen(s.week) && p.clubId) return { status: 'refused', reason: 'The transfer window is closed.' };
  if (p.clubId === buyerId) return { status: 'refused', reason: 'Already at your club.' };
  const ask = askingPrice(s, p);
  if (p.clubId) {
    const seller = club(s, p.clubId);
    if (seller.squad.length <= SQUAD_MIN) return { status: 'rejected', reason: `${seller.name} cannot sell: their squad is too small.` };
    if (fee < ask * 0.8) return { status: 'rejected', reason: `${seller.name} rejected the bid as too low.` };
    if (fee < ask) { return { status: 'counter', counter: Math.round((ask * 0.98) / 10_000) * 10_000, reason: `${seller.name} want ${Math.round(ask * 0.98).toLocaleString()}.` }; }
  }
  if (fee > buyer.budget) return { status: 'refused', reason: 'You cannot afford this fee.' };
  const demand = Math.round(p.wage * (1 + clamp((p.clubId ? club(s, p.clubId).reputation : 40) - buyer.reputation, -10, 40) * 0.02));
  if (wage < demand) return { status: 'refused', reason: `${p.shortName} wants at least ${demand.toLocaleString()} per week.` };
  if (p.clubId && club(s, p.clubId).reputation - buyer.reputation > 25 && p.overall > 70) return { status: 'refused', reason: `${p.shortName} does not want to join a lesser club.` };
  return { status: 'accepted', reason: 'Deal agreed.' };
}

export function executeTransfer(s: CareerState, playerId: string, toId: string, fee: number, wage: number, years: number): void {
  const p = player(s, playerId);
  const to = club(s, toId);
  const fromId = p.clubId;
  if (fromId) {
    const from = club(s, fromId);
    from.squad = from.squad.filter((id) => id !== playerId);
    from.budget += fee;
    if (fromId === s.userClubId) { s.lineup.starters = s.lineup.starters.filter((id) => id !== playerId); s.seasonFinance.transfersOut += fee; s.listed = s.listed.filter((id) => id !== playerId); }
  }
  to.squad.push(playerId);
  to.budget -= fee;
  p.clubId = toId; p.wage = wage; p.contractEnd = s.season + years; p.morale = 75;
  const used = new Set(to.squad.filter((id) => id !== playerId).map((id) => player(s, id).number));
  if (used.has(p.number) || !p.number) { let n = 1; while (used.has(n)) n++; p.number = n; }
  if (toId === s.userClubId) s.seasonFinance.transfersIn += fee;
  if (toId === s.userClubId || fromId === s.userClubId) addNews(s, `${p.name} ${toId === s.userClubId ? 'joins' : 'leaves for'} ${toId === s.userClubId ? to.name : to.name} ${fee ? `(¤${(fee / 1e6).toFixed(1)}M)` : '(free)'}`, 'transfer');
  if (toId === s.userClubId && s.lineup.starters.length < 11) autoLineup(s);
}

export function autoLineup(s: CareerState): void {
  // lazy import-free: pick best by overall per formation is handled by pickLineup in match/setup; here keep simple fallback
  s.lineup.starters = [];
}

export function releasePlayer(s: CareerState, playerId: string): number {
  const p = player(s, playerId);
  const c = club(s, p.clubId ?? s.userClubId);
  if (c.squad.length <= SQUAD_MIN) return -1;
  const payoff = Math.round(p.wage * 8 * Math.max(0, p.contractEnd - s.season));
  c.squad = c.squad.filter((id) => id !== playerId);
  c.budget -= payoff;
  p.clubId = null;
  s.lineup.starters = s.lineup.starters.filter((id) => id !== playerId);
  s.listed = s.listed.filter((id) => id !== playerId);
  return payoff;
}

export function renewDemand(s: CareerState, p: Player): { wage: number; years: number } {
  const c = club(s, p.clubId!);
  const happy = 1 + (60 - p.morale) * 0.004;
  return { wage: Math.round(p.wage * (1.08 + (p.potential - p.overall) * 0.01) * happy), years: p.age > 31 ? 1 : 3 };
}

export function renewContract(s: CareerState, playerId: string, wage: number, years: number): BidResult {
  const p = player(s, playerId);
  const d = renewDemand(s, p);
  if (wage < d.wage) return { status: 'refused', reason: `${p.shortName} wants ¤${d.wage.toLocaleString()} per week.` };
  p.wage = wage; p.contractEnd = s.season + years; p.morale = Math.min(100, p.morale + 8);
  return { status: 'accepted', reason: 'Contract extended.' };
}

/** Weekly AI activity during transfer windows. */
export function aiTransfers(s: CareerState, rng: RNG): void {
  const open = isWindowOpen(s.week);
  const clubs = Object.values(s.world.clubs).filter((c) => c.id !== s.userClubId && !c.id.startsWith('nat-'));
  // everyone keeps a viable squad
  for (const c of clubs) {
    if (c.squad.length < 22) {
      const fa = Object.values(s.world.players).filter((p) => p.clubId === null).sort((a, b) => b.overall - a.overall);
      const need = 22 - c.squad.length;
      for (const p of fa.slice(0, need)) executeTransfer(s, p.id, c.id, 0, p.wage, 2);
    }
    if (c.squad.length > 30) {
      const worst = c.squad.map((id) => player(s, id)).sort((a, b) => a.overall - b.overall).slice(0, c.squad.length - 28);
      for (const p of worst) { c.squad = c.squad.filter((id) => id !== p.id); p.clubId = null; }
    }
  }
  if (!open) return;
  const buyers = rng.shuffle([...clubs]).slice(0, 14);
  for (const b of buyers) {
    if (b.budget < 400_000 || b.squad.length >= 29) continue;
    // weakest position group relative to the club's standard
    const squad = b.squad.map((id) => player(s, id));
    const groups = ['GK', 'DEF', 'MID', 'ATT'] as const;
    const need = [...groups].sort((x, y) => avg(squad.filter((p) => POS_GROUP[p.positions[0]!] === x)) - avg(squad.filter((p) => POS_GROUP[p.positions[0]!] === y)))[0]!;
    const limit = Math.min(b.budget * 0.6, 60_000_000);
    const floor = avg(squad) + 2;
    const cand = Object.values(s.world.players).filter((p) => p.clubId && p.clubId !== b.id && p.clubId !== s.userClubId && POS_GROUP[p.positions[0]!] === need && p.overall >= floor && askingPrice(s, p) <= limit && club(s, p.clubId).squad.length > 22 && club(s, p.clubId).reputation <= b.reputation + 10)
      .sort((x, y) => y.overall - x.overall);
    const pick = cand[rng.int(0, Math.min(4, cand.length - 1))];
    if (!pick || !rng.chance(0.5)) continue;
    const fee = Math.round(askingPrice(s, pick) * rng.float(1, 1.1) / 10_000) * 10_000;
    executeTransfer(s, pick.id, b.id, fee, Math.round(pick.wage * rng.float(1.05, 1.3)), rng.int(2, 4));
  }
  // free agents sign with clubs that have spare room
  const fas = Object.values(s.world.players).filter((p) => p.clubId === null && p.overall > 50).sort((a, b) => b.overall - a.overall).slice(0, 12);
  for (const p of fas) {
    const c = rng.pick(clubs);
    if (c.squad.length < 27 && c.reputation + 25 > p.overall && rng.chance(0.35)) executeTransfer(s, p.id, c.id, 0, p.wage, rng.int(1, 3));
  }
}

const avg = (ps: Player[]): number => (ps.length ? ps.reduce((a, p) => a + p.overall, 0) / ps.length : 0);

/** AI offers for the user's listed / valuable players (weekly during windows). */
export function aiBidsForUser(s: CareerState, rng: RNG): void {
  if (!isWindowOpen(s.week)) return;
  const mine = club(s, s.userClubId).squad.map((id) => player(s, id));
  const targets = mine.filter((p) => s.listed.includes(p.id) || (p.overall > avg(mine) + 6 && rng.chance(0.06)));
  const buyers = Object.values(s.world.clubs).filter((c) => c.id !== s.userClubId && !c.id.startsWith('nat-') && c.budget > 1_000_000);
  for (const p of targets) {
    if (!rng.chance(s.listed.includes(p.id) ? 0.4 : 1)) continue;
    const b = rng.pick(buyers.filter((c) => c.reputation >= club(s, s.userClubId).reputation - 12));
    if (!b || s.offers.some((o) => o.playerId === p.id && o.status === 'open')) continue;
    const fee = Math.round(askingPrice(s, p) * rng.float(0.85, 1.2) / 10_000) * 10_000;
    if (fee > b.budget) continue;
    s.offers.push({ id: `o${s.season}-${s.week}-${p.id}`, kind: 'sell', playerId: p.id, from: b.id, to: s.userClubId, fee, wage: 0, years: 0, week: s.week, season: s.season, expires: s.week + 2, status: 'open' });
    addNews(s, `${b.name} bid ¤${(fee / 1e6).toFixed(1)}M for ${p.shortName}`, 'transfer');
  }
}

export function resolveSellOffer(s: CareerState, offerId: string, accept: boolean): string {
  const o = s.offers.find((x) => x.id === offerId);
  if (!o || o.status !== 'open') return 'Offer no longer available';
  if (!accept) { o.status = 'rejected'; return 'Offer rejected'; }
  const buyer = club(s, o.from);
  if (club(s, s.userClubId).squad.length <= SQUAD_MIN) return 'Your squad would be too small';
  if (buyer.budget < o.fee) { o.status = 'expired'; return 'The buyer can no longer afford the fee'; }
  executeTransfer(s, o.playerId!, o.from, o.fee, Math.round(player(s, o.playerId!).wage * 1.1), 3);
  o.status = 'accepted';
  return 'Player sold';
}

export interface MarketFilter { group?: 'GK' | 'DEF' | 'MID' | 'ATT'; maxAge?: number; minOverall?: number; maxFee?: number; nation?: string; freeOnly?: boolean; query?: string; sort?: 'overall' | 'value' | 'age' | 'potential' }

/** Players the user can see: own league (baseline knowledge) + scouted players. */
export function searchMarket(s: CareerState, f: MarketFilter, limit = 60): Player[] {
  const myLeague = club(s, s.userClubId).leagueId;
  const q = f.query?.toLowerCase();
  const out: Player[] = [];
  for (const p of Object.values(s.world.players)) {
    if (p.clubId === s.userClubId) continue;
    const known = s.scouting.known[p.id] ?? (p.clubId && club(s, p.clubId).leagueId === myLeague ? 0.5 : p.clubId === null ? 0.5 : 0);
    if (known <= 0) continue;
    if (f.group && POS_GROUP[p.positions[0]!] !== f.group) continue;
    if (f.maxAge && p.age > f.maxAge) continue;
    if (f.minOverall && p.overall < f.minOverall) continue;
    if (f.nation && p.nation !== f.nation) continue;
    if (f.freeOnly && p.clubId !== null) continue;
    if (f.maxFee && askingPrice(s, p) > f.maxFee) continue;
    if (q && !p.name.toLowerCase().includes(q)) continue;
    out.push(p);
  }
  const key = f.sort ?? 'overall';
  out.sort((a, b) => (key === 'age' ? a.age - b.age : key === 'value' ? b.value - a.value : key === 'potential' ? b.potential - a.potential : b.overall - a.overall));
  return out.slice(0, limit);
}

/** Overall as seen through scouting: exact when well known, a deterministic range otherwise. */
export function scoutedOverall(s: CareerState, p: Player): { lo: number; hi: number; exact: boolean } {
  if (p.clubId === s.userClubId) return { lo: p.overall, hi: p.overall, exact: true };
  const known = s.scouting.known[p.id] ?? 0.5;
  if (known >= 0.85) return { lo: p.overall, hi: p.overall, exact: true };
  const spread = Math.round((1 - known) * 10);
  const off = (Math.abs(hash(p.id)) % (spread * 2 + 1)) - spread;
  return { lo: p.overall + off - spread, hi: p.overall + off + spread, exact: false };
}
function hash(str: string): number { let h = 0; for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0; return h; }
