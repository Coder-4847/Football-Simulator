import { EventBus } from '../core/events';
import { RNG } from '../core/rng';
import { angleDiff, clamp, clamp01, dampAngle, lerp } from '../core/math';
import type { Player } from '../data/types';
import { formationById } from '../data/formations';
import { ratingAt } from '../data/rating';
import { Ball, goalScored, predictCrossing, SURFACES } from './ball';
import {
  BALL_R, GOAL_H, HALF_GOAL, HALF_L, HALF_W, PITCH_L, PITCH_W, PLAYER_R, other, type Side,
} from './constants';
import { MPlayer, Team, newIntent, type TeamSetup } from './entities';
import { defaultMatchConfig, DIFF_PARAMS, type DiffParams, type MatchConfig, type MatchEvents, type PassKind, type Phase } from './types';
import { updateTeamAI, updateHalfBreakAI } from './ai';
import { updateKeepers } from './keeper';
import {
  adjudicateOffsideTouch, callFoul, checkAdvantage, handleOutOfPlay, resolveTackleIntent, updateSetPiece, startSetPiece, type SetPiece, updateRulesTimers,
} from './rules';
import { Shootout } from './shootout';
import { ReplayBuffer } from './replay';
import { commentate } from './commentary';
import { applyActiveSkills, skillBallTarget } from './skillrun';
import { resolveAerial } from './aerial';
import { installSetPieceAI } from './ai';
import type { MPlayer as _MP } from './entities';

export interface PassInfo {
  passer: MPlayer; receiver: MPlayer | null; time: number; kind: PassKind;
  offside: Map<number, number>; tx: number; ty: number; noOffside: boolean; completed: boolean;
  keyPass: boolean;
}

export interface ShotInfo { shooter: MPlayer; time: number; xg: number; onTarget: boolean }

export interface AdvantageState { side: Side; until: number; x: number; y: number; offender: MPlayer; victim: MPlayer; card: 'yellow' | 'red' | null; penalty: boolean }

export class Match {
  readonly bus = new EventBus<MatchEvents>();
  readonly rng: RNG;
  readonly ball = new Ball();
  readonly teams: [Team, Team];
  readonly diff: DiffParams;
  replay = new ReplayBuffer();

  time = 0;
  phase: Phase = 'intro';
  phaseT = 0;
  period = 1;               // 1,2 normal; 3,4 extra time; 5 shootout
  periodClock = 0;          // game seconds in the current period
  readonly clockScale: number;
  addedTime = 0;            // game seconds added to the current period
  addedAnnounced = false;
  periodExpired = false;
  /** accumulated "stoppage" game seconds in this period used to compute added time */
  stoppageAcc = 0;

  owner: MPlayer | null = null;
  lastTouch: MPlayer | null = null;
  prevTouch: MPlayer | null = null;   // the toucher before lastTouch (assist detection)
  lastTouchT = 0;
  lastOwnerSide: Side | null = null;
  possessionSide: Side | null = null;
  passInfo: PassInfo | null = null;
  shotInfo: ShotInfo | null = null;
  sp: SetPiece | null = null;
  adv: AdvantageState | null = null;
  shootout: Shootout | null = null;
  goalInfo: { side: Side; scorer: MPlayer; t: number } | null = null;
  lastStopReason = '';
  /** whistle was just blown by the referee for a foul: player positions for restart */
  inPenaltyAreaFoul = false;
  ballInGoalKeeperHands: MPlayer | null = null;
  ended = false;
  winner: Side | null = null;
  /** referee / assistants world positions (render reads these) */
  ref = { x: 0, y: 12, face: 0, vx: 0, vy: 0 };
  assistants = [{ x: 0, y: HALF_W + 1.5, flag: 0, side: 1 }, { x: 0, y: -HALF_W - 1.5, flag: 0, side: -1 }];
  flagT = 0;
  moments: Array<{ t: number; kind: string; side: Side; minute: number; text: string }> = [];
  /** mostly informational: per-team possession seconds */
  stats = { possessionTime: [0, 0] as [number, number] };
  heat: [Float32Array, Float32Array] = [new Float32Array(30 * 20), new Float32Array(30 * 20)];
  passMap: Array<{ side: Side; x0: number; y0: number; x1: number; y1: number; ok: boolean }> = [];
  halfScore: [number, number] = [0, 0];
  injuryQueue: MPlayer[] = [];
  /** human prompts that need UI: substitutions after injuries */
  pendingSubPrompt: { side: Side; player: MPlayer } | null = null;
  autoSubPending: Array<{ side: Side; off: MPlayer; on: Player; injury: boolean }> = [];
  windowsUsed: [number, number] = [0, 0];
  private windowOpen: [boolean, boolean] = [false, false];
  tick = 0;
  /** gk handling: sent-off goalkeeper replaced */
  all: MPlayer[] = [];
  dynamicBonus = 0;
  lastTouchByFoot = true;
  private expiredAt = 0;
  eventLog: Array<{ minute: number; type: 'goal' | 'yellow' | 'red' | 'injury' | 'sub'; side: Side; player: string; assist?: string; text: string }> = [];
  penaltyKick: { taker: MPlayer; t: number; side: Side } | null = null;
  missedOffside: { player: MPlayer; t: number } | null = null;
  varCheck: { kind: 'penalty' | 'red' | 'goal'; offender?: MPlayer; victim?: MPlayer; card?: 'yellow' | 'red' | null } | null = null;
  calledForPass: { player: MPlayer; until: number } | null = null;
  /** after a kick-off the receiving side's AI holds its half briefly so the first pass always connects */
  kickoffGuard: { side: Side; until: number } | null = null;
  pressCall: [number, number] = [0, 0];
  runRequest: { side: Side; until: number } | null = null;
  aiTakeSetPiece: ((m: Match, sp: SetPiece) => void) | null = null;
  private trackTick = -1;
  private track: Array<{ t: number; x: number; y: number; z: number }> = [];

  windowsUsedFor(side: Side): number { return this.windowsUsed[side]; }
  notifyPenaltyTaken(_taker: MPlayer, _spec: unknown): void { /* hook for UI */ }
  /** True while the game is only waiting (goal celebration, set-up of a dead ball, injury stoppage) and the player may skip ahead. */
  canSkip(): boolean {
    if (this.phase === 'goal') return this.phaseT > 0.8 && !this.varStarted;
    if (this.phase === 'injury') return this.phaseT > 0.5;
    if (this.phase === 'setpiece' && this.sp) {
      if (this.sp.phase === 'setup') return true;
      return this.sp.phase === 'ready' && !!this.sp.taker && this.sp.t - this.sp.readyAt < 0.9;
    }
    return false;
  }

  /** Skip the waiting: players snap to their set-piece spots and the restart happens straight away. */
  skipWaiting(): boolean {
    if (!this.canSkip()) return false;
    if (this.phase === 'goal') { this.phaseT = Math.max(this.phaseT, 5.6); return true; }
    if (this.phase === 'injury') { this.phaseT = Math.max(this.phaseT, 3.6); return true; }
    const sp = this.sp!;
    if (sp.phase === 'setup') {
      for (const p of this.all) {
        if (!p.active() || p.state === 'down') continue;
        p.x = p.px = p.tx; p.y = p.py = p.ty; p.vx = p.vy = 0;
      }
      sp.t = Math.max(sp.t, sp.maxSetup, 1.3);
    } else sp.readyAt -= 1;
    return true;
  }

  forceResume(): void { if (this.sp) { this.sp.phase = 'done'; this.sp = null; } this.phase = 'play'; }
  requestRun(side: Side): void { this.runRequest = { side, until: this.time + 2 }; }
  requestPress(side: Side, from: MPlayer): void { this.pressCall[side] = this.time + 3.5; void from; }
  keeperCharge(side: Side): void { const gk = this.keeperOf(side); if (gk) gk.gk.claim = { x: this.ball.x, y: this.ball.y, t: this.time + 0.6, punch: false }; }

  /** Predicted ball path (cached per tick): samples every 0.15 s for 3 s. */
  getBallTrack(): Array<{ t: number; x: number; y: number; z: number }> {
    if (this.trackTick === this.tick) return this.track;
    this.trackTick = this.tick;
    const b = this.ball;
    let x = b.x, y = b.y, z = b.z, vx = b.vx, vy = b.vy, vz = b.vz;
    const out: Array<{ t: number; x: number; y: number; z: number }> = [{ t: 0, x, y, z }];
    const dt = 0.05;
    for (let i = 1; i <= 60; i++) {
      vz -= 9.81 * dt;
      const sp = Math.hypot(vx, vy, vz);
      const f = Math.max(0, 1 - 0.0132 * sp * dt);
      vx *= f; vy *= f; vz *= f;
      x += vx * dt; y += vy * dt; z += vz * dt;
      if (z < BALL_R) {
        z = BALL_R;
        if (vz < -1) vz = -vz * 0.6; else vz = 0;
        const v = Math.hypot(vx, vy);
        if (v > 0) { const nv = Math.max(0, v - 0.9 * dt); vx *= nv / v; vy *= nv / v; }
      }
      if (i % 3 === 0) out.push({ t: i * dt, x, y, z });
    }
    this.track = out;
    return out;
  }

  constructor(public cfg: MatchConfig, home: TeamSetup, away: TeamSetup) {
    this.cfg = { ...defaultMatchConfig(), ...cfg };
    this.rng = new RNG(`m:${this.cfg.seed}`);
    this.diff = DIFF_PARAMS[this.cfg.difficulty];
    this.clockScale = 45 / this.cfg.halfLength;
    this.teams = [new Team(0, home), new Team(1, away)];
    this.teams[0].dir = 1; this.teams[1].dir = -1;
    this.init(home, away);
    this.foulHandler = callFoul;
    installSetPieceAI(this);
    this.ball.surface = this.cfg.weather === 'rain' ? SURFACES.wet : this.cfg.weather === 'snow' ? SURFACES.snow : SURFACES.dry;
    this.ball.onEvent = (e): void => {
      if (e.kind === 'post') this.bus.emit('post', { hit: 'post' });
      else if (e.kind === 'bar') this.bus.emit('post', { hit: 'bar' });
      else if (e.kind === 'net') this.bus.emit('netHit', { speed: e.speed });
      else if (e.kind === 'bounce') this.bus.emit('bounce', { speed: e.speed });
    };
    this.ball.reset(0, 0);
    this.bus.on('goal', (e) => this.eventLog.push({ minute: e.minute, type: 'goal', side: e.side, player: e.scorer.data.id, assist: e.assist?.data.id, text: `${e.scorer.data.shortName}${e.assist ? ` (assist ${e.assist.data.shortName})` : ''}${e.penalty ? ' (pen)' : ''}${e.ownGoal ? ' (og)' : ''}` }));
    this.bus.on('card', (e) => this.eventLog.push({ minute: this.minute(), type: e.color, side: e.player.side, player: e.player.data.id, text: e.player.data.shortName }));
    this.bus.on('injury', (e) => this.eventLog.push({ minute: this.minute(), type: 'injury', side: e.player.side, player: e.player.data.id, text: e.player.data.shortName }));
    commentate(this);
  }

  // ---------- setup ----------

  static slotToWorld(team: Team, ax: number, ay: number): { x: number; y: number } {
    return { x: team.dir * (-HALF_L + ax * PITCH_L), y: team.dir * (ay - 0.5) * PITCH_W };
  }

  refreshAll(): void {
    this.all = [...this.teams[0].players.filter((p) => p.active()), ...this.teams[1].players.filter((p) => p.active())];
  }

  get diffQuality(): number { return clamp(this.diff.quality + this.dynamicBonus, 0.05, 1); }

  teamOf(p: MPlayer): Team { return this.teams[p.side]; }
  oppOf(p: MPlayer): Team { return this.teams[other(p.side)]; }
  dirOf(side: Side): number { return this.teams[side].dir; }
  keeperOf(side: Side): MPlayer | null { return this.teams[side].players.find((p) => p.isGK() && p.active()) ?? null; }

  /** Depth along the team's attacking direction: -HALF_L (own goal line) .. +HALF_L (opponent goal line) */
  depth(side: Side, x: number): number { return x * this.teams[side].dir; }

  /** Game clock: minutes (float) since match start, including extra periods. */
  gameMinutes(): number {
    const base = this.period === 1 ? 0 : this.period === 2 ? 45 : this.period === 3 ? 90 : 105;
    return base + this.periodClock / 60;
  }
  displayClock(): { minute: number; added: number; text: string } {
    const len = this.periodLength();
    const m = this.gameMinutes();
    const baseStart = this.period === 1 ? 0 : this.period === 2 ? 45 : this.period === 3 ? 90 : 105;
    const periodEndMin = baseStart + len / 60;
    if (m >= periodEndMin) {
      const added = Math.floor((m - periodEndMin) + 1e-6) + 1;
      return { minute: periodEndMin, added, text: `${periodEndMin}+${added}'` };
    }
    const mi = Math.floor(m) + 1;
    return { minute: mi, added: 0, text: `${mi}'` };
  }
  periodLength(): number { return this.period <= 2 ? 45 * 60 : 15 * 60; }
  minute(): number { return Math.max(1, Math.floor(this.gameMinutes()) + 1); }

  // ---------- lifecycle ----------

  /** Builds players from setups; kept separate so subclasses/tests can call it. */
  init(home: TeamSetup, away: TeamSetup): void {
    for (const [side, setup] of [[0, home], [1, away]] as const) {
      const t = this.teams[side];
      t.players = setup.starters.map((pl, i) => {
        const slot = setup.formation.slots[i]!;
        const p = new MPlayer(pl, t, i, slot.pos, slot.role);
        return p;
      });
      t.bench = setup.bench;
    }
    this.refreshAll();
    this.placeForKickoff(0, true);
  }

  startMatch(): void {
    if (this.phase !== 'intro') return;
    this.bus.emit('whistle', { kind: 'start' });
    this.startKickoff(0, true);
  }

  startKickoff(side: Side, teleport: boolean): void {
    this.ball.reset(0, 0);
    this.owner = null;
    this.placeForKickoff(side, teleport);
    startSetPiece(this, { type: 'kickoff', side, x: 0, y: 0 });
  }

  /** Put every player on their half in formation (centre circle respected by setpiece logic). */
  placeForKickoff(side: Side, teleport: boolean): void {
    for (const t of this.teams) {
      for (const p of t.players) {
        if (!p.active()) continue;
        const s = t.formation.slots[p.slot]!;
        let wx = t.dir * (-HALF_L + Math.min(s.x, 0.46) * PITCH_L);
        const wy = t.dir * (s.y - 0.5) * PITCH_W;
        if (p.isGK()) wx = t.dir * (-HALF_L + 3);
        p.anchorX = wx; p.anchorY = wy;
        if (teleport) { p.x = p.px = wx; p.y = p.py = wy; p.vx = p.vy = 0; p.face = p.pface = t.dir > 0 ? 0 : Math.PI; p.setState('normal'); }
      }
    }
    void side;
  }

  // ---------- main step ----------

  step(dt: number): void {
    this.tick++;
    this.savePrev();
    this.time += dt;
    this.phaseT += dt;

    if (this.phase === 'intro' || this.phase === 'paused' || this.phase === 'var') { this.animateOfficials(dt); return; }
    if (this.phase === 'fulltime') { this.stepMovement(dt); this.ball.step(dt / 2); this.ball.step(dt / 2); this.animateOfficials(dt); return; }

    // intents
    for (const t of this.teams) updateTeamAI(this, t, dt);
    if (this.phase === 'halftime' || this.phase === 'extratimeBreak') for (const t of this.teams) updateHalfBreakAI(this, t);

    // player movement
    applyActiveSkills(this, dt);
    this.stepMovement(dt);
    resolveTackleIntent(this);

    // ball
    this.stepBall(dt);
    updateKeepers(this, dt);

    // phases
    switch (this.phase) {
      case 'setpiece': this.tickClock(dt); updateSetPiece(this, dt); break;
      case 'play': this.updatePlay(dt); break;
      case 'goal': this.updateGoal(dt); break;
      case 'shootout': this.shootout?.update(this, dt); break;
      case 'injury': this.updateInjury(dt); break;
      default: break;
    }
    updateRulesTimers(this, dt);
    this.animateOfficials(dt);
    this.replay.record(this);
    this.accumulateHeat(dt);
  }

  private savePrev(): void {
    this.ball.savePrev();
    for (const p of this.all) { p.px = p.x; p.py = p.y; p.pface = p.face; p.pvx = p.vx; p.pvy = p.vy; p.pstride = p.stride; p.pstateT = p.stateT; }
    for (const t of this.teams) for (const p of t.players) if (!p.active()) { p.px = p.x; p.py = p.y; }
  }

  private accumulateHeat(dt: number): void {
    if (this.tick % 30 !== 0) return;
    void dt;
    for (const p of this.all) {
      const gx = clamp(Math.floor(((p.x + HALF_L) / PITCH_L) * 30), 0, 29);
      const gy = clamp(Math.floor(((p.y + HALF_W) / PITCH_W) * 20), 0, 19);
      const a = this.heat[p.side];
      // normalise to attacking left→right for the team
      const gx2 = this.teams[p.side].dir > 0 ? gx : 29 - gx;
      a[gy * 30 + gx2] = (a[gy * 30 + gx2] ?? 0) + 1;
    }
  }

  // ---------- movement ----------

  maxSpeed(p: MPlayer): number {
    const a = p.data.attrs;
    const sprint = 6.4 + 3.4 * (a.sprintSpeed / 99);
    const fatigueMult = this.cfg.fatigue ? 0.8 + 0.2 * Math.pow(p.stamina, 0.6) : 1;
    let v = sprint * fatigueMult;
    if (p.injured) v *= 0.55;
    if (this.cfg.weather === 'rain') v *= 0.985;
    if (this.cfg.weather === 'snow') v *= 0.95;
    if (p.data.traits.includes('Rapid')) v *= 1.015;
    return v;
  }

  private stepMovement(dt: number): void {
    const scaleDrain = 5 / this.cfg.halfLength;
    for (const p of this.all) {
      p.stateT += dt;
      const it = p.intent;
      if (p.state !== 'normal' && p.stateT >= p.stateDur) {
        if (p.state === 'down' && p.injured) { p.stateT = p.stateDur - 0.01; }
        else p.setState('normal');
      }
      const a = p.data.attrs;
      const full = this.maxSpeed(p);
      const hasBall = this.owner === p;
      let cap = it.sprint && p.stamina > 0.04 ? full : full * 0.64;
      if (it.jockey) cap = full * 0.62;
      if (it.precise) cap = Math.min(cap, full * 0.42);
      if (hasBall) cap *= 0.94 + 0.05 * (a.dribbling / 100);
      let mx = it.mx, my = it.my;
      if (this.kickoffGuard && this.time < this.kickoffGuard.until && p.side === this.kickoffGuard.side) {
        // hold the line: no forward movement across the halfway line
        const dd = this.teams[p.side].dir;
        if (this.depth(p.side, p.x) > -1.5 && mx * dd > 0) { mx = 0; if (!my) my = 0; }
        it.sprint = false;
      }
      {
        // intents are low-pass filtered so direction flips ease in instead of snapping
        const f = 1 - Math.exp(-11 * dt);
        p.smx += (mx - p.smx) * f; p.smy += (my - p.smy) * f; mx = p.smx; my = p.smy;
      }
      const mag = Math.hypot(mx, my);
      if (mag > 1) { mx /= mag; my /= mag; }
      let wantVx = mx * cap, wantVy = my * cap;

      let accel = (7.6 + 4.6 * (a.acceleration / 99)) * (it.jockey ? 1.3 : 1);
      let brake = accel * 1.5;
      switch (p.state) {
        case 'slide': { wantVx = 0; wantVy = 0; brake = 4.2; break; }
        case 'down': case 'save': { wantVx = 0; wantVy = 0; brake = 5; break; }
        case 'dive': { wantVx = 0; wantVy = 0; brake = 2.5; break; }
        case 'kick': { wantVx *= 0.7; wantVy *= 0.7; break; }
        case 'tackle': { wantVx *= 0.3; wantVy *= 0.3; break; }
        case 'celebrate': case 'wait': case 'throw': { if (p.state !== 'celebrate') { wantVx *= 0.2; wantVy *= 0.2; } break; }
        case 'stumble': { wantVx *= 0.4; wantVy *= 0.4; break; }
        case 'jump': { wantVx *= 0.6; wantVy *= 0.6; break; }
        case 'skill': { wantVx = 0; wantVy = 0; accel = 0; brake = 0; break; }
        default: break;
      }
      // wet/snow: reduced grip when changing direction
      const grip = this.cfg.weather === 'rain' ? 0.9 : this.cfg.weather === 'snow' ? 0.82 : 1;
      // direction-change penalty: sharp turns reduce acceleration depending on agility
      const sp = Math.hypot(p.vx, p.vy);
      let turnPenalty = 1;
      if (it.jockey) turnPenalty = 1;
      else if (sp > 2 && mag > 0.1) {
        const dot = (p.vx * mx + p.vy * my) / (sp * Math.max(mag, 1e-6));
        turnPenalty = lerp(0.5 + 0.3 * (a.agility / 99), 1, clamp01((dot + 0.3) / 1.3));
      }
      if (this.cfg.weather !== 'clear' && this.cfg.weather !== 'fog' && p.state === 'normal' && turnPenalty < 0.6 && sp > 6.5 && this.rng.chance(this.cfg.weather === 'snow' ? 0.004 : 0.0025)) { p.setState('stumble', 0.55); p.vx *= 0.5; p.vy *= 0.5; }
      if (p.state !== 'skill') {
        const dvx = wantVx - p.vx, dvy = wantVy - p.vy;
        const dl = Math.hypot(dvx, dvy);
        const decel = Math.hypot(wantVx, wantVy) < sp;
        const rate = (decel ? brake : accel) * grip * (decel ? 1 : turnPenalty);
        const step = rate * dt;
        if (dl > step) { p.vx += (dvx / dl) * step; p.vy += (dvy / dl) * step; } else { p.vx = wantVx; p.vy = wantVy; }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const ko = this.sp;
      if (ko && ko.type === 'kickoff' && ko.phase !== 'done' && p !== ko.taker && !(p.isGK())) {
        // before the kick-off every player stays in their own half; the defending side also stays out of the centre circle
        const dd = this.teams[p.side].dir;
        if (p.x * dd > -0.7) { p.x = -0.7 * dd; if (p.vx * dd > 0) p.vx = 0; }
        if (p.side !== ko.side) {
          const r = Math.hypot(p.x, p.y);
          if (r < 10) { const k = 10 / (r || 1); p.x = r ? p.x * k : -dd * 10; p.y = r ? p.y * k : 0; if (p.x * dd > -0.7) p.x = -0.7 * dd; }
        }
      }
      // pitch margin (allow some run-off for throw-ins etc.)
      const mxL = HALF_L + 8, mxW = HALF_W + 4.5;
      p.x = clamp(p.x, -mxL, mxL); p.y = clamp(p.y, -mxW, mxW);

      // facing
      const spd = Math.hypot(p.vx, p.vy);
      let targetFace = p.face;
      if (it.faceAngle !== null) targetFace = it.faceAngle;
      else if (spd > 0.9) targetFace = Math.atan2(p.vy, p.vx);
      else if (mag > 0.2) targetFace = Math.atan2(my, mx);
      const turnRate = (hasBall ? 7 : 9) + 5 * (a.agility / 99) - spd * 0.35;
      if (p.state === 'normal' || p.state === 'kick' || p.state === 'jump' || p.state === 'celebrate') p.face = dampAngle(p.face, targetFace, Math.max(4, turnRate), dt);

      // stride & stamina
      const spd2 = Math.hypot(p.vx, p.vy);
      p.stride += spd2 * dt / (1.6 + 0.27 * spd2);
      p.stats.distance += spd2 * dt;
      if (this.cfg.fatigue && p.state !== 'down') {
        const stamF = 1.45 - a.stamina / 100;
        const wr = p.data.workAtt === 'high' || p.data.workDef === 'high' ? 1.12 : p.data.workAtt === 'low' && p.data.workDef === 'low' ? 0.9 : 1;
        const sprinting = spd2 > full * 0.75;
        const jogging = spd2 > 1.5;
        const drain = sprinting ? 0.0038 : jogging ? 0.00040 : 0;
        const regen = spd2 < 1.5 ? 0.0012 : 0;
        p.stamina = clamp(p.stamina - (drain * stamF * wr - regen) * scaleDrain * dt, 0, 1);
      }
      if (p.celebrate > 0) p.celebrate -= dt;
      p.stats.minutes += dt * this.clockScale / 60;
    }
    // player-player separation
    const n = this.all.length;
    for (let i = 0; i < n; i++) {
      const a = this.all[i]!;
      if (a.state === 'slide' || a.state === 'down') continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.all[j]!;
        if (b.state === 'slide' || b.state === 'down') continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = PLAYER_R * 2;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const wa = 1 + a.data.attrs.strength / 160, wb = 1 + b.data.attrs.strength / 160;
          const ra = wb / (wa + wb), rb = wa / (wa + wb);
          const nx = dx / d, ny = dy / d;
          a.x -= nx * push * 2 * ra; a.y -= ny * push * 2 * ra;
          b.x += nx * push * 2 * rb; b.y += ny * push * 2 * rb;
        }
      }
    }
  }

  // ---------- ball ----------

  private stepBall(dt: number): void {
    const b = this.ball;
    const sub = 2;
    for (let i = 0; i < sub; i++) {
      this.carryBall(dt / sub);
      b.step(dt / sub);
    }
    if (this.phase === 'setpiece' || this.phase === 'goal' || this.phase === 'halftime') {
      // dead-ball handling is in their updaters
    }
    this.resolveContacts();
    resolveAerial(this);
  }

  /** Keep the ball glued to the dribbler with a soft spring (touch-oscillation). */
  private carryBall(dt: number): void {
    const o = this.owner;
    if (!o) return;
    const b = this.ball;
    if (this.ballInGoalKeeperHands === o) return;
    if (o.state === 'down' || o.state === 'slide' || o.state === 'dive' || o.state === 'tackle' || o.sentOff || b.z > 0.6) { this.release(); return; }
    if (this.sp && this.sp.phase !== 'done') return;
    const spd = Math.hypot(o.vx, o.vy);
    const dir = spd > 0.6 ? Math.atan2(o.vy, o.vx) : o.face;
    const full = this.maxSpeed(o);
    const ratio = spd / full;
    const ctl = o.data.attrs.ballControl / 100;
    const osc = Math.sin(o.stride * Math.PI * 2) * (0.16 - ctl * 0.08) * ratio;
    let dist = 0.42 + 0.46 * ratio + osc;
    if (o.intent.precise) dist = 0.4 + osc * 0.3;
    // foot offset
    const side = o.ballSide === 'R' ? 1 : -1;
    const off = 0.1 * side * (1 - ratio);
    let tx = o.x + Math.cos(dir) * dist - Math.sin(dir) * off;
    let ty = o.y + Math.sin(dir) * dist + Math.cos(dir) * off;
    const sk = skillBallTarget(o);
    if (sk) { tx = sk.x; ty = sk.y; }
    const k = sk ? 22 : 16;
    b.vx = o.vx + (tx - b.x) * k;
    b.vy = o.vy + (ty - b.y) * k;
    // very light spin to match rolling
    b.wy = b.vx / BALL_R; b.wx = -b.vy / BALL_R;
    if (Math.hypot(b.x - o.x, b.y - o.y) > 1.9) this.release();
    void dt;
  }

  release(): void {
    this.owner = null;
  }

  /** Strike the ball: clears ownership and records touch. */
  kickBall(p: MPlayer, vx: number, vy: number, vz: number, wx: number, wy: number, wz: number, knuckle: number, tag: string): void {
    const b = this.ball;
    // the ball starts at the kicker's feet
    if (Math.hypot(b.x - p.x, b.y - p.y) > 1.5 && !tag.startsWith('pass:keeper') && !tag.startsWith('shot:header')) {
      // strike executed from distance (e.g. queued action): ball stays where it is
    }
    b.kick(vx, vy, vz, wx, wy, wz, knuckle);
    // the ball is held for a few ms so the striking animation reaches the ball first
    b.frozen = tag.startsWith('shot:header') ? 0 : tag.startsWith('shot') ? 0.055 : tag === 'throw' ? 0.09 : tag.startsWith('pass') ? 0.035 : 0;
    this.owner = null;
    this.setTouch(p, true);
    this.lastTouchByFoot = true;
    p.noTouchUntil = this.time + 0.3 + b.frozen;
    p.setState('kick', 0.34, tag);
    p.stats.touches++;
    this.possessionSide = p.side;
    void tag;
  }

  setTouch(p: MPlayer, kicked = false): void {
    if (this.lastTouch !== p) { this.prevTouch = this.lastTouch; }
    this.lastTouch = p; this.lastTouchT = this.time;
    this.lastOwnerSide = p.side;
    if (kicked) this.possessionSide = p.side;
  }

  registerPass(p: MPlayer, receiver: MPlayer | null, kind: PassKind, tx: number, ty: number): void {
    const setpiece = this.sp !== null && this.sp.phase !== 'done';
    const offside = new Map<number, number>();
    const noOffside = setpiece && ['corner', 'goalKick', 'throwIn', 'kickoff'].includes(this.sp!.type);
    if (this.cfg.offside && !noOffside) {
      const t = this.teams[p.side];
      const dir = t.dir;
      const opp = this.teams[other(p.side)].players.filter((q) => q.active());
      const depths = opp.map((q) => q.x * dir).sort((a, b) => b - a);
      const secondLast = depths[1] ?? depths[0] ?? HALF_L;
      const ballD = this.ball.x * dir;
      for (const q of t.players) {
        if (!q.active() || q === p) continue;
        const d = q.x * dir;
        if (d > 0 && d > ballD + 0.05 && d > secondLast + 0.05) offside.set(q.id, d - Math.max(ballD, secondLast));
      }
    }
    // key pass heuristic: receiver in attacking third and under no offside
    this.passInfo = { passer: p, receiver, time: this.time, kind, offside, tx, ty, noOffside, completed: false, keyPass: false };
  }

  registerShot(p: MPlayer, xg: number, onTarget: boolean): void {
    this.shotInfo = { shooter: p, time: this.time, xg, onTarget };
    if (this.passInfo && this.passInfo.passer.side === p.side && this.time - this.passInfo.time < 6 && this.passInfo.passer !== p) this.passInfo.keyPass = true;
    const pi = this.passInfo;
    if (pi && pi.passer.side === p.side && pi.passer !== p && this.time - pi.time < 8 && xg > 0.07) pi.passer.stats.keyPasses++;
  }

  predictGoalCrossing(): { t: number; y: number; z: number } | null {
    const b = this.ball;
    const sgn = Math.sign(b.vx);
    if (sgn === 0) return null;
    return predictCrossing(b, sgn * HALF_L, 3);
  }

  /** Where will the ball be after t seconds (ground-track estimate for chasing). */
  ballAt(t: number): { x: number; y: number; z: number } {
    const b = this.ball;
    if (b.z > 0.3 || Math.abs(b.vz) > 0.5) {
      // airborne: simple ballistic with bounce loss, coarse
      let x = b.x, y = b.y, z = b.z, vx = b.vx, vy = b.vy, vz = b.vz;
      const dt = 1 / 30;
      for (let s = 0; s < t; s += dt) {
        vz -= 9.81 * dt;
        const f = Math.max(0, 1 - 0.0132 * Math.hypot(vx, vy, vz) * dt);
        vx *= f; vy *= f; vz *= f;
        x += vx * dt; y += vy * dt; z += vz * dt;
        if (z < BALL_R) { z = BALL_R; vz = -vz * 0.6; vx *= 0.9; vy *= 0.9; if (Math.abs(vz) < 1) vz = 0; }
      }
      return { x, y, z };
    }
    const v = Math.hypot(b.vx, b.vy);
    if (v < 0.05) return { x: b.x, y: b.y, z: b.z };
    const decel = 0.0132 * v + 0.9; // approx rolling decel (m/s^2)
    const tStop = v / decel;
    const tt = Math.min(t, tStop);
    const dist = v * tt - 0.5 * decel * tt * tt;
    return { x: b.x + (b.vx / v) * dist, y: b.y + (b.vy / v) * dist, z: b.z };
  }

  /** Resolve who touches the loose ball this tick. */
  private resolveContacts(): void {
    const b = this.ball;
    if (this.phase === 'setpiece' && this.sp && this.sp.phase !== 'done') return;
    if (this.phase === 'goal' || this.phase === 'halftime' || this.phase === 'extratimeBreak') return;
    if (b.inNet || b.frozen > 0) return;
    if (this.owner) {
      // owner may lose it to a tackle only through intent; also check ball stolen by keeper (handled elsewhere)
      this.owner.stats.touches += 0;
      return;
    }
    let best: MPlayer | null = null;
    let bestScore = -1;
    const bs = b.speedXY();
    for (const p of this.all) {
      if (p.noTouchUntil > this.time) continue;
      if (p.state === 'down' || p.state === 'save' || p.state === 'dive' && !p.isGK()) continue;
      if (p.isGK() && this.ballInGoalKeeperHands) continue;
      const dx = b.x - p.x, dy = b.y - p.y;
      const d = Math.hypot(dx, dy);
      const lowReach = p.state === 'slide' ? 1.5 : 0.68;
      let reach = b.z < 0.4 ? lowReach : b.z < 1.2 ? 0.55 : 0;
      if (p.isGK()) reach = Math.max(reach, 0);
      if (reach <= 0 || d > reach) continue;
      // skill-dependent contest score
      const a = p.data.attrs;
      const score = (1 - d / reach) * 0.5 + (a.reactions + a.ballControl) / 400 + this.rng.next() * 0.3
        + (this.passInfo && this.passInfo.receiver === p ? 0.25 : 0)
        + (this.lastTouch && this.lastTouch.side === p.side ? 0 : (a.interceptions / 400));
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!best) return;
    const p = best;
    // touch
    const a = p.data.attrs;
    const relSpeed = Math.hypot(b.vx - p.vx, b.vy - p.vy) + Math.abs(b.vz) * 0.3;
    const isOpp = this.lastTouch !== null && this.lastTouch.side !== p.side;
    const limit = 7 + 15 * (a.ballControl / 100) + (isOpp ? 0 : 3) + (p.intent.precise ? 2 : 0);
    // speculative lunge/slide reach from fast ball: block rather than control
    if (relSpeed <= limit) {
      this.takeControl(p, relSpeed, limit);
    } else {
      // deflection / block
      const fx = this.rng.gauss(0, 2.5), fy = this.rng.gauss(0, 2.5);
      b.vx = b.vx * 0.4 + p.vx * 0.3 + fx; b.vy = b.vy * 0.4 + p.vy * 0.3 + fy;
      b.vz = Math.abs(b.vz) * 0.3 + this.rng.float(0, 1.5);
      p.noTouchUntil = this.time + 0.25;
      this.prevTouch = this.lastTouch; this.lastTouch = p; this.lastTouchT = this.time;
      this.onDeflect(p);
    }
  }

  private onDeflect(p: MPlayer): void {
    // blocks count; handballs
    const b = this.ball;
    const inBox = Math.abs(p.x) > HALF_L - 16.5 && Math.abs(p.y) < 20.16 && Math.sign(p.x) === -this.teams[p.side].dir;
    if (b.z > 0.9 && inBox && this.rng.chance(0.07 * this.cfg.foulFrequency)) {
      this.callFoulAt(p, this.pickOpponentNear(p), 'handball', 0.45);
    }
    if (this.shotInfo && this.time - this.shotInfo.time < 1.5 && this.shotInfo.shooter.side !== p.side) p.stats.ratingEvents++;
  }

  pickOpponentNear(p: MPlayer): MPlayer {
    const opp = this.teams[other(p.side)].players.filter((q) => q.active());
    let best = opp[0]!; let bd = 1e9;
    for (const q of opp) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } }
    return best;
  }

  /** `p` takes the ball under control. */
  takeControl(p: MPlayer, relSpeed: number, limit: number): void {
    const b = this.ball;
    const a = p.data.attrs;
    // first-touch quality: heavy touch when the pass was hard or the player is poor
    const q = clamp01(1 - relSpeed / (limit + 4)) * 0.6 + (a.ballControl / 100) * 0.5 - pressureLocal(this, p) * 0.25;
    const heavy = this.rng.next() > q + 0.35 && relSpeed > 6;
    const prev = this.lastTouch;
    const wasOpp = prev !== null && prev.side !== p.side;
    this.setTouch(p);
    p.stats.touches++;
    if (wasOpp) {
      if (this.passInfo && this.passInfo.passer === prev) { p.stats.interceptions++; this.teams[p.side].stats.interceptions++; }
      this.passInfo = null;
    } else if (this.passInfo && prev && this.passInfo.passer === prev && prev !== p) {
      const pi = this.passInfo;
      if (!pi.completed) {
        pi.completed = true;
        prev.stats.passesCompleted++; this.teams[prev.side].stats.passesCompleted++;
        this.passMap.push({ side: prev.side, x0: pi.tx - 0, y0: pi.ty, x1: p.x, y1: p.y, ok: true });
      }
    }
    // offside is decided at the moment of the touch
    if (this.passInfo && !wasOpp) {
      const pi = this.passInfo;
      if (adjudicateOffsideTouch(this, p, pi)) { this.passInfo = null; return; }
    }
    if (wasOpp) this.passInfo = null;
    if (heavy) {
      const dir = Math.atan2(p.vy, p.vx);
      b.vx = p.vx * 1.1 + Math.cos(dir) * 2.5 + this.rng.gauss(0, 1.1);
      b.vy = p.vy * 1.1 + Math.sin(dir) * 2.5 + this.rng.gauss(0, 1.1);
      b.vz = Math.min(b.vz, 1.2);
      p.noTouchUntil = this.time + 0.2;
      return;
    }
    // possession changes
    if (this.owner !== p) {
      this.owner = p;
      if (this.possessionSide !== p.side) { this.possessionSide = p.side; this.bus.emit('possession', { side: p.side }); }
      if (b.z > 0.5) b.vz = Math.min(b.vz, 0.3);
      b.z = Math.max(BALL_R, Math.min(b.z, 0.5));
      // an advantage ends successfully
      if (this.adv && this.adv.side !== p.side && this.time - (this.adv.until - 4) < 3.5) checkAdvantage(this, true);
    }
  }

  // ---------- phases ----------

  private updatePlay(dt: number): void {
    const b = this.ball;
    // possession accounting
    const ps = this.owner ? this.owner.side : this.possessionSide;
    if (ps !== null) { this.teams[ps].possessionTime += dt; this.stats.possessionTime[ps] += dt; }
    this.tickClock(dt);

    // goal?
    const g = goalScored(b);
    if (g !== null) { this.scoreGoal(g); return; }
    handleOutOfPlay(this);
    checkAdvantage(this, false);
    // shot resolution timers
    if (this.shotInfo && this.time - this.shotInfo.time > 3) this.shotInfo = null;
  }

  private tickClock(dt: number): void {
    if (this.sp?.shootout) return;
    this.periodClock += dt * this.clockScale;
    this.checkPeriodEnd();
  }

  private checkPeriodEnd(): void {
    const len = this.periodLength();
    if (!this.addedAnnounced && this.periodClock >= len) {
      this.addedAnnounced = true;
      const extra = Math.round(clamp(this.stoppageAcc / 60 + this.rng.int(0, 1) + 1, 1, 7));
      this.addedTime = extra * 60;
      this.bus.emit('commentary', { text: `${extra} minute${extra > 1 ? 's' : ''} added`, minute: this.minute() });
    }
    if (this.addedAnnounced && this.periodClock >= len + this.addedTime) { if (!this.periodExpired) this.expiredAt = this.time; this.periodExpired = true; }
    if (this.periodExpired && this.phase === 'play' && this.time - this.expiredAt > 20) this.endPeriod();
  }

  /** Called when a stoppage happens; ends the period if time is up. Returns true if the period ended. */
  maybeEndPeriod(): boolean {
    if (!this.periodExpired) return false;
    this.endPeriod();
    return true;
  }

  endPeriod(): void {
    this.owner = null;
    this.sp = null;
    this.adv = null;
    this.passInfo = null;
    this.bus.emit('whistle', { kind: this.period === 1 ? 'halfTime' : 'fullTime' });
    this.periodExpired = false; this.addedAnnounced = false; this.addedTime = 0; this.stoppageAcc = 0;
    const score: [number, number] = [this.teams[0].score, this.teams[1].score];
    if (this.period === 1) {
      this.phase = 'halftime'; this.phaseT = 0; this.halfScore = [...score];
      this.bus.emit('halfTime', { score });
    } else if (this.period === 2) {
      if (this.cfg.knockout && score[0] === score[1]) {
        if (this.cfg.extraTime) { this.phase = 'extratimeBreak'; this.phaseT = 0; this.bus.emit('extraTime', {}); }
        else if (this.cfg.penalties) this.beginShootout();
        else this.finish(score);
      } else this.finish(score);
    } else if (this.period === 3) { this.phase = 'extratimeBreak'; this.phaseT = 0; }
    else if (this.period === 4) {
      if (score[0] === score[1] && this.cfg.penalties) this.beginShootout();
      else this.finish(score);
    }
  }

  private finish(score: [number, number]): void {
    this.phase = 'fulltime'; this.ended = true;
    this.winner = score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1;
    this.bus.emit('fullTime', { score });
  }

  /** Continue after half-time / extra-time break (UI calls this). */
  startNextPeriod(): void {
    if (this.phase !== 'halftime' && this.phase !== 'extratimeBreak') return;
    this.period++;
    this.periodClock = 0;
    this.addedAnnounced = false; this.addedTime = 0; this.stoppageAcc = 0; this.periodExpired = false;
    // teams swap ends at the start of period 2 and 4
    if (this.period === 2 || this.period === 4) for (const t of this.teams) t.dir = -t.dir;
    // second period of ET kicks off for the team that did not kick off ET1; second half: away team
    const side: Side = this.period === 2 ? 1 : this.period === 3 ? 0 : this.period === 4 ? 1 : 0;
    for (const t of this.teams) this.applyWindowRules(t.side);
    this.startKickoff(side, true);
  }

  private applyWindowRules(side: Side): void { this.windowOpen[side] = false; }

  private beginShootout(): void {
    this.period = 5;
    this.phase = 'shootout'; this.phaseT = 0;
    this.shootout = new Shootout(this);
    this.shootout.begin(this);
  }

  scoreGoal(attackingEnd: 0 | 1): void {
    // `attackingEnd`: 0 means ball in the +x goal, 1 means -x goal
    const sideScored: Side = this.teams[0].dir === (attackingEnd === 0 ? 1 : -1) ? 0 : 1;
    const scorer = this.lastTouch;
    const ownGoal = !!scorer && scorer.side !== sideScored;
    let credit = scorer;
    let assist: MPlayer | null = null;
    if (ownGoal) { credit = scorer; }
    else if (scorer) {
      const pt = this.prevTouch;
      if (pt && pt.side === scorer.side && pt !== scorer && this.time - this.lastTouchT < 10 && this.passInfo?.passer === pt) assist = pt;
      else if (pt && pt.side === scorer.side && pt !== scorer && this.passInfo === null) assist = null;
    }
    const wasPen = this.sp?.type === 'penalty' || this.lastGoalFromPenalty;
    this.lastGoalFromPenalty = false;
    this.teams[sideScored].score++;
    if (credit) { if (!ownGoal) credit.stats.goals++; }
    if (assist) assist.stats.assists++;
    this.goalInfo = { side: sideScored, scorer: credit ?? this.teams[sideScored].players[0]!, t: this.time };
    this.phase = 'goal'; this.phaseT = 0;
    this.owner = null;
    this.stoppageAcc += 40;
    this.bus.emit('whistle', { kind: 'goal' });
    this.bus.emit('goal', { scorer: credit ?? this.goalInfo.scorer, assist, side: sideScored, minute: this.minute(), ownGoal, penalty: !!wasPen });
    this.moments.push({ t: this.time, kind: 'goal', side: sideScored, minute: this.minute(), text: `${credit?.data.shortName ?? ''}` });
    // celebrations
    const t = this.teams[sideScored];
    for (const p of t.players) {
      if (!p.active()) continue;
      p.celebrate = 4.5;
      if (p === credit && !ownGoal) this.bus.emit('celebrate', { player: p });
    }
    // dynamic difficulty nudges quality by scoreline
    if (this.cfg.dynamicDifficulty) {
      const humanSide = this.teams[0].controlled.length ? 0 : this.teams[1].controlled.length ? 1 : null;
      if (humanSide !== null) {
        const diff = this.teams[humanSide].score - this.teams[other(humanSide)].score;
        this.dynamicBonus = clamp(diff * 0.025, -0.12, 0.12);
      }
    }
    // VAR review of goals (optional)
    if (this.cfg.var && !ownGoal) this.pendingVarGoal = true;
  }
  lastGoalFromPenalty = false;
  pendingVarGoal = false;
  private varStarted = false;
  private varEnd = 0;
  missedFoul: { t: number; offender: MPlayer; victim: MPlayer } | null = null;

  /** Returns the reason a goal is chalked off after review, or null if it stands. */
  private varReason(gi: { side: Side; scorer: MPlayer; t: number }): string | null {
    const mo = this.missedOffside;
    if (mo && mo.player.side === gi.side && gi.t - mo.t < 14 && gi.t - mo.t >= 0) return 'Offside in the build-up';
    const mf = this.missedFoul;
    if (mf && mf.offender.side === gi.side && gi.t - mf.t < 12 && gi.t - mf.t >= 0) return 'Foul in the build-up';
    return null;
  }

  private updateGoal(dt: number): void {
    void dt;
    // celebration then kick-off for the conceding side
    const t = this.phaseT;
    for (const p of this.all) {
      if (this.goalInfo && p.side === this.goalInfo.side && p.celebrate > 0) {
        // run toward scorer
        const s = this.goalInfo.scorer;
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (p === s) {
          // run to corner flag / crowd
          const gx = this.teams[this.goalInfo.side].dir * (HALF_L - 6);
          p.intent.mx = (gx - p.x) / 12; p.intent.my = (clamp(p.y, -20, 20) * 1.1 - p.y) / 12; p.intent.sprint = true;
          if (Math.abs(p.x - gx) < 3) { p.intent.mx = 0; p.intent.my = 0; p.setState('celebrate', 3); }
        } else if (d > 3) { p.intent.mx = (s.x - p.x) / d; p.intent.my = (s.y - p.y) / d; p.intent.sprint = false; }
        else { p.intent.mx = 0; p.intent.my = 0; }
      }
    }
    if (this.cfg.var && this.pendingVarGoal) {
      if (!this.varStarted) { this.varStarted = true; this.varEnd = t + 3; this.bus.emit('commentary', { text: 'VAR is checking the goal…', minute: this.minute() }); }
      if (t < this.varEnd) return;
      this.pendingVarGoal = false; this.varStarted = false;
      const gi = this.goalInfo!;
      const reason = this.varReason(gi);
      if (reason) {
        this.bus.emit('var', { kind: 'goal', outcome: 'overturned', reason });
        this.teams[gi.side].score--; gi.scorer.stats.goals = Math.max(0, gi.scorer.stats.goals - 1);
        this.eventLog = this.eventLog.filter((e) => !(e.type === 'goal' && e.player === gi.scorer.data.id && e.side === gi.side)).slice();
        this.owner = null;
        startSetPiece(this, { type: 'indirectFreeKick', side: other(gi.side), x: clamp(this.missedOffside?.player.x ?? this.ball.x * 0 + 30 * -this.teams[gi.side].dir, -HALF_L + 8, HALF_L - 8), y: this.missedOffside?.player.y ?? 0 });
        this.missedOffside = null; this.missedFoul = null;
        return;
      }
      this.bus.emit('var', { kind: 'goal', outcome: 'confirmed', reason: 'No infringement' });
    }
    if (t > 5.5 + (this.varStarted ? 3 : 0)) {
      if (this.maybeEndPeriod()) return;
      const conceding = other(this.goalInfo!.side);
      this.startKickoff(conceding, true);
    }
  }

  private updateInjury(dt: number): void {
    void dt;
    if (this.phaseT > 3.5) {
      const inj = this.injuryQueue.shift();
      if (inj) this.resolveInjury(inj);
      if (this.injuryQueue.length === 0) { this.phase = 'setpiece'; this.phaseT = 0; if (this.sp) this.sp.phase = 'setup'; }
    }
  }

  private resolveInjury(p: MPlayer): void {
    const t = this.teams[p.side];
    this.bus.emit('injury', { player: p });
    if (t.subsMade < this.cfg.maxSubs && t.bench.length > 0) {
      if (t.controlled.length === 0 || this.cfg.headless) {
        const on = this.pickSubFor(p);
        if (on) this.substitute(p.side, p, on, true);
      } else {
        this.pendingSubPrompt = { side: p.side, player: p };
        this.bus.emit('needSub', { side: p.side, player: p });
        const on = this.pickSubFor(p);
        // UI is expected to call substitute(); if it does not within the stoppage, the AI picks (see rules timers)
        if (on && this.cfg.headless) this.substitute(p.side, p, on, true);
      }
    } else {
      p.injured = true;
    }
  }

  // ---------- substitutions ----------

  pickSubFor(off: MPlayer): Player | null {
    const t = this.teams[off.side];
    if (t.bench.length === 0) return null;
    const pos = off.slotPos;
    const scored = t.bench.map((b) => {
      const same = b.positions.includes(pos) ? 12 : 0;
      const grp = (b.positions[0] === 'GK') === (pos === 'GK') ? 0 : -100;
      return { b, s: b.overall + same + grp };
    }).sort((a, b) => b.s - a.s);
    return scored[0]?.b ?? null;
  }

  /** Perform a substitution immediately (callers ensure the ball is dead). */
  substitute(side: Side, off: MPlayer, on: Player, injury = false): boolean {
    const t = this.teams[side];
    if (t.subsMade >= this.cfg.maxSubs) return false;
    const idx = t.bench.indexOf(on);
    if (idx < 0 || !off.active()) return false;
    if (!injury && !this.windowOpen[side]) {
      if (this.windowsUsed[side] >= this.cfg.subWindows && this.period !== 2 || (this.windowsUsed[side] >= this.cfg.subWindows && this.phase !== 'halftime')) {
        if (this.phase !== 'halftime') return false;
      }
      if (this.phase !== 'halftime') { this.windowOpen[side] = true; this.windowsUsed[side]++; }
    }
    t.bench.splice(idx, 1);
    const np = new MPlayer(on, t, off.slot, off.slotPos, off.role);
    np.x = np.px = off.x; np.y = np.py = off.y; np.face = np.pface = off.face;
    np.anchorX = off.anchorX; np.anchorY = off.anchorY; np.stamina = 1;
    np.yellowCards = 0;
    const i = t.players.indexOf(off);
    t.players[i] = np;
    t.bench.push(off.data);
    // off-player data stays on bench list only if not sent off; remove (cannot return)
    t.bench.pop();
    off.sentOff = true; // removed from play (not a red card)
    off.injured = false;
    off.subbedOff = true;
    t.subsMade++;
    t.subs.push({ minute: this.minute(), off: off.data.name, on: on.name, side, injury });
    this.removedPlayers.push(off);
    this.refreshAll();
    if (this.owner === off) this.owner = null;
    this.stoppageAcc += 30;
    this.bus.emit('sub', { side, off, on: on.name, injury });
    return true;
  }
  removedPlayers: MPlayer[] = [];
  closeSubWindow(side: Side): void { this.windowOpen[side] = false; }

  /** Substitutions requested by a human during play; executed at the next stoppage. */
  subQueue: Array<{ side: Side; off: MPlayer; on: Player }> = [];
  queueSub(side: Side, off: MPlayer, on: Player): void {
    this.subQueue = this.subQueue.filter((q) => q.off !== off && q.on !== on);
    this.subQueue.push({ side, off, on });
  }
  applyQueuedSubs(): void {
    const q = this.subQueue; this.subQueue = [];
    for (const s of q) if (s.off.active()) this.substitute(s.side, s.off, s.on);
  }

  /** Changes the formation live: players keep their roles as far as possible. */
  setFormation(side: Side, id: string): void {
    const t = this.teams[side];
    const f = formationById(id);
    t.formation = f;
    const players = t.players.filter((p) => p.active());
    const gk = players.find((p) => p.isGK());
    const field = players.filter((p) => p !== gk);
    const slots = f.slots.map((s, i) => ({ s, i })).filter((x) => x.s.pos !== 'GK');
    const used = new Set<MPlayer>();
    for (const { s, i } of slots) {
      let best: MPlayer | null = null; let br = -1;
      for (const p of field) {
        if (used.has(p)) continue;
        const r = ratingAt(p.data, s.pos);
        if (r > br) { br = r; best = p; }
      }
      if (best) { used.add(best); best.slot = i; best.slotPos = s.pos; best.role = s.role; }
    }
    if (gk) { const gi = f.slots.findIndex((x) => x.pos === 'GK'); gk.slot = gi; }
    // keep the players array indexed by slot for replay/rendering
    t.players.sort((a, b) => a.slot - b.slot);
    this.refreshAll();
  }

  // ---------- fouls (entry point used by deflections) ----------

  callFoulAt(offender: MPlayer, victim: MPlayer, kind: string, severity: number): void {
    // implemented in rules.ts via dynamic import-free indirection to avoid cycles
    this.foulHandler?.(this, offender, victim, kind, severity);
  }
  foulHandler: ((m: Match, o: MPlayer, v: MPlayer, kind: string, sev: number) => void) | null = null;

  // ---------- officials ----------

  private animateOfficials(dt: number): void {
    const b = this.ball;
    // referee shadows play at a distance, staying off the ball line
    const tx = clamp(b.x * 0.8 - 8 * this.teams[0].dir, -HALF_L + 6, HALF_L - 6);
    const ty = clamp(b.y * 0.4 + (b.y > 0 ? -9 : 9), -20, 20);
    const dx = tx - this.ref.x, dy = ty - this.ref.y;
    const d = Math.hypot(dx, dy);
    const sp = Math.min(6.5, d * 1.4);
    if (d > 0.5) { this.ref.vx = (dx / d) * sp; this.ref.vy = (dy / d) * sp; } else { this.ref.vx *= 0.9; this.ref.vy *= 0.9; }
    this.ref.x += this.ref.vx * dt; this.ref.y += this.ref.vy * dt;
    if (Math.hypot(this.ref.vx, this.ref.vy) > 0.5) this.ref.face = dampAngle(this.ref.face, Math.atan2(this.ref.vy, this.ref.vx), 6, dt);
    else this.ref.face = dampAngle(this.ref.face, Math.atan2(b.y - this.ref.y, b.x - this.ref.x), 4, dt);
    // assistants follow the second-last defender line on their side
    for (let i = 0; i < 2; i++) {
      const as = this.assistants[i]!;
      const sideSign = as.side;
      // assistant for the half where the ball is: follow the offside line of the defending team in that half
      const defSide: Side = b.x >= 0 ? (this.teams[0].dir === -1 ? 0 : 1) : (this.teams[0].dir === 1 ? 0 : 1);
      const opp = this.teams[defSide].players.filter((q) => q.active() && !q.isGK());
      const line = opp.length ? (this.teams[defSide].dir > 0 ? Math.min(...opp.map((q) => -q.x)) * -1 : Math.max(...opp.map((q) => -q.x)) * -1) : 0;
      void line;
      const ax = clamp(b.x, -HALF_L + 2, HALF_L - 2);
      as.x += (ax - as.x) * Math.min(1, dt * 2.2);
      as.y = sideSign * (HALF_W + 1.6);
    }
    if (this.flagT > 0) this.flagT -= dt;
    this.assistants[0]!.flag = this.flagT > 0 ? 1 : 0;
  }

  raiseFlag(): void { this.flagT = 2.5; }

  // ---------- management ----------

  /** The user manages this team: AI substitutions are left to the manager and injuries ask for a decision. */
  manage(side: Side): void { if (!this.teams[side].controlled.includes(0)) this.teams[side].controlled.push(0); }

  /** Total of both teams' goals etc for UI. */
  get score(): [number, number] { return [this.teams[0].score, this.teams[1].score]; }

  isDeadBall(): boolean { return this.phase !== 'play'; }
  newIntent = newIntent;
  angleDiff = angleDiff;
  GOALS = { HALF_GOAL, GOAL_H };
}

function pressureLocal(m: Match, p: MPlayer): number {
  let best = 99;
  for (const o of m.teams[other(p.side)].players) {
    if (!o.active()) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < best) best = d;
  }
  return clamp01(1 - (best - 0.6) / 3.2);
}

export { formationById };
