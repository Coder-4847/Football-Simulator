import { angleDiff, clamp, clamp01, lerp } from '../core/math';
import { settings } from '../core/settings';
import { HALF_GOAL, HALF_L, HALF_W } from '../match/constants';
import type { MPlayer, PState } from '../match/entities';
import type { Match } from '../match/match';
import { ANIM_LIST as ANIMS, FRAME_SIZE, PF, sampleFrames, stateFromCode } from '../match/replay';
import { skillById } from '../match/skills';
import type { TimeOfDay, Weather } from '../match/types';
import { CameraDirector, type CameraMode, type Cinematic } from './camera';
import { LightingLayer, Particles, WeatherLayer, vignette } from './fx';
import { PitchRenderer } from './pitch';
import { FigurePainter, BOOT_COLORS, HAIR_COLORS, PlayerAnim, SKIN_TONES, pushTrail, type BallLocal, type PlayerStyle, type RenderPlayer } from './players';
import { GRADES, gradeFilter, type GradePreset } from './post';
import type { Quality } from './quality';
import { buildStadium, drawBoards, drawCrowd, drawRoofs, drawStadiumGround, type StadiumView } from './stadium';

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

/** Marker drawn on the pitch by training drills. */
export interface DrillMarker { kind: 'ring' | 'cone' | 'zone'; x: number; y: number; r?: number; color: string; label?: string; pulse?: boolean }

interface PlayerView {
  anim: PlayerAnim; painter: FigurePainter; style: PlayerStyle; rp: RenderPlayer | null;
  sx: number; sy: number; slideT: number; lastState: PState; lastStride: number;
}

interface Popup { x: number; y: number; t: number; text: string; color: string; size: number }

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO: Array<[number, number, number]> = (() => {
  const v: Array<[number, number, number]> = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) { v.push([0, a, b], [a, b, 0], [b, 0, a]); }
  return v.map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l] as [number, number, number]; });
})();

const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b'];

export class MatchView {
  readonly canvas: HTMLCanvasElement;
  readonly director = new CameraDirector();
  private ctx: CanvasRenderingContext2D;
  private pitch: PitchRenderer;
  private stadium: StadiumView;
  private particles = new Particles();
  private weather = new WeatherLayer();
  private lighting: LightingLayer;
  private views = new Map<MPlayer, PlayerView>();
  private refView: PlayerView;
  private assistViews: PlayerView[] = [];
  private popups: Popup[] = [];
  private quality: Quality;
  private opts: ViewOptions;
  private tod: TimeOfDay;
  private weatherKind: Weather;
  private time = 0;
  private fpsSmooth = 60;
  private pixelRatio = 1;
  private cssW = 1280; private cssH = 720;
  private excitement = 0;
  private crowdExcite = 0.25;
  private flash = 0;
  private boardT = 0;
  private wearT = 0;
  private ballVecs: Array<[number, number, number]> = ICO.map((v) => [...v] as [number, number, number]);
  private trailPts: number[] = [];
  private lastBall = { x: 0, y: 0, z: 0 };
  private kickPow = new Map<MPlayer, { p: number; t: number }>();
  private replayTmp = new Float32Array(FRAME_SIZE);
  private benchWalk = 0;
  private dugoutReact = 0;
  private lastGoalSide: 0 | 1 | null = null;
  /** seconds of hit-stop requested by strong impacts; the session slows the clock while > 0 */
  hitStop = 0;
  fade = 0;
  letterbox = 0;
  drill: DrillMarker[] = [];
  replay: { frames: Float32Array[]; idx: number; speed: number; angleT: number; angle: number; done: boolean; onDone?: () => void } | null = null;
  onFrame: ((dt: number) => void) | null = null;
  private frameCount = 0;

  constructor(canvas: HTMLCanvasElement, readonly match: Match, opts: ViewOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.opts = opts;
    this.quality = opts.quality;
    this.tod = match.cfg.timeOfDay;
    this.weatherKind = match.cfg.weather;
    this.pitch = new PitchRenderer(match.cfg.stadiumStyle, this.weatherKind === 'rain', this.weatherKind === 'snow', opts.quality.pitchWear, match.cfg.seed, hash(match.cfg.seed) & 3);
    this.pitch.detail = clamp(opts.quality.stadiumDetail * 1.3, 11, 22);
    this.stadium = buildStadium(match.cfg.stadiumStyle, { night: this.tod === 'night', crowd: opts.quality.crowd, detail: opts.quality.stadiumDetail, home: match.teams[0].kit, away: match.teams[1].kit, seed: match.cfg.seed });
    this.lighting = new LightingLayer(this.tod);
    this.particles.density = opts.quality.particles;
    this.weather.set(this.weatherKind, opts.quality.weatherParticles);
    this.director.zoomScale = opts.cameraZoom; this.director.heightScale = opts.cameraHeight; this.director.setMode(opts.cameraMode);
    this.setGrade(opts.grade);
    this.refView = this.makeOfficial('#e8d51a', 'referee');
    this.assistViews = [this.makeOfficial('#fb923c', 'assistant'), this.makeOfficial('#fb923c', 'assistant')];
    this.hookEvents();
    this.resize();
    this.director.snap(0, 0);
  }

  // ---------------------------------------------------------------- setup

  private makeOfficial(color: string, role: 'referee' | 'assistant'): PlayerView {
    return {
      anim: new PlayerAnim(), painter: new FigurePainter(), rp: null, sx: 0, sy: 0, slideT: 0, lastState: 'normal', lastStride: 0,
      style: { primary: color, secondary: '#111827', shorts: '#0f172a', socks: '#111827', pattern: 'solid', keeper: false, skin: SKIN_TONES[1]!, hair: HAIR_COLORS[0]!, hairStyle: 1, beard: 0, boot: '#111827', longSleeves: false, gloves: null, number: 0, build: 1, celeb: 0, role },
    };
  }

  private makeView(p: MPlayer): PlayerView {
    const t = p.team;
    const k = p.isGK();
    const look = p.data.look;
    const kit = k ? { primary: t.gkKit.primary, secondary: t.gkKit.secondary, shorts: t.gkKit.secondary, socks: t.gkKit.primary, pattern: 'solid' } : t.kit;
    const style: PlayerStyle = {
      primary: kit.primary, secondary: kit.secondary, shorts: kit.shorts, socks: kit.socks, pattern: kit.pattern, keeper: k,
      skin: SKIN_TONES[look.skin % SKIN_TONES.length]!, hair: HAIR_COLORS[look.hairColor % HAIR_COLORS.length]!, hairStyle: look.hairStyle, beard: look.beard,
      boot: k ? '#0f172a' : BOOT_COLORS[look.bootColor % BOOT_COLORS.length]!, longSleeves: look.sleeves || k, gloves: k ? '#e5e7eb' : null,
      number: p.data.number, build: clamp(p.data.heightCm / 180, 0.92, 1.08), celeb: Math.abs(hash(p.data.id)) % 6, role: 'player',
    };
    const anim = new PlayerAnim();
    anim.seed = (Math.abs(hash(p.data.id)) % 1000) / 10;
    anim.prevFace = p.face;
    return { anim, painter: new FigurePainter(), style, rp: null, sx: 0, sy: 0, slideT: 0, lastState: 'normal', lastStride: 0 };
  }

  private hookEvents(): void {
    const bus = this.match.bus;
    bus.on('kick', (e) => {
      const b = this.match.ball;
      this.kickPow.set(e.player, { p: e.power, t: this.time });
      const strong = e.kind === 'shot' || e.power > 0.55;
      if (strong) {
        this.particles.ring(b.x, b.y, 0.5 + e.power * 0.6, 'rgba(255,255,255,0.9)');
        this.particles.turf(b.x, b.y, Math.cos(e.player.face), Math.sin(e.player.face), Math.round(3 + e.power * 8));
        this.particles.streak(b.x, b.y, Math.cos(e.player.face) * 8, Math.sin(e.player.face) * 8, 1.5);
      }
      if (e.kind === 'shot' && e.power > 0.5) { this.director.punch(0.02 + e.power * 0.03); this.director.addShake(0.2 + e.power * 0.4); if (e.power > 0.78) this.hitStop = Math.max(this.hitStop, 0.05); }
    });
    bus.on('shot', (e) => { if (e.xg > 0.2) this.excitement = Math.max(this.excitement, 0.55); });
    bus.on('post', (e) => { const b = this.match.ball; this.particles.sparks(b.x, b.y, 10, '#ffffff'); this.director.addShake(0.5); this.excitement = Math.max(this.excitement, 0.7); void e; });
    bus.on('netHit', (e) => { const b = this.match.ball; this.pitch.addNetImpulse(b.x > 0 ? 1 : -1, b.x, b.y, e.speed); this.particles.sparks(b.x, b.y, 6, '#e8f0ff'); });
    bus.on('save', (e) => { const b = this.match.ball; this.particles.ring(b.x, b.y, 0.7, 'rgba(120,200,255,0.9)'); this.director.addShake(0.15); void e; });
    bus.on('bounce', (e) => { if (e.speed > 4) { const b = this.match.ball; this.particles.dust(b.x, b.y, Math.min(5, Math.round(e.speed / 3)), 0.8); } });
    bus.on('tackle', (e) => {
      const v = e.victim;
      this.particles.dust(v.x, v.y, e.slide ? 8 : 4, 1.6);
      if (e.success) this.particles.turf(v.x, v.y, v.vx, v.vy, 6);
      this.director.addShake(e.slide ? 0.3 : 0.18);
      if (e.slide) this.hitStop = Math.max(this.hitStop, 0.035);
    });
    bus.on('header', (e) => { this.particles.ring(e.player.x, e.player.y, 0.5, 'rgba(255,255,255,0.8)', 0.3); });
    bus.on('skill', (e) => {
      const mv = skillById(e.id);
      const p = e.player;
      this.popups.push({ x: p.x, y: p.y - 1.8, t: 0, text: `${'★'.repeat(mv?.stars ?? 1)} ${mv?.name ?? ''}`.trim(), color: e.success ? '#ffd23f' : '#ff6b6b', size: 0.62 });
      if (e.success) this.particles.sparks(p.x, p.y, 5, '#ffd23f');
    });
    bus.on('goal', (e) => {
      this.excitement = 1; this.flash = 1;
      this.lastGoalSide = e.side;
      this.director.addShake(0.8); this.director.punch(0.08);
      const t = this.match.teams[e.side];
      const x = e.scorer.x, y = e.scorer.y;
      this.particles.confetti(x, y, 90, [t.kit.primary, t.kit.secondary, '#ffffff', '#ffd23f']);
      this.particles.sparks(x, y, 24, '#ffd23f');
      this.popups.push({ x, y: y - 2.4, t: 0, text: 'GOAL!', color: '#ffffff', size: 1.1 });
      this.dugoutReact = 3;
    });
    bus.on('foul', (e) => { this.particles.dust(e.x, e.y, 3, 0.8); });
    bus.on('whistle', (e) => { if (e.kind === 'start') this.excitement = Math.max(this.excitement, 0.4); });
  }

  setQuality(q: Quality): void { this.quality = q; this.particles.density = q.particles; this.weather.set(this.weatherKind, q.weatherParticles); this.resize(); }
  setGrade(g: GradePreset): void { this.opts.grade = g; this.canvas.style.filter = gradeFilter(g); }
  setCameraMode(m: CameraMode): void { this.director.setMode(m); this.opts.cameraMode = m; }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = Math.max(2, parent?.clientWidth || window.innerWidth), h = Math.max(2, parent?.clientHeight || window.innerHeight);
    this.cssW = w; this.cssH = h;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio) * this.quality.resolutionScale;
    this.canvas.width = Math.round(w * this.pixelRatio); this.canvas.height = Math.round(h * this.pixelRatio);
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`; this.canvas.style.display = 'block';
    this.director.setView(w, h);
  }

  get fps(): number { return this.fpsSmooth; }

  /** World point (metres) → CSS pixels relative to the canvas; `h` lifts the point (metres above ground). */
  project(x: number, y: number, h = 0): { x: number; y: number; visible: boolean } {
    const d = this.director;
    const sx = d.toScreenX(x), sy = d.toScreenY(y) - h * d.scale * 0.5;
    return { x: sx, y: sy, visible: sx > -40 && sx < this.cssW + 40 && sy > -40 && sy < this.cssH + 40 };
  }

  // ---------------------------------------------------------------- replay / cinematics

  startReplay(frames: Float32Array[], speed = 0.6, done?: () => void): void {
    this.replay = { frames, idx: 0, speed, angleT: 0, angle: 0, done: false, onDone: done };
    this.director.cinematic = { kind: 'replay', t: 0, duration: frames.length / 60, angle: 0 };
  }
  stopReplay(): void {
    const r = this.replay;
    this.replay = null; this.director.cinematic = null;
    r?.onDone?.();
  }
  setCinematic(kind: Cinematic['kind'] | null): void { this.director.cinematic = kind ? { kind, t: 0, duration: 99 } : null; }

  // ---------------------------------------------------------------- frame

  update(alpha: number, dt: number): void {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.time += dt; this.frameCount++;
    if (dt > 0) this.fpsSmooth += (1 / dt - this.fpsSmooth) * 0.05;
    const m = this.match;
    const rep = this.replay;
    if (rep) {
      rep.idx += dt * 60 * rep.speed; rep.angleT += dt;
      if (rep.angleT > 2.6) { rep.angleT = 0; rep.angle++; if (this.director.cinematic) this.director.cinematic.angle = rep.angle; }
      if (rep.idx >= rep.frames.length - 1) this.stopReplay();
    }
    if (this.director.cinematic) this.director.cinematic.t += dt;

    // ---- gather state (live interpolation or replay sample)
    const rf = this.replay ? this.sampleReplay() : null;
    const b = m.ball;
    let bx: number, by: number, bz: number, bwx = b.wx, bwy = b.wy, bwz = b.wz;
    if (rf) { bx = rf[0]!; by = rf[1]!; bz = rf[2]!; bwx = rf[3]!; bwy = rf[4]!; bwz = rf[5]!; }
    else { bx = b.px + (b.x - b.px) * alpha; by = b.py + (b.y - b.py) * alpha; bz = b.pz + (b.z - b.pz) * alpha; }

    const players: Array<{ pv: PlayerView; rp: RenderPlayer; p: MPlayer }> = [];
    for (const team of m.teams) {
      for (let i = 0; i < team.players.length; i++) {
        const p = team.players[i]!;
        let pv = this.views.get(p);
        if (!pv) { pv = this.makeView(p); this.views.set(p, pv); }
        let rp: RenderPlayer;
        if (rf && !p.subbedOff) {
          const o = 12 + (team.side * 11 + i) * PF;
          const st = stateFromCode(Math.round(rf[o + 3]!));
          const extra = rf[o + 7]!;
          const flags = rf[o + 9] ?? 0;
          rp = {
            visible: rf[o + 3] !== 99, x: rf[o]!, z: rf[o + 1]!, face: rf[o + 2]!, state: st, stateName: '', stateT: rf[o + 4]!,
            stateDur: st === 'kick' ? 0.34 : st === 'slide' ? 0.95 : st === 'dive' ? 1 : st === 'tackle' ? 0.5 : st === 'jump' ? 0.7 : st === 'down' ? 1.5 : st === 'throw' ? 0.6 : 0.8,
            speed: rf[o + 6]!, stride: rf[o + 5]!, hasBall: (flags & 1) !== 0, ballSide: (flags & 2) !== 0 ? 'R' : 'L', dominantFoot: 'R', weakFoot: 4, tired: rf[o + 10] ?? 0.2, keeper: p.isGK(),
            skillAnim: extra >= 10 ? ANIMS[Math.round(extra) - 10] ?? 'feint' : null, skillU: Math.min(1, rf[o + 4]! / 0.7), skillSide: 1, diveSide: extra > 0 ? 1 : -1, diveH: rf[o + 8]!, celebT: this.time, kickPower: 0.6,
          };
        } else rp = this.livePlayer(p, alpha);
        if (!p.subbedOff || rf) players.push({ pv, rp, p });
        pv.rp = rp;
      }
    }

    // ---- camera
    this.director.update(dt, m, { x: bx, y: by });

    // ---- simulate fx
    this.particles.update(dt); this.weather.update(dt); this.pitch.update(dt);
    this.excitement = Math.max(0, this.excitement - dt * 0.2);
    const base = m.phase === 'play' ? 0.3 : 0.22;
    this.crowdExcite += (Math.max(base, this.excitement) - this.crowdExcite) * Math.min(1, dt * 3);
    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.hitStop = Math.max(0, this.hitStop - dt);
    this.dugoutReact = Math.max(0, this.dugoutReact - dt);
    this.boardT += dt; this.benchWalk += dt;
    for (const pp of this.popups) pp.t += dt;
    this.popups = this.popups.filter((pp) => pp.t < 1.8);
    this.updateBallOrientation(bwx, bwy, bwz, dt);

    this.render(players, bx, by, bz, rf, dt);
    this.onFrame?.(dt);
  }

  private livePlayer(p: MPlayer, alpha: number): RenderPlayer {
    const m = this.match;
    const x = p.px + (p.x - p.px) * alpha, z = p.py + (p.y - p.py) * alpha;
    const face = p.pface + angleDiff(p.pface, p.face) * alpha;
    const sk = p.skill ? skillById(p.skill.id) : p.state === 'skill' ? skillById(p.stateName) : undefined;
    const speed = Math.hypot(p.pvx + (p.vx - p.pvx) * alpha, p.pvy + (p.vy - p.pvy) * alpha);
    const stride = p.pstride + (p.stride - p.pstride) * alpha;
    const stateT = p.stateT >= p.pstateT ? p.pstateT + (p.stateT - p.pstateT) * alpha : p.stateT;
    const kp = this.kickPow.get(p);
    return {
      visible: !p.sentOff, x, z, face, state: p.state, stateName: p.stateName, stateT, stateDur: p.stateDur, speed, stride,
      hasBall: m.owner === p, ballSide: p.ballSide, dominantFoot: p.data.foot, weakFoot: p.data.weakFoot, tired: m.cfg.fatigue ? 1 - p.stamina : 0, keeper: p.isGK(),
      skillAnim: sk?.anim ?? null, skillU: p.skill ? p.skill.t / p.skill.dur : 0, skillSide: p.skill?.dx ?? 1, diveSide: p.sx >= 0 ? 1 : -1, diveH: p.sz, celebT: this.time, kickPower: kp && this.time - kp.t < 0.5 ? kp.p : 0.55,
    };
  }

  private sampleReplay(): Float32Array | null {
    const r = this.replay;
    if (!r) return null;
    sampleFrames(r.frames, r.idx, this.replayTmp);
    return this.replayTmp;
  }

  private updateBallOrientation(wx: number, wy: number, wz: number, dt: number): void {
    const w = Math.hypot(wx, wy, wz);
    if (w < 0.01) return;
    const step = Math.min(w * dt, 1.2) / w;
    for (const v of this.ballVecs) {
      // dv = ω × v
      const cx = wy * v[2] - wz * v[1], cy = wz * v[0] - wx * v[2], cz = wx * v[1] - wy * v[0];
      v[0] += cx * step; v[1] += cy * step; v[2] += cz * step;
      const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l;
    }
  }

  // ---------------------------------------------------------------- drawing

  private render(players: Array<{ pv: PlayerView; rp: RenderPlayer; p: MPlayer }>, bx: number, by: number, bz: number, rf: Float32Array | null, dt: number): void {
    const ctx = this.ctx, d = this.director, k = this.pixelRatio, S = d.scale;
    const W = this.cssW, H = this.cssH;
    const night = this.tod === 'night';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#10141c'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const worldTransform = (): void => {
      ctx.setTransform(k * S, 0, 0, k * S, k * (W / 2 - (d.x - d.shakeX) * S), k * (H / 2 - (d.y - d.shakeY) * S));
    };
    worldTransform();
    const vp = { x0: d.x - W / 2 / S - 2, y0: d.y - H / 2 / S - 2, x1: d.x + W / 2 / S + 2, y1: d.y + H / 2 / S + 2 };

    // ---- environment
    drawStadiumGround(ctx, this.stadium, vp);
    this.pitch.draw(ctx, S, vp, this.time);
    this.drawDrill(ctx, S);
    this.pitch.drawGoals(ctx, S, { x: bx, y: by, z: bz }, night);
    this.pitch.drawFlags(ctx, this.time, S);
    drawCrowd(ctx, this.stadium, this.time, this.crowdExcite, vp);
    this.drawDugouts(ctx);

    // ---- wear marks
    this.wearT += dt;
    if (this.quality.pitchWear && !this.replay && this.wearT > 0.4) {
      this.wearT = 0;
      for (const { p } of players) { if (p.speed > 3 || p.isGK()) this.pitch.wear(p.x, p.y, p.isGK() ? 0.6 : Math.min(1, p.speed / 8)); }
    }

    // ---- ground markers (under the players)
    this.drawGroundMarkers(ctx, S, rf);

    // ---- shadows
    const PS = clamp(2.4 * Math.pow(20 / Math.max(S, 6), 0.45), 2.0, 3.3);
    this.drawShadows(ctx, players, bx, by, bz, PS);

    // ---- players: update poses, then draw in painter's order
    const drawList: Array<{ pv: PlayerView; rp: RenderPlayer; p: MPlayer | null; sy: number }> = [];
    for (const e of players) {
      const { pv, rp, p } = e;
      if (!rp.visible) continue;
      const dxb = bx - rp.x, dyb = by - rp.z;
      const cf = Math.cos(rp.face), sf = Math.sin(rp.face);
      const near = Math.hypot(dxb, dyb) < 3.2;
      const bl: BallLocal | null = near ? { x: dxb * cf + dyb * sf, y: -dxb * sf + dyb * cf, z: bz } : null;
      // head looks at the ball when it matters, otherwise forward
      let look: number | null = null;
      if (Math.hypot(dxb, dyb) < 22 && !rp.hasBall) look = angleDiff(rp.face, Math.atan2(dyb, dxb));
      pv.painter.update(pv.anim, rp, bl, look, dt, this.time, 'player');
      if (this.quality.footTrails && (rp.state === 'kick' || rp.state === 'skill' || rp.state === 'tackle')) {
        pv.painter.computeFeet(pv.anim, rp);
        const f = pv.painter.footWorld;
        const useR = pv.anim.fRl >= pv.anim.fLl;
        pushTrail(useR ? pv.anim.trailR : pv.anim.trailL, useR ? f.rx : f.lx, useR ? f.ry : f.ly, 8);
      } else { if (pv.anim.trailL.length) pv.anim.trailL.splice(0, 2); if (pv.anim.trailR.length) pv.anim.trailR.splice(0, 2); }
      // slide/sprint dust
      if (!this.replay) this.playerFx(pv, rp, p, dt);
      pv.sx = d.toScreenX(rp.x); pv.sy = d.toScreenY(rp.z);
      drawList.push({ pv, rp, p, sy: rp.z });
    }
    drawList.sort((a, b) => a.sy - b.sy);

    // foot trails
    if (this.quality.footTrails) this.drawFootTrails(ctx, drawList, S);

    // officials (referee + assistants) join the list
    this.updateOfficials(dt, drawList);

    const u = S * PS; // pixels per metre of figure space (screen units)
    ctx.setTransform(k, 0, 0, k, 0, 0);
    // legs
    for (const e of drawList) e.pv.painter.drawLegs(ctx, e.pv.anim, e.pv.style, e.rp, e.pv.sx, e.pv.sy, u);
    // ball (low) between legs and bodies so boots seem to touch it
    const highBall = bz > 1.3;
    if (!highBall) this.drawBall(ctx, bx, by, bz, S, dt);
    const showNum = S > 12;
    for (const e of drawList) e.pv.painter.drawBody(ctx, e.pv.anim, e.pv.style, e.rp, e.pv.sx, e.pv.sy, u, showNum);
    if (highBall) this.drawBall(ctx, bx, by, bz, S, dt);


    // ---- world fx
    worldTransform();
    this.particles.draw(ctx, S);
    drawRoofs(ctx, this.stadium, night);
    this.drawPopups(ctx);

    // ---- lighting
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (this.quality.lighting) {
      this.lighting.draw(ctx, W, H, (x, y) => [d.toScreenX(x), d.toScreenY(y)], S, this.stadium.masts, { x: bx, y: by }, this.flash);
      if (night || this.tod === 'dusk') {
        // emissive elements stay bright: boards and floodlight heads are redrawn after the darkness
        worldTransform();
        this.drawBoardsNow(ctx, true);
        this.drawMastLamps(ctx);
        ctx.setTransform(k, 0, 0, k, 0, 0);
      } else { worldTransform(); this.drawBoardsNow(ctx, false); ctx.setTransform(k, 0, 0, k, 0, 0); }
    } else { worldTransform(); this.drawBoardsNow(ctx, false); ctx.setTransform(k, 0, 0, k, 0, 0); }

    // ---- screen space
    this.weather.draw(ctx, W, H, night);
    if (this.quality.vignette) vignette(ctx, W, H, GRADES[this.opts.grade].vignette);
    if (this.replay) this.drawReplayFrame(ctx, W, H);
    if (this.letterbox > 0.01) { ctx.fillStyle = '#000'; const lb = this.letterbox * H * 0.1; ctx.fillRect(0, 0, W, lb); ctx.fillRect(0, H - lb, W, lb); }
    if (this.fade > 0.01) { ctx.fillStyle = `rgba(0,0,0,${this.fade})`; ctx.fillRect(0, 0, W, H); }
  }

  private drawBoardsNow(ctx: CanvasRenderingContext2D, night: boolean): void {
    const m = this.match;
    const cycle = this.boardT / 9;
    const set = ((Math.floor(cycle) % 3) + 3) % 3;
    const fade = clamp01((cycle - Math.floor(cycle) - 0.88) / 0.12);
    const led = `${m.teams[0].short}  ${m.teams[0].score} – ${m.teams[1].score}  ${m.teams[1].short}`;
    drawBoards(ctx, this.stadium, set, fade, led, this.time);
    void night;
  }

  private drawMastLamps(ctx: CanvasRenderingContext2D): void {
    for (const l of this.stadium.masts) {
      ctx.fillStyle = '#1b2230'; ctx.fillRect(l.x - 1.8, l.y - 0.9, 3.6, 1.8);
      ctx.fillStyle = '#fff4d6';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { ctx.beginPath(); ctx.arc(l.x - 1.2 + i * 0.8, l.y - 0.4 + j * 0.8, 0.26, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  private drawDrill(ctx: CanvasRenderingContext2D, S: number): void {
    for (const m of this.drill) {
      const pulse = m.pulse ? 1 + Math.sin(this.time * 6) * 0.08 : 1;
      const r = (m.r ?? 0.6) * pulse;
      if (m.kind === 'cone') {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(m.x + 0.1, m.y + 0.12, r * 0.55, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(m.x, m.y, r * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.beginPath(); ctx.arc(m.x, m.y, r * 0.2, 0, Math.PI * 2); ctx.fill();
      } else if (m.kind === 'zone') {
        ctx.fillStyle = m.color; ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = m.color; ctx.lineWidth = Math.max(0.08, 2.5 / S); ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.stroke();
      } else {
        if (m.label) { ctx.font = '800 0.7px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = m.color; ctx.fillText(m.label, m.x, m.y - r - 0.4); }
        ctx.strokeStyle = m.color; ctx.lineWidth = Math.max(0.12, 3 / S); ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(m.x, m.y, r * 0.35, 0, Math.PI * 2); ctx.fillStyle = m.color; ctx.globalAlpha = 0.6; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }

  /** Dugouts with substitutes and staff in the technical areas below the near touchline. */
  private drawDugouts(ctx: CanvasRenderingContext2D): void {
    const y0 = HALF_W + 1.8;
    for (const side of [0, 1] as const) {
      const t = this.match.teams[side];
      const cx = side === 0 ? -15 : 15;
      // bench shell
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(cx - 7.1, y0 + 0.25, 14.2, 2.9);
      ctx.fillStyle = 'rgba(180,200,220,0.22)'; ctx.fillRect(cx - 7, y0, 14, 2.8);
      ctx.strokeStyle = 'rgba(230,238,248,0.7)'; ctx.lineWidth = 0.1; ctx.strokeRect(cx - 7, y0, 14, 2.8);
      ctx.fillStyle = '#2b3342'; ctx.fillRect(cx - 6.6, y0 + 1.5, 13.2, 0.5);
      const n = Math.min(9, t.bench.length + 2);
      for (let i = 0; i < n; i++) {
        const px = cx - 6 + i * (12 / Math.max(1, n - 1));
        const react = this.dugoutReact > 0 && this.lastGoalSide === side ? Math.abs(Math.sin(this.time * 9 + i)) * 0.35 : 0;
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(px + 0.12, y0 + 1.12, 0.38, 0.26, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = i < 2 ? '#1f2937' : t.kit.secondary; ctx.beginPath(); ctx.ellipse(px, y0 + 1.0 - react, 0.34, 0.24, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = SKIN_TONES[(i * 3 + side) % 5]!; ctx.beginPath(); ctx.arc(px, y0 + 0.85 - react, 0.14, 0, Math.PI * 2); ctx.fill();
      }
      // manager paces along the technical area
      const mx = cx + Math.sin(this.benchWalk * 0.35 + side * 2) * 4.5 + (this.dugoutReact > 0 && this.lastGoalSide === side ? Math.sin(this.time * 8) * 0.5 : 0);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(mx + 0.15, y0 - 0.55, 0.42, 0.28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.ellipse(mx, y0 - 0.72, 0.36, 0.26, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = SKIN_TONES[(side + 1) % 5]!; ctx.beginPath(); ctx.arc(mx, y0 - 0.9, 0.14, 0, Math.PI * 2); ctx.fill();
    }
  }

  private drawShadows(ctx: CanvasRenderingContext2D, players: Array<{ rp: RenderPlayer }>, bx: number, by: number, bz: number, PS: number): void {
    if (this.quality.shadows === 'off') return;
    const night = this.tod === 'night', dusk = this.tod === 'dusk';
    const ox = night ? 0.12 : dusk ? 0.95 : 0.34, oy = night ? 0.16 : dusk ? 0.45 : 0.46;
    const a = night ? 0.22 : dusk ? 0.3 : this.weatherKind === 'clear' ? 0.3 : 0.16;
    for (const { rp } of players) {
      if (!rp.visible) continue;
      const lying = rp.state === 'slide' || rp.state === 'down' || rp.state === 'dive';
      const jump = rp.state === 'jump' || rp.state === 'dive' ? 0.15 : 0;
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.beginPath();
      if (lying) ctx.ellipse(rp.x + ox * 1.1, rp.z + oy * 1.1, 0.78 * PS * 0.62, 0.34 * PS * 0.6, rp.face, 0, Math.PI * 2);
      else ctx.ellipse(rp.x + ox * (1 + jump), rp.z + oy * (1 + jump), 0.34 * PS * 0.9, 0.32 * PS * 0.75, Math.atan2(oy, ox), 0, Math.PI * 2);
      ctx.fill();
      if (this.quality.shadows !== 'low' && !lying) { ctx.fillStyle = `rgba(0,0,0,${a * 0.6})`; ctx.beginPath(); ctx.ellipse(rp.x + ox * 1.9, rp.z + oy * 1.9, 0.14 * PS, 0.12 * PS, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    // ball
    const bs = 1 + bz * 0.12;
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.1, a * 1.05 - bz * 0.05)})`;
    ctx.beginPath(); ctx.ellipse(bx + ox * (0.25 + bz * 0.5), by + oy * (0.25 + bz * 0.5), 0.2 * bs, 0.17 * bs, 0, 0, Math.PI * 2); ctx.fill();
  }

  private drawFootTrails(ctx: CanvasRenderingContext2D, list: Array<{ pv: PlayerView }>, S: number): void {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const { pv } of list) for (const tr of [pv.anim.trailL, pv.anim.trailR]) {
      if (tr.length < 6) continue;
      for (let i = 2; i < tr.length; i += 2) {
        const f = i / tr.length;
        ctx.strokeStyle = `rgba(255,255,255,${(f * 0.42).toFixed(3)})`; ctx.lineWidth = Math.max(0.04, (0.05 + f * 0.1) * (S > 8 ? 1 : 0.7));
        ctx.beginPath(); ctx.moveTo(tr[i - 2]!, tr[i - 1]!); ctx.lineTo(tr[i]!, tr[i + 1]!); ctx.stroke();
      }
    }
  }

  private playerFx(pv: PlayerView, rp: RenderPlayer, p: MPlayer, dt: number): void {
    if (rp.state === 'slide') {
      pv.slideT += dt;
      if (pv.slideT > 0.05) {
        pv.slideT = 0;
        this.particles.dust(rp.x + Math.cos(rp.face) * 0.5, rp.z + Math.sin(rp.face) * 0.5, 2, 1.4);
        this.pitch.skid(rp.x, rp.z, Math.cos(rp.face), Math.sin(rp.face), 0.7);
      }
    } else pv.slideT = 0;
    if (rp.state === 'normal' && rp.speed > 6.2 && Math.abs(pv.anim.turn) > 5.5 && Math.random() < 0.3) this.particles.dust(rp.x, rp.z, 2, 1);
    if (rp.state === 'normal' && rp.speed > 7.5 && Math.random() < 0.04) this.particles.turf(rp.x, rp.z, -Math.cos(rp.face), -Math.sin(rp.face), 1);
    pv.lastState = p.state;
  }

  private drawBall(ctx: CanvasRenderingContext2D, bx: number, by: number, bz: number, S: number, dt: number): void {
    const d = this.director;
    const R = 0.28;
    const skillLift = this.skillBallLift();
    const z = bz + skillLift;
    const lift = Math.max(0, z) * 0.5;
    const sx = d.toScreenX(bx), sy = d.toScreenY(by) - lift * S;
    const r = Math.max(3.4, R * S * (1 + clamp(z, 0, 12) * 0.05));
    // trail
    const speed = Math.hypot(bx - this.lastBall.x, by - this.lastBall.y) / Math.max(dt, 1e-3);
    this.lastBall.x = bx; this.lastBall.y = by; this.lastBall.z = bz;
    this.trailPts.push(sx, sy);
    if (this.trailPts.length > 24) this.trailPts.splice(0, 2);
    if (this.quality.ballTrail && this.opts.trail && speed > 14 && !this.match.sp) {
      const n = this.trailPts.length / 2;
      ctx.lineCap = 'round';
      for (let i = 1; i < n; i++) {
        const f = i / n;
        ctx.strokeStyle = `rgba(255,255,255,${(f * f * 0.5).toFixed(3)})`; ctx.lineWidth = r * 1.5 * f;
        ctx.beginPath(); ctx.moveTo(this.trailPts[(i - 1) * 2]!, this.trailPts[(i - 1) * 2 + 1]!); ctx.lineTo(this.trailPts[i * 2]!, this.trailPts[i * 2 + 1]!); ctx.stroke();
      }
    } else if (this.trailPts.length > 4) this.trailPts.splice(0, this.trailPts.length - 4);
    // body
    ctx.save(); ctx.translate(sx, sy);
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#e9ebee'); g.addColorStop(1, '#b8bdc6');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // panels follow the real spin
    ctx.fillStyle = '#1a1d24';
    for (const v of this.ballVecs) {
      if (v[2] < 0.05) continue;
      const pr = r * 0.34 * (0.45 + 0.55 * v[2]);
      ctx.save(); ctx.translate(v[0] * r * 0.66, v[1] * r * 0.66);
      ctx.rotate(Math.atan2(v[1], v[0])); ctx.scale(0.45 + 0.55 * v[2], 1);
      ctx.beginPath(); ctx.arc(0, 0, pr, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.strokeStyle = 'rgba(10,14,20,0.6)'; ctx.lineWidth = Math.max(1, r * 0.1); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  /** The ball is flicked in the air by lift/flick skills even though the simulation keeps it low. */
  private skillBallLift(): number {
    const o = this.match.owner;
    if (!o || o.state !== 'skill' || !o.skill) return 0;
    const mv = skillById(o.skill.id);
    if (!mv) return 0;
    const u = clamp01(o.skill.t / o.skill.dur);
    if (mv.anim === 'lift') return Math.sin(u * Math.PI) * 1.5;
    if (mv.anim === 'flick') return Math.sin(clamp01((u - 0.3) / 0.5) * Math.PI) * 0.7;
    if (mv.anim === 'hop') return Math.abs(Math.sin(u * Math.PI * 4)) * 0.3;
    return 0;
  }

  private drawGroundMarkers(ctx: CanvasRenderingContext2D, S: number, rf: Float32Array | null): void {
    const m = this.match;
    const lw = Math.max(0.05, 1.5 / S);
    // set-piece guides
    const sp = m.sp;
    if (sp && sp.phase !== 'done' && !this.replay) {
      const taker = sp.taker;
      if (sp.phase === 'ready' && ['freeKick', 'indirectFreeKick'].includes(sp.type)) {
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.setLineDash([0.4, 0.4]); ctx.lineWidth = lw;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 9.15, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (rf) this.drawOffsideLine(ctx, rf, lw);
  }

  private drawOffsideLine(ctx: CanvasRenderingContext2D, rf: Float32Array, lw: number): void {
    const bx = rf[0]!;
    if (Math.abs(bx) < 18) return;
    const sgn = Math.sign(bx);
    let best: number[] | null = null;
    for (const t of [0, 1]) { const gx = rf[12 + t * 11 * PF]!; if (Math.sign(gx) === sgn && Math.abs(gx) > 25) { best = []; for (let i = 0; i < 11; i++) { const o = 12 + (t * 11 + i) * PF; if (rf[o + 3] !== 99) best.push(rf[o]! * sgn); } } }
    if (!best || best.length < 2) return;
    best.sort((a, b) => b - a);
    ctx.strokeStyle = 'rgba(255,210,63,0.6)'; ctx.lineWidth = lw * 1.5; ctx.setLineDash([0.8, 0.6]);
    ctx.beginPath(); ctx.moveTo(best[1]! * sgn, -HALF_W); ctx.lineTo(best[1]! * sgn, HALF_W); ctx.stroke(); ctx.setLineDash([]);
  }

  private drawPopups(ctx: CanvasRenderingContext2D): void {
    for (const pp of this.popups) {
      const f = pp.t / 1.8;
      ctx.globalAlpha = f < 0.12 ? f / 0.12 : 1 - Math.max(0, (f - 0.6) / 0.4);
      ctx.font = `800 ${pp.size}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const y = pp.y - f * 1.8;
      ctx.lineWidth = pp.size * 0.18; ctx.strokeStyle = 'rgba(5,8,15,0.85)'; ctx.strokeText(pp.text, pp.x, y);
      ctx.fillStyle = pp.color; ctx.fillText(pp.text, pp.x, y);
    }
    ctx.globalAlpha = 1;
  }

  private drawReplayFrame(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(30,60,120,0.16)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(30,60,120,0.16)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.strokeRect(10, 10, W - 20, H - 20);
  }

  private updateOfficials(dt: number, list: Array<{ pv: PlayerView; rp: RenderPlayer; p: MPlayer | null; sy: number }>): void {
    const m = this.match;
    const d = this.director;
    const r = m.ref;
    const rv = this.refView;
    const sp = Math.hypot(r.vx, r.vy);
    rv.lastStride += sp * dt / (1.6 + 0.27 * sp);
    const rrp: RenderPlayer = { visible: true, x: r.x, z: r.y, face: r.face, state: 'normal', stateName: '', stateT: 0, stateDur: 0, speed: sp, stride: rv.lastStride, hasBall: false, ballSide: 'R', dominantFoot: 'R', weakFoot: 3, tired: 0, keeper: false, skillAnim: null, skillU: 0, skillSide: 1, diveSide: 1, diveH: 0, celebT: this.time, kickPower: 0 };
    rv.rp = rrp; rv.painter.update(rv.anim, rrp, null, null, dt, this.time, 'referee');
    rv.sx = d.toScreenX(r.x); rv.sy = d.toScreenY(r.y);
    list.push({ pv: rv, rp: rrp, p: null, sy: r.y });
    for (let i = 0; i < 2; i++) {
      const a = m.assistants[i]!; const av = this.assistViews[i]!;
      const arp: RenderPlayer = { visible: true, x: a.x, z: a.y, face: a.side > 0 ? -Math.PI / 2 : Math.PI / 2, state: 'normal', stateName: '', stateT: 0, stateDur: 0, speed: 0, stride: 0, hasBall: false, ballSide: 'R', dominantFoot: 'R', weakFoot: 3, tired: 0, keeper: false, skillAnim: null, skillU: 0, skillSide: 1, diveSide: 1, diveH: 0, celebT: this.time, kickPower: 0 };
      av.rp = arp; av.painter.update(av.anim, arp, null, null, dt, this.time, 'assistant');
      if (i === 0 && a.flag) { av.anim.hRx = 0.55; av.anim.hRy = 0.3; }
      av.sx = d.toScreenX(a.x); av.sy = d.toScreenY(a.y);
      list.push({ pv: av, rp: arp, p: null, sy: a.y });
    }
    list.sort((x, y) => x.sy - y.sy);
  }

  dispose(): void {
    this.stadium.dispose();
    this.particles.clear();
    this.canvas.style.filter = '';
  }
}


void lerp; void PLAYER_COLORS;
export type { PState };
