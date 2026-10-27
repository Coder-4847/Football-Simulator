import { BoxGeometry, DirectionalLight, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import type { QualityName } from './quality';
import { isMobile } from './quality';

/** Short GPU micro-benchmark used on the first launch to pick a quality preset. */
export async function runBenchmark(): Promise<QualityName> {
  try {
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
    const r = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.shadowMap.enabled = true;
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(name)) { r.dispose(); return 'Low'; }
    const scene = new Scene(); const cam = new PerspectiveCamera(50, 16 / 9, 0.1, 200); cam.position.set(0, 12, 22); cam.lookAt(0, 0, 0);
    const sun = new DirectionalLight(0xffffff, 2); sun.position.set(10, 20, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); scene.add(sun);
    const ground = new Mesh(new PlaneGeometry(100, 100), new MeshStandardMaterial({ color: '#2f7a2f' })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const inst = new InstancedMesh(new BoxGeometry(0.6, 1.6, 0.6), new MeshStandardMaterial({ color: '#cccccc' }), 6000);
    const m = new Matrix4();
    for (let i = 0; i < 6000; i++) { m.makeTranslation((i % 100) - 50, 0.8, Math.floor(i / 100) - 30); inst.setMatrixAt(i, m); }
    inst.castShadow = true; scene.add(inst);
    const times: number[] = [];
    for (let i = 0; i < 24; i++) {
      const t0 = performance.now(); r.render(scene, cam); gl.finish();
      await new Promise<void>((res) => requestAnimationFrame(() => res()));
      if (i >= 4) times.push(performance.now() - t0);
    }
    r.dispose();
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)] ?? 16;
    const mobile = isMobile();
    if (med < 17.5) return mobile ? 'Medium' : 'High'; // paced by vsync: no slowdown
    if (med < 26) return 'Medium';
    return 'Low';
  } catch { return 'Medium'; }
}
