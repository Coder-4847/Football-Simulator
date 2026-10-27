import { describe, expect, it } from 'vitest';
import { makeMatch } from './headless';

describe('kick-off', () => {
  it('keeps each side in its own half and the first pass reaches a teammate', () => {
    for (let i = 0; i < 8; i++) {
      const m = makeMatch('ko-' + i, { halfLength: 3 });
      m.startMatch();
      const dt = 1 / 60;
      let guard = 0;
      // run the pre-kick set-up until the whistle sends the ball away
      while (m.sp && guard++ < 60 * 30) {
        m.step(dt);
        for (const p of m.all) if (p.active() && !p.isGK() && p !== m.sp?.taker) expect(m.depth(p.side, p.x)).toBeLessThan(1.5);
      }
      const side = m.lastTouch?.side;
      expect(side).toBeDefined();
      let firstOwner: number | null = null;
      for (let t = 0; t < 60 * 3; t++) {
        m.step(dt);
        if (m.owner && firstOwner === null) firstOwner = m.owner.side;
        for (const p of m.teams[side === 0 ? 1 : 0].players) if (p.active() && !p.isGK()) expect(m.depth(p.side, p.x)).toBeLessThan(2.5);
      }
      expect(firstOwner).toBe(side);
    }
  }, 60000);

  it('can skip the set-up of a dead ball', () => {
    const m = makeMatch('skip', { halfLength: 3 });
    m.startMatch();
    m.step(1 / 60);
    expect(m.canSkip()).toBe(true);
    expect(m.skipWaiting()).toBe(true);
    for (let i = 0; i < 20; i++) m.step(1 / 60);
    expect(m.sp === null || m.sp.phase !== 'setup').toBe(true);
  });
});
