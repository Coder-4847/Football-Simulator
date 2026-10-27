import { GameLoop } from '../core/loop';
import { settings } from '../core/settings';
import { h, clear } from './dom';
import { Hud } from './hud';
import { lineupPanel, modal, statsPanel, subsPanel, tacticsPanel } from './panels';
import { MatchView } from '../render/matchview';
import { qualityFor } from '../render/quality';
import { CAMERA_MODES } from '../render/camera';
import type { InputManager, SlotScheme } from '../input/manager';
import type { Match } from '../match/match';
import type { Side } from '../match/constants';
import type { MatchConfig } from '../match/types';
import { humanContext } from '../match/human';
import { audio } from '../audio/engine';
import { defaultMatchConfig } from '../match/types';

export interface HumanSpec { side: Side; scheme: SlotScheme; keeperOnly?: boolean; lockId?: string }
export interface SessionResult { match: Match; score: [number, number]; winner: Side | null; quit: boolean }

export interface SessionOptions {
  match: Match;
  humans: HumanSpec[];
  input: InputManager;
  onExit: (r: SessionResult) => void;
  skipIntro?: boolean;
  /** called when the user opens settings from the pause menu */
  openSettings?: (parent: HTMLElement) => void;
  /** training sessions pass a hook that runs each frame */
  onTick?: (m: Match, dt: number) => void;
  /** replace the stats panel (e.g. for training) */
  fullTimeTitle?: string;
  hideScoreboard?: boolean;
  noReplays?: boolean;
}

/** Builds the match config from the user's settings. */
export function matchConfigFromSettings(over: Partial<MatchConfig> = {}, touch = false): MatchConfig {
  const s = settings.value;
  const g = s.gameplay;
  const pick = <T,>(v: T | 'random', list: readonly T[]): T => (v === 'random' ? list[Math.floor(Math.random() * list.length)]! : v);
  const assist = { ...s.controls.assist };
  if (touch) { const a = s.controls.touch.autoAssist; assist.pass = Math.max(assist.pass, a); assist.shot = Math.max(assist.shot, a * 0.7); assist.cross = Math.max(assist.cross, a); assist.aim = Math.max(assist.aim, a * 0.6); assist.autoSwitch = true; }
  return {
    ...defaultMatchConfig(), seed: `m${Date.now()}`, halfLength: g.halfLength, difficulty: g.difficulty, refStrictness: g.refStrictness, offside: g.offside, foulFrequency: g.foulFrequency,
    injuries: g.injuries, fatigue: g.fatigue, dynamicDifficulty: g.dynamicDifficulty, var: g.var, extraTime: g.extraTimeAndPens, penalties: g.extraTimeAndPens,
    weather: pick(g.weather, ['clear', 'clear', 'rain', 'fog', 'snow'] as const), timeOfDay: pick(g.timeOfDay, ['day', 'dusk', 'night'] as const), stadiumStyle: g.stadium === 'random' ? Math.floor(Math.random() * 8) : g.stadium,
    assist, loadout: s.controls.skillLoadout, loadoutOverrides: s.controls.skillOverrides, ...over,
  };
}

export class GameSession {
  readonly root = h('div', { style: 'position:absolute;inset:0;background:#000' });
  private canvasWrap = h('div', { style: 'position:absolute;inset:0' });
  private canvas = h('canvas') as HTMLCanvasElement;
  readonly view: MatchView;
  private hud: Hud;
  private loop: GameLoop;
  private paused = false;
  private overlay: HTMLElement | null = null;
  private replayAt = -1;
  private replayDone = false;
  private intro = true;
  private ended = false;
  private resizeFn = (): void => this.view.resize();
  private lastDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  private hadHalftime = false;
  private highlightClips = false;
  private sessionTime = 0;
  private controlled = null as import('../match/entities').MPlayer | null;
  private skipEl = h('button', { class: 'btn skip-chip', style: 'display:none', onclick: (): void => this.doSkip() }, 'Skip');
  private skipHeld = false;
  private swallowT = 0;

  constructor(private parent: HTMLElement, private o: SessionOptions) {
    const m = o.match;
    this.canvasWrap.appendChild(this.canvas);
    this.root.appendChild(this.canvasWrap);
    parent.appendChild(this.root);
    const g = settings.value.graphics;
    const quality = qualityFor(g.preset, g.custom);
    quality.resolutionScale *= g.resolutionScale;
    this.view = new MatchView(this.canvas, m, {
      quality, grade: g.grade, cameraMode: settings.value.gameplay.camera, cameraHeight: settings.value.gameplay.cameraHeight, cameraZoom: settings.value.gameplay.cameraZoom,
      showFps: g.showFps, fpsCap: g.fpsCap, celebrationSeed: 1, trail: g.ballTrail,
    });
    this.hud = new Hud(m, this.view, () => o.input.active);
    this.root.appendChild(this.hud.root);
    this.root.appendChild(this.skipEl);
    window.addEventListener('keydown', this.onSkipKey);
    if (o.hideScoreboard) (this.hud.root.querySelector('.scoreboard') as HTMLElement).style.display = 'none';
    // humans
    o.input.setSlots(o.humans.map((hs) => hs.scheme));
    for (const hs of o.humans) { const hi = m.addHuman(hs.side, hs.keeperOnly); if (hs.lockId) m.humans[hi]!.lockId = hs.lockId; }
    o.input.touch?.setVisible((o.input.active as string) === 'touch' && !!o.skipIntro);
    o.input.onDevice = (d): void => { this.lastDevice = d; o.input.touch?.setVisible(d === 'touch' && !this.paused && !this.intro); };
    // audio
    audio.startCrowd();
    const bus = m.bus;
    bus.on('kick', (e) => { audio.kick(e.power); this.rumble(e.player.human, 20, 0.3); });
    bus.on('bounce', (e) => audio.bounce(e.speed));
    bus.on('netHit', (e) => audio.net(e.speed));
    bus.on('post', () => { audio.post(); audio.groan(); });
    bus.on('tackle', () => audio.tackle());
    bus.on('whistle', (e) => audio.whistle(e.kind === 'fullTime' || e.kind === 'halfTime' ? 'triple' : e.kind === 'goal' ? 'long' : 'short'));
    bus.on('goal', (e) => { audio.roar(1); audio.goalStinger(); this.rumble(e.scorer.human, 400, 1); if (!o.noReplays) this.replayAt = m.time + 1.7; m.replay.mark(`${e.scorer.data.shortName} ${e.minute}'`, 'goal', e.minute); });
    bus.on('save', () => { audio.roar(0.5); });
    bus.on('card', () => audio.card());
    bus.on('shot', (e) => { if (e.xg > 0.2) audio.setExcitement(0.8); });
    bus.on('penalty', () => audio.roar(0.4));
    bus.on('commentary', (e) => audio.speak(e.text));
    bus.on('needSub', () => this.openSubs());
    bus.on('shot', (e) => { if (e.xg > 0.3) m.replay.mark(`${e.player.data.shortName} chance`, 'chance', m.minute()); });

    const ctlBinder = (): void => { /* keeps linter quiet */ };
    ctlBinder();
    this.loop = new GameLoop({ update: (dt) => this.fixedUpdate(dt), render: (a, dt) => this.render(a, dt) }, 1 / 60);
    this.loop.fpsCap = g.fpsCap;
    this.loop.timeScale = settings.value.gameplay.gameSpeed === 'slow' ? 0.8 : settings.value.gameplay.gameSpeed === 'fast' ? 1.25 : 1;
    window.addEventListener('resize', this.resizeFn);
    document.addEventListener('visibilitychange', this.onVis);
    this.beginIntro();
    this.loop.start();
  }

  get match(): Match { return this.o.match; }

  private onVis = (): void => { if (document.hidden && !this.paused && !this.intro && !this.ended) this.pause(); };

  private rumble(human: number, ms: number, str: number): void { if (human >= 0) this.o.input.vibrate(human, ms, str, str * 0.6); }

  // ---------- intro
  private beginIntro(): void {
    const m = this.o.match;
    if (this.o.skipIntro) { this.intro = false; m.startMatch(); return; }
    this.view.setCinematic('lineup');
    this.overlay = lineupPanel(m); this.root.appendChild(this.overlay);
    audio.whistle('short');
    const go = (): void => { if (!this.intro) return; this.intro = false; this.overlay?.remove(); this.overlay = null; this.view.setCinematic(null); m.startMatch(); if ((this.o.input.active as string) === 'touch') this.o.input.touch?.setVisible(true); };
    setTimeout(() => { if (this.intro) this.waitSkip(go); }, 1200);
    setTimeout(go, 9000);
  }
  private waitSkip(go: () => void): void {
    const fn = (): void => { window.removeEventListener('keydown', fn); window.removeEventListener('pointerdown', fn); clearInterval(poll); go(); };
    window.addEventListener('keydown', fn); window.addEventListener('pointerdown', fn);
    const poll = setInterval(() => { for (const p of navigator.getGamepads?.() ?? []) if (p && p.buttons.some((b) => b.pressed)) fn(); }, 100);
  }

  // ---------- loop
  private fixedUpdate(dt: number): void {
    const m = this.o.match;
    const input = this.o.input;
    if (this.intro) return;
    const frames = this.o.humans.map((_, i) => input.frame(i, dt));
    this.handleSkip(frames[0]);
    if (frames[0]?.pressed.pause && !this.overlayBlocksPause()) { if (this.paused) this.resume(); else this.pause(); }
    if (this.paused || this.view.replay) return;
    // goal replay trigger
    if (this.replayAt > 0 && m.time >= this.replayAt && !this.o.noReplays) {
      this.replayAt = -1;
      const frames2 = m.replay.instant(8);
      if (frames2.length > 60) {
        this.hud.setReplay(true);
        this.view.startReplay(frames2, 0.7, () => { this.hud.setReplay(false); });
        return;
      }
    }
    input.aimMode = !!m.sp && m.sp.phase !== 'done' && m.humans.some((hs) => hs.player === m.sp!.taker);
    m.step(dt, frames);
    this.o.onTick?.(m, dt);
    // context for touch + stick yaw
    const hs = m.humans[0];
    this.controlled = hs?.player ?? null;
    if (hs) input.touch?.setContext(humanContext(m, hs), m.sp && m.sp.phase !== 'done' ? (m.sp.type === 'indirectFreeKick' ? 'freeKick' : m.sp.type) : '');
    input.yaw = this.view.director.inputYaw;
    this.phaseWatch();
  }

  private onSkipKey = (e: KeyboardEvent): void => { if (e.code === 'Enter' && !e.repeat) this.doSkip(); };

  /** Skip combo: gamepad X / cross, or both shoulder buttons together (L1 + R1 / Q + E by default). */
  private handleSkip(f: import('../input/actions').FrameInput | undefined): void {
    let x = false;
    for (const g of navigator.getGamepads?.() ?? []) if (g && g.connected && g.buttons[0]?.pressed) x = true;
    const combo = !!f && ((f.pressed.modA && f.down.modB) || (f.pressed.modB && f.down.modA));
    const hit = (x && !this.skipHeld) || combo;
    this.skipHeld = x;
    if (this.swallowT > 0) {
      this.swallowT -= 1 / 60;
      if (f) for (const b of ['b1', 'b2', 'b3', 'b4', 'modA', 'modB'] as const) { f.pressed[b] = false; f.released[b] = false; f.down[b] = false; }
    }
    const can = this.canSkipNow();
    this.skipEl.style.display = can ? '' : 'none';
    if (can) this.skipEl.textContent = `Skip  ${this.lastDevice === 'gamepad' ? '✕ / L1+R1' : this.lastDevice === 'touch' ? '⏭' : 'Enter / Q+E'}`;
    if (hit && can) this.doSkip();
    // keep swallowing while X is still held so the release doesn't fire a pass
    if (this.swallowT <= 0 && x && this.swallowPad && f) { f.pressed.b1 = false; f.released.b1 = false; f.down.b1 = false; }
    if (!x) this.swallowPad = false;
  }
  private swallowPad = false;

  private canSkipNow(): boolean {
    if (this.intro || this.paused || this.overlay) return false;
    return !!this.view.replay || this.o.match.canSkip();
  }

  private doSkip(): void {
    if (!this.canSkipNow()) return;
    if (this.view.replay) { this.replayAt = -1; this.view.stopReplay(); this.hud.setReplay(false); }
    this.o.match.skipWaiting();
    this.replayAt = -1;
    this.swallowT = 0.35; this.swallowPad = true;
    audio.ui('click');
  }

  private overlayBlocksPause(): boolean { return this.overlay !== null && !this.paused; }

  private phaseWatch(): void {
    const m = this.o.match;
    if (m.phase === 'halftime' || m.phase === 'extratimeBreak') {
      if (!this.overlay) this.showHalfTime();
    } else if (m.phase === 'fulltime' && !this.ended) {
      if (!this.overlay) this.showFullTime();
    }
    const c = this.view.director;
    if (m.phase === 'goal' && !c.cinematic && m.phaseT > 0.4 && !this.view.replay) this.view.setCinematic('goal');
    else if (m.phase !== 'goal' && c.cinematic?.kind === 'goal') this.view.setCinematic(null);
    if (m.phase === 'fulltime' && !c.cinematic) this.view.setCinematic('fulltime');
  }

  private render(alpha: number, dt: number): void {
    if (this.paused) alpha = 1;
    this.view.update(alpha, dt, this.controlled);
    this.hud.update(dt, this.o.match.humans, this.paused);
    const m = this.o.match;
    if (!this.paused) audio.setExcitement(m.phase === 'play' ? Math.min(1, 0.25 + m.ball.speed() / 60 + (Math.abs(m.ball.x) > 38 ? 0.25 : 0)) : 0.2);
  }

  // ---------- panels
  private showOverlay(el: HTMLElement): void { this.overlay?.remove(); this.overlay = el; this.root.appendChild(el); this.o.input.touch?.setVisible(false); }
  private closeOverlay(): void { this.overlay?.remove(); this.overlay = null; if (this.o.input.active === 'touch' && !this.paused) this.o.input.touch?.setVisible(true); }

  private showHalfTime(): void {
    const m = this.o.match;
    this.hadHalftime = true;
    const title = m.phase === 'extratimeBreak' ? 'Break before extra time' : 'Half-time';
    const humanSide = m.humans[0]?.side;
    const extras: HTMLElement[] = [];
    if (humanSide !== undefined) {
      extras.push(h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'btn', onclick: (): void => this.showOverlay(modal(subsPanel(m, humanSide, () => this.showHalfTime()))) }, 'Substitutions'),
        h('button', { class: 'btn', onclick: (): void => this.showOverlay(modal(tacticsPanel(m, humanSide, () => this.showHalfTime()))) }, 'Tactics')));
    }
    this.showOverlay(modal(statsPanel(m, title, () => { this.closeOverlay(); m.startNextPeriod(); }, 'Start second half', extras)));
    if (m.phase === 'extratimeBreak') (this.overlay!.querySelector('.btn.primary') as HTMLElement).textContent = 'Continue';
  }

  private showFullTime(): void {
    const m = this.o.match;
    this.ended = true;
    audio.stopCrowd();
    const extra: HTMLElement[] = [];
    const clips = m.replay.clips;
    if (clips.length && !this.o.noReplays) extra.push(h('button', { class: 'btn', onclick: (): void => this.playHighlights() }, `Watch highlights (${clips.length})`));
    this.showOverlay(modal(statsPanel(m, this.o.fullTimeTitle ?? 'Full time', () => this.exit(false), 'Continue', extra)));
  }

  private playHighlights(): void {
    const clips = [...this.o.match.replay.clips];
    this.closeOverlay();
    const next = (): void => {
      const c = clips.shift();
      if (!c) { this.hud.setReplay(false); this.showFullTime(); this.ended = false; return; }
      this.hud.showBanner(c.kind === 'goal' ? 'GOAL' : 'HIGHLIGHT', c.label, 2500);
      this.hud.setReplay(true);
      this.view.startReplay(c.frames, 0.8, next);
    };
    next();
    const skip = (e: KeyboardEvent): void => { if (e.code === 'Space' || e.code === 'Escape') { clips.length = 0; this.view.stopReplay(); window.removeEventListener('keydown', skip); } };
    window.addEventListener('keydown', skip);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true; this.loop.timeScale = 0;
    this.o.input.touch?.setVisible(false);
    audio.ui('click');
    this.showPause();
  }
  resume(): void {
    this.paused = false; this.closeOverlay();
    this.loop.timeScale = settings.value.gameplay.gameSpeed === 'slow' ? 0.8 : settings.value.gameplay.gameSpeed === 'fast' ? 1.25 : 1;
    if (this.o.input.active === 'touch') this.o.input.touch?.setVisible(true);
  }

  private openSubs(): void {
    const m = this.o.match;
    const hs = m.humans.find((q) => q.side === m.pendingSubPrompt?.side);
    if (!hs) return;
    this.showOverlay(modal(subsPanel(m, hs.side, () => { m.pendingSubPrompt = null; this.closeOverlay(); })));
  }

  private showPause(): void {
    const m = this.o.match;
    const side = m.humans[0]?.side ?? 0;
    const list = h('div', { class: 'menu-list' },
      h('button', { class: 'btn primary', onclick: (): void => this.resume() }, 'Resume'),
      h('button', { class: 'btn', onclick: (): void => this.showOverlay(modal(subsPanel(m, side, () => this.showPause()))) }, 'Substitutions'),
      h('button', { class: 'btn', onclick: (): void => this.showOverlay(modal(tacticsPanel(m, side, () => this.showPause()))) }, 'Tactics & formation'),
      h('div', { class: 'field' }, h('label', null, 'Camera'), h('select', { onchange: (e: Event): void => { const v = (e.target as HTMLSelectElement).value as 'broadcast'; this.view.setCameraMode(v); settings.update((s) => { s.gameplay.camera = v; }); } },
        CAMERA_MODES.map((c) => h('option', { value: c.id, selected: this.view.director.mode === c.id }, c.name)))),
      h('div', { class: 'field' }, h('label', null, 'Camera height'), h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.05, value: settings.value.gameplay.cameraHeight, oninput: (e: Event): void => { const v = Number((e.target as HTMLInputElement).value); this.view.director.heightScale = v; settings.update((s) => { s.gameplay.cameraHeight = v; }); } })),
      h('div', { class: 'field' }, h('label', null, 'Camera zoom'), h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.05, value: settings.value.gameplay.cameraZoom, oninput: (e: Event): void => { const v = Number((e.target as HTMLInputElement).value); this.view.director.zoomScale = v; settings.update((s) => { s.gameplay.cameraZoom = v; }); } })),
      h('button', { class: 'btn', onclick: (): void => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => undefined)).catch(() => undefined); } }, 'Fullscreen'),
      this.o.openSettings ? h('button', { class: 'btn', onclick: (): void => { const host = h('div'); this.o.openSettings!(host); this.showOverlay(modal(h('div', { class: 'col' }, host, h('button', { class: 'btn', onclick: (): void => this.showPause() }, 'Back')))); } }, 'Settings & controls') : null,
      h('button', { class: 'btn danger', onclick: (): void => { if (confirm('Quit this match? Progress will be lost.')) this.exit(true); } }, 'Quit match'));
    this.showOverlay(modal(h('div', { class: 'col' }, h('h2', null, 'Paused'), h('div', { class: 'muted' }, `${m.teams[0].name} ${m.teams[0].score} – ${m.teams[1].score} ${m.teams[1].name} · ${m.displayClock().text}`), list)));
    clear(this.hud.root.querySelector('.prompts') as HTMLElement);
  }

  exit(quit: boolean): void {
    const m = this.o.match;
    const r: SessionResult = { match: m, score: [m.teams[0].score, m.teams[1].score], winner: m.winner, quit };
    this.dispose();
    this.o.onExit(r);
  }

  dispose(): void {
    this.loop.stop();
    window.removeEventListener('resize', this.resizeFn);
    window.removeEventListener('keydown', this.onSkipKey);
    document.removeEventListener('visibilitychange', this.onVis);
    audio.stopCrowd();
    this.o.input.touch?.setVisible(false);
    this.o.input.aimMode = false; this.o.input.yaw = 0;
    this.o.input.onDevice = null;
    this.view.dispose();
    this.root.remove();
    void this.highlightClips; void this.sessionTime; void this.hadHalftime;
  }
}
