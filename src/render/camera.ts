import { clamp, lerp } from '../core/math';
import { HALF_L, HALF_W } from '../match/constants';
import type { Match } from '../match/match';

export type CameraMode = 'broadcast' | 'tele' | 'coop' | 'endToEnd' | 'player' | 'drone' | 'mobile' | 'pro';
export const CAMERA_MODES: Array<{ id: CameraMode; name: string }> = [
  { id: 'drone', name: 'Full pitch (goal to goal)' }, { id: 'tele', name: 'Wide follow' }, { id: 'broadcast', name: 'Close follow' },
];

/** Visible pitch width in metres for each mode (before the zoom setting). */
const BASE_WIDTH: Record<CameraMode, number> = { broadcast: 58, tele: 82, coop: 72, endToEnd: 58, player: 40, drone: 124, mobile: 46, pro: 40 };

export interface Cinematic {
  kind: 'goal' | 'replay' | 'intro' | 'lineup' | 'halftime' | 'fulltime' | 'tunnel' | 'custom';
  t: number;
  duration: number;
  /** replay angle index (alternates close / wide framing) */
  angle?: number;
}

interface Damp { v: number }

function smoothDamp(cur: number, target: number, vel: Damp, smooth: number, dt: number): number {
  const omega = 2 / Math.max(0.0001, smooth);
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const tmp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * tmp) * e;
  return target + (change + tmp) * e;
}

/** Top-down camera: world metres → CSS pixels. Follows the ball and the controlled player, with set-piece and cinematic framing. */
export class CameraDirector {
  mode: CameraMode = 'broadcast';
  heightScale = 1;
  zoomScale = 1;
  /** top-down: screen-up is always -y, so the stick needs no rotation */
  readonly inputYaw = 0;
  cinematic: Cinematic | null = null;
  /** world point at the centre of the view */
  x = 0; y = 0;
  /** pixels per metre (CSS px) */
  scale = 12;
  viewW = 1280; viewH = 720;
  private vx: Damp = { v: 0 }; private vy: Damp = { v: 0 };
  private width = 62;
  private widthVel: Damp = { v: 0 };
  private shake = 0;
  private punchZ = 0;
  private lookX = 0; private lookY = 0;
  private prevBx = 0; private prevBy = 0;
  private bvx = 0; private bvy = 0;
  private faceLook = 0;
  /** shake offset in metres for this frame */
  shakeX = 0; shakeY = 0;
  /** debugging aid: pin the camera to a point */
  debugFocus: { x: number; y: number; width?: number } | null = null;

  setMode(m: CameraMode): void { this.mode = m; }
  setView(w: number, h: number): void { this.viewW = w; this.viewH = h; }
  addShake(a: number): void { this.shake = Math.min(1.2, this.shake + a); }
  /** quick zoom-in kick that eases back out (shots, goals) */
  punch(a: number): void { this.punchZ = Math.min(0.12, this.punchZ + a); }

  snap(x: number, y: number): void { this.x = x; this.y = y; this.vx.v = 0; this.vy.v = 0; }

  update(dt: number, match: Match, ball: { x: number; y: number }): void {
    dt = Math.min(dt, 0.05);
    // ball velocity (smoothed) for look-ahead, independent of replay/live source
    if (dt > 0) {
      const ivx = (ball.x - this.prevBx) / dt, ivy = (ball.y - this.prevBy) / dt;
      const k = 1 - Math.exp(-4 * dt);
      if (Math.hypot(ivx, ivy) < 60) { this.bvx += (ivx - this.bvx) * k; this.bvy += (ivy - this.bvy) * k; }
    }
    this.prevBx = ball.x; this.prevBy = ball.y;

    const cin = this.cinematic;
    const aspect = this.viewW / Math.max(1, this.viewH);
    const follow = this.mode !== 'drone';
    let tx = 0, ty = 0;
    // the default view shows the whole pitch goal to goal; follow modes track the ball
    let width = follow ? BASE_WIDTH[this.mode] * this.zoomScale : Math.max(BASE_WIDTH.drone * this.zoomScale, (HALF_W * 2 + 12) * aspect);
    let smooth = 0.45;
    if (cin) {
      switch (cin.kind) {
        case 'goal': {
          const s = match.goalInfo?.scorer;
          if (s) { tx = s.x * 0.8; ty = s.y * 0.8; }
          width = follow ? lerp(44, 34, clamp(cin.t / 3, 0, 1)) : lerp(104, 84, clamp(cin.t / 3, 0, 1)); smooth = 0.6; break;
        }
        case 'replay': { tx = ball.x + this.bvx * 0.25; ty = ball.y + this.bvy * 0.25; width = ((cin.angle ?? 0) % 2 === 0 ? 52 : 34) * this.zoomScale; smooth = 0.4; break; }
        case 'halftime': case 'fulltime': case 'lineup': case 'intro': case 'tunnel': { tx = 0; ty = 0; width = Math.max(width, 118); smooth = 0.9; break; }
        default: break;
      }
    } else if (follow) {
      const lead = clamp(Math.hypot(this.bvx, this.bvy) / 30, 0, 1);
      const la = 0.42 + lead * 0.25;
      tx = ball.x + clamp(this.bvx * la, -13, 13); ty = ball.y + clamp(this.bvy * la, -7, 7);
      width *= 1 + lead * 0.1;
      smooth = 0.32;
    }
    void match;
    if (this.debugFocus) { tx = this.debugFocus.x; ty = this.debugFocus.y; if (this.debugFocus.width) width = this.debugFocus.width; }
    width = clamp(width, 14, 190);
    this.width = smoothDamp(this.width, width, this.widthVel, cin ? 0.7 : 0.55, dt);
    // clamp to the stadium so we never look outside it
    const halfW = this.width / 2, halfH = this.width / aspect / 2;
    const bx = HALF_L + 26, by = HALF_W + 19;
    tx = bx - halfW > 0 ? clamp(tx, -(bx - halfW), bx - halfW) : 0;
    ty = by - halfH > 0 ? clamp(ty, -(by - halfH), by - halfH) : 0;
    this.x = smoothDamp(this.x, tx, this.vx, smooth, dt);
    this.y = smoothDamp(this.y, ty, this.vy, smooth, dt);

    this.punchZ *= Math.exp(-5 * dt);
    this.shake *= Math.exp(-7 * dt);
    const sk = this.shake > 0.01 ? this.shake : 0;
    this.shakeX = sk ? (Math.random() - 0.5) * sk * 0.9 : 0; this.shakeY = sk ? (Math.random() - 0.5) * sk * 0.9 : 0;
    // scale: fit the width, but never show less than ~22 m vertically
    const wantScale = this.viewW / this.width;
    this.scale = Math.min(wantScale, this.viewH / 22) * (1 + this.punchZ);
    void this.faceLook; void this.lookX; void this.lookY;
  }

  /** World → CSS pixel. */
  toScreenX(x: number): number { return (x + this.shakeX - this.x) * this.scale + this.viewW / 2; }
  toScreenY(y: number): number { return (y + this.shakeY - this.y) * this.scale + this.viewH / 2; }
}
