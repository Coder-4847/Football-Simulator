// @ts-nocheck
import { it } from 'vitest';
import { createCareer, endWeek, simFixture, applyResult, simulateWeek, leagueTable } from '../manager/career';
const run = process.env.DIAG5 ? it : it.skip;
run('finance', () => {
  const s = createCareer({ clubId: 'c0', managerName: 'T', seed: 'fin' });
  for (let season = 0; season < 4; season++) {
    const start = s.season;
    while (s.season === start) { const r = simulateWeek(s); if (r.userFixture) applyResult(s, r.userFixture, simFixture(s, r.userFixture)); endWeek(s); }
    const b = Object.values(s.world.clubs).map((c) => c.budget).sort((a, b) => a - b);
    const t = leagueTable(s, 'ALD-1' in s.world.leagues ? 'ALD-1' : Object.keys(s.world.leagues)[0]);
    console.log('season', s.season - 1, 'budget min/med/max', (b[0]/1e6).toFixed(0), (b[b.length>>1]/1e6).toFixed(0), (b[b.length-1]/1e6).toFixed(0), 'hist', JSON.stringify(s.history.at(-1)), 'players', Object.keys(s.world.players).length);
  }
});
