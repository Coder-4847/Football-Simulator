import { GameLoop } from '../core/loop';
import { BASE_SIM_SPEED, MATCH_LENGTHS, SPEEDS, settings } from '../core/settings';
import { h, add, clear, toast } from './dom';
import { Hud } from './hud';
import { icon } from './components';
import { kickoffCard, modal, statsPanel, subsPanel, tacticsPanel } from './panels';
import { MatchView } from '../render/matchview';
import { qualityFor } from '../render/quality';
import { CAMERA_MODES } from '../render/camera';
import type { Match } from '../match/match';
import type { Side } from '../match/constants';
import type { MatchConfig } from '../match/types';
import { audio } from '../audio/engine';
import { defaultMatchConfig } from '../match/types';

export interface SessionResult { match: Match; score: [number, number]; winner: Side | null; quit: boolean }

export interface SessionOptions {
  match: Match;
  /** which team(s) the user manages: tactics and substitutions are theirs to decide */
  managed: Side | 'both' | null;
  onExit: (r: SessionResult) => void;
  /** called when the user opens settings from the pause menu */
  openSettings?: (parent: HTMLElement) => void;
  fullTimeTitle?: string;
  /** start immediately without the team-sheet card (used for the landing-page backdrop) */
  skipIntro?: boolean;
}

/** Builds the match config from the user's settings. */
export function matchConfigFromSettings(over: Partial<MatchConfig> = {}): MatchConfig {
  const g = settings.value.gameplay;
  const pick = <T,>(v: T | 'random', list: readonly T[]): T => (v === 'random' ? list[Math.floor(Math.random() * list.length)]! : v);
  return {
    ...defaultMatchConfig(), seed: `m${Date.now()}`, halfLength: MATCH_LENGTHS[g.matchLength].half, difficulty: g.difficulty, refStrictness: g.refStrictness, offside: g.offside, foulFrequency: g.foulFrequency,
    injuries: g.injuries, fatigue: g.fatigue, var: g.var, extraTime: g.extraTimeAndPens, penalties: g.extraTimeAndPens,
    weather: pick(g.weather, ['clear', 'clear', 'rain', 'fog', 'snow'] as const), timeOfDay: pick(g.timeOfDay, ['day', 'dusk', 'night'] as const), stadiumStyle: g.stadium === 'random' ? Math.floor(Math.random() * 8) : g.stadium,
    ...over,
  };
}

/** A watched match: the managers decide tactics and substitutions, the players do the rest. */
export class GameSession {
  readonly root = h('div', { style: 'position:absolute;inset:0;background:#05080d' });
  private canvasWrap = h('div', { style: 'position:absolute;inset:0' });
  private canvas = h('canvas', { class: 'view' }) as HTMLCanvasElement;
  readonly view: MatchView;
  private hud: Hud;
  private loop: GameLoop;
  private paused = false;
  private overlay: HTMLElement | null = null;
  private replayAt = -1;
  private intro = true;
  private ended = false;
  private ff = false;
  private speed: number;
  private resizeFn = (): void => this.view.resize();
  private hadHalftime = false;
  private bar = h('div', { class: 'controls-bar' });
  private progress = h('div', { class: 'progress' }, h('i'));
  private introEl: HTMLElement | null = null;
  private introTimer = 0;
  private speedBtns: HTMLElement[] = [];
  private pauseBtn!: HTMLElement;
  private subBtn: HTMLElement | null = null;

  constructor(private parent: HTMLElement, private o: SessionOptions) {
    const m = o.match;
    this.canvasWrap.appendChild(this.canvas);
    this.root.appendChild(this.canvasWrap);
    parent.appendChild(this.root);
    const g = settings.value.graphics;
    const quality = qualityFor(g.preset, g.custom);
    quality.resolutionScale *= g.resolutionScale;
    this.view = new MatchView(this.canvas, m, {
      quality, grade: g.grade, cameraMode: settings.value.gameplay.camera, cameraHeight: 1, cameraZoom: settings.value.gameplay.cameraZoom,
      showFps: g.showFps, fpsCap: g.fpsCap, celebrationSeed: 1, trail: g.ballTrail,
    });
    this.hud = new Hud(m, this.view);
    this.root.appendChild(this.hud.root);
    this.root.appendChild(this.progress);
    this.speed = settings.value.gameplay.matchSpeed;
    if (o.managed === 'both') { m.manage(0); m.manage(1); } else if (o.managed !== null) m.manage(o.managed);
    this.buildBar();
    if (o.skipIntro) this.root.querySelector('.controls-bar')?.remove();

    // audio
    audio.startCrowd();
    const bus = m.bus;
    bus.on('kick', (e) => audio.kick(e.power));
    bus.on('bounce', (e) => audio.bounce(e.speed));
    bus.on('netHit', (e) => audio.net(e.speed));
    bus.on('post', () => { audio.post(); audio.groan(); });
    bus.on('tackle', () => audio.tackle());
    bus.on('whistle', (e) => audio.whistle(e.kind === 'fullTime' || e.kind === 'halfTime' ? 'triple' : e.kind === 'goal' ? 'long' : 'short'));
    bus.on('goal', (e) => { audio.roar(1); audio.goalStinger(); if (settings.value.gameplay.goalReplays) this.replayAt = m.time + 1.7; m.replay.mark(`${e.scorer.data.shortName} ${e.minute}'`, 'goal', e.minute); });
    bus.on('save', () => { audio.roar(0.5); });
    bus.on('card', () => audio.card());
    bus.on('shot', (e) => { if (e.xg > 0.2) audio.setExcitement(0.8); });
    bus.on('penalty', () => audio.roar(0.4));
    bus.on('commentary', (e) => audio.speak(e.text));
    bus.on('needSub', (e) => { if (this.isManaged(e.side)) this.openSubs(e.side, e.player); });
    bus.on('shot', (e) => { if (e.xg > 0.3) m.replay.mark(`${e.player.data.shortName} chance`, 'chance', m.minute()); });

    this.loop = new GameLoop({ update: (dt) => this.fixedUpdate(dt), render: (a, dt) => this.render(a, dt) }, 1 / 60, 96);
    this.loop.fpsCap = g.fpsCap;
    this.applySpeed();
    window.addEventListener('resize', this.resizeFn);
    window.addEventListener('keydown', this.onKey);
    this.canvas.addEventListener('pointermove', this.onPointer);
    this.canvas.addEventListener('pointerleave', () => this.hud.showTip(0, 0, null));
    this.beginIntro();
    this.loop.start();
  }

  get match(): Match { return this.o.match; }
  private isManaged(side: Side): boolean { return this.o.managed === 'both' || this.o.managed === side; }
  private managedSide(): Side | null { return this.o.managed === 'both' ? 0 : this.o.managed; }

  // ---------------------------------------------------------------- intro
  private beginIntro(): void {
    const m = this.o.match;
    if (this.o.skipIntro) { this.intro = false; m.startMatch(); return; }
    this.view.setCinematic('lineup');
    this.introEl = kickoffCard(m, this.o.managed, () => this.go());
    this.root.appendChild(this.introEl);
    audio.whistle('short');
    this.introTimer = window.setTimeout(() => this.go(), 7000);
  }
  private go(): void {
    if (!this.intro) return;
    this.intro = false; clearTimeout(this.introTimer);
    this.introEl?.remove(); this.introEl = null; this.view.setCinematic(null);
    this.o.match.startMatch();
  }

  // ---------------------------------------------------------------- controls
  private buildBar(): void {
    const m = this.o.match;
    clear(this.bar);
    this.pauseBtn = h('button', { class: 'btn icon', title: 'Pause (Space)', onclick: (): void => this.togglePause() }, icon('pause'));
    this.speedBtns = SPEEDS.map((s) => h('button', { class: 'btn', title: `${s}× speed`, onclick: (): void => { this.speed = s; settings.update((st) => { st.gameplay.matchSpeed = s; }); this.applySpeed(); } }, `${s}×`));
    const managed = this.o.managed !== null;
    this.subBtn = managed ? h('button', { class: 'btn', title: 'Substitutions (S)', onclick: (): void => this.openSubs(this.managedSide()!) }, icon('sub'), 'Subs') : null;
    add(this.bar,
      h('div', { class: 'grp' }, this.pauseBtn, ...this.speedBtns),
      h('div', { class: 'grp' }, h('button', { class: 'btn', title: 'Finish the match instantly (F)', onclick: (): void => this.fastForward() }, icon('skip'), 'Finish')),
      managed ? h('div', { class: 'grp' }, h('button', { class: 'btn', title: 'Tactics (T)', onclick: (): void => this.openTactics(this.managedSide()!) }, icon('tactics'), 'Tactics'), this.subBtn) : null,
      h('div', { class: 'grp' }, h('button', { class: 'btn', title: 'Match stats', onclick: (): void => this.showStats() }, icon('stats'), 'Stats'), h('button', { class: 'btn icon', title: 'Menu (Esc)', onclick: (): void => this.pause() }, icon('settings'))));
    this.root.appendChild(this.bar);
    void m;
    this.refreshBar();
  }
  private refreshBar(): void {
    SPEEDS.forEach((s, i) => this.speedBtns[i]?.classList.toggle('on', s === this.speed && !this.paused));
    this.pauseBtn.innerHTML = ''; this.pauseBtn.appendChild(icon(this.paused ? 'play' : 'pause'));
  }
  private applySpeed(): void {
    this.loop.timeScale = this.paused || this.overlay ? 0 : BASE_SIM_SPEED * this.speed;
    this.refreshBar();
  }
  private togglePause(): void { if (this.paused) this.resume(); else this.pause(true); }

  private onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    if (this.intro) { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.go(); } return; }
    if (this.overlay && e.code !== 'Escape') return;
    switch (e.code) {
      case 'Space': e.preventDefault(); this.togglePause(); break;
      case 'Escape': if (this.overlay && this.paused) this.resume(); else if (!this.overlay) this.pause(); break;
      case 'Digit1': this.speed = 0.5; this.applySpeed(); break; case 'Digit2': this.speed = 1; this.applySpeed(); break;
      case 'Digit3': this.speed = 2; this.applySpeed(); break; case 'Digit4': this.speed = 4; this.applySpeed(); break;
      case 'KeyF': this.fastForward(); break;
      case 'KeyT': if (this.managedSide() !== null) this.openTactics(this.managedSide()!); break;
      case 'KeyS': if (this.managedSide() !== null) this.openSubs(this.managedSide()!); break;
      default: break;
    }
  };

  private onPointer = (e: PointerEvent): void => {
    if (this.intro) return;
    const d = this.view.director;
    const r = this.canvas.getBoundingClientRect();
    const wx = (e.clientX - r.left - d.viewW / 2) / d.scale + d.x, wy = (e.clientY - r.top - d.viewH / 2) / d.scale + d.y;
    let best: { p: import('../match/entities').MPlayer; d: number } | null = null;
    for (const t of this.o.match.teams) for (const p of t.players) { if (!p.active()) continue; const dd = Math.hypot(p.x - wx, p.y - wy); if (dd < 2.6 && (!best || dd < best.d)) best = { p, d: dd }; }
    if (!best) { this.hud.showTip(0, 0, null); return; }
    const p = best.p;
    const pr = this.view.project(p.x, p.y, 2.2);
    const st = Math.round(p.stamina * 100);
    this.hud.showTip(pr.x, pr.y, `<b>${p.data.name}</b> <span class="pill" style="margin-left:6px">${p.slotPos}</span><div class="r">OVR ${p.data.overall} · stamina ${st}% · ${p.stats.goals ? `${p.stats.goals} goal${p.stats.goals > 1 ? 's' : ''} · ` : ''}${p.stats.passes} passes</div>`);
  };

  // ---------------------------------------------------------------- loop
  private fixedUpdate(dt: number): void {
    const m = this.o.match;
    if (this.intro || this.paused || this.overlay || this.ended) return;
    if (this.replayAt > 0 && m.time >= this.replayAt) {
      this.replayAt = -1;
      const frames = m.replay.instant(8);
      if (frames.length > 60) { this.hud.setReplay(true); this.view.startReplay(frames, 0.7, () => { this.hud.setReplay(false); }); return; }
    }
    if (this.view.replay) return;
    m.step(dt);
    this.phaseWatch();
  }

  private phaseWatch(): void {
    const m = this.o.match;
    if (m.phase === 'halftime' || m.phase === 'extratimeBreak') {
      if (!this.overlay) {
        if (settings.value.gameplay.autoPauseHalftime && this.o.managed !== null) this.showHalfTime();
        else m.startNextPeriod();
      }
    } else if (m.phase === 'fulltime' && !this.ended) {
      if (!this.overlay) this.showFullTime();
    }
    const c = this.view.director;
    if (m.phase === 'goal' && !c.cinematic && m.phaseT > 0.4 && !this.view.replay) this.view.setCinematic('goal');
    else if (m.phase !== 'goal' && c.cinematic?.kind === 'goal') this.view.setCinematic(null);
    if (m.phase === 'fulltime' && !c.cinematic) this.view.setCinematic('fulltime');
  }

  private render(alpha: number, dt: number): void {
    if (this.ff && !this.overlay && !this.ended) {
      // fast-forward: burn through simulation steps within a frame budget
      const t0 = performance.now();
      const m = this.o.match;
      while (performance.now() - t0 < 12 && !this.overlay && !this.ended && !this.view.replay) { m.step(1 / 60); this.phaseWatch(); }
      if (this.overlay || this.ended) this.stopFf();
    }
    if (this.paused) alpha = 1;
    this.view.update(alpha, dt);
    this.hud.update(dt, this.paused);
    const m = this.o.match;
    const total = this.totalSeconds();
    (this.progress.firstChild as HTMLElement).style.width = `${Math.min(100, (m.time / total) * 100)}%`;
    if (!this.paused) audio.setExcitement(m.phase === 'play' ? Math.min(1, 0.25 + m.ball.speed() / 60 + (Math.abs(m.ball.x) > 38 ? 0.25 : 0)) : 0.2);
  }
  private totalSeconds(): number { return this.o.match.cfg.halfLength * 60 * 2 + 40; }

  private fastForward(): void {
    if (this.intro || this.ended) return;
    if (this.view.replay) { this.view.stopReplay(); this.hud.setReplay(false); }
    this.ff = true; this.loop.timeScale = 0;
    toast('Simulating to full time…');
  }
  private stopFf(): void { this.ff = false; this.applySpeed(); }

  // ---------------------------------------------------------------- panels
  private showOverlay(el: HTMLElement): void { this.overlay?.remove(); this.overlay = el; this.root.appendChild(el); this.applySpeed(); this.hud.showTip(0, 0, null); }
  private closeOverlay(): void { this.overlay?.remove(); this.overlay = null; this.applySpeed(); }

  private openTactics(side: Side): void {
    const m = this.o.match;
    if (this.overlay) return;
    this.showOverlay(modal(tacticsPanel(m, side, () => { this.closeOverlay(); }), () => this.closeOverlay(), 'wide'));
  }
  private openSubs(side: Side, forced?: import('../match/entities').MPlayer): void {
    const m = this.o.match;
    if (this.overlay && !forced) return;
    this.showOverlay(modal(subsPanel(m, side, () => { m.pendingSubPrompt = null; this.closeOverlay(); }, forced), forced ? undefined : () => this.closeOverlay()));
  }
  private showStats(): void {
    if (this.overlay) return;
    const m = this.o.match;
    this.showOverlay(modal(statsPanel(m, `${m.displayClock().text} · live`, () => this.closeOverlay(), 'Back to the match'), () => this.closeOverlay(), 'wide'));
  }

  private showHalfTime(): void {
    const m = this.o.match;
    this.hadHalftime = true;
    const title = m.phase === 'extratimeBreak' ? 'Break before extra time' : 'Half-time';
    const side = this.managedSide();
    const extras: HTMLElement[] = [];
    if (side !== null) {
      extras.push(h('div', { class: 'row', style: 'justify-content:center;gap:12px' },
        h('button', { class: 'btn', onclick: (): void => this.showOverlay(modal(subsPanel(m, side, () => this.showHalfTime()))) }, icon('sub'), 'Substitutions'),
        h('button', { class: 'btn', onclick: (): void => this.showOverlay(modal(tacticsPanel(m, side, () => this.showHalfTime()), undefined, 'wide')) }, icon('tactics'), 'Tactics & formation')));
    }
    this.showOverlay(modal(statsPanel(m, title, () => { this.closeOverlay(); m.startNextPeriod(); }, m.phase === 'extratimeBreak' ? 'Continue' : 'Start second half', extras), undefined, 'wide'));
    this.stopFf();
  }

  private showFullTime(): void {
    const m = this.o.match;
    this.ended = true; this.stopFf();
    audio.stopCrowd();
    const extra: HTMLElement[] = [];
    const clips = m.replay.clips;
    if (clips.length) extra.push(h('button', { class: 'btn', onclick: (): void => this.playHighlights() }, icon('play'), `Watch highlights (${clips.length})`));
    this.showOverlay(modal(statsPanel(m, this.o.fullTimeTitle ?? 'Full time', () => this.exit(false), 'Continue', extra), undefined, 'wide'));
  }

  private playHighlights(): void {
    const clips = [...this.o.match.replay.clips];
    this.closeOverlay();
    this.root.querySelector('.controls-bar')?.setAttribute('style', 'display:none');
    const finish = (): void => { window.removeEventListener('keydown', skip); this.hud.setReplay(false); this.root.querySelector('.controls-bar')?.removeAttribute('style'); this.showFullTime(); this.ended = false; };
    const next = (): void => {
      const c = clips.shift();
      if (!c) { finish(); return; }
      this.hud.showBanner(c.kind === 'goal' ? 'Goal' : 'Highlight', c.label, 2500);
      this.hud.setReplay(true);
      this.view.startReplay(c.frames, 0.8, next);
    };
    const skip = (e: KeyboardEvent): void => { if (e.code === 'Space' || e.code === 'Escape') { clips.length = 0; this.view.stopReplay(); } };
    window.addEventListener('keydown', skip);
    next();
  }

  pause(keepBar = false): void {
    if (this.paused && this.overlay) return;
    this.paused = true;
    if (!keepBar) this.showPause();
    this.applySpeed();
  }
  resume(): void { this.paused = false; this.closeOverlay(); this.applySpeed(); }

  private showPause(): void {
    const m = this.o.match;
    const side = this.managedSide();
    const list = h('div', { class: 'col', style: 'gap:10px;margin-top:10px' },
      h('button', { class: 'btn primary big', onclick: (): void => this.resume() }, icon('play'), 'Resume'),
      side !== null ? h('button', { class: 'btn', onclick: (): void => { this.paused = false; this.openTactics(side); } }, icon('tactics'), 'Tactics & formation') : null,
      h('div', { class: 'field' }, h('label', null, 'Camera'), h('select', { onchange: (e: Event): void => { const v = (e.target as HTMLSelectElement).value as 'broadcast'; this.view.setCameraMode(v); settings.update((s) => { s.gameplay.camera = v; }); } },
        CAMERA_MODES.map((c) => h('option', { value: c.id, selected: this.view.director.mode === c.id }, c.name)))),
      h('button', { class: 'btn danger', onclick: (): void => { if (confirm('Leave this match? The result will not count.')) this.exit(true); } }, icon('exit'), 'Leave match'));
    this.showOverlay(modal(h('div', { class: 'col' }, h('h2', null, 'Paused'), h('div', { class: 'muted' }, `${m.teams[0].name} ${m.teams[0].score} – ${m.teams[1].score} ${m.teams[1].name} · ${m.displayClock().text}`), list), () => this.resume(), 'narrow'));
  }

  exit(quit: boolean): void {
    const m = this.o.match;
    const r: SessionResult = { match: m, score: [m.teams[0].score, m.teams[1].score], winner: m.winner, quit };
    this.dispose();
    this.o.onExit(r);
  }

  dispose(): void {
    this.loop.stop();
    clearTimeout(this.introTimer);
    window.removeEventListener('resize', this.resizeFn);
    window.removeEventListener('keydown', this.onKey);
    audio.stopCrowd();
    this.view.dispose();
    this.hud.dispose();
    this.root.remove();
    void this.hadHalftime; void this.parent;
  }
}
