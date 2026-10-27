import { describe, expect, it } from 'vitest';
import { createTournament, pending, simTournamentFixture, type Tournament } from '../manager/tournament';

function run(t: Tournament): void { let guard = 0; while (t.phase !== 'done' && guard++ < 500) { const p = pending(t); if (!p.length) break; for (const f of p) simTournamentFixture(t, f); } }

describe('tournaments', () => {
  for (const type of ['knockout', 'groups'] as const) for (const size of [4, 6, 8, 12, 16, 20, 24]) {
    it(`${type} with ${size} nations produces a champion`, () => {
      const t = createTournament({ seed: `s${size}${type}`, type, size, user: 'ALD' });
      expect(t.ids.length).toBe(size);
      run(t);
      expect(t.phase).toBe('done');
      expect(t.champion).toBeTruthy();
      expect(t.ids).toContain(t.champion);
    });
  }
  it('knockout plays n-1 matches', () => {
    const t = createTournament({ seed: 'k16', type: 'knockout', size: 16, user: 'ALD' });
    run(t); expect(t.fixtures.length).toBe(15);
    const t2 = createTournament({ seed: 'k12', type: 'knockout', size: 12, user: 'ALD' });
    run(t2); expect(t2.fixtures.length).toBe(11);
  });
});
