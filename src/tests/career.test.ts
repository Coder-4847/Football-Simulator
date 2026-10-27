import { describe, expect, it } from 'vitest';
import { createCareer, endWeek, leagueTable, simFixture, applyResult, simulateWeek, userFixtureThisWeek } from '../manager/career';
import { generateWorld } from '../data/generate';
import { RNG } from '../core/rng';
import { simulateMatch, simTeamFor } from '../sim/engine';
import { evaluateBid, executeTransfer, askingPrice, searchMarket } from '../manager/transfers';

const world = generateWorld({ seed: 'career-test' });
const firstClub = Object.values(world.clubs).find((c) => c.leagueId.endsWith('-1'))!;

function playSeason(s: ReturnType<typeof createCareer>): void {
  const start = s.season;
  while (s.season === start) {
    const rep = simulateWeek(s);
    if (rep.userFixture) applyResult(s, rep.userFixture, simFixture(s, rep.userFixture));
    endWeek(s);
  }
}

describe('fast sim engine', () => {
  it('has realistic goals and favours stronger teams', () => {
    const lg = Object.values(world.leagues).find((l) => l.tier === 1)!;
    const strong = world.clubs[lg.clubs[0]!]!, weak = world.clubs[lg.clubs[lg.clubs.length - 1]!]!;
    const rng = new RNG('sim');
    let goals = 0, strongWins = 0, weakWins = 0; const N = 400;
    for (let i = 0; i < N; i++) {
      const r = simulateMatch(simTeamFor(strong, world.players), simTeamFor(weak, world.players), rng);
      goals += r.score[0] + r.score[1];
      if (r.score[0] > r.score[1]) strongWins++; else if (r.score[1] > r.score[0]) weakWins++;
    }
    expect(goals / N).toBeGreaterThan(2.0); expect(goals / N).toBeLessThan(3.6);
    expect(strongWins).toBeGreaterThan(weakWins * 1.5);
  });
  it('knockout ties always produce a winner', () => {
    const c = Object.values(world.clubs);
    const rng = new RNG('ko');
    for (let i = 0; i < 80; i++) { const r = simulateMatch(simTeamFor(c[i]!, world.players), simTeamFor(c[i + 1]!, world.players), rng, { knockout: true }); expect(r.winner).not.toBeNull(); }
  });
});

describe('career mode', () => {
  const s = createCareer({ clubId: firstClub.id, managerName: 'Test Manager', seed: 'career-test', world });
  it('creates fixtures: 30 rounds, everyone plays 30 league games', () => {
    const lg = s.world.leagues[firstClub.leagueId]!;
    const mine = s.fixtures.filter((f) => f.comp === lg.id && (f.home === s.userClubId || f.away === s.userClubId));
    expect(mine.length).toBe(30);
    expect(new Set(mine.map((f) => f.week)).size).toBe(30);
  });
  it('plays three seasons without breaking invariants', () => {
    for (let k = 0; k < 3; k++) playSeason(s);
    expect(s.season).toBe(2029);
    expect(s.history.length).toBe(3);
    for (const l of Object.values(s.world.leagues)) expect(l.clubs.length).toBe(16);
    for (const c of Object.values(s.world.clubs)) {
      expect(c.squad.length).toBeGreaterThanOrEqual(18); expect(c.squad.length).toBeLessThanOrEqual(34);
      for (const id of c.squad) expect(s.world.players[id]!.clubId).toBe(c.id);
    }
    const budgets = Object.values(s.world.clubs).map((c) => c.budget);
    expect(Math.max(...budgets)).toBeLessThan(5e9);
    expect(Math.min(...budgets)).toBeGreaterThan(-5e9);
  }, 120000);
  it('tables are consistent', () => {
    const t = leagueTable(s, firstClub.leagueId);
    expect(t.reduce((a, r) => a + r.gf, 0)).toBe(t.reduce((a, r) => a + r.ga, 0));
    expect(t.every((r) => r.p === r.w + r.d + r.l)).toBe(true);
  });
  it('transfers move players and money', () => {
    const c = s.world.clubs[s.userClubId]!;
    c.budget = 200_000_000; s.week = 2;
    const target = searchMarket(s, { minOverall: 60 }, 5).find((p) => p.clubId && s.world.clubs[p.clubId]!.squad.length > 25)!;
    const fee = askingPrice(s, target);
    const res = evaluateBid(s, target.id, fee, target.wage * 3, 3);
    expect(['accepted', 'refused']).toContain(res.status);
    if (res.status === 'accepted') {
      const seller = target.clubId!; const before = s.world.clubs[seller]!.budget;
      executeTransfer(s, target.id, s.userClubId, fee, target.wage * 3, 3);
      expect(s.world.clubs[seller]!.budget).toBe(before + fee);
      expect(s.world.players[target.id]!.clubId).toBe(s.userClubId);
    }
    expect(userFixtureThisWeek(s)).toBeDefined();
  });
  it('is deterministic', () => {
    const a = createCareer({ clubId: firstClub.id, managerName: 'x', seed: 'det', world: generateWorld({ seed: 'det' }) });
    const b = createCareer({ clubId: firstClub.id, managerName: 'x', seed: 'det', world: generateWorld({ seed: 'det' }) });
    for (let w = 0; w < 10; w++) { for (const st of [a, b]) { const r = simulateWeek(st); if (r.userFixture) applyResult(st, r.userFixture, simFixture(st, r.userFixture)); endWeek(st); } }
    expect(JSON.stringify(a.fixtures.map((f) => [f.hg, f.ag]))).toBe(JSON.stringify(b.fixtures.map((f) => [f.hg, f.ag])));
  }, 60000);
});
