import { h, clear } from './dom';
import type { Match } from '../match/match';
import type { MatchView } from '../render/matchview';
import type { HumanSlot } from '../match/types';
import { humanContext } from '../match/human';
import { promptFor, type Device } from '../input/prompts';
import type { Btn } from '../input/actions';
import { settings } from '../core/settings';
import { HALF_L, HALF_W } from '../match/constants';

const FEED_MS = 6000;

/** DOM overlay for the match: scoreboard, radar, feed, prompts, power meter, banners. */
export class Hud {
  readonly root = h('div', { class: 'hud' });
  private score = h('div', { class: 'scoreboard' });
  private feed = h('div', { class: 'feed' });
  private ticker = h('div', { class: 'ticker' });
  private banner = h('div', { class: 'banner' }, h('div', { class: 'big' }), h('div', { class: 'sub' }));
  private radar = h('canvas', { class: 'radar', width: 360, height: 232 }) as HTMLCanvasElement;
  private power = h('div', { class: 'power' }, h('i'));
  private prompts = h('div', { class: 'prompts' });
  private replayTag = h('div', { class: 'replay-tag' }, 'REPLAY');
  private fps = h('div', { class: 'fps' });
  private pens = h('div', { class: 'card', style: 'position:absolute;left:50%;top:70px;transform:translateX(-50%);padding:8px 14px;display:none;font-size:14px;letter-spacing:.2em' });
  private labels: HTMLElement[] = [];
  private tickerT = 0;
  private bannerT = 0;
  private lastPromptKey = '';
  private cardTimers: number[] = [];

  constructor(private match: Match, private view: MatchView, private getDevice: () => Device) {
    this.root.append(this.score, this.feed, this.ticker, this.banner, this.radar, this.power, this.prompts, this.replayTag, this.fps, this.pens);
    this.buildScore();
    const bus = match.bus;
    bus.on('goal', (e) => {
      const t = match.teams[e.side];
      this.showBanner(e.ownGoal ? 'OWN GOAL' : 'GOAL', `${e.scorer.data.name} · ${e.minute}'${e.assist ? ` · assist ${e.assist.data.shortName}` : ''}`, 4200, t.kit.primary);
      this.addFeed(`⚽ ${e.scorer.data.shortName} ${e.minute}'`);
    });
    bus.on('card', (e) => this.addFeed(`<i class="${e.color === 'yellow' ? 'card-y' : 'card-r'}"></i> ${e.player.data.shortName}${e.second ? ' (2nd yellow)' : ''}`));
    bus.on('sub', (e) => this.addFeed(`⇄ ${e.on} for ${e.off.data.shortName}`));
    bus.on('offside', () => this.showBanner('OFFSIDE', '', 1400));
    bus.on('foul', () => { /* ticker line handles it */ });
    bus.on('penalty', () => this.showBanner('PENALTY', '', 1800));
    bus.on('injury', (e) => this.addFeed(`✚ ${e.player.data.shortName} injured`));
    bus.on('halfTime', () => this.showBanner('HALF TIME', '', 2200));
    bus.on('extraTime', () => this.showBanner('EXTRA TIME', '', 2200));
    bus.on('advantage', () => this.showBanner('ADVANTAGE', '', 1100));
    bus.on('commentary', (e) => this.say(e.text));
    bus.on('var', (e) => this.showBanner('VAR', `${e.kind} ${e.outcome}`, 2500));
  }

  private buildScore(): void {
    const m = this.match;
    clear(this.score);
    this.score.append(
      h('div', { class: 'chip', style: `background:${m.teams[0].kit.primary}` }), h('div', { class: 'team', id: 'hud-t0' }, m.teams[0].short),
      h('div', { class: 'score', id: 'hud-score' }, '0 - 0'), h('div', { class: 'team', id: 'hud-t1' }, m.teams[1].short),
      h('div', { class: 'chip', style: `background:${m.teams[1].kit.primary}` }), h('div', { class: 'clock', id: 'hud-clock' }, "1'"), h('div', { class: 'extra', id: 'hud-extra' }),
    );
  }

  private addFeed(html: string): void {
    const it = h('div', { class: 'item' }); it.innerHTML = html;
    this.feed.prepend(it);
    while (this.feed.children.length > 5) this.feed.lastChild?.remove();
    setTimeout(() => it.remove(), FEED_MS);
  }

  showBanner(big: string, sub: string, ms: number, color?: string): void {
    (this.banner.children[0] as HTMLElement).textContent = big;
    (this.banner.children[0] as HTMLElement).style.color = color && luminance(color) > 0.25 ? color : '#fff';
    (this.banner.children[1] as HTMLElement).textContent = sub;
    this.banner.classList.add('on'); this.bannerT = ms / 1000;
  }

  say(text: string): void {
    if (!settings.value.gameplay.ticker) return;
    this.ticker.textContent = text; this.ticker.classList.add('on'); this.tickerT = 4.5;
  }

  setReplay(on: boolean): void { this.replayTag.style.display = on ? 'block' : 'none'; }

  update(dt: number, humans: HumanSlot[], paused: boolean): void {
    const m = this.match;
    const cl = m.displayClock();
    const sc = this.score.querySelector('#hud-score');
    if (sc) sc.textContent = `${m.teams[0].score} - ${m.teams[1].score}`;
    const ck = this.score.querySelector('#hud-clock'); if (ck) ck.textContent = m.period === 5 ? 'PENS' : cl.text;
    const ex = this.score.querySelector('#hud-extra'); if (ex) ex.textContent = m.addedTime > 0 && m.period < 5 ? `+${Math.round(m.addedTime / 60)}` : '';
    if (m.shootout) { const s = m.shootout; if (sc) sc.textContent = `${m.teams[0].score} (${s.score[0]}) - (${s.score[1]}) ${m.teams[1].score}`; }
    if (this.tickerT > 0) { this.tickerT -= dt; if (this.tickerT <= 0) this.ticker.classList.remove('on'); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.banner.classList.remove('on'); }
    this.fps.textContent = settings.value.graphics.showFps ? `${Math.round(this.view.fps)} fps` : '';

    this.updatePens();
    this.updateRadar();
    this.updateLabels(humans);
    this.updatePower(humans);
    this.updatePrompts(humans);
    this.radar.style.display = settings.value.gameplay.radar && !paused ? 'block' : 'none';
    const touch = this.getDevice() === 'touch';
    const rs = this.radar.style;
    rs.bottom = touch ? 'auto' : 'calc(var(--safe-b) + 16px)'; rs.top = touch ? 'calc(var(--safe-t) + 14px)' : 'auto';
    rs.width = touch ? '130px' : '180px'; rs.height = touch ? '84px' : '116px';
    this.feed.style.top = touch ? 'calc(var(--safe-t) + 106px)' : '';
  }

  private updatePens(): void {
    const so = this.match.shootout;
    if (!so) { this.pens.style.display = 'none'; return; }
    this.pens.style.display = 'block';
    const row = (side: 0 | 1): string => so.kicks.filter((k) => k.side === side).map((k) => (k.scored ? '●' : '✕')).join(' ') || '–';
    this.pens.innerHTML = `<div>${this.match.teams[0].short}  ${row(0)}</div><div>${this.match.teams[1].short}  ${row(1)}</div>`;
  }

  private updateRadar(): void {
    if (!settings.value.gameplay.radar) return;
    const c = this.radar.getContext('2d')!;
    const W = this.radar.width, H = this.radar.height;
    c.clearRect(0, 0, W, H);
    const X = (x: number): number => ((x + HALF_L + 4) / (HALF_L * 2 + 8)) * W, Y = (y: number): number => ((y + HALF_W + 3) / (HALF_W * 2 + 6)) * H;
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 2;
    c.strokeRect(X(-HALF_L), Y(-HALF_W), X(HALF_L) - X(-HALF_L), Y(HALF_W) - Y(-HALF_W));
    c.beginPath(); c.moveTo(X(0), Y(-HALF_W)); c.lineTo(X(0), Y(HALF_W)); c.stroke();
    c.beginPath(); c.arc(X(0), Y(0), 22, 0, Math.PI * 2); c.stroke();
    for (const t of this.match.teams) for (const p of t.players) {
      if (!p.active()) continue;
      c.fillStyle = p.isGK() ? t.gkKit.primary : t.kit.primary; c.beginPath(); c.arc(X(p.x), Y(p.y), p.human >= 0 ? 7 : 5, 0, Math.PI * 2); c.fill();
      if (p.human >= 0) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); }
    }
    c.fillStyle = '#fff'; c.beginPath(); c.arc(X(this.match.ball.x), Y(this.match.ball.y), 4, 0, Math.PI * 2); c.fill();
  }

  private updateLabels(humans: HumanSlot[]): void {
    const show = settings.value.gameplay.playerNames;
    const targets = humans.map((hs) => hs.player).filter((p): p is NonNullable<typeof p> => !!p);
    if (this.match.owner && !targets.includes(this.match.owner)) targets.push(this.match.owner);
    while (this.labels.length < targets.length) { const l = h('div', { class: 'plabel' }, h('span'), h('div', { class: 'stam' }, h('i'))); this.root.appendChild(l); this.labels.push(l); }
    this.labels.forEach((l, i) => {
      const p = targets[i];
      if (!p || !show || this.view.replay) { l.style.display = 'none'; return; }
      const pr = this.view.project(p.x, p.y, 2.3);
      if (!pr.visible) { l.style.display = 'none'; return; }
      l.style.display = 'block'; l.style.left = `${pr.x}px`; l.style.top = `${pr.y}px`;
      (l.firstChild as HTMLElement).textContent = p.data.shortName;
      const bar = (l.lastChild as HTMLElement); bar.style.display = settings.value.gameplay.staminaBars ? 'block' : 'none';
      (bar.firstChild as HTMLElement).style.width = `${Math.round(p.stamina * 100)}%`;
      (bar.firstChild as HTMLElement).style.background = p.stamina < 0.3 ? 'var(--danger)' : p.stamina < 0.55 ? 'var(--warn)' : 'var(--accent)';
      l.style.borderBottom = `2px solid ${p.human === 0 ? '#3b82f6' : p.human === 1 ? '#ef4444' : 'transparent'}`;
    });
  }

  private updatePower(humans: HumanSlot[]): void {
    let best = 0;
    for (const hs of humans) {
      const inp = hs.input;
      for (const b of ['b1', 'b2', 'b3', 'b4'] as Btn[]) if (inp.down[b] && inp.held[b] > 0.06) best = Math.max(best, Math.min(1, inp.held[b] / 0.85));
    }
    this.power.classList.toggle('on', best > 0.02);
    (this.power.firstChild as HTMLElement).style.width = `${Math.round(best * 100)}%`;
  }

  private updatePrompts(humans: HumanSlot[]): void {
    const hs = humans[0];
    const dev = this.getDevice();
    if (!hs || dev === 'touch' || !hs.player) { if (this.prompts.firstChild) clear(this.prompts); this.lastPromptKey = ''; return; }
    const ctx = humanContext(this.match, hs);
    const key = `${ctx}|${dev}`;
    if (key === this.lastPromptKey) return;
    this.lastPromptKey = key;
    clear(this.prompts);
    const c = settings.value.controls;
    const b = { keyboard: c.keyboard as unknown as Record<string, string[]>, gamepad: c.gamepad as unknown as Record<string, number[]> };
    const list: Btn[] = ctx === 'attack' ? ['b1', 'b2', 'b3', 'b4', 'sprint'] : ctx === 'defend' ? ['b1', 'b3', 'b4', 'precise', 'sprint'] : ctx === 'keeper' ? ['b1', 'b3', 'modA', 'modB'] : ['b1', 'b3', 'b4', 'precise'];
    for (const btn of list) {
      const p = promptFor(btn, ctx, dev, b);
      if (p.action) this.prompts.appendChild(h('span', null, h('kbd', null, p.key), p.action));
    }
  }

  dispose(): void { this.root.remove(); }
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}
