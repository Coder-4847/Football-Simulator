// @ts-nocheck
import { describe, it } from 'vitest';
import { makeMatch } from './headless';
import { distSegPoint } from '../match/ai';
import { other } from '../match/constants';

const run = process.env.DIAG3 ? it : it.skip;
describe('diag3', () => {
  run('ground pass interceptions', () => {
    const rows: string[] = [];
    const m = makeMatch('g1', {}, 0, 3);
    let cur: { passer: any; target: any; dist: number; minOpp: number; oppDistFromPasser: number; t0: number; tx: number; ty: number } | null = null;
    m.bus.on('pass', (e) => {
      if (e.kind !== 'ground') return;
      let mo = 99, od = 0;
      for (const o of m.teams[other(e.player.side)].players) { if (!o.active()) continue; const d = e.target ? distSegPoint(e.player.x, e.player.y, e.target.x, e.target.y, o.x, o.y) : 99; if (d < mo) { mo = d; od = Math.hypot(o.x - e.player.x, o.y - e.player.y); } }
      cur = { passer: e.player, target: e.target, dist: e.target ? Math.hypot(e.target.x - e.player.x, e.target.y - e.player.y) : 0, minOpp: mo, oppDistFromPasser: od, t0: m.time, tx: e.target?.x ?? 0, ty: e.target?.y ?? 0 };
    });
    let last = m.lastTouch;
    m.startMatch();
    let t = 0;
    while (!m.ended && t < 600) {
      if (m.phase === 'halftime') m.startNextPeriod();
      m.step(1 / 60); t += 1 / 60;
      if (cur && m.lastTouch !== last && m.lastTouch !== cur.passer) {
        const lt = m.lastTouch!;
        const tag = lt.side === cur.passer.side ? (lt === cur.target ? 'OK' : 'mate') : 'OPP';
        rows.push(`${tag} d=${cur.dist.toFixed(0)} laneMin=${cur.minOpp.toFixed(1)} oppFromPasser=${cur.oppDistFromPasser.toFixed(0)} flight=${(m.time - cur.t0).toFixed(2)} touchDistToBall=${Math.hypot(lt.x - m.ball.x, lt.y - m.ball.y).toFixed(2)} ball=${m.ball.speed().toFixed(1)}`);
        cur = null;
      }
      last = m.lastTouch;
    }
    console.log('ROWS\n' + rows.slice(0, 60).join('\n'));
  }, 100000);
});
