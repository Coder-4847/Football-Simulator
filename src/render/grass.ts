import { BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshLambertMaterial, Object3D } from 'three';
import { HALF_L, HALF_W } from '../match/constants';

/** Blade-level grass that follows the camera focus; positions derive from a world grid so nothing pops when the patch moves. */
export class GrassBlades {
  readonly mesh: InstancedMesh;
  private time = { value: 0 };
  private cx = 1e9; private cz = 1e9;
  private count: number;
  private side: number;
  private spacing: number;
  private dummy = new Object3D();

  constructor(count: number, tint: string) {
    this.count = count;
    this.side = Math.sqrt(count) * 0.34 > 48 ? 48 : Math.sqrt(count) * 0.34;
    this.spacing = this.side / Math.sqrt(count);
    const g = new BufferGeometry();
    // tapered blade: 2 triangles, base width 0.03, height 0.12
    const pos = new Float32Array([-0.015, 0, 0, 0.015, 0, 0, -0.008, 0.07, 0, 0.008, 0.07, 0, 0, 0.13, 0]);
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    g.computeVertexNormals();
    const mat = new MeshLambertMaterial({ color: new Color(tint), side: DoubleSide });
    mat.onBeforeCompile = (sh): void => {
      sh.uniforms.uTime = this.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSeed; uniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n float h = position.y; float sway = sin(uTime * 1.6 + aSeed * 40.0 + instanceMatrix[3].x * 0.7) * 0.02 * h / 0.13; transformed.x += sway; transformed.z += sway * 0.6;');
    };
    this.mesh = new InstancedMesh(g, mat, count);
    const seeds = new Float32Array(count); for (let i = 0; i < count; i++) seeds[i] = Math.random();
    g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  private hash(a: number, b: number): number { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }

  update(fx: number, fz: number, dt: number): void {
    this.time.value += dt;
    const snap = 4;
    const sx = Math.round(fx / snap) * snap, sz = Math.round(fz / snap) * snap;
    if (sx === this.cx && sz === this.cz) return;
    this.cx = sx; this.cz = sz;
    const n = Math.floor(Math.sqrt(this.count));
    const x0 = Math.floor((sx - this.side / 2) / this.spacing), z0 = Math.floor((sz - this.side / 2) / this.spacing);
    let i = 0;
    for (let a = 0; a < n && i < this.count; a++) for (let b = 0; b < n && i < this.count; b++) {
      const gx = x0 + a, gz = z0 + b;
      const x = (gx + this.hash(gx, gz)) * this.spacing, z = (gz + this.hash(gz, gx + 7)) * this.spacing;
      const on = Math.abs(x) < HALF_L + 8 && Math.abs(z) < HALF_W + 7;
      this.dummy.position.set(x, on ? 0 : -5, z);
      this.dummy.rotation.set(0, this.hash(gx + 3, gz) * Math.PI * 2, 0);
      this.dummy.scale.setScalar(0.7 + this.hash(gz, gx) * 0.8);
      this.dummy.updateMatrix(); this.mesh.setMatrixAt(i++, this.dummy.matrix);
    }
    for (; i < this.count; i++) { this.dummy.position.set(0, -10, 0); this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix); }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as MeshLambertMaterial).dispose(); }
}
export { Matrix4 };
