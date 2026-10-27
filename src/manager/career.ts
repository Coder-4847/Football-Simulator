import { RNG } from '../core/rng';
import { clamp } from '../core/math';
import { generateWorld, START_YEAR } from '../data/generate';
import { makeName } from '../data/names';
import type { Club, Nation, Player, World } from '../data/types';
import { simulateMatch, simTeamFor, type SimResult, type SimTeam } from '../sim/engine';
import { POS_GROUP } from '../data/rating';
import { drawCupRound, generateSeasonFixtures, table } from './calendar';
import { generateYouthPlayer, progressPlayer } from './development';
import { facilityUpgradeCost, weeklyIncome, weeklyWages } from './economy';
import { aiBidsForUser, aiTransfers, addNews, club, executeTransfer, player, SQUAD_MIN } from './transfers';
import { CUP_ROUND_NAMES, CUP_WEEKS, WEEKS, type CareerState, type Fixture, type Objective, type Scout } from './state';

export interface NewCareerOptions { seed?: string; clubId: string; managerName: string; mode?: 'manager' | 'player'; playerId?: string; world?: World }

export function createCareer(o: NewCareerOptions): CareerState {
  const seed = o.seed ?? `career-${Date.now()}`;
  const world = structuredClone(o.world ?? generateWorld({ seed }));
  const c = world.clubs[o.clubId]!;
  const s: CareerState = {
    version: 1, seed, mode: o.mode ?? 'manager', managerName: o.managerName, userClubId: o.clubId, userPlayerId: o.playerId, season: START_YEAR, week: 1, world,
    fixtures: [], cupAlive: {}, history: [], lineup: { formation: c.formation, starters: [], tactics: structuredClone(c.tactics) },
    board: { confidence: 65, objectives: [], managerRep: clamp(c.reputation - 10, 5, 90), sacked: false },
    finance: {}, seasonFinance: { income: 0, wages: 0, transfersIn: 0, transfersOut: 0, other: 0 }, offers: [],
    scouting: { scouts: [], known: {}, shortlist: [] }, youth: [], news: [], trainingFocus: 'balanced', listed: [], facilities: { training: 1, youth: 1, stadium: 1 }, jobOffers: [],
    stats: { seasonsPlayed: 0, trophies: [] },
  };
  for (let i = 0; i < 2; i++) s.scouting.scouts.push(newScout(s, i));
  startSeason(s);
  s.youth = generateYouthIntake(s, new RNG(`youth0:${seed}`));
  addNews(s, `${s.managerName} is appointed manager of ${c.name}.`, 'board');
  return s;
}

function newScout(s: CareerState, i: number): Scout {
  const r = new RNG(`scout:${s.seed}:${i}:${s.season}`);
  const nat = Object.values(s.world.nations)[r.int(0, 23)]!;
  return { id: `sc${i}-${s.season}`, name: makeName(r, nat.style).name, nation: s.world.clubs[s.userClubId]!.nation, group: 'ANY', quality: r.int(2, 4), assigned: true };
}

// --------------------------------------------------------------------------- season setup
export function startSeason(s: CareerState): void {
  s.fixtures = generateSeasonFixtures(s.world, s.season, s.seed);
  s.cupAlive = {};
  for (const lg of Object.values(s.world.leagues)) { (s.cupAlive[lg.nation] ??= []).push(...lg.clubs); }
  for (const nation of Object.keys(s.cupAlive)) s.fixtures.push(...drawCupRound(s, nation, 0));
  for (const c of Object.values(s.world.clubs)) s.finance[c.id] = { income: 0, expenses: 0, cash: c.budget };
  s.seasonFinance = { income: 0, wages: 0, transfersIn: 0, transfersOut: 0, other: 0 };
  s.board.objectives = makeObjectives(s);
  for (const p of Object.values(s.world.players)) { p.goals = 0; p.assists = 0; p.apps = 0; p.yellow = 0; p.red = 0; }
}

function makeObjectives(s: CareerState): Objective[] {
  const c = club(s, s.userClubId);
  const lg = s.world.leagues[c.leagueId]!;
  const ranked = lg.clubs.map((id) => club(s, id)).sort((a, b) => b.reputation - a.reputation);
  const rank = ranked.findIndex((x) => x.id === c.id) + 1;
  const target = lg.tier === 1 ? clamp(Math.ceil(rank * 0.8), 1, lg.clubs.length - 3) : clamp(Math.ceil(rank * 0.8), 1, 6);
  return [
    { id: 'league', text: lg.tier === 1 ? `Finish in the top ${Math.max(target, 1)} of the ${lg.name}` : `Finish in the top ${target} of the ${lg.name}${lg.tier > 1 ? ' (promotion places: top 3)' : ''}`, kind: 'league', target, done: false, failed: false },
    { id: 'cup', text: `Reach the ${CUP_ROUND_NAMES[Math.max(0, Math.min(3, Math.floor(rank / 6)))]} of the cup`, kind: 'cup', target: Math.max(1, 3 - Math.floor(rank / 6)), done: false, failed: false },
    { id: 'finance', text: 'Finish the season with a positive cash balance', kind: 'finance', target: 0, done: false, failed: false },
  ];
}

export function generateYouthIntake(s: CareerState, rng: RNG): Player[] {
  const c = club(s, s.userClubId);
  const nation = s.world.nations[c.nation] as Nation;
  const n = 3 + Math.floor((c.youthRating + s.facilities.youth * 8) / 40);
  const out: Player[] = [];
  for (let i = 0; i < n; i++) out.push(generateYouthPlayer(rng, c, nation, `y${s.season}-${i}-${s.seed.slice(-4)}`, s.season));
  return out;
}

// --------------------------------------------------------------------------- queries
export function fixturesFor(s: CareerState, clubId: string, week?: number): Fixture[] {
  return s.fixtures.filter((f) => (f.home === clubId || f.away === clubId) && (week === undefined || f.week === week));
}
export function nextUserFixture(s: CareerState): Fixture | null {
  return s.fixtures.filter((f) => !f.played && (f.home === s.userClubId || f.away === s.userClubId)).sort((a, b) => a.week - b.week)[0] ?? null;
}
export function leagueTable(s: CareerState, leagueId: string) { return table(s.fixtures, leagueId, s.world.leagues[leagueId]!.clubs); }
export function userFixtureThisWeek(s: CareerState): Fixture | null { return s.fixtures.find((f) => !f.played && f.week === s.week && (f.home === s.userClubId || f.away === s.userClubId)) ?? null; }

export function squadOf(s: CareerState, clubId: string): Player[] { return club(s, clubId).squad.map((id) => player(s, id)); }

// --------------------------------------------------------------------------- results
export function applyResult(s: CareerState, f: Fixture, r: SimResult, simTeams?: [SimTeam, SimTeam]): void {
  f.played = true; f.hg = r.score[0]; f.ag = r.score[1]; f.pens = r.shootout;
  f.scorers = r.events.filter((e) => e.type === 'goal').map((e) => ({ side: e.side, minute: e.minute, player: e.player, text: e.text }));
  const rng = new RNG(`apply:${s.seed}:${s.season}:${f.id}`);
  for (const l of r.players) {
    const p = s.world.players[l.id]; if (!p) continue;
    p.apps++; p.goals += l.goals; p.assists += l.assists; p.yellow += l.yellow; p.red += l.red;
    p.form = clamp(p.form * 0.6 + (l.rating - 6.4) * 0.25, -1, 1);
    p.fitness = clamp(p.fitness - (l.minutes / 90) * rng.float(9, 18), 30, 100);
    p.morale = clamp(p.morale + (r.winner === l.side ? 3 : r.winner === null ? 0 : -3) + (l.goals ? 4 : 0), 20, 100);
    if (l.red) p.suspended = Math.max(p.suspended, rng.int(1, 3));
    else if (l.yellow && p.yellow % 5 === 0) p.suspended = Math.max(p.suspended, 1);
    if (l.injured) { const sev = rng.weighted([1, 2, 3, 5, 8, 14, 26], (w) => 1 / Math.sqrt(w)); p.injuredUntil = sev; if (p.clubId === s.userClubId) addNews(s, `${p.shortName} is injured for ~${sev} week${sev > 1 ? 's' : ''}.`, 'injury'); }
  }
  // players who did not play recover and lose a suspension
  for (const side of [f.home, f.away]) {
    for (const id of club(s, side).squad) { const p = player(s, id); if (!r.players.some((l) => l.id === id) && p.suspended > 0) p.suspended--; }
  }
  void simTeams;
  if (f.home === s.userClubId || f.away === s.userClubId) {
    const mine = f.home === s.userClubId ? 0 : 1;
    const my = r.score[mine], th = r.score[1 - mine];
    const res = my > th ? 'W' : my < th ? 'L' : 'D';
    const opp = club(s, mine === 0 ? f.away : f.home).name;
    s.lastResult = { fixtureId: f.id, summary: `${res} ${f.hg}–${f.ag} ${mine === 0 ? 'vs' : 'at'} ${opp}${r.shootout ? ` (pens ${r.shootout[0]}–${r.shootout[1]})` : ''}` };
    addNews(s, s.lastResult.summary, 'match');
    const delta = res === 'W' ? 3 : res === 'L' ? -3.5 : 0.2;
    const expected = club(s, s.userClubId).reputation - club(s, mine === 0 ? f.away : f.home).reputation;
    s.board.confidence = clamp(s.board.confidence + delta - (res === 'L' ? Math.max(0, expected) * 0.04 : 0) + (res === 'W' ? Math.max(0, -expected) * 0.03 : 0), 0, 100);
    s.board.managerRep = clamp(s.board.managerRep + (res === 'W' ? 0.15 : res === 'L' ? -0.1 : 0), 1, 100);
  }
  // cup progression
  if (f.comp.startsWith('cup:')) {
    const nation = f.comp.slice(4);
    const winner = r.winner === 0 ? f.home : f.away;
    const loser = winner === f.home ? f.away : f.home;
    s.cupAlive[nation] = (s.cupAlive[nation] ?? []).filter((c) => c !== loser);
  }
}

export function simFixture(s: CareerState, f: Fixture, userLineup?: string[]): SimResult {
  const rng = new RNG(`sim:${s.seed}:${s.season}:${f.id}`);
  const hc = club(s, f.home), ac = club(s, f.away);
  const cup = f.comp.startsWith('cup:');
  const home = simTeamFor(hc, s.world.players, f.home === s.userClubId ? userLineup ?? (s.lineup.starters.length === 11 ? s.lineup.starters : undefined) : undefined);
  const away = simTeamFor(ac, s.world.players, f.away === s.userClubId ? userLineup ?? (s.lineup.starters.length === 11 ? s.lineup.starters : undefined) : undefined);
  if (f.home === s.userClubId) { home.tactics = s.lineup.tactics; home.formationId = s.lineup.formation; }
  if (f.away === s.userClubId) { away.tactics = s.lineup.tactics; away.formationId = s.lineup.formation; }
  return simulateMatch(home, away, rng, { knockout: cup });
}

// --------------------------------------------------------------------------- weekly loop
export interface WeekReport { results: Array<{ f: Fixture }>; userFixture: Fixture | null; seasonEnded: boolean; sacked: boolean }

/** Simulates every fixture of the current week except the user's (which is returned for playing). */
export function simulateWeek(s: CareerState): WeekReport {
  const userF = userFixtureThisWeek(s);
  const results: Array<{ f: Fixture }> = [];
  for (const f of s.fixtures) {
    if (f.played || f.week !== s.week || f === userF) continue;
    applyResult(s, f, simFixture(s, f));
    results.push({ f });
  }
  return { results, userFixture: userF, seasonEnded: false, sacked: false };
}

/** Finishes the week (after the user's match has been resolved): economy, training, windows, cup draws. */
export function endWeek(s: CareerState): WeekReport {
  const rng = new RNG(`week:${s.seed}:${s.season}:${s.week}`);
  // economy
  for (const c of Object.values(s.world.clubs)) {
    const lg = s.world.leagues[c.leagueId]; if (!lg) continue;
    const pos = leagueTable(s, lg.id).findIndex((r) => r.club === c.id) + 1;
    const home = s.fixtures.filter((f) => f.week === s.week && f.home === c.id && f.played).length;
    const inc = weeklyIncome(c, lg, pos || 8, home, c.id === s.userClubId ? s.facilities.stadium - 1 : 0);
    const income = inc.gate + inc.sponsors + inc.tv + inc.merch;
    const wages = weeklyWages(c, s.world.players);
    const upkeep = Math.round(c.facilities * 1500);
    const fin = s.finance[c.id]!;
    fin.income += income; fin.expenses += wages + upkeep; c.budget += income - wages - upkeep; fin.cash = c.budget;
    if (c.id === s.userClubId) { s.seasonFinance.income += income; s.seasonFinance.wages += wages; s.seasonFinance.other += upkeep; }
  }
  // fitness / injuries / training
  for (const p of Object.values(s.world.players)) {
    if (!p.clubId) continue;
    p.fitness = clamp(p.fitness + 24 + (p.clubId === s.userClubId ? s.facilities.training * 2 : 0), 0, 100);
    if (p.injuredUntil > 0) { p.injuredUntil--; if (p.injuredUntil === 0 && p.clubId === s.userClubId) addNews(s, `${p.shortName} is fit again.`, 'injury'); }
    if (p.clubId === s.userClubId && s.trainingFocus !== 'balanced' && rng.chance(0.02)) {
      const k = s.trainingFocus === 'attacking' ? 'finishing' : s.trainingFocus === 'defending' ? 'standingTackle' : s.trainingFocus === 'passing' ? 'shortPass' : 'stamina';
      p.attrs[k] = clamp(p.attrs[k] + 1, 5, 97);
    }
  }
  // scouting
  scoutWeek(s, rng);
  // transfers
  aiTransfers(s, rng);
  aiBidsForUser(s, rng);
  for (const o of s.offers) if (o.status === 'open' && o.expires < s.week) o.status = 'expired';
  // next cup round draw
  const ridx = CUP_WEEKS.indexOf(s.week);
  if (ridx >= 0 && ridx < CUP_WEEKS.length - 1) for (const nation of Object.keys(s.cupAlive)) s.fixtures.push(...drawCupRound(s, nation, ridx + 1));
  // board
  const sacked = boardCheck(s);
  s.week++;
  let seasonEnded = false;
  if (s.week > WEEKS) { endSeason(s); seasonEnded = true; }
  return { results: [], userFixture: null, seasonEnded, sacked };
}

function scoutWeek(s: CareerState, rng: RNG): void {
  const all = Object.values(s.world.players);
  for (const sc of s.scouting.scouts) {
    if (!sc.assigned) continue;
    const pool = all.filter((p) => p.clubId && p.clubId !== s.userClubId && club(s, p.clubId).nation === sc.nation && (sc.group === 'ANY' || POS_GROUP[p.positions[0]!] === sc.group));
    for (let i = 0; i < 2 + sc.quality; i++) {
      const p = pool[rng.int(0, pool.length - 1)]; if (!p) continue;
      s.scouting.known[p.id] = Math.min(1, (s.scouting.known[p.id] ?? 0) + 0.25 + sc.quality * 0.08);
    }
  }
}

// --------------------------------------------------------------------------- board
function boardCheck(s: CareerState): boolean {
  if (s.board.confidence < 12 && s.week > 12 && !s.board.sacked) {
    s.board.sacked = true;
    addNews(s, 'The board has dismissed you after a run of poor results.', 'board');
    makeJobOffers(s);
    return true;
  }
  if (s.week % 4 === 0 && s.board.managerRep > 30) { if (new RNG(`jobs:${s.seed}:${s.season}:${s.week}`).chance(0.12)) makeJobOffers(s); }
  return false;
}

export function makeJobOffers(s: CareerState): void {
  const rng = new RNG(`joboffers:${s.seed}:${s.season}:${s.week}`);
  const me = club(s, s.userClubId);
  const cands = Object.values(s.world.clubs).filter((c) => c.id !== s.userClubId && !c.id.startsWith('nat-') && c.reputation <= s.board.managerRep + 12 && c.reputation >= s.board.managerRep - 35);
  const picks = rng.shuffle(cands).slice(0, 3);
  s.jobOffers = picks.map((c) => ({ id: `job-${c.id}-${s.season}-${s.week}`, kind: 'job', from: c.id, to: s.userClubId, fee: 0, wage: 0, years: 3, week: s.week, season: s.season, expires: s.week + 6, status: 'open', note: `${c.name} (${s.world.leagues[c.leagueId]?.name})` }));
  void me;
}

export function acceptJob(s: CareerState, clubId: string): void {
  s.userClubId = clubId;
  s.board.sacked = false; s.board.confidence = 60;
  const c = club(s, clubId);
  s.lineup = { formation: c.formation, starters: [], tactics: structuredClone(c.tactics) };
  s.board.objectives = makeObjectives(s);
  s.listed = []; s.offers = []; s.jobOffers = []; s.youth = generateYouthIntake(s, new RNG(`youthj:${s.seed}:${s.season}:${s.week}`));
  addNews(s, `${s.managerName} is appointed manager of ${c.name}.`, 'board');
}

// --------------------------------------------------------------------------- season rollover
export function endSeason(s: CareerState): void {
  const rng = new RNG(`rollover:${s.seed}:${s.season}`);
  const my = club(s, s.userClubId);
  const lgBefore = s.world.leagues[my.leagueId]!;
  const tbl = leagueTable(s, lgBefore.id);
  const pos = tbl.findIndex((r) => r.club === my.id) + 1;
  // objectives
  for (const o of s.board.objectives) {
    if (o.id === 'league') { o.done = pos <= o.target; o.failed = !o.done; }
    if (o.id === 'finance') { o.done = my.budget > 0; o.failed = !o.done; }
    if (o.id === 'cup') { const reached = cupRoundReached(s, my.id); o.done = reached >= o.target; o.failed = !o.done; }
  }
  const done = s.board.objectives.filter((o) => o.done).length;
  s.board.confidence = clamp(s.board.confidence + (done - 1.5) * 8, 0, 100);
  s.board.managerRep = clamp(s.board.managerRep + (pos <= 3 ? 2 : pos <= lgBefore.clubs.length / 2 ? 0.5 : -1) + done, 1, 100);
  // promotion / relegation
  const moves: Array<[string, string]> = [];
  const promoted = new Set<string>(), relegated = new Set<string>();
  for (const lg of Object.values(s.world.leagues).filter((l) => l.tier === 1)) {
    const lower = s.world.leagues[`${lg.nation}-2`]; if (!lower) continue;
    const top = leagueTable(s, lg.id), low = leagueTable(s, lower.id);
    const down = top.slice(-lg.relegationSpots).map((r) => r.club), up = low.slice(0, lower.promotionSpots).map((r) => r.club);
    for (const c of down) { relegated.add(c); moves.push([c, lower.id]); }
    for (const c of up) { promoted.add(c); moves.push([c, lg.id]); }
  }
  const champion = tbl[0]!.club;
  const scorers = Object.values(s.world.players).filter((p) => p.clubId && s.world.clubs[p.clubId]?.leagueId === lgBefore.id).sort((a, b) => b.goals - a.goals)[0];
  s.history.push({ season: s.season, leagueId: lgBefore.id, position: pos, points: tbl[pos - 1]!.pts, cupRound: CUP_ROUND_NAMES[Math.max(0, cupRoundReached(s, my.id) - 1)] ?? '-', profit: s.seasonFinance.income - s.seasonFinance.wages - s.seasonFinance.other - s.seasonFinance.transfersIn + s.seasonFinance.transfersOut, champion: club(s, champion).name, topScorer: scorers ? `${scorers.name} (${scorers.goals})` : '-', promoted: promoted.has(my.id), relegated: relegated.has(my.id) });
  if (champion === my.id) { s.stats.trophies.push(`${s.season} ${lgBefore.name}`); addNews(s, `You won the ${lgBefore.name}!`, 'board'); }
  for (const [cid, lid] of moves) { const c = club(s, cid); const from = s.world.leagues[c.leagueId]!; from.clubs = from.clubs.filter((x) => x !== cid); s.world.leagues[lid]!.clubs.push(cid); c.leagueId = lid; }
  s.stats.seasonsPlayed++;
  // players: age, progress, contracts, retirement
  for (const p of Object.values(s.world.players)) {
    const c = p.clubId ? s.world.clubs[p.clubId] : null;
    progressPlayer(p, rng.fork(p.id), c?.facilities ?? 40, p.clubId === s.userClubId ? s.facilities.training * 0.12 : 0);
    p.age++;
    p.morale = 70;
    if (p.age >= 34 && rng.chance(0.25 + (p.age - 34) * 0.18)) {
      if (p.clubId) { const cl = club(s, p.clubId); cl.squad = cl.squad.filter((id) => id !== p.id); }
      if (p.id === s.userPlayerId) addNews(s, `${p.name} retires.`, 'info');
      delete s.world.players[p.id];
      s.lineup.starters = s.lineup.starters.filter((id) => id !== p.id);
      s.listed = s.listed.filter((id) => id !== p.id);
      continue;
    }
    if (p.clubId && p.contractEnd <= s.season) {
      if (p.clubId === s.userClubId) { /* user decides: handled as expiring; AI auto-release below */ if (rng.chance(0.5)) { p.contractEnd = s.season; } }
      else if (rng.chance(0.75)) { p.contractEnd = s.season + rng.int(2, 4); p.wage = Math.round(p.wage * 1.06); }
      else { const cl = club(s, p.clubId); cl.squad = cl.squad.filter((id) => id !== p.id); p.clubId = null; }
    }
  }
  // user contracts that expired leave
  for (const id of [...my.squad]) {
    const p = player(s, id);
    if (p.contractEnd <= s.season && p.clubId === s.userClubId) { my.squad = my.squad.filter((x) => x !== id); p.clubId = null; addNews(s, `${p.name}'s contract expired and he left the club.`, 'transfer'); s.lineup.starters = s.lineup.starters.filter((x) => x !== id); }
  }
  while (my.squad.length < 20 && s.youth.length) promoteYouth(s, s.youth.sort((a, b) => b.overall - a.overall)[0]!.id);
  ensureSquad(s);
  // youth intake for AI clubs
  let pid = 100000 + s.season * 1000;
  for (const c of Object.values(s.world.clubs)) {
    if (c.id.startsWith('nat-')) continue;
    if (c.id === s.userClubId) continue;
    const nation = s.world.nations[c.nation] as Nation;
    const n = c.squad.length < 26 ? 3 : 1;
    for (let i = 0; i < n; i++) { const y = generateYouthPlayer(rng, c, nation, `p${pid++}`, s.season + 1); y.contractEnd = s.season + 3; s.world.players[y.id] = y; c.squad.push(y.id); }
  }
  for (const p of Object.values(s.world.players)) if (p.clubId === null && (p.age >= 32 || p.overall < 46) && p.id !== s.userPlayerId) delete s.world.players[p.id];
  // free-agent pool refresh
  for (let i = 0; i < 30; i++) { const nation = rng.pick(Object.values(s.world.nations)); const pos = rng.pick(['GK', 'CB', 'CM', 'LW', 'ST', 'RB', 'LB', 'CDM', 'CAM'] as const); const p = generateYouthPlayer(rng, my, nation, `p${pid++}`, s.season + 1); p.clubId = null; p.age = rng.int(19, 33); p.overall = Math.round(rng.gauss(58, 7)); void pos; s.world.players[p.id] = p; }
  // finance reset & next season
  s.season++; s.week = 1;
  s.board.sacked = false;
  startSeason(s);
  if (s.youth.length < 18) s.youth.push(...generateYouthIntake(s, rng));
  for (const o of s.offers) o.status = 'expired';
  s.offers = s.offers.filter((o) => o.status === 'open');
  if (s.board.managerRep > 35) makeJobOffers(s);
  addNews(s, `A new season begins: ${s.season}.`, 'info');
}

export function cupRoundReached(s: CareerState, clubId: string): number {
  const rounds = s.fixtures.filter((f) => f.comp.startsWith('cup:') && (f.home === clubId || f.away === clubId));
  return rounds.reduce((m, f) => Math.max(m, f.round), 0);
}

// --------------------------------------------------------------------------- user actions
export function upgradeFacility(s: CareerState, kind: 'training' | 'youth' | 'stadium'): string {
  const c = club(s, s.userClubId);
  const level = s.facilities[kind];
  if (level >= 5) return 'Already at maximum level';
  const cost = facilityUpgradeCost(level, c);
  if (c.budget < cost) return 'Not enough funds';
  c.budget -= cost; s.facilities[kind]++; s.seasonFinance.other += cost;
  return `${kind} upgraded to level ${s.facilities[kind]}`;
}

export function promoteYouth(s: CareerState, id: string): string {
  const i = s.youth.findIndex((p) => p.id === id);
  if (i < 0) return 'Not found';
  const c = club(s, s.userClubId);
  if (c.squad.length >= 32) return 'Squad is full';
  const [p] = s.youth.splice(i, 1);
  p!.clubId = c.id; p!.contractEnd = s.season + 3; s.world.players[p!.id] = p!; c.squad.push(p!.id);
  const used = new Set(c.squad.filter((x) => x !== p!.id).map((x) => player(s, x).number)); let n = 1; while (used.has(n)) n++; p!.number = n;
  return `${p!.shortName} promoted to the first team`;
}

export function userClubSummary(s: CareerState): { cash: number; wages: number; position: number; played: number; points: number } {
  const c = club(s, s.userClubId);
  const tbl = leagueTable(s, c.leagueId); const row = tbl.find((r) => r.club === c.id)!;
  return { cash: c.budget, wages: weeklyWages(c, s.world.players), position: tbl.indexOf(row) + 1, played: row.p, points: row.pts };
}

/** Marks the user as unavailable if the squad is too thin (the game auto-signs free agents). */
export function ensureSquad(s: CareerState): void {
  const c = club(s, s.userClubId);
  if (c.squad.length >= SQUAD_MIN) return;
  const fas = Object.values(s.world.players).filter((p) => p.clubId === null).sort((a, b) => b.overall - a.overall);
  for (const p of fas) { if (c.squad.length >= SQUAD_MIN) break; executeTransfer(s, p.id, c.id, 0, p.wage, 1); }
}

export type { Club };
