import { describe, expect, it } from 'vitest';
import { Ball, goalScored, predictCrossing, rollSpeedFor, SURFACES } from '../match/ball';
import { BALL_R, HALF_L } from '../match/constants';

const run = (b: Ball, secs: number, dt = 1 / 120): void => { for (let t = 0; t < secs; t += dt) b.step(dt); };

describe('ball physics', () => {
  it('bounces and loses energy', () => {
    const b = new Ball(); b.reset(0, 0, 3);
    let bounces = 0; b.onEvent = (e) => { if (e.kind === 'bounce') bounces++; };
    run(b, 3);
    expect(bounces).toBeGreaterThanOrEqual(2);
    expect(b.z).toBeLessThan(0.5);
  });
  it('rolls to a stop in a plausible distance', () => {
    const b = new Ball(); b.reset(0, 0); b.kick(20, 0, 0, 0, 20 / BALL_R, 0);
    run(b, 20);
    expect(b.x).toBeGreaterThan(30); expect(b.x).toBeLessThan(90);
    expect(b.speed()).toBeLessThan(0.1);
  });
  it('wet pitch is faster than dry', () => {
    const a = new Ball(), w = new Ball(); w.surface = SURFACES.wet;
    for (const b of [a, w]) { b.reset(0, 0); b.kick(15, 0, 0, 0, 15 / BALL_R, 0); run(b, 20); }
    expect(w.x).toBeGreaterThan(a.x);
  });
  it('curls with sidespin (Magnus)', () => {
    const b = new Ball(); b.reset(0, 0, 0.2); b.kick(25, 0, 3, 0, 0, 60);
    run(b, 1);
    expect(Math.abs(b.y)).toBeGreaterThan(1.5);
    const c = new Ball(); c.reset(0, 0, 0.2); c.kick(25, 0, 3, 0, 0, -60); run(c, 1);
    expect(Math.sign(c.y)).toBe(-Math.sign(b.y));
  });
  it('detects goals and the net stops the ball', () => {
    const b = new Ball(); b.reset(HALF_L - 10, 0, 0.5); b.kick(28, 0, 1);
    let scored = false;
    for (let t = 0; t < 2; t += 1 / 120) { b.step(1 / 120); if (goalScored(b) !== null) scored = true; }
    expect(scored).toBe(true);
    expect(b.x).toBeLessThan(HALF_L + 2.4);
  });
  it('hits the post and rebounds', () => {
    const b = new Ball(); b.reset(HALF_L - 6, 3.66, 0.3); b.kick(25, 0, 0);
    const ev: string[] = []; b.onEvent = (e) => ev.push(e.kind);
    run(b, 1);
    expect(ev).toContain('post');
    expect(b.vx).toBeLessThan(0);
  });
  it('rollSpeedFor reproduces requested arrival speed', () => {
    for (const [d, arr] of [[10, 5], [25, 6], [40, 4]] as const) {
      const v0 = rollSpeedFor(d, arr);
      const b = new Ball(); b.reset(0, 0); b.kick(v0, 0, 0, 0, v0 / BALL_R, 0);
      let speedAt = 0;
      for (let t = 0; t < 10; t += 1 / 120) { b.step(1 / 120); if (b.x >= d) { speedAt = b.speed(); break; } }
      expect(Math.abs(speedAt - arr)).toBeLessThan(1.2);
    }
  });
  it('predictCrossing agrees with simulation', () => {
    const b = new Ball(); b.reset(30, 5, 0.3); b.kick(26, -2, 3.5, 0, 0, 20);
    const p = predictCrossing(b, HALF_L)!;
    expect(p).not.toBeNull();
    const s = new Ball(); s.reset(30, 5, 0.3); s.kick(26, -2, 3.5, 0, 0, 20);
    let t = 0; while (s.x < HALF_L && t < 5) { s.step(1 / 120); t += 1 / 120; }
    expect(Math.abs(s.y - p.y)).toBeLessThan(0.6);
    expect(Math.abs(t - p.t)).toBeLessThan(0.1);
  });
});
