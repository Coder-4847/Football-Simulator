import { BALL_R, GOAL_DEPTH, GOAL_H, GRAVITY, HALF_GOAL, HALF_L, POST_R } from './constants';
import { clamp } from '../core/math';

export interface Surface {
  /** kinetic friction coefficient between ball and grass */
  mu: number;
  /** extra rolling decel (m/s^2) */
  roll: number;
  /** vertical restitution */
  bounce: number;
  /** air density multiplier (rain/fog slightly) */
  air: number;
}

export const SURFACES = {
  dry: { mu: 0.5, roll: 0.55, bounce: 0.62, air: 1 },
  wet: { mu: 0.3, roll: 0.2, bounce: 0.58, air: 1 },
  snow: { mu: 0.62, roll: 1.5, bounce: 0.35, air: 1.05 },
} satisfies Record<string, Surface>;

export type BallEventKind = 'post' | 'bar' | 'bounce' | 'net' | 'groundHit';
export interface BallEvent { kind: BallEventKind; speed: number }

const K_DRAG = 0.0132;   // 0.5*rho*Cd*A/m
const K_MAGNUS = 0.0045; // accel per (rad/s * m/s)
const I_FACTOR = 2.5;    // 1 + m r^2 / I for a thin spherical shell

export class Ball {
  x = 0; y = 0; z = BALL_R;
  vx = 0; vy = 0; vz = 0;
  wx = 0; wy = 0; wz = 0; // angular velocity (rad/s)
  // render interpolation
  px = 0; py = 0; pz = BALL_R;
  /** rotation accumulated for render (quaternion-free: axis-angle integrated by caller) */
  surface: Surface = SURFACES.dry;
  /** 0..1, how much knuckle (low-spin instability) is applied this flight */
  knuckle = 0;
  private knuckleT = 0;
  onEvent: ((e: BallEvent) => void) | null = null;
  inNet = false;
  /** seconds the ball stays put after a kick is scheduled (animation sync) */
  frozen = 0;

  reset(x = 0, y = 0, z = BALL_R): void {
    this.x = this.px = x; this.y = this.py = y; this.z = this.pz = z;
    this.vx = this.vy = this.vz = 0;
    this.wx = this.wy = this.wz = 0;
    this.knuckle = 0; this.inNet = false; this.frozen = 0;
  }

  speed(): number { return Math.hypot(this.vx, this.vy, this.vz); }
  speedXY(): number { return Math.hypot(this.vx, this.vy); }
  onGround(): boolean { return this.z <= BALL_R + 0.02; }

  /** Sets velocity and spin for a strike. spin is (wx, wy, wz) in rad/s. */
  kick(vx: number, vy: number, vz: number, wx = 0, wy = 0, wz = 0, knuckle = 0): void {
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.wx = wx; this.wy = wy; this.wz = wz;
    this.knuckle = knuckle; this.knuckleT = 0;
    this.inNet = false;
  }

  savePrev(): void { this.px = this.x; this.py = this.y; this.pz = this.z; }

  step(dt: number): void {
    if (this.frozen > 0) { this.frozen -= dt; return; }
    const s = this.surface;
    // gravity
    this.vz -= GRAVITY * dt;

    // aerodynamic drag
    const sp = this.speed();
    if (sp > 1e-6) {
      const d = K_DRAG * s.air * sp * dt;
      const f = Math.max(0, 1 - d);
      this.vx *= f; this.vy *= f; this.vz *= f;
    }
    // Magnus: a = K * (w x v)
    if (this.z > BALL_R + 0.05) {
      const ax = this.wy * this.vz - this.wz * this.vy;
      const ay = this.wz * this.vx - this.wx * this.vz;
      const az = this.wx * this.vy - this.wy * this.vx;
      this.vx += ax * K_MAGNUS * dt; this.vy += ay * K_MAGNUS * dt; this.vz += az * K_MAGNUS * dt;
      const sd = Math.exp(-0.25 * dt);
      this.wx *= sd; this.wy *= sd; this.wz *= sd;
      // knuckle: erratic lateral force when the ball has little spin
      if (this.knuckle > 0 && sp > 12) {
        this.knuckleT += dt;
        const n = Math.sin(this.knuckleT * 17.3) * Math.cos(this.knuckleT * 9.1);
        const m = Math.hypot(this.vx, this.vy) || 1;
        this.vx += (-this.vy / m) * n * 7 * this.knuckle * dt;
        this.vy += (this.vx / m) * n * 7 * this.knuckle * dt;
        this.vz += Math.sin(this.knuckleT * 13.7) * 3 * this.knuckle * dt;
      }
    }

    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;

    this.collideGoal();
    this.collideGround(dt);
  }

  private collideGround(dt: number): void {
    const s = this.surface;
    if (this.z > BALL_R) return;
    this.z = BALL_R;
    const vzIn = this.vz;
    if (vzIn < -0.8) {
      const e = s.bounce;
      this.vz = -vzIn * e;
      // tangential friction impulse with spin coupling
      const r = BALL_R;
      const cx = this.vx - this.wy * r, cy = this.vy + this.wx * r;
      const cm = Math.hypot(cx, cy);
      if (cm > 1e-6) {
        const jMax = s.mu * (1 + e) * -vzIn;
        const j = Math.min(jMax, cm / I_FACTOR);
        const dx = cx / cm, dy = cy / cm;
        this.vx -= j * dx; this.vy -= j * dy;
        this.wx += (-1.5 * j * dy) / r; this.wy += (1.5 * j * dx) / r;
      }
      this.onEvent?.({ kind: 'bounce', speed: -vzIn });
    } else {
      this.vz = 0;
      // rolling / sliding on the ground
      const r = BALL_R;
      const cx = this.vx - this.wy * r, cy = this.vy + this.wx * r;
      const cm = Math.hypot(cx, cy);
      if (cm > 0.35) {
        const j = Math.min(s.mu * GRAVITY * dt, cm / I_FACTOR);
        const dx = cx / cm, dy = cy / cm;
        this.vx -= j * dx; this.vy -= j * dy;
        this.wx += (-1.5 * j * dy) / r; this.wy += (1.5 * j * dx) / r;
      } else {
        // pure rolling: keep spin consistent with velocity
        this.wy = this.vx / r; this.wx = -this.vy / r;
      }
      const v = Math.hypot(this.vx, this.vy);
      if (v > 0) {
        const nv = Math.max(0, v - s.roll * dt * (v < 3 ? 1.6 : 1));
        const k = nv / v;
        this.vx *= k; this.vy *= k;
        if (nv < 0.05) { this.vx = this.vy = 0; this.wx = this.wy = 0; }
      }
      this.wz *= Math.exp(-2 * dt);
    }
  }

  /** Goal frame (posts, bar) and net (back, sides, top). Goals at x = ±HALF_L. */
  private collideGoal(): void {
    for (const sgn of [-1, 1]) {
      const gx = sgn * HALF_L;
      const near = Math.abs(this.x - gx) < GOAL_DEPTH + 1 && Math.abs(this.y) < HALF_GOAL + 1;
      if (!near) continue;
      // posts: vertical cylinders at (gx, ±HALF_GOAL)
      for (const py of [-HALF_GOAL, HALF_GOAL]) {
        const dx = this.x - gx, dy = this.y - py;
        const d = Math.hypot(dx, dy);
        const minD = BALL_R + POST_R;
        if (d < minD && this.z < GOAL_H + 0.1 && d > 1e-6) {
          const nx = dx / d, ny = dy / d;
          this.x = gx + nx * minD; this.y = py + ny * minD;
          const vn = this.vx * nx + this.vy * ny;
          if (vn < 0) {
            const sp = this.speed();
            this.vx -= 1.55 * vn * nx; this.vy -= 1.55 * vn * ny;
            this.vx *= 0.97; this.vy *= 0.97;
            this.onEvent?.({ kind: 'post', speed: sp });
          }
        }
      }
      // crossbar: horizontal cylinder along y at (gx, z = GOAL_H)
      if (Math.abs(this.y) <= HALF_GOAL + POST_R) {
        const dx = this.x - gx, dz = this.z - GOAL_H;
        const d = Math.hypot(dx, dz);
        const minD = BALL_R + POST_R;
        if (d < minD && d > 1e-6) {
          const nx = dx / d, nz = dz / d;
          this.x = gx + nx * minD; this.z = GOAL_H + nz * minD;
          const vn = this.vx * nx + this.vz * nz;
          if (vn < 0) {
            const sp = this.speed();
            this.vx -= 1.5 * vn * nx; this.vz -= 1.5 * vn * nz;
            this.onEvent?.({ kind: 'bar', speed: sp });
          }
        }
      }
      // net volume: behind the goal line, between posts, under the bar
      const behind = (this.x - gx) * sgn; // depth beyond the line
      const inside = behind > -BALL_R && Math.abs(this.y) < HALF_GOAL + 0.05 && this.z < GOAL_H + 0.3 && behind < GOAL_DEPTH + 0.5;
      if (behind > 0 && inside) this.inNet = true;
      else if (!inside || behind < -0.3) { if (this.inNet && (!inside)) this.inNet = false; }
      if (this.inNet && inside) {
        const back = gx + sgn * GOAL_DEPTH;
        let hit = false;
        if ((this.x - back) * sgn > -BALL_R) { this.x = back - sgn * BALL_R; this.vx *= -0.08; this.vy *= 0.35; this.vz *= 0.35; hit = true; }
        if (this.y > HALF_GOAL - BALL_R) { this.y = HALF_GOAL - BALL_R; this.vy *= -0.1; this.vx *= 0.5; hit = true; }
        if (this.y < -HALF_GOAL + BALL_R) { this.y = -HALF_GOAL + BALL_R; this.vy *= -0.1; this.vx *= 0.5; hit = true; }
        if (this.z > GOAL_H + 0.25 - BALL_R) { this.z = GOAL_H + 0.25 - BALL_R; this.vz = -Math.abs(this.vz) * 0.1; hit = true; }
        if (hit) this.onEvent?.({ kind: 'net', speed: this.speed() });
        // netting drag
        const f = Math.exp(-3.5 * (1 / 120));
        this.vx *= f; this.vy *= f;
      }
    }
  }
}

/** Does the ball (whole ball) lie over the line between the posts and under the bar? Returns the scoring side or null. */
export function goalScored(b: Ball): 0 | 1 | null {
  if (Math.abs(b.y) >= HALF_GOAL - 0.02 || b.z >= GOAL_H) return null;
  if (b.x > HALF_L + BALL_R) return 0;   // home attacks +x in half 1 (caller maps by period)
  if (b.x < -HALF_L - BALL_R) return 1;
  return null;
}

/**
 * Time-stepped prediction of where the ball crosses a vertical plane x = planeX.
 * Returns { t, y, z } or null if it never reaches it within tMax. Uses the same physics as Ball.
 */
export function predictCrossing(b: Ball, planeX: number, tMax = 3, dt = 1 / 60): { t: number; y: number; z: number; vz: number } | null {
  let x = b.x, y = b.y, z = b.z, vx = b.vx, vy = b.vy, vz = b.vz;
  const wx = b.wx, wy = b.wy, wz = b.wz;
  const dir = Math.sign(planeX - x);
  if (dir === 0) return { t: 0, y, z, vz };
  if (Math.sign(vx) !== dir && Math.abs(vx) < 0.1) return null;
  for (let t = 0; t < tMax; t += dt) {
    vz -= GRAVITY * dt;
    const sp = Math.hypot(vx, vy, vz);
    const f = Math.max(0, 1 - K_DRAG * sp * dt);
    vx *= f; vy *= f; vz *= f;
    if (z > BALL_R + 0.05) {
      const ax = wy * vz - wz * vy, ay = wz * vx - wx * vz, az = wx * vy - wy * vx;
      vx += ax * K_MAGNUS * dt; vy += ay * K_MAGNUS * dt; vz += az * K_MAGNUS * dt;
    }
    const nx = x + vx * dt;
    if ((nx - planeX) * dir >= 0) {
      const u = (planeX - x) / (nx - x || 1);
      return { t: t + u * dt, y: y + (vy * dt) * u, z: Math.max(BALL_R, z + vz * dt * u), vz };
    }
    x = nx; y += vy * dt; z += vz * dt;
    if (z < BALL_R) { z = BALL_R; vz = -vz * 0.6; vx *= 0.92; vy *= 0.92; if (Math.abs(vz) < 0.8) vz = 0; }
  }
  return null;
}

/**
 * Initial ground speed needed so a rolling ball arrives `dist` metres away with speed `arrive`.
 * Matches Ball's rolling model closely enough for pass weighting (verified in tests).
 */
export function rollSpeedFor(dist: number, arrive: number, surface: Surface = SURFACES.dry): number {
  const sim = (v0: number): number => {
    let v = v0, d = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 600 && d < dist; i++) {
      const drag = K_DRAG * surface.air * v * v;
      const roll = surface.roll * (v < 3 ? 1.6 : 1);
      v = Math.max(0, v - (drag + roll) * dt);
      d += v * dt;
      if (v <= 0) return 0;
    }
    return d >= dist ? v : 0;
  };
  let lo = Math.max(arrive, 0.5), hi = 45;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (sim(mid) > arrive) hi = mid; else lo = mid;
  }
  return clamp((lo + hi) / 2, 1, 45);
}
