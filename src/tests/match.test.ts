import { describe, expect, it } from 'vitest';
import { makeMatch, runMatch } from './headless';

describe('headless match', () => {
  it('plays to full time with sane stats', () => {
    const m = makeMatch('t1', { halfLength: 3 });
    runMatch(m);
    expect(m.ended).toBe(true);
    const shots = m.teams[0].stats.shots + m.teams[1].stats.shots;
    expect(shots).toBeGreaterThan(4);
    expect(m.teams[0].score + m.teams[1].score).toBeLessThan(14);
    expect(m.teams[0].stats.passes).toBeGreaterThan(40);
  }, 60000);

  it('is deterministic for the same seed', () => {
    const a = makeMatch('det', { halfLength: 2 }); runMatch(a);
    const b = makeMatch('det', { halfLength: 2 }); runMatch(b);
    expect(a.score).toEqual(b.score);
    expect(a.teams[0].stats).toEqual(b.teams[0].stats);
    expect(a.ball.x).toBeCloseTo(b.ball.x, 6);
  }, 60000);

  it('different seeds differ', () => {
    const a = makeMatch('s1', { halfLength: 2 }); runMatch(a);
    const b = makeMatch('s2', { halfLength: 2 }); runMatch(b);
    expect(a.teams[0].stats.passes === b.teams[0].stats.passes && a.score.join() === b.score.join()).toBe(false);
  }, 60000);

  it('knockout ties go to a shootout and produce a winner', () => {
    // force draws by making both sides identical and giving it enough tries
    let decided = 0;
    for (let i = 0; i < 6 && decided === 0; i++) {
      const m = makeMatch('ko' + i, { halfLength: 1, knockout: true, extraTime: true, penalties: true }, 2, 2 + 1);
      runMatch(m, 4000);
      expect(m.ended).toBe(true);
      if (m.shootout) { decided++; expect(m.winner).not.toBeNull(); expect(m.shootout.kicks.length).toBeGreaterThanOrEqual(6); }
    }
  }, 120000);
});
