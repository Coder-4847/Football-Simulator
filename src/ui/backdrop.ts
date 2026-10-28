import { GameLoop } from '../core/loop';
import { settings } from '../core/settings';
import { h } from './dom';
import { Match } from '../match/match';
import { worldSetup } from '../match/setup';
import { MatchView } from '../render/matchview';
import { PRESETS, qualityFor, type Quality } from '../render/quality';
import { matchConfigFromSettings } from './session';
import type { World } from '../data/types';

/** A live AI-versus-AI match playing behind the landing page. */
export class LiveBackdrop {
  readonly root = h('div', { style: 'position:absolute;inset:0;z-index:0;pointer-events:none;background:#05080d' });
  private canvas = h('canvas', { class: 'view' }) as HTMLCanvasElement;
  private view: MatchView | null = null;
  private match: Match | null = null;
  private loop: GameLoop | null = null;
  private endT = 0;
  private veil = h('div', { style: 'position:absolute;inset:0;background:radial-gradient(1200px 700px at 70% 55%, rgba(4,8,14,0) 0%, rgba(4,8,14,.35) 70%, rgba(4,8,14,.75) 100%)' });

  constructor(parent: HTMLElement, private getWorld: () => World) {
    this.root.append(this.canvas, this.veil);
    parent.prepend(this.root);
    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => this.view?.resize();

  private startMatch(): void {
    const w = this.getWorld();
    const leagues = Object.values(w.leagues);
    const lg = leagues[Math.floor(Math.random() * leagues.length)]!;
    const a = lg.clubs[Math.floor(Math.random() * lg.clubs.length)]!;
    let b = lg.clubs[Math.floor(Math.random() * lg.clubs.length)]!;
    if (b === a) b = lg.clubs[(lg.clubs.indexOf(a) + 1) % lg.clubs.length]!;
    const [home, away] = worldSetup(w, a, b);
    const cfg = matchConfigFromSettings({ headless: true, halfLength: 3, weather: Math.random() < 0.2 ? 'rain' : 'clear', timeOfDay: Math.random() < 0.55 ? 'night' : 'day', stadiumStyle: Math.floor(Math.random() * 8), seed: `bg${Date.now()}` });
    this.match = new Match(cfg, home, away);
    const q: Quality = qualityFor(settings.value.graphics.preset === 'Low' ? 'Low' : 'Medium', settings.value.graphics.custom);
    q.crowd = Math.min(q.crowd, 0.7); q.stadiumDetail = Math.min(q.stadiumDetail, PRESETS.Medium.stadiumDetail);
    this.view?.dispose();
    this.view = new MatchView(this.canvas, this.match, { quality: q, grade: 'broadcast', cameraMode: 'drone', cameraHeight: 1, cameraZoom: 0.92, showFps: false, fpsCap: 60, celebrationSeed: 1, trail: false });
    this.match.startMatch();
    this.endT = 0;
  }

  show(): void {
    this.root.style.display = 'block';
    this.view?.resize();
    if (this.loop) return;
    if (!this.match) this.startMatch();
    this.loop = new GameLoop({
      update: (dt) => {
        const m = this.match!;
        if (m.phase === 'halftime' || m.phase === 'extratimeBreak') m.startNextPeriod();
        m.step(dt);
        if (m.phase === 'fulltime') { this.endT += dt; if (this.endT > 3) this.startMatch(); }
      },
      render: (a, dt) => this.view?.update(a, dt),
    }, 1 / 60, 8);
    this.loop.fpsCap = 60;
    this.loop.timeScale = 2;
    this.loop.start();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.loop?.stop(); this.loop = null;
  }
}
