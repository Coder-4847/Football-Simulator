export const TAU = Math.PI * 2;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : clamp01((v - a) / (b - a)));
export const smoothstep = (a: number, b: number, v: number): number => { const t = invLerp(a, b, v); return t * t * (3 - 2 * t); };
export const damp = (a: number, b: number, lambda: number, dt: number): number => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const sign = (v: number): number => (v < 0 ? -1 : 1);
/** Shortest signed angle difference b - a in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d <= -Math.PI) d += TAU;
  return d;
}
export function dampAngle(a: number, b: number, lambda: number, dt: number): number {
  return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
}
/** Moves `a` toward `b` by at most `maxStep` (angles). */
export function rotateToward(a: number, b: number, maxStep: number): number {
  const d = angleDiff(a, b);
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
}

export class Vec2 {
  constructor(public x = 0, public y = 0) {}
  set(x: number, y: number): this { this.x = x; this.y = y; return this; }
  copy(v: Vec2): this { this.x = v.x; this.y = v.y; return this; }
  clone(): Vec2 { return new Vec2(this.x, this.y); }
  add(v: Vec2): this { this.x += v.x; this.y += v.y; return this; }
  sub(v: Vec2): this { this.x -= v.x; this.y -= v.y; return this; }
  scale(s: number): this { this.x *= s; this.y *= s; return this; }
  addScaled(v: Vec2, s: number): this { this.x += v.x * s; this.y += v.y * s; return this; }
  len(): number { return Math.hypot(this.x, this.y); }
  lenSq(): number { return this.x * this.x + this.y * this.y; }
  dist(v: Vec2): number { return Math.hypot(this.x - v.x, this.y - v.y); }
  distSq(v: Vec2): number { const dx = this.x - v.x, dy = this.y - v.y; return dx * dx + dy * dy; }
  dot(v: Vec2): number { return this.x * v.x + this.y * v.y; }
  normalize(): this { const l = this.len(); if (l > 1e-9) { this.x /= l; this.y /= l; } else { this.x = 0; this.y = 0; } return this; }
  angle(): number { return Math.atan2(this.y, this.x); }
  setLength(l: number): this { return this.normalize().scale(l); }
  clampLength(max: number): this { const l = this.len(); if (l > max) this.scale(max / l); return this; }
  lerp(v: Vec2, t: number): this { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; return this; }
  static fromAngle(a: number, l = 1): Vec2 { return new Vec2(Math.cos(a) * l, Math.sin(a) * l); }
}
