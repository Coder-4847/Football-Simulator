// @ts-nocheck
import { describe, it } from 'vitest';
import { makeMatch } from './headless';
const run = process.env.DIAG4 ? it : it.skip;
describe('diag4', () => {
  run('headers', () => {
    const m = makeMatch('h1', {}, 0, 3);
    const rows: string[] = [];
    let lastH = 0;
    m.bus.on('header', (e) => { rows.push(`t=${m.time.toFixed(1)} dt=${(m.time - lastH).toFixed(1)} z=${m.ball.z.toFixed(2)} v=${m.ball.speed().toFixed(1)} pos=(${e.player.x.toFixed(0)},${e.player.y.toFixed(0)}) bx=${m.ball.x.toFixed(0)} last=${m.passInfo?.kind ?? '-'} phase=${m.phase}`); lastH = m.time; });
    m.startMatch();
    let t = 0;
    while (!m.ended && t < 300) { if (m.phase === 'halftime') m.startNextPeriod(); m.step(1 / 60); t += 1 / 60; }
    console.log('HDR ' + rows.length + '\n' + rows.slice(0, 40).join('\n'));
  }, 100000);
});
