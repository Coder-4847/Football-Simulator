import { AmbientLight, Color, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer, ACESFilmicToneMapping } from 'three';
import { buildHumanoid } from '../animation/rig';
import { applyPose, PoseState, type PoseInput } from '../animation/pose';
import { shirtTexture } from '../render/kits';

/** Debug page: a row of rigs each frozen in a different state to check the procedural animation. */
export function poseGrid(canvas: HTMLCanvasElement): void {
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 0.8;
  const scene = new Scene(); scene.background = new Color('#8aa6c8');
  const sun = new DirectionalLight(0xffffff, 2.5); sun.position.set(5, 10, 8); scene.add(sun, new AmbientLight(0xffffff, 0.7));
  const ground = new Mesh(new PlaneGeometry(60, 20), new MeshStandardMaterial({ color: '#2f7a2f' })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const states: Array<[string, Partial<PoseInput>]> = [
    ['idle', {}], ['run', { speed: 5, stride: 0.1 }], ['sprint', { speed: 9, stride: 0.35 }], ['kick-back', { state: 'kick', stateT: 0.05, stateDur: 0.34 }], ['kick-strike', { state: 'kick', stateT: 0.13, stateDur: 0.34 }],
    ['kick-follow', { state: 'kick', stateT: 0.25, stateDur: 0.34 }], ['tackle', { state: 'tackle', stateT: 0.2, stateDur: 0.5 }], ['slide', { state: 'slide', stateT: 0.4, stateDur: 0.95 }], ['header', { state: 'jump', stateT: 0.35, stateDur: 0.7 }],
    ['dive', { state: 'dive', stateT: 0.5, stateDur: 1, diveSide: 1, diveHeight: 1.2, isKeeper: true }], ['down', { state: 'down', stateT: 0.6, stateDur: 1.5 }], ['celebrate1', { state: 'celebrate', celebrateId: 1 }], ['celebrate2', { state: 'celebrate', celebrateId: 2 }],
    ['stepover', { state: 'skill', skillAnim: 'stepOver', skillU: 0.5, stateDur: 0.55 }], ['throw', { state: 'throw', stateT: 0.4, stateDur: 0.6 }], ['keeper', { isKeeper: true }],
  ];
  const base: PoseInput = {
    state: 'normal', stateName: '', stateT: 0, stateDur: 0, speed: 0, maxSpeed: 9, stride: 0, turn: 0, accel: 0, hasBall: false, ballSide: 'R', dominantFoot: 'R', weakFoot: 4, isKeeper: false, tired: 0, ballLocal: null,
    skillAnim: null, skillU: 0, skillSide: 1, diveSide: 1, diveHeight: 1, celebrateId: 0, celebrateT: 1, role: 'player', armUp: 0, flag: 0, seed: 1, time: 1, kickPower: 0.6,
  };
  const rigs = states.map(([, over], i) => {
    const rig = buildHumanoid({ look: { skin: 1, hairStyle: 1, hairColor: 1, beard: 0, bootColor: 0, tattoo: false, sleeves: false }, bodyType: 'normal', heightCm: 180, shirt: shirtTexture({ primary: '#c0392b', secondary: '#f1c40f', pattern: 'stripes' }), shorts: '#111827', socks: '#c0392b', isKeeper: !!(over as { isKeeper?: boolean }).isKeeper, shirtColor: '#c0392b', longSleeves: false, number: i + 1, name: 'TEST' });
    rig.root.position.set((i - states.length / 2) * 2.2, 0, 0); rig.root.rotation.y = 0; scene.add(rig.root);
    return { rig, ps: new PoseState(), over };
  });
  const cam = new PerspectiveCamera(40, 2, 0.1, 100); cam.position.set(0, 3.2, 14); cam.lookAt(new Vector3(0, 1, 0));
  const focus = new URLSearchParams(location.search).get('focus');
  if (focus !== null) { const i = Number(focus); cam.position.set((i - states.length / 2) * 2.2 + 0.0, 1.3, 4.2); cam.lookAt((i - states.length / 2) * 2.2, 0.9, 0); }
  const resize = (): void => { const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  resize(); window.addEventListener('resize', resize);
  const ball = new Vector3(0, 0.11, 0.5);
  const tick = (): void => {
    for (const { rig, ps, over } of rigs) {
      const inp = { ...base, ...over };
      for (let k = 0; k < 30; k++) applyPose(rig, inp, ps, 1 / 30, new URLSearchParams(location.search).has('noik') ? null : new Vector3(rig.root.position.x + 0.3, 0.11, 0.9));
      const ud = rig.root.userData as { pitch?: number; roll?: number; dy?: number };
      rig.root.rotation.order = 'YXZ'; rig.root.position.y = ud.dy ?? 0; rig.root.rotation.set(ud.pitch ?? 0, 0.5, ud.roll ?? 0);
    }
    renderer.render(scene, cam);
  };
  tick();
  (window as unknown as { __pose: () => void; __rigs: unknown }).__pose = tick;
  (window as unknown as { __rigs: unknown }).__rigs = rigs;
}
