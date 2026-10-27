// @ts-nocheck
import { it } from 'vitest';
import { makeMatch } from './headless';
import { emptyFrame } from '../input/actions';
const run = process.env.DIAG6 ? it : it.skip;
run('keeper stall', () => {
  const m = makeMatch('monkey-keeper', { halfLength: 3, headless: false });
  m.addHuman(0, true);
  m.startMatch();
  let t = 0; let lastPhase = '';
  while (!m.ended && t < 700) {
    if (m.phase === 'halftime') m.startNextPeriod();
    m.step(1 / 60, [emptyFrame()]); t += 1 / 60;
    if (m.phase !== lastPhase || Math.floor(t) % 60 === 0 && t % 1 < 1/60) { console.log(t.toFixed(0), m.phase, m.sp?.type, m.sp?.phase, m.period, m.periodClock.toFixed(0), m.score); lastPhase = m.phase; }
  }
});
