import {
  ACESFilmicToneMapping, AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, DirectionalLight, Group, HemisphereLight, Line, LineBasicMaterial,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFSoftShadowMap, PMREMGenerator, PerspectiveCamera, Quaternion, RingGeometry, Scene, SphereGeometry, SRGBColorSpace,
  Vector3, WebGLRenderer, PCFShadowMap, BasicShadowMap, BoxGeometry, PlaneGeometry, type Texture,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { angleDiff } from '../core/math';
import { buildHumanoid, createCanvas, type Rig } from '../animation/rig';
import { applyPose, PoseState, type PoseInput } from '../animation/pose';
import { buildCornerFlags, buildGround, GoalView, makePitchTexture, paintWear, type PitchTextures } from './pitch';
import { buildStadium, type StadiumView } from './stadium';
import { CameraDirector, type CameraMode } from './camera';
import { PostStack, type GradePreset } from './post';
import { WeatherFx } from './weather';
import { GrassBlades } from './grass';
import { shirtTexture } from './kits';
import { settings } from '../core/settings';
import { qualityFor, type Quality } from './quality';
import type { Match } from '../match/match';
import type { MPlayer, Team } from '../match/entities';
import { skillById } from '../match/skills';
import { HALF_L } from '../match/constants';
import { ANIM_LIST as ANIMS, FRAME_SIZE, PF, stateFromCode, sampleFrames } from '../match/replay';
import type { PState } from '../match/entities';
import type { TimeOfDay, Weather } from '../match/types';

export interface ViewOptions {
  quality: Quality;
  grade: GradePreset;
  cameraMode: CameraMode;
  cameraHeight: number;
  cameraZoom: number;
  showFps: boolean;
  fpsCap: number;
  celebrationSeed: number;
  trail: boolean;
}

interface RenderPlayer {
  visible: boolean; x: number; z: number; face: number;
  state: string; stateName: string; stateT: number; stateDur: number; speed: number; stride: number;
  hasBall: boolean; ballSide: 'L' | 'R'; dominantFoot: 'L' | 'R'; weakFoot: number; tired: number; keeper: boolean;
  skillAnim: string | null; skillU: number; skillSide: number; diveSide: number; diveH: number; celebT: number; kickPower: number;
}

class PlayerView {
  ps = new PoseState();
  lastFace = 0; lastSpeed = 0; turn = 0; accel = 0;
  seed = Math.random() * 10;
  celeb: number;
  shadow: Mesh | null = null;
  frame = 0;
  stride = 0;
  constructor(public rig: Rig, public readonly player: MPlayer | null, public role: 'player' | 'referee' | 'assistant' | 'bench' | 'crew' = 'player') {
    this.celeb = player ? (settings.value.gameplay.celebrations[player.data.id] ?? Math.abs(hash(player.data.id)) % 6) : 0;
  }
}

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }

function ballTexture(): CanvasTexture {
  const c = createCanvas(256, 128); const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#1b1b1f';
  const pent = (x: number, y: number, r: number): void => { g.beginPath(); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.closePath(); g.fill(); };
  for (let i = 0; i < 6; i++) pent(i * 43 + 20, 32, 11);
  for (let i = 0; i < 6; i++) pent(i * 43 + 41, 96, 11);
  pent(128, 64, 9); pent(0, 64, 9); pent(256, 64, 9);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function blobTexture(): CanvasTexture {
  const c = createCanvas(64, 64); const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export class MatchView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly director = new CameraDirector();
  readonly canvas: HTMLCanvasElement;
  private post: PostStack;
  private weather: WeatherFx;
  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private sky: Sky | null = null;
  private envTex: Texture | null = null;
  private pitch: PitchTextures;
  private ground!: Mesh;
  private goals: GoalView[] = [];
  private ballMesh: Mesh;
  private ballRot = new Quaternion();
  private trail: Line | null = null;
  private trailPts: Vector3[] = [];
  private stadium!: StadiumView;
  private views = new Map<MPlayer, PlayerView>();
  private extras: PlayerView[] = [];
  private refViews: PlayerView[] = [];
  private blob = blobTexture();
  private ballShadow: Mesh;
  private markers = new Map<number, { ring: Mesh; arrow: Mesh }>();
  private targetRing: Mesh;
  private aimGroup = new Group();
  private aimLine: Line;
  private aimRing: Mesh;
  private time = 0;
  private wearT = 0;
  private wearDirty = false;
  private crowdExcite = 0.25;
  private excitement = 0;
  private tmpV = new Vector3();
  private lastFrameTime = 0;
  replay: { frames: Float32Array[]; idx: number; speed: number; angleT: number; angle: number; done: boolean; onDone?: () => void } | null = null;
  private replayTmp = new Float32Array(FRAME_SIZE);
  private fpsSmooth = 60;
  onFrame: ((dt: number) => void) | null = null;
  private disposeFns: Array<() => void> = [];
  private quality: Quality;
  private opts: ViewOptions;
  private weatherKind: Weather;
  private tod: TimeOfDay;
  private homeKit: { primary: string; secondary: string };
  private awayKit: { primary: string; secondary: string };
  private grass: GrassBlades | null = null;
  private offsideLine: Mesh | null = null;
  private boardsT = 0;
  private jumboT = 0;
  private frameCount = 0;

  constructor(canvas: HTMLCanvasElement, readonly match: Match, opts: ViewOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.quality = opts.quality;
    this.weatherKind = match.cfg.weather;
    this.tod = match.cfg.timeOfDay;
    this.homeKit = match.teams[0].kit; this.awayKit = match.teams[1].kit;
    this.renderer = new WebGLRenderer({ canvas, antialias: opts.quality.antialias === 'msaa', powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.scene.background = new Color('#9db6d4');
    this.post = new PostStack(this.renderer, this.scene, this.director.camera);
    this.weather = new WeatherFx(this.scene);

    this.pitch = makePitchTexture(opts.quality.pitchTexture, match.cfg.weather === 'snow', match.cfg.weather === 'rain');
    this.sun = new DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new HemisphereLight(0xbfd8ff, 0x3c5a2a, 0.7);
    this.scene.add(this.hemi, new AmbientLight(0xffffff, 0.05));

    this.buildWorld();

    // ball
    this.ballMesh = new Mesh(new SphereGeometry(0.11, 24, 16), new MeshStandardMaterial({ map: ballTexture(), roughness: 0.42, metalness: 0.02 }));
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);
    this.ballShadow = new Mesh(new CircleGeometry(0.25, 16), new MeshBasicMaterial({ map: this.blob, transparent: true, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2; this.scene.add(this.ballShadow);

    // markers
    this.targetRing = new Mesh(new RingGeometry(0.55, 0.72, 32), new MeshBasicMaterial({ color: 0xb8c4d4, transparent: true, opacity: 0.4, depthWrite: false }));
    this.targetRing.rotation.x = -Math.PI / 2; this.targetRing.visible = false; this.scene.add(this.targetRing);
    const lg = new BufferGeometry(); lg.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    this.aimLine = new Line(lg, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    this.aimRing = new Mesh(new RingGeometry(0.28, 0.38, 24), new MeshBasicMaterial({ color: 0xffffff, side: 2, transparent: true, opacity: 0.9, depthTest: false }));
    this.aimGroup.add(this.aimLine, this.aimRing); this.aimGroup.visible = false; this.aimLine.frustumCulled = false;
    this.scene.add(this.aimGroup);

    this.director.heightScale = opts.cameraHeight; this.director.zoomScale = opts.cameraZoom; this.director.setMode(opts.cameraMode);
    this.setQuality(opts.quality);
    this.hookEvents();
    this.resize();
  }

  // ---------- world construction ----------

  private buildWorld(): void {
    const m = this.match;
    const wet = this.weatherKind === 'rain';
    this.ground = buildGround(this.pitch, wet);
    this.scene.add(this.ground);
    this.goals = [new GoalView(1, this.quality.netPhysics), new GoalView(-1, this.quality.netPhysics)];
    for (const g of this.goals) this.scene.add(g.group);
    this.scene.add(buildCornerFlags());
    const night = this.tod === 'night';
    this.stadium = buildStadium(m.cfg.stadiumStyle, {
      crowd: this.quality.crowd, home: this.homeKit, away: this.awayKit, night, seed: m.cfg.seed,
      capacity: 40000,
    });
    this.scene.add(this.stadium.group);
    this.applyEnvironment();
    this.buildOfficials();
  }

  private applyEnvironment(): void {
    const tod = this.tod, kind = this.weatherKind;
    const night = tod === 'night';
    // sun position
    const elev = tod === 'day' ? 52 : tod === 'dusk' ? 6.5 : 28;
    const az = tod === 'dusk' ? 250 : 130;
    const phi = ((90 - elev) * Math.PI) / 180, theta = (az * Math.PI) / 180;
    const sunDir = new Vector3().setFromSphericalCoords(1, phi, theta);
    this.sunDir = sunDir;
    this.sun.color.set(tod === 'dusk' ? '#ffb070' : night ? '#9fb7ff' : '#fff6e8');
    this.sun.intensity = night ? 0.28 : tod === 'dusk' ? 1.6 : kind === 'clear' ? 2.3 : 1.3;
    this.hemi.intensity = night ? 0.25 : tod === 'dusk' ? 0.35 : kind === 'clear' ? 0.42 : 0.6;
    this.hemi.color.set(night ? '#2a3a66' : tod === 'dusk' ? '#ff9a6e' : '#bfd8ff');
    this.hemi.groundColor.set(night ? '#0b1410' : '#3c5a2a');
    this.renderer.toneMappingExposure = night ? 0.9 : tod === 'dusk' ? 0.8 : 0.55;
    // sky
    if (this.sky) { this.scene.remove(this.sky); this.sky.geometry.dispose(); this.sky = null; }
    if (!night) {
      const sky = new Sky(); sky.scale.setScalar(3500);
      const u = sky.material.uniforms as Record<string, { value: number | Vector3 }>;
      u.turbidity!.value = kind === 'clear' ? 4 : 12; u.rayleigh!.value = tod === 'dusk' ? 2.5 : 1.4; u.mieCoefficient!.value = 0.005; u.mieDirectionalG!.value = 0.8;
      (u.sunPosition!.value as Vector3).copy(sunDir);
      this.sky = sky; this.scene.add(sky);
      if (kind === 'rain' || kind === 'fog' || kind === 'snow') this.scene.background = new Color(kind === 'snow' ? '#c9d3dc' : '#7d8791');
      // environment map for PBR reflections
      const pm = new PMREMGenerator(this.renderer);
      const envScene = new Scene(); const es = new Sky(); es.scale.setScalar(100);
      const eu = es.material.uniforms as Record<string, { value: number | Vector3 }>;
      eu.turbidity!.value = u.turbidity!.value; eu.rayleigh!.value = u.rayleigh!.value; eu.mieCoefficient!.value = 0.005; eu.mieDirectionalG!.value = 0.8; (eu.sunPosition!.value as Vector3).copy(sunDir);
      envScene.add(es);
      this.envTex?.dispose();
      const rt = pm.fromScene(envScene, 0, 0.1, 500);
      this.envTex = rt.texture; this.scene.environment = this.envTex; this.scene.environmentIntensity = kind === 'clear' ? 0.16 : 0.12;
      pm.dispose();
    } else {
      this.scene.background = new Color('#05080f');
      this.scene.environment = null;
      this.addStars();
    }
    // floodlights
    const flood = night ? 4800 : tod === 'dusk' ? 2200 : 0;
    for (const l of this.stadium.lights) { l.intensity = flood; l.angle = 0.78; l.penumbra = 0.6; l.decay = 2; }
    for (const m of this.stadium.floodMeshes) (m.material as MeshBasicMaterial).color.set(flood > 0 ? '#fff7e0' : '#9aa0a8');
    this.weather.set(kind, this.quality.weatherParticles, night);
    if (kind === 'rain') { (this.ground.material as MeshStandardMaterial).roughness = 0.6; }
  }
  private sunDir = new Vector3(0.5, 1, 0.3);
  private stars: Group | null = null;
  private addStars(): void {
    if (this.stars) return;
    const g = new BufferGeometry(); const n = 700; const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.9 + 0.1); arr[i * 3] = Math.sin(ph) * Math.cos(th) * 1800; arr[i * 3 + 1] = Math.cos(ph) * 1800; arr[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 1800; }
    g.setAttribute('position', new BufferAttribute(arr, 3));
    const pts = new (class extends Group {})(); // placeholder group
    this.stars = pts;
    const mat = new MeshBasicMaterial({ color: 0xffffff });
    void mat;
    this.scene.add(pts);
    import('three').then(({ Points, PointsMaterial }) => { const p = new Points(g, new PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false })); pts.add(p); });
  }

  private makeRig(p: MPlayer, team: Team): Rig {
    const keeper = p.isGK();
    const kit = keeper ? { primary: team.gkKit.primary, secondary: team.gkKit.secondary, pattern: 'solid' } : team.kit;
    return buildHumanoid({
      look: p.data.look, bodyType: p.data.bodyType, heightCm: p.data.heightCm, shirt: shirtTexture(kit),
      shorts: keeper ? team.gkKit.secondary : team.kit.shorts, socks: keeper ? team.gkKit.primary : team.kit.socks, isKeeper: keeper,
      gloves: keeper ? '#e5e7eb' : undefined, shirtColor: kit.primary, longSleeves: p.data.look.sleeves || keeper, number: p.data.number, name: p.data.shortName,
    });
  }

  private buildOfficials(): void {
    const mk = (shirt: string, shorts: string, h: number, num: number): Rig => buildHumanoid({
      look: { skin: 1, hairStyle: 1, hairColor: 0, beard: 0, bootColor: 0, tattoo: false, sleeves: false }, bodyType: 'normal', heightCm: h,
      shirt: shirtTexture({ primary: shirt, secondary: shirt, pattern: 'solid' }), shorts, socks: '#111827', isKeeper: false, shirtColor: shirt, longSleeves: false, number: num, name: '',
    });
    const ref = mk('#e8d51a', '#111827', 180, 0); ref.numberPlane.visible = false;
    this.scene.add(ref.root); this.refViews.push(new PlayerView(ref, null, 'referee'));
    for (let i = 0; i < 2; i++) { const a = mk('#fb923c', '#111827', 178, 0); a.numberPlane.visible = false; this.scene.add(a.root); this.refViews.push(new PlayerView(a, null, 'assistant')); }
    // benches: substitutes sit in the dugouts, coaches stand; ball boys and camera crew stand behind the boards
    if (this.quality.crowd > 0.3) {
      const addSeated = (team: Team, x0: number): void => {
        team.bench.slice(0, 7).forEach((pl, i) => {
          const rig = buildHumanoid({
            look: pl.look, bodyType: pl.bodyType, heightCm: pl.heightCm, shirt: shirtTexture({ primary: team.kit.secondary, secondary: team.kit.primary, pattern: 'solid' }),
            shorts: team.kit.shorts, socks: team.kit.socks, isKeeper: false, shirtColor: team.kit.secondary, longSleeves: true, number: pl.number, name: pl.shortName,
          });
          rig.root.position.set(x0 + i * 1.0, 0.0, 42.6 - 5.4); rig.root.rotation.y = Math.PI;
          this.scene.add(rig.root);
          const pv = new PlayerView(rig, null, 'bench'); pv.seed = i * 1.7; this.extras.push(pv);
        });
      };
      addSeated(this.match.teams[0], -9); addSeated(this.match.teams[1], 3);
      for (const cx of [-5.5, 6.5]) {
        const glass = new Mesh(new BoxGeometry(8.4, 2.1, 0.12), new MeshStandardMaterial({ color: '#9fb4c8', transparent: true, opacity: 0.22, roughness: 0.1 }));
        glass.position.set(cx, 1.15, 38.3); const roof = new Mesh(new BoxGeometry(8.6, 0.12, 2.2), new MeshStandardMaterial({ color: '#cbd5e1', transparent: true, opacity: 0.55 }));
        roof.position.set(cx, 2.25, 37.3); const bench = new Mesh(new BoxGeometry(8, 0.1, 0.5), new MeshStandardMaterial({ color: '#374151' })); bench.position.set(cx, 0.45, 37.5);
        this.scene.add(glass, roof, bench);
      }
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? 1 : -1;
        const rig = mk(i % 2 ? '#f97316' : '#22c55e', '#111827', 165, 0); rig.numberPlane.visible = false;
        const pos = [[-HALF_L - 4, 20], [HALF_L + 4, -20], [-30, 38.5], [30, -38.5], [HALF_L + 4, 22], [-HALF_L - 4, -22]][i]!;
        rig.root.position.set(pos[0]!, 0, pos[1]!); rig.root.rotation.y = side > 0 ? Math.PI : 0; this.scene.add(rig.root);
        const pv = new PlayerView(rig, null, 'crew'); pv.seed = i; this.extras.push(pv);
      }
      for (let i = 0; i < 4; i++) {
        const rig = mk('#1f2937', '#111827', 175, 0); rig.numberPlane.visible = false;
        const x = [-HALF_L - 6.5, HALF_L + 6.5, -HALF_L - 6.5, HALF_L + 6.5][i]!, z = [-6, 6, 7, -7][i]!;
        rig.root.position.set(x, 0, z); rig.root.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2; this.scene.add(rig.root);
        const pv = new PlayerView(rig, null, 'crew'); pv.seed = i + 9; this.extras.push(pv);
      }
    }
  }

  // ---------- quality ----------

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio) * q.resolutionScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = q.shadows !== 'off';
    this.renderer.shadowMap.type = q.shadows === 'high' ? PCFSoftShadowMap : q.shadows === 'medium' ? PCFShadowMap : BasicShadowMap;
    this.sun.castShadow = q.shadows !== 'off';
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null as never; }
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const S = q.shadows === 'high' ? 38 : q.shadows === 'medium' ? 44 : 52;
    const sc = this.sun.shadow.camera;
    sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 10; sc.far = 330; sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    for (const pv of this.views.values()) { pv.rig.body.castShadow = q.shadows !== 'off'; pv.rig.shirtMesh.castShadow = q.shadows !== 'off'; }
    this.post.apply(q, this.opts.grade);
    this.resize();
    this.director.camera.far = 4000;
    this.weather.set(this.weatherKind, q.weatherParticles, this.tod === 'night');
    this.ground.visible = true;
    this.grass?.dispose(); if (this.grass) this.scene.remove(this.grass.mesh); this.grass = null;
    if (q.grassBlades > 0) { this.grass = new GrassBlades(q.grassBlades, this.weatherKind === 'snow' ? '#dfe8ee' : '#3f8a38'); this.scene.add(this.grass.mesh); }
    const tex = this.pitch.texture; tex.anisotropy = q.anisotropy; tex.needsUpdate = true;
    this.ballShadow.visible = q.shadows === 'off';
    for (const pv of this.views.values()) if (pv.shadow) pv.shadow.visible = q.shadows === 'off';
  }

  setGrade(g: GradePreset): void { this.opts.grade = g; this.post.setGrade(g); }
  setCameraMode(m: CameraMode): void { this.director.setMode(m); this.opts.cameraMode = m; }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth, h = parent ? parent.clientHeight : window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    this.director.camera.aspect = w / Math.max(1, h);
    this.director.camera.updateProjectionMatrix();
    this.post.resize(w, h);
  }

  // ---------- events ----------

  private hookEvents(): void {
    const m = this.match;
    const bus = m.bus;
    this.disposeFns.push(
      bus.on('netHit', (e) => {
        const gi = m.ball.x > 0 ? 0 : 1;
        this.goals[gi]?.impulse(new Vector3(m.ball.x, m.ball.z, m.ball.y), e.speed);
        this.director.addShake(Math.min(0.5, e.speed * 0.012));
      }),
      bus.on('goal', () => { this.excitement = 1; }),
      bus.on('shot', (e) => { this.excitement = Math.max(this.excitement, e.xg > 0.2 ? 0.7 : 0.35); }),
      bus.on('post', () => { this.excitement = Math.max(this.excitement, 0.75); this.director.addShake(0.2); }),
      bus.on('save', () => { this.excitement = Math.max(this.excitement, 0.5); }),
      bus.on('tackle', (e) => { if (e.slide) this.bumpDirt(e.player, 0.1); this.excitement = Math.max(this.excitement, 0.25); }),
      bus.on('foul', (e) => { this.bumpDirt(e.victim, 0.06); }),
      bus.on('card', (e) => { const rv = this.refViews[0]; if (rv) { rv.ps.cur[0] = 0; (rv as PlayerView & { cardT?: number }).cardT = 1.6; } void e; }),
      bus.on('offside', () => { /* flag raised via match.flagT */ }),
    );
  }

  private bumpDirt(p: MPlayer, d: number): void {
    const v = this.views.get(p);
    if (v) v.rig.dirt.value = Math.min(1, v.rig.dirt.value + d);
  }

  // ---------- projection helper for the HUD ----------

  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    this.tmpV.set(x, z, y).project(this.director.camera);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { x: (this.tmpV.x * 0.5 + 0.5) * w, y: (-this.tmpV.y * 0.5 + 0.5) * h, visible: this.tmpV.z > -1 && this.tmpV.z < 1 };
  }

  // ---------- frame ----------

  /** Starts a replay; `done` is called after the last frame. */
  startReplay(frames: Float32Array[], speed = 0.6, done?: () => void): void {
    this.replay = { frames, idx: 0, speed, angleT: 0, angle: 0, done: false, onDone: done };
    this.director.cinematic = { kind: 'replay', t: 0, duration: frames.length / 60, angle: 0 };
  }
  stopReplay(): void {
    const r = this.replay;
    this.replay = null; this.director.cinematic = null;
    r?.onDone?.();
  }

  setCinematic(kind: 'goal' | 'halftime' | 'fulltime' | 'lineup' | 'tunnel' | null): void {
    this.director.cinematic = kind ? { kind, t: 0, duration: 99 } : null;
  }

  update(alpha: number, dt: number, controlled: MPlayer | null): void {
    this.time += dt;
    this.frameCount++;
    const m = this.match;
    const q = this.quality;
    if (dt > 0) this.fpsSmooth += (1 / dt - this.fpsSmooth) * 0.05;
    // replay clock
    const rep = this.replay;
    if (rep) {
      rep.idx += dt * 60 * rep.speed;
      rep.angleT += dt;
      if (rep.angleT > 2.8) { rep.angleT = 0; rep.angle++; if (this.director.cinematic) this.director.cinematic.angle = rep.angle; }
      if (rep.idx >= rep.frames.length - 1) { this.stopReplay(); }
    }
    if (this.director.cinematic) this.director.cinematic.t += dt;

    // ---- ball
    let bx: number, by: number, bz: number, bwx = m.ball.wx, bwy = m.ball.wy, bwz = m.ball.wz;
    const rf = this.replay ? this.sampleReplay() : null;
    if (rf) { bx = rf[0]!; by = rf[1]!; bz = rf[2]!; bwx = rf[3]!; bwy = rf[4]!; bwz = rf[5]!; }
    else {
      const b = m.ball;
      bx = b.px + (b.x - b.px) * alpha; by = b.py + (b.y - b.py) * alpha; bz = b.pz + (b.z - b.pz) * alpha;
    }
    this.ballMesh.position.set(bx, bz, by);
    const w = new Vector3(-bwx, -bwz, -bwy);
    const wl = w.length();
    if (wl > 0.01) { const qd = new Quaternion().setFromAxisAngle(w.divideScalar(wl), Math.min(wl * dt, 1.5)); this.ballRot.premultiply(qd); this.ballMesh.quaternion.copy(this.ballRot); }
    this.ballShadow.position.set(bx, 0.03, by); this.ballShadow.scale.setScalar(1 + bz * 0.25);
    (this.ballShadow.material as MeshBasicMaterial).opacity = Math.max(0.15, 0.9 - bz * 0.12);
    // trail
    if (q.ballTrail && this.opts.trail) this.updateTrail(bx, bz, by, m.ball.speed());

    // ---- players
    this.syncPlayers(alpha, dt, rf, controlled);
    this.syncExtras(dt);

    // ---- markers
    this.updateMarkers(alpha);

    // ---- camera
    this.director.update(dt, m, alpha, controlled);

    // ---- sun/shadow follows the focus
    const f = this.director.camera.position;
    const fx = Math.max(-40, Math.min(40, bx)), fz = Math.max(-26, Math.min(26, by));
    void f;
    this.sun.position.set(fx + this.sunDir.x * 140, this.sunDir.y * 140, fz + this.sunDir.z * 140);
    this.sun.target.position.set(fx, 0, fz); this.sun.target.updateMatrixWorld();

    this.grass?.update(this.director.camera.position.x * 0.2 + bx * 0.8, this.director.camera.position.z * 0.2 + by * 0.8, dt);
    this.updateOffsideLine(rf);
    // ---- environment animation
    for (const g of this.goals) g.update(dt);
    this.excitement = Math.max(0, this.excitement - dt * 0.18);
    const base = m.phase === 'play' ? 0.28 : 0.2;
    const target = Math.max(base, this.excitement);
    this.crowdExcite += (target - this.crowdExcite) * Math.min(1, dt * 3);
    this.stadium.crowdUniform.value = this.crowdExcite;
    this.stadium.timeUniform.value = this.time;
    this.boardsT += dt; if (this.boardsT > 2) { this.boardsT = 0; this.stadium.boards.draw(this.time); }
    this.jumboT += dt; if (this.jumboT > 0.5) { this.jumboT = 0; this.drawJumbotron(); }
    this.weather.update(dt, this.director.camera.position);
    this.wearT += dt;
    if (this.wearT > 0.7 && !this.replay) { this.wearT = 0; this.paintWear(); }
    if (this.wearDirty && this.frameCount % 120 === 0) { this.pitch.texture.needsUpdate = true; this.wearDirty = false; }

    this.post.render(dt, this.time);
    this.onFrame?.(dt);
  }

  get fps(): number { return this.fpsSmooth; }

  private paintWear(): void {
    const m = this.match;
    for (const p of m.all) {
      const s = p.speed;
      if (s > 3 || p.isGK()) { paintWear(this.pitch, p.x, p.y, p.isGK() ? 0.6 : Math.min(1, s / 8) * 0.5); this.wearDirty = true; }
      if (p.state === 'slide') { paintWear(this.pitch, p.x, p.y, 2); this.wearDirty = true; }
    }
  }

  private drawJumbotron(): void {
    const j = this.stadium.jumbotron;
    if (!j) return;
    const m = this.match;
    const g = j.ctx;
    g.fillStyle = '#05080f'; g.fillRect(0, 0, 512, 192);
    g.fillStyle = m.teams[0].kit.primary; g.fillRect(0, 0, 8, 192);
    g.fillStyle = m.teams[1].kit.primary; g.fillRect(504, 0, 8, 192);
    g.fillStyle = '#f8fafc'; g.textAlign = 'center';
    g.font = 'bold 26px system-ui, sans-serif'; g.fillText(m.teams[0].short, 110, 60); g.fillText(m.teams[1].short, 402, 60);
    g.font = 'bold 64px system-ui, sans-serif'; g.fillText(`${m.teams[0].score} - ${m.teams[1].score}`, 256, 120);
    g.font = '24px system-ui, sans-serif'; g.fillStyle = '#9ca3af'; g.fillText(m.displayClock().text, 256, 160);
    if (this.replay) { g.fillStyle = '#ef4444'; g.font = 'bold 22px system-ui'; g.fillText('REPLAY', 256, 36); }
    j.tex.needsUpdate = true;
  }

  private updateTrail(x: number, y: number, z: number, speed: number): void {
    if (!this.trail) {
      const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(16 * 3), 3));
      this.trail = new Line(g, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
      this.trail.frustumCulled = false; this.scene.add(this.trail);
    }
    this.trailPts.push(new Vector3(x, y, z));
    if (this.trailPts.length > 16) this.trailPts.shift();
    this.trail.visible = speed > 14;
    const a = this.trail.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < 16; i++) { const p = this.trailPts[Math.max(0, this.trailPts.length - 1 - i)] ?? this.trailPts[0]!; a.setXYZ(15 - i, p.x, p.y, p.z); }
    a.needsUpdate = true;
  }

  private updateOffsideLine(rf: Float32Array | null): void {
    if (!rf) { if (this.offsideLine) this.offsideLine.visible = false; return; }
    if (!this.offsideLine) {
      this.offsideLine = new Mesh(new PlaneGeometry(0.18, 68), new MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.55, depthWrite: false }));
      this.offsideLine.rotation.x = -Math.PI / 2; this.offsideLine.position.y = 0.05; this.scene.add(this.offsideLine);
    }
    const bx = rf[0]!;
    if (Math.abs(bx) < 18) { this.offsideLine.visible = false; return; }
    const sgn = Math.sign(bx);
    // the defending team is the one whose keeper (slot 0) stands in that half
    let best: number[] | null = null;
    for (const t of [0, 1]) { const gx = rf[12 + (t * 11) * PF]!; if (Math.sign(gx) === sgn && Math.abs(gx) > 25) { best = []; for (let i = 0; i < 11; i++) { const o = 12 + (t * 11 + i) * PF; if (rf[o + 3] !== 99) best.push(rf[o]! * sgn); } } }
    if (!best || best.length < 2) { this.offsideLine.visible = false; return; }
    best.sort((a, b) => b - a);
    this.offsideLine.visible = true; this.offsideLine.position.x = best[1]! * sgn;
  }

  private sampleReplay(): Float32Array | null {
    const r = this.replay;
    if (!r) return null;
    sampleFrames(r.frames, r.idx, this.replayTmp);
    return this.replayTmp;
  }

  private rpFromPlayer(p: MPlayer, alpha: number, dt: number, v: PlayerView): RenderPlayer {
    const m = this.match;
    const x = p.px + (p.x - p.px) * alpha, z = p.py + (p.y - p.py) * alpha;
    const face = p.pface + angleDiff(p.pface, p.face) * alpha;
    const sk = p.skill ? skillById(p.skill.id) : p.state === 'skill' ? skillById(p.stateName) : undefined;
    const speed = Math.hypot(p.pvx + (p.vx - p.pvx) * alpha, p.pvy + (p.vy - p.pvy) * alpha);
    const stride = p.pstride + (p.stride - p.pstride) * alpha;
    const stateT = p.stateT >= p.pstateT ? p.pstateT + (p.stateT - p.pstateT) * alpha : p.stateT;
    // dive direction relative to the player's left
    const diveSide = Math.sign(-p.sx * Math.cos(face)) || 1;
    void dt; void v;
    return {
      visible: !p.sentOff, x, z, face, state: p.state, stateName: p.stateName, stateT, stateDur: p.stateDur, speed, stride,
      hasBall: m.owner === p, ballSide: p.ballSide, dominantFoot: p.data.foot, weakFoot: p.data.weakFoot, tired: m.cfg.fatigue ? 1 - p.stamina : 0, keeper: p.isGK(),
      skillAnim: sk?.anim ?? null, skillU: p.skill ? p.skill.t / p.skill.dur : 0, skillSide: p.skill?.dx ?? 1, diveSide, diveH: p.sz, celebT: this.time, kickPower: 0.6,
    };
  }

  private syncPlayers(alpha: number, dt: number, rf: Float32Array | null, controlled: MPlayer | null): void {
    const m = this.match;
    const cam = this.director.camera.position;
    const lod = this.quality.animLod;
    for (const team of m.teams) {
      for (let i = 0; i < team.players.length; i++) {
        const p = team.players[i]!;
        let view = this.views.get(p);
        if (!view) {
          const rig = this.makeRig(p, team);
          this.scene.add(rig.root);
          view = new PlayerView(rig, p);
          const sh = new Mesh(new CircleGeometry(0.55, 16), new MeshBasicMaterial({ map: this.blob, transparent: true, depthWrite: false }));
          sh.rotation.x = -Math.PI / 2; sh.visible = this.quality.shadows === 'off'; this.scene.add(sh); view.shadow = sh;
          rig.body.castShadow = this.quality.shadows !== 'off'; rig.shirtMesh.castShadow = this.quality.shadows !== 'off';
          view.lastFace = p.face;
          this.views.set(p, view);
        }
        let rp: RenderPlayer;
        if (rf && !p.subbedOff) {
          const o = 12 + (team.side * 11 + i) * PF;
          const st = stateFromCode(Math.round(rf[o + 3]!));
          const extra = rf[o + 7]!;
          const flags = rf[o + 9] ?? 0;
          rp = {
            visible: rf[o + 3] !== 99, x: rf[o]!, z: rf[o + 1]!, face: rf[o + 2]!, state: st, stateName: '', stateT: rf[o + 4]!, stateDur: st === 'kick' ? 0.34 : st === 'slide' ? 0.95 : st === 'dive' ? 1 : st === 'tackle' ? 0.5 : st === 'jump' ? 0.7 : st === 'down' ? 1.5 : st === 'throw' ? 0.6 : 0.8,
            speed: rf[o + 6]!, stride: rf[o + 5]!, hasBall: (flags & 1) !== 0, ballSide: (flags & 2) !== 0 ? 'R' : 'L', dominantFoot: 'R', weakFoot: 4, tired: rf[o + 10] ?? 0.2, keeper: p.isGK(),
            skillAnim: extra >= 10 ? ANIMS[Math.round(extra) - 10] ?? 'feint' : null, skillU: Math.min(1, rf[o + 4]! / 0.7), skillSide: 1, diveSide: Math.sign(-extra * Math.cos(rf[o + 2]!)) || 1, diveH: rf[o + 8]!, celebT: this.time, kickPower: 0.6,
          };
        } else rp = this.rpFromPlayer(p, alpha, dt, view);
        this.drawPlayer(view, rp, dt, cam, lod, p === controlled);
      }
    }
  }

  private drawPlayer(v: PlayerView, rp: RenderPlayer, dt: number, cam: Vector3, lod: number, controlled: boolean): void {
    const root = v.rig.root;
    root.visible = rp.visible;
    if (v.shadow) v.shadow.visible = rp.visible && this.quality.shadows === 'off';
    if (!rp.visible) return;
    const dist = Math.hypot(rp.x - cam.x, rp.z - cam.z);
    v.frame++;
    const skipMod = lod === 0 ? 1 : lod === 1 ? (dist > 70 ? 2 : 1) : dist > 45 ? 3 : 2;
    const doPose = controlled || skipMod === 1 || v.frame % skipMod === 0;
    const dFace = angleDiff(v.lastFace, rp.face);
    v.turn += (dFace / Math.max(dt, 1e-3) - v.turn) * Math.min(1, dt * 8);
    v.lastFace = rp.face;
    v.accel += ((rp.speed - v.lastSpeed) / Math.max(dt, 1e-3) - v.accel) * Math.min(1, dt * 6);
    v.lastSpeed = rp.speed;
    const b = this.match.ball;
    const ca = Math.cos(rp.face), sa = Math.sin(rp.face);
    const bdx = b.x - rp.x, bdy = b.y - rp.z;
    const inp: PoseInput = {
      state: rp.state, stateName: rp.stateName, stateT: rp.stateT, stateDur: rp.stateDur, speed: rp.speed, maxSpeed: 9.2, stride: rp.stride, turn: v.turn, accel: v.accel,
      hasBall: rp.hasBall, ballSide: rp.ballSide, dominantFoot: rp.dominantFoot, weakFoot: rp.weakFoot, isKeeper: rp.keeper, tired: rp.tired,
      ballLocal: { x: bdx * sa - bdy * ca, y: b.z, z: bdx * ca + bdy * sa },
      skillAnim: rp.skillAnim, skillU: rp.skillU, skillSide: rp.skillSide, diveSide: rp.diveSide, diveHeight: rp.diveH,
      celebrateId: v.celeb, celebrateT: rp.celebT, role: 'player', armUp: 0, flag: 0, seed: v.seed, time: this.time, kickPower: rp.kickPower,
    };
    if (doPose) {
      this.tmpV.set(b.x, b.z, b.y);
      applyPose(v.rig, inp, v.ps, dt * skipMod, this.tmpV);
    }
    const ud = root.userData as { pitch?: number; roll?: number; dy?: number };
    root.rotation.order = 'YXZ';
    root.position.set(rp.x, ud.dy ?? 0, rp.z);
    root.rotation.set(ud.pitch ?? 0, Math.PI / 2 - rp.face, ud.roll ?? 0);
    if (v.shadow) { v.shadow.position.set(rp.x, 0.03, rp.z); v.shadow.scale.setScalar(1.1); }
    // sweat / dirt
    v.rig.sweat.value = rp.tired * 0.9;
    if (this.weatherKind === 'rain') v.rig.dirt.value = Math.min(0.5, v.rig.dirt.value + dt * 0.002);
  }

  private syncExtras(dt: number): void {
    const m = this.match;
    // referee and assistants
    const rv = this.refViews[0];
    if (rv) {
      const r = m.ref;
      const sp = Math.hypot(r.vx, r.vy);
      rv.rig.root.position.set(r.x, 0, r.y); rv.rig.root.rotation.y = Math.PI / 2 - r.face;
      rv.rig.root.rotation.order = 'YXZ';
      rv.stride = (rv.stride ?? 0) + sp * dt / (1.6 + 0.27 * sp);
      const cardT = (rv as PlayerView & { cardT?: number }).cardT ?? 0;
      (rv as PlayerView & { cardT?: number }).cardT = Math.max(0, cardT - dt);
      const inp = this.basicInput(rv, sp, 'referee', cardT > 0 ? 1 : 0, 0);
      inp.stride = rv.stride; applyPose(rv.rig, inp, rv.ps, dt, null);
    }
    for (let i = 0; i < 2; i++) {
      const av = this.refViews[1 + i]; if (!av) continue;
      const a = m.assistants[i]!;
      av.rig.root.position.set(a.x, 0, a.y); av.rig.root.rotation.y = a.side > 0 ? Math.PI : 0;
      const sp = 0;
      const inp = this.basicInput(av, sp, 'assistant', 0, i === 0 && a.flag ? 1 : 0);
      applyPose(av.rig, inp, av.ps, dt, null);
    }
    // seated / crew: update at low rate
    for (let i = 0; i < this.extras.length; i++) {
      const ev = this.extras[i]!;
      if ((this.frameCount + i) % 4 !== 0) continue;
      const inp = this.basicInput(ev, 0, 'player', 0, 0);
      inp.state = ev.role === 'bench' ? 'sit' : ev.role === 'crew' ? 'crew' : 'normal';
      // react to the game: stand/cheer after a goal for the scoring side
      if (ev.role === 'bench' && this.crowdExcite > 0.8) inp.state = 'celebrate';
      applyPose(ev.rig, inp, ev.ps, dt * 4, null);
    }
  }

  private basicInput(v: PlayerView, speed: number, role: 'player' | 'referee' | 'assistant', armUp: number, flag: number): PoseInput {
    return {
      state: 'normal', stateName: '', stateT: 0, stateDur: 0, speed, maxSpeed: 7, stride: v.stride ?? 0, turn: 0, accel: 0, hasBall: false, ballSide: 'R', dominantFoot: 'R', weakFoot: 3,
      isKeeper: false, tired: 0, ballLocal: null, skillAnim: null, skillU: 0, skillSide: 1, diveSide: 1, diveHeight: 1, celebrateId: 0, celebrateT: this.time, role, armUp, flag,
      seed: v.seed, time: this.time, kickPower: 0.5,
    };
  }

  private updateMarkers(alpha: number): void {
    const m = this.match;
    // human-selected players get a ring + arrow
    const used = new Set<number>();
    m.humans.forEach((h, i) => {
      const p = h.player;
      let mk = this.markers.get(i);
      if (!mk) {
        // deliberately dim: toneMapped, low opacity, so it reads as a soft ground marker and never triggers bloom
        const col = i === 0 ? 0x2f5f9e : i === 1 ? 0x9e3a3a : i === 2 ? 0x2f8a52 : 0x9a7a2a;
        const ring = new Mesh(new RingGeometry(0.62, 0.72, 40), new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        const arrow = new Mesh(new ConeGeometry(0.16, 0.3, 16), new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 }));
        arrow.rotation.x = Math.PI;
        this.scene.add(ring, arrow); mk = { ring, arrow }; this.markers.set(i, mk);
      }
      used.add(i);
      if (!p || !p.active()) { mk.ring.visible = false; mk.arrow.visible = false; return; }
      const x = p.px + (p.x - p.px) * alpha, z = p.py + (p.y - p.py) * alpha;
      mk.ring.visible = true; mk.arrow.visible = true;
      mk.ring.position.set(x, 0.04, z);
      mk.arrow.position.set(x, 2.45 + Math.sin(this.time * 4) * 0.05, z);
    });
    for (const [i, mk] of this.markers) if (!used.has(i)) { mk.ring.visible = false; mk.arrow.visible = false; }

    // target ring for the pass receiver
    const pi = m.passInfo;
    const humanSide = m.humans[0]?.side;
    if (pi && pi.receiver && !pi.completed && humanSide === pi.passer.side && m.time - pi.time < 2.5) {
      this.targetRing.visible = true;
      this.targetRing.position.set(pi.receiver.x, 0.05, pi.receiver.y);
      this.targetRing.scale.setScalar(1 + Math.sin(this.time * 12) * 0.08);
    } else this.targetRing.visible = false;

    // set-piece aim guide
    const sp = m.sp;
    const taker = sp?.taker;
    if (sp && sp.phase === 'ready' && taker && taker.human >= 0 && ['freeKick', 'indirectFreeKick', 'penalty'].includes(sp.type)) {
      const dir = m.teams[sp.side].dir;
      const gx = dir * HALF_L;
      const ty = dir * sp.aimY * 3.66, tz = 0.2 + sp.aimH * 2.2;
      this.aimGroup.visible = true;
      const a = this.aimLine.geometry.getAttribute('position') as BufferAttribute;
      a.setXYZ(0, sp.x, 0.2, sp.y); a.setXYZ(1, gx, tz, ty); a.needsUpdate = true;
      this.aimRing.position.set(gx - dir * 0.2, tz, ty);
      this.aimRing.rotation.y = Math.PI / 2;
    } else this.aimGroup.visible = false;
  }

  dispose(): void {
    for (const f of this.disposeFns) f();
    this.post.dispose();
    this.weather.dispose();
    this.stadium.dispose();
    this.renderer.dispose();
  }
}

export { PerspectiveCamera, Color };
export type { PState, Team, Texture };
void Group;
