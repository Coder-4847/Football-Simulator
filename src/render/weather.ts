import { BufferAttribute, BufferGeometry, Color, Fog, FogExp2, LineBasicMaterial, LineSegments, Points, PointsMaterial, type Scene, Vector3 } from 'three';
import { RNG } from '../core/rng';
import type { Weather } from '../match/types';

/** Rain streaks / snow flakes following the camera; fog handled through scene.fog. */
export class WeatherFx {
  private rain: LineSegments | null = null;
  private snow: Points | null = null;
  private count = 0;
  private pos!: Float32Array;
  private vel!: Float32Array;
  private rng = new RNG('weather');
  private box = new Vector3(70, 40, 70);
  kind: Weather = 'clear';

  constructor(private scene: Scene) {}

  set(kind: Weather, particles: number, night: boolean): void {
    this.dispose();
    this.kind = kind;
    const fogColor = new Color(night ? '#0a0f1c' : kind === 'snow' ? '#c9d3dc' : kind === 'rain' ? '#7d8791' : '#b8c8d8');
    if (kind === 'fog') this.scene.fog = new FogExp2(fogColor, 0.014);
    else if (kind === 'rain') this.scene.fog = new Fog(fogColor, 60, 330);
    else if (kind === 'snow') this.scene.fog = new Fog(fogColor, 50, 260);
    else this.scene.fog = night ? new Fog(fogColor, 150, 620) : new Fog(fogColor, 220, 900);
    if (kind !== 'rain' && kind !== 'snow') return;
    this.count = particles;
    this.pos = new Float32Array(this.count * 3);
    this.vel = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      this.pos[i * 3] = this.rng.float(-1, 1) * this.box.x; this.pos[i * 3 + 1] = this.rng.float(0, this.box.y); this.pos[i * 3 + 2] = this.rng.float(-1, 1) * this.box.z;
      this.vel[i * 3] = kind === 'rain' ? 2 : this.rng.float(-1, 1); this.vel[i * 3 + 1] = kind === 'rain' ? -28 - this.rng.float(0, 8) : -2.2 - this.rng.float(0, 1.2); this.vel[i * 3 + 2] = kind === 'rain' ? 1 : this.rng.float(-1, 1);
    }
    if (kind === 'rain') {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(this.count * 6), 3));
      this.rain = new LineSegments(g, new LineBasicMaterial({ color: 0xcfd8e3, transparent: true, opacity: 0.45 }));
      this.rain.frustumCulled = false; this.scene.add(this.rain);
    } else {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(this.count * 3), 3));
      this.snow = new Points(g, new PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.9, depthWrite: false }));
      this.snow.frustumCulled = false; this.scene.add(this.snow);
    }
  }

  update(dt: number, center: Vector3): void {
    if (!this.rain && !this.snow) return;
    const p = this.pos, v = this.vel;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      p[o] += v[o]! * dt; p[o + 1] += v[o + 1]! * dt; p[o + 2] += v[o + 2]! * dt;
      if (p[o + 1]! < 0) { p[o + 1] = this.box.y; p[o] = this.rng.float(-1, 1) * this.box.x; p[o + 2] = this.rng.float(-1, 1) * this.box.z; }
    }
    if (this.rain) {
      const a = (this.rain.geometry.getAttribute('position') as BufferAttribute);
      for (let i = 0; i < this.count; i++) {
        const o = i * 3, k = i * 6;
        const x = p[o]! + center.x, y = p[o + 1]!, z = p[o + 2]! + center.z;
        a.array[k] = x; a.array[k + 1] = y; a.array[k + 2] = z;
        a.array[k + 3] = x - v[o]! * 0.012; a.array[k + 4] = y - v[o + 1]! * 0.012; a.array[k + 5] = z - v[o + 2]! * 0.012;
      }
      a.needsUpdate = true;
    }
    if (this.snow) {
      const a = (this.snow.geometry.getAttribute('position') as BufferAttribute);
      for (let i = 0; i < this.count; i++) { const o = i * 3; a.array[o] = p[o]! + center.x + Math.sin(i + performance.now() * 0.0004) * 0.6; a.array[o + 1] = p[o + 1]!; a.array[o + 2] = p[o + 2]! + center.z; }
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const o of [this.rain, this.snow]) { if (o) { this.scene.remove(o); o.geometry.dispose(); (o.material as { dispose(): void }).dispose(); } }
    this.rain = null; this.snow = null;
  }
}
