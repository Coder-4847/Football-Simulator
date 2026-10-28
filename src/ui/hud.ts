import { h, clear } from './dom';
import type { Match } from '../match/match';
import type { MatchView } from '../render/matchview';
import { settings } from '../core/settings';
import { crest } from './components';

const FEED_MS = 7000;

/** DOM overlay for a watched match: scoreboard, possession, event feed, commentary ticker, banners and a hover tooltip. */
export class Hud {
  readonly root = h('div', { class: 'hud' });
  private score = h('div', { class: 'scoreboard' });
  private feed = h('div', { class: 'feed' });
  private ticker = h('div', { class: 'ticker' });
  private banner = h('div', { class: 'banner' }, h('div', { class: 'big' }), h('div', { class: 'sub' }));
  private poss = h('div', { class: 'poss' }, h('i'), h('b'));
  private replayTag = h('div', { class: 'replay-tag' }, 'REPLAY');
  private fps = h('div', { class: 'fps' });
  private tip = h('div', { class: 'tip' });
  private pens = h('div', { class: 'card', style: 'position:absolute;left:50%;top:78px;transform:translateX(-50%);padding:8px 16px;display:none;font-size:14px;letter-spacing:.2em;font-weight:700' });
  private tickerT = 0;
  private bannerT = 0;

  constructor(private match: Match, private view: MatchView) {
    this.root.append(this.score, this.poss, this.feed, this.ticker, this.banner, this.replayTag, this.fps, this.pens, this.tip);
    this.buildScore();
    const bus = match.bus;
    bus.on('goal', (e) => {
      const t = match.teams[e.side];
      this.showBanner(e.ownGoal ? 'Own goal' : 'Goal', `${e.scorer.data.name} · ${e.minute}'${e.assist ? ` · assist ${e.assist.data.shortName}` : ''}`, 3200, t.kit.primary);
      this.addFeed(`⚽ <b>${e.scorer.data.shortName}</b> ${e.minute}' <span class="muted">${t.short}</span>`);
    });
    bus.on('card', (e) => this.addFeed(`<i class="${e.color === 'yellow' ? 'card-y' : 'card-r'}"></i> ${e.player.data.shortName}${e.second ? ' (2nd yellow)' : ''}`));
    bus.on('sub', (e) => this.addFeed(`⇄ <b>${e.on}</b> <span class="muted">for ${e.off.data.shortName}</span>`));
    bus.on('offside', () => this.showBanner('Offside', '', 900));
    bus.on('penalty', () => this.showBanner('Penalty', '', 1500));
    bus.on('injury', (e) => this.addFeed(`✚ ${e.player.data.shortName} injured`));
    bus.on('halfTime', () => this.showBanner('Half time', '', 1800));
    bus.on('extraTime', () => this.showBanner('Extra time', '', 1800));
    bus.on('commentary', (e) => this.say(e.text));
    bus.on('var', (e) => this.showBanner('VAR', `${e.kind} ${e.outcome}`, 2200));
  }

  private buildScore(): void {
    const m = this.match;
    clear(this.score);
    this.score.append(
      h('div', { class: 'team', id: 'hud-t0' }, crest(m.teams[0].kit), h('span', null, m.teams[0].short)),
      h('div', { class: 'score', id: 'hud-score' }, '0 - 0'),
      h('div', { class: 'team away', id: 'hud-t1' }, h('span', null, m.teams[1].short), crest(m.teams[1].kit)),
      h('div', { class: 'timebox' }, h('span', { class: 'clock', id: 'hud-clock' }, "1'"), h('span', { class: 'extra', id: 'hud-extra' })),
    );
    (this.poss.firstChild as HTMLElement).style.background = m.teams[0].kit.primary;
    (this.poss.lastChild as HTMLElement).style.background = m.teams[1].kit.primary;
  }

  private addFeed(html: string): void {
    const it = h('div', { class: 'item' }); it.innerHTML = html;
    this.feed.prepend(it);
    while (this.feed.children.length > 6) this.feed.lastChild?.remove();
    setTimeout(() => it.remove(), FEED_MS);
  }

  showBanner(big: string, sub: string, ms: number, color?: string): void {
    const b = this.banner.children[0] as HTMLElement;
    b.textContent = big;
    b.style.filter = color ? `drop-shadow(0 6px 22px rgba(0,0,0,.7)) drop-shadow(0 0 18px ${color}66)` : '';
    (this.banner.children[1] as HTMLElement).textContent = sub;
    this.banner.classList.remove('on'); void this.banner.offsetWidth; this.banner.classList.add('on'); this.bannerT = ms / 1000;
  }

  say(text: string): void {
    if (!settings.value.gameplay.ticker) return;
    this.ticker.textContent = text; this.ticker.classList.add('on'); this.tickerT = 4;
  }

  setReplay(on: boolean): void { this.replayTag.style.display = on ? 'block' : 'none'; }

  showTip(x: number, y: number, html: string | null): void {
    if (!html) { this.tip.style.display = 'none'; return; }
    this.tip.innerHTML = html; this.tip.style.display = 'block'; this.tip.style.left = `${x}px`; this.tip.style.top = `${y}px`;
  }

  update(dt: number, paused: boolean): void {
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
    const so = m.shootout;
    if (!so) this.pens.style.display = 'none';
    else {
      this.pens.style.display = 'block';
      const row = (side: 0 | 1): string => so.kicks.filter((k) => k.side === side).map((k) => (k.scored ? '●' : '✕')).join(' ') || '–';
      this.pens.innerHTML = `<div>${m.teams[0].short}  ${row(0)}</div><div>${m.teams[1].short}  ${row(1)}</div>`;
    }
    const t = m.teams, a = t[0].possessionTime, b = t[1].possessionTime, tot = a + b;
    (this.poss.firstChild as HTMLElement).style.width = `${tot > 1 ? Math.round((a / tot) * 100) : 50}%`;
    (this.poss.lastChild as HTMLElement).style.width = `${tot > 1 ? Math.round((b / tot) * 100) : 50}%`;
    void paused;
  }

  dispose(): void { this.root.remove(); }
}
