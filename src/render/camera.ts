import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp, lerp } from '../core/math';
import { HALF_L, HALF_W } from '../match/constants';
import type { Match } from '../match/match';
import type { MPlayer } from '../match/entities';

export type CameraMode = 'broadcast' | 'tele' | 'coop' | 'endToEnd' | 'player' | 'drone' | 'mobile' | 'pro';
export const CAMERA_MODES: Array<{ id: CameraMode; name: string }> = [
  { id: 'broadcast', name: 'Broadcast' }, { id: 'tele', name: 'Tele' }, { id: 'coop', name: 'Co-op' }, { id: 'endToEnd', name: 'End-to-end' },
  { id: 'player', name: 'Player cam' }, { id: 'drone', name: 'Drone' }, { id: 'mobile', name: 'Wide-tall (mobile)' }, { id: 'pro', name: 'Pro cam' },
];

export interface Cinematic {
  kind: 'goal' | 'replay' | 'intro' | 'lineup' | 'halftime' | 'fulltime' | 'tunnel' | 'custom';
  t: number;
  duration: number;
  /** replay angle index */
  angle?: number;
  target?: Vector3;
  from?: Vector3;
}

/** Smooth camera controller with gameplay modes and cinematic shots. */
export class CameraDirector {
  readonly camera = new PerspectiveCamera(32, 16 / 9, 0.5, 900);
  mode: CameraMode = 'broadcast';
  heightScale = 1;
  zoomScale = 1;
  /** angle between screen-up and the pitch's -y axis; used to rotate the stick so up means "away from camera" */
  inputYaw = 0;
  cinematic: Cinematic | null = null;
  private focus = new Vector3();
  private focusVel = new Vector3();
  private pos = new Vector3(0, 30, 40);
  private look = new Vector3();
  private fov = 32;
  private shake = 0;
  private tmp = new Vector3();
  private dp = new Vector3();
  private dl = new Vector3();
  private sbvx = 0;
  private sbvz = 0;
  private playerFace = 0;
  private lastSet = '';

  addShake(a: number): void { this.shake = Math.min(1, this.shake + a); }

  setMode(m: CameraMode): void { this.mode = m; }

  private ballFocus(match: Match, ax: number, az: number, lookAhead: number): Vector3 {
    const b = match.ball;
    const x = ax + this.sbvx * lookAhead, z = az + this.sbvz * lookAhead;
    return this.tmp.set(clamp(x, -HALF_L - 6, HALF_L + 6), 0, clamp(z, -HALF_W - 4, HALF_W + 4));
  }

  update(dt: number, match: Match, alpha: number, controlled: MPlayer | null): void {
    const b = match.ball;
    const bx = b.px + (b.x - b.px) * alpha, bz = b.py + (b.y - b.py) * alpha;
    let desiredPos = this.pos, desiredLook = this.look, desiredFov = this.fov;
    let lambda = 3.4;
    const hs = this.heightScale, zs = this.zoomScale;
    const set = match.sp && match.sp.phase !== 'done' ? match.sp : null;
    const dir = controlled ? match.teams[controlled.side].dir : match.teams[0].dir;
    const cin = this.cinematic;
    const dp = this.dp, dl = this.dl;
    const kv = 1 - Math.exp(-3.5 * dt);
    this.sbvx += (b.vx - this.sbvx) * kv; this.sbvz += (b.vy - this.sbvz) * kv;

    if (cin) {
      this.cinematicShot(cin, match, bx, bz, dp, dl);
      desiredFov = cin.kind === 'goal' ? 34 : 38;
      lambda = cin.kind === 'replay' ? 5 : 3.2;
    } else if (set && match.phase !== 'intro' && this.setpieceCam(match, set, controlled, dp, dl)) {
      desiredFov = set.type === 'penalty' ? 38 : 40;
      lambda = 4;
    } else {
      switch (this.mode) {
        case 'tele': {
          const f = this.ballFocus(match, bx, bz, 0.45);
          dp.set(f.x * 0.9, 17 * hs, f.z * 0.2 + 70 * zs); dl.set(f.x, 0, f.z * 0.85); desiredFov = 20; lambda = 2.4; break;
        }
        case 'coop': {
          const f = this.ballFocus(match, bx, bz, 0.4);
          dp.set(f.x * 0.55 - dir * 58, 26 * hs, f.z * 0.55 + 6); dl.set(f.x + dir * 6, 0, f.z * 0.8); desiredFov = 44; lambda = 2.6; break;
        }
        case 'endToEnd': {
          const f = this.ballFocus(match, bx, bz, 0.4);
          dp.set(f.x - dir * 36 * zs, 14 * hs, f.z * 0.55); dl.set(f.x + dir * 9, 0, f.z * 0.9); desiredFov = 46; lambda = 3; break;
        }
        case 'player': {
          if (controlled) {
            this.playerFace += angleLerp(this.playerFace, Math.atan2(controlled.vy, controlled.vx) || controlled.face, controlled.speed > 1 ? 1.5 * dt : 0.4 * dt);
            const px = controlled.px + (controlled.x - controlled.px) * alpha, pz = controlled.py + (controlled.y - controlled.py) * alpha;
            const f = this.playerFace;
            dp.set(px - Math.cos(f) * 7.5 * zs, 3.4 * hs, pz - Math.sin(f) * 7.5 * zs);
            dl.set(px + Math.cos(f) * 12, 1, pz + Math.sin(f) * 12);
            desiredFov = 56; lambda = 5; break;
          }
          this.simpleBroadcast(bx, bz, hs, zs, dp, dl); break;
        }
        case 'drone': {
          const f = this.ballFocus(match, bx, bz, 0.4);
          dp.set(f.x, 62 * hs, f.z + 22 * zs); dl.set(f.x, 0, f.z); desiredFov = 46; lambda = 3.2; break;
        }
        case 'mobile': {
          const f = this.ballFocus(match, bx, bz, 0.45);
          dp.set(f.x * 0.92, 21 * hs, f.z * 0.25 + 27 * zs); dl.set(f.x, 0, f.z * 0.9 - 2); desiredFov = 44; lambda = 3.4; break;
        }
        case 'pro': {
          if (controlled) {
            const px = controlled.x, pz = controlled.y;
            const ang = Math.atan2(bz - pz, bx - px);
            dp.set(px - Math.cos(ang) * 9 * zs, 4.6 * hs, pz - Math.sin(ang) * 9 * zs);
            dl.set((px + bx) / 2 + Math.cos(ang) * 3, 0.6, (pz + bz) / 2 + Math.sin(ang) * 3); desiredFov = 52; lambda = 4.5; break;
          }
          this.simpleBroadcast(bx, bz, hs, zs, dp, dl); break;
        }
        default: {
          const f = this.ballFocus(match, bx, bz, 0.4);
          // zoom out a touch for fast ball
          const spd = clamp(match.ball.speed() / 38, 0, 1);
          dp.set(f.x * 0.88, 25 * hs * (1 + spd * 0.06), f.z * 0.22 + 38 * zs * (1 + spd * 0.08)); dl.set(f.x, 0, f.z * 0.88); desiredFov = 32;
        }
      }
    }
    // critically-damped follow
    const k = 1 - Math.exp(-lambda * dt);
    desiredPos = dp; desiredLook = dl;
    this.pos.lerp(desiredPos, k); this.look.lerp(desiredLook, 1 - Math.exp(-(lambda + 1.5) * dt));
    this.fov = lerp(this.fov, desiredFov, 1 - Math.exp(-3 * dt));
    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake *= Math.exp(-6 * dt);
    }
    this.camera.lookAt(this.look);
    this.camera.fov = this.fov * (this.mode === 'broadcast' && !cin ? 1 / Math.sqrt(zs) : 1);
    this.camera.updateProjectionMatrix();

    // stick rotation: forward vector projected on the pitch
    const fx = this.look.x - this.pos.x, fz = this.look.z - this.pos.z;
    if (Math.hypot(fx, fz) > 0.5) {
      const ang = Math.atan2(fz, fx);
      this.inputYaw = ang - -Math.PI / 2;
    }
    void damp;
  }

  private simpleBroadcast(bx: number, bz: number, hs: number, zs: number, dp: Vector3, dl: Vector3): void {
    dp.set(bx * 0.88, 25 * hs, bz * 0.22 + 38 * zs); dl.set(bx, 0, bz * 0.88);
  }

  private setpieceCam(m: Match, sp: NonNullable<Match['sp']>, controlled: MPlayer | null, dp: Vector3, dl: Vector3): boolean {
    const att = m.teams[sp.side].dir;
    const goalX = att * HALF_L;
    switch (sp.type) {
      case 'corner': {
        const cs = Math.sign(sp.y) || 1;
        dp.set(sp.x - att * 14, 5.5 * this.heightScale, sp.y + cs * 14); dl.set(goalX - att * 8, 1.5, 0); return true;
      }
      case 'freeKick': case 'indirectFreeKick': {
        const dist = Math.hypot(goalX - sp.x, sp.y);
        if (dist > 38) return false;
        const ang = Math.atan2(-sp.y, goalX - sp.x);
        dp.set(sp.x - Math.cos(ang) * 11 * this.zoomScale, 3.0 * this.heightScale, sp.y - Math.sin(ang) * 11 * this.zoomScale);
        dl.set(goalX, 1.4, 0); return true;
      }
      case 'penalty': {
        const spotX = goalX - att * 11;
        dp.set(spotX - att * 15, 3.4 * this.heightScale, 6); dl.set(goalX, 1.1, -0.5); return true;
      }
      case 'goalKick': {
        const own = -att * HALF_L;
        dp.set(own - att * 30, 12 * this.heightScale, 14); dl.set(own + att * 14, 0, 0); return true;
      }
      default: void controlled; return false;
    }
  }

  private cinematicShot(c: Cinematic, m: Match, bx: number, bz: number, dp: Vector3, dl: Vector3): void {
    c.t += 0;
    const gi = m.goalInfo;
    switch (c.kind) {
      case 'goal': {
        const s = gi?.scorer;
        const sx = s ? s.x : bx, sz = s ? s.y : bz;
        const a = (c.t * 0.35) + 0.8;
        dp.set(sx + Math.cos(a) * 9, 2.2, sz + Math.sin(a) * 9); dl.set(sx, 1.2, sz); break;
      }
      case 'replay': {
        const ang = (c.angle ?? 0) % 3;
        if (ang === 0) { dp.set(bx * 0.85, 12, 36); dl.set(bx, 0.5, bz * 0.9); }
        else if (ang === 1) { dp.set(bx + 18, 5, bz + 14 * Math.sign(bz || 1)); dl.set(bx, 0.8, bz); }
        else { dp.set(bx - Math.sign(bx || 1) * 24, 9, bz * 0.4); dl.set(bx, 0.8, bz); }
        break;
      }
      case 'halftime': case 'fulltime': { dp.set(0, 60, 80); dl.set(0, 0, 0); break; }
      case 'intro': { dp.set(c.from?.x ?? -70, 8, 50); dl.set(c.target?.x ?? 0, 1, 0); break; }
      case 'tunnel': { dp.set(0, 1.5, HALF_W + 4); dl.set(0, 1.5, HALF_W + 14); break; }
      case 'lineup': { dp.set(0, 6, 28); dl.set(0, 1, 0); break; }
      default: { dp.copy(c.from ?? this.pos); dl.copy(c.target ?? this.look); }
    }
  }

  snapTo(pos: Vector3, look: Vector3): void { this.pos.copy(pos); this.look.copy(look); }
}

function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return d * clamp(t, 0, 1);
}
export { Vector3 };
