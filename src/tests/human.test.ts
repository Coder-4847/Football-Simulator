import { describe, expect, it } from 'vitest';
import { makeMatch } from './headless';
import { BUTTONS, emptyFrame, type Btn, type FrameInput } from '../input/actions';
import { RNG } from '../core/rng';

/** Random-but-consistent input generator (proper press/hold/release edges). */
class Monkey {
  private down: Record<string, number> = {};
  private rng: RNG;
  constructor(seed: string, private busy = 0.5) { this.rng = new RNG(seed); }
  frame(dt: number, moveBias: number): FrameInput {
    const f = emptyFrame();
    const r = this.rng;
    if (r.chance(0.04)) { this.mx = r.float(-1, 1); this.my = r.float(-1, 1); if (r.chance(0.2)) { this.mx = 0; this.my = 0; } }
    f.mx = this.mx * moveBias; f.my = this.my * moveBias;
    for (const b of BUTTONS) {
      if (b === 'pause') continue;
      const was = this.down[b] !== undefined;
      let isDown = was;
      if (!was && r.chance(0.02 * this.busy)) isDown = true;
      else if (was && r.chance(b === 'sprint' ? 0.01 : 0.08)) isDown = false;
      f.pressed[b as Btn] = isDown && !was; f.released[b as Btn] = !isDown && was; f.down[b as Btn] = isDown;
      if (isDown) { this.down[b] = (this.down[b] ?? 0) + dt; f.held[b as Btn] = this.down[b]!; }
      if (!isDown && was) { f.heldAtRelease[b as Btn] = this.down[b]!; delete this.down[b]; }
    }
    if (r.chance(0.01)) f.skillSlot = r.int(0, 3);
    return f;
  }
  private mx = 0; private my = 0;
}

describe('human-controlled play', () => {
  for (const [name, keeper, twoHumans] of [['outfield', false, false], ['keeper', true, false], ['two humans', false, true]] as const) {
    it(`survives random inputs (${name})`, () => {
      const m = makeMatch('monkey-' + name, { halfLength: 3, headless: false });
      const a = m.addHuman(0, keeper);
      const b = twoHumans ? m.addHuman(1) : -1;
      const monkeys = [new Monkey('a'), new Monkey('b')];
      const counts: Record<string, number> = {};
      for (const ev of ['pass', 'shot', 'tackle', 'skill', 'switchPlayer', 'freeKick', 'corner', 'throwIn', 'goalKick', 'foul', 'save'] as const) m.bus.on(ev, () => { counts[ev] = (counts[ev] ?? 0) + 1; });
      m.startMatch();
      let t = 0;
      while (!m.ended && t < 700) {
        if (m.phase === 'halftime') m.startNextPeriod();
        const frames: FrameInput[] = [monkeys[0]!.frame(1 / 60, 1)];
        if (b >= 0) frames.push(monkeys[1]!.frame(1 / 60, 1));
        m.step(1 / 60, frames);
        t += 1 / 60;
        expect(Number.isFinite(m.ball.x) && Number.isFinite(m.ball.y) && Number.isFinite(m.ball.z)).toBe(true);
      }
      void a;
      if (!m.ended) console.log('NOT ENDED', m.phase, m.sp?.type, m.sp?.phase, m.sp?.taker?.data.shortName, m.sp?.taker?.human, m.period, m.periodClock, m.addedTime, m.periodExpired, m.score, 'owner', m.owner?.data.shortName, m.ballInGoalKeeperHands?.data.shortName, 'clock', m.displayClock().text, 'ball', m.ball.x.toFixed(1), m.ball.y.toFixed(1), m.ball.z.toFixed(2), m.ball.speed().toFixed(2), m.ball.inNet, 'lastTouch', m.lastTouch?.data.shortName);
      expect(m.ended).toBe(true);
      expect(counts.pass ?? 0).toBeGreaterThan(10);
      for (const p of m.all) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }, 90000);
  }
});
