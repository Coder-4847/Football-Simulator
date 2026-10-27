// @ts-nocheck
import { describe, it } from 'vitest';
import { makeMatch } from './headless';

const run = process.env.DIAG2 ? it : it.skip;
describe('diag2', () => {
  run('pass fates', () => {
    const fates: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 3; i++) {
      const m = makeMatch('f' + i, {}, i, i + 3);
      let cur: { kind: string; passer: unknown; side: number; target: unknown } | null = null;
      m.bus.on('pass', (e) => { if (cur) bump(cur.kind, 'superseded'); cur = { kind: e.kind, passer: e.player, side: e.player.side, target: e.target }; });
      const bump = (k: string, f: string): void => { fates[k] ??= {}; fates[k]![f] = (fates[k]![f] ?? 0) + 1; };
      let lastTouch = m.lastTouch;
      m.startMatch();
      let t = 0;
      while (!m.ended && t < 700) {
        if (m.phase === 'halftime') m.startNextPeriod();
        m.step(1 / 60); t += 1 / 60;
        if (cur && m.lastTouch !== lastTouch) {
          const lt = m.lastTouch;
          if (lt && lt !== cur.passer) { bump(cur.kind, lt.side === cur.side ? (lt === cur.target ? 'receiver' : 'otherMate') : 'opponent'); cur = null; }
        }
        if (cur && (m.phase === 'setpiece' || m.phase === 'goal')) { bump(cur.kind, 'out/stop:' + (m.sp?.type ?? m.phase)); cur = null; }
        lastTouch = m.lastTouch;
      }
    }
    console.log('FATES', JSON.stringify(fates, null, 1));
  }, 300000);
});
