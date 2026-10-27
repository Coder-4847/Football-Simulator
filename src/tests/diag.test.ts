import { describe, it } from 'vitest';
import { makeMatch } from './headless';

const run = process.env.DIAG ? it : it.skip;

describe('diag', () => {
  run('aggregate stats', () => {
    const N = Number(process.env.DIAG_N ?? 3);
    const agg: Record<string, number> = {};
    const add = (k: string, v = 1): void => { agg[k] = (agg[k] ?? 0) + v; };
    let stuck = 0;
    for (let i = 0; i < N; i++) {
      const m = makeMatch('d' + i, { halfLength: 5 }, i, i + 2);
      for (const ev of ['goal', 'foul', 'card', 'offside', 'corner', 'throwIn', 'goalKick', 'freeKick', 'penalty', 'save', 'post', 'shot', 'header', 'skill', 'tackle', 'keeperCatch', 'sub', 'injury', 'advantage'] as const) m.bus.on(ev, () => add(ev));
      m.startMatch();
      let lastPhase = m.phase, phaseStart = 0, t = 0;
      while (!m.ended && t < 1600) {
        if (m.phase === 'halftime' || m.phase === 'extratimeBreak') m.startNextPeriod();
        m.step(1 / 60); t += 1 / 60;
        if (m.phase !== lastPhase) { lastPhase = m.phase; phaseStart = t; }
        if (t - phaseStart > 25 && m.phase !== 'fulltime' && m.phase !== 'play') { stuck++; console.log('STUCK in', m.phase, m.sp?.type, m.sp?.phase, 'at', t.toFixed(0)); phaseStart = t; }
      }
      for (const tm of m.teams) {
        add('shots', tm.stats.shots); add('onTarget', tm.stats.onTarget); add('passes', tm.stats.passes); add('passOK', tm.stats.passesCompleted);
        add('tackles', tm.stats.tackles); add('interceptions', tm.stats.interceptions); add('clearances', tm.stats.clearances); add('xg', tm.stats.xg);
        add('goalsFor', tm.score); add('yellow', tm.stats.yellow); add('red', tm.stats.red);
      }
      add('possA', m.stats.possessionTime[0] / (m.stats.possessionTime[0] + m.stats.possessionTime[1]));
      add('simSeconds', t);
      console.log(`match ${i}: ${m.teams[0].score}-${m.teams[1].score} clock ${m.displayClock().text} ended=${m.ended}`);
    }
    for (const k of Object.keys(agg)) agg[k] = Math.round((agg[k]! / N) * 100) / 100;
    console.log('PER MATCH', JSON.stringify(agg), 'stuck', stuck);
  }, 300000);
});
