import { h, clear, toast } from './dom';
import { MenuNav } from './menunav';
import { settings, MATCH_LENGTHS, type MatchLength } from '../core/settings';
import { storage } from '../core/storage';
import { generateWorld } from '../data/generate';
import type { Tactics, World } from '../data/types';
import { Match } from '../match/match';
import { teamRatings, teamSetupFromClub, pickLineup } from '../match/setup';
import { GameSession, matchConfigFromSettings, type SessionResult } from './session';
import { buildSettings } from './settingsui';
import { audio } from '../audio/engine';
import { STADIUM_STYLES } from '../render/stadium';
import { defaultQualityName, isMobile } from '../render/quality';
import { runBenchmark } from '../render/bench';
import { LiveBackdrop } from './backdrop';
import { compareBlock, crest, formationPicker, icon, lineupEditor, logo, tacticsEditor } from './components';
import { modal } from './panels';
import { formationById, makeTactics } from '../data/formations';
import type { MatchConfig } from '../match/types';
import type { Side } from '../match/constants';
import type { CareerState } from '../manager/state';

export type ScreenBuilder = (app: App, params?: unknown) => HTMLElement | Promise<HTMLElement>;

export class App {
  readonly root: HTMLElement;
  nav = new MenuNav();
  world!: World;
  private screenEl: HTMLElement | null = null;
  private stack: Array<[string, unknown]> = [];
  private screens = new Map<string, ScreenBuilder>();
  session: GameSession | null = null;
  private loader: HTMLElement | null = null;
  private backdrop: LiveBackdrop | null = null;

  constructor(root: HTMLElement) { this.root = root; }

  register(name: string, fn: ScreenBuilder): void { this.screens.set(name, fn); }

  async boot(): Promise<void> {
    this.showLoader('Loading', 0.1);
    await settings.load();
    this.showLoader('Generating the football world', 0.45);
    await new Promise((r) => setTimeout(r, 30));
    this.world = generateWorld({ seed: 'football-simulator' });
    this.showLoader('Ready', 1);
    // unlock audio on the first gesture
    const unlock = (): void => { audio.unlock(); audio.startMusic('menu'); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    await new Promise((r) => setTimeout(r, 120));
    if (!settings.value.graphics.autoDetected) {
      const guess = detectPreset();
      this.showLoader('Tuning graphics for your device', 0.9);
      const measured = guess === 'Low' ? 'Low' : await runBenchmark();
      const rank = ['Low', 'Medium', 'High', 'Ultra'];
      const pick = rank[Math.min(rank.indexOf(guess), rank.indexOf(measured))] as 'Low';
      settings.update((s) => { s.graphics.autoDetected = true; s.graphics.preset = pick; });
    }
    this.hideLoader();
    this.backdrop = new LiveBackdrop(this.root, () => this.world);
    void this.go('main');
  }

  showLoader(text: string, p: number): void {
    if (!this.loader) { this.loader = h('div', { class: 'loading' }, h('div', { class: 'col', style: 'align-items:center;gap:6px' }, logo(), h('div', { class: 'muted', id: 'load-text', style: 'margin-top:26px;font-size:13px;letter-spacing:.14em;text-transform:uppercase' }), h('div', { class: 'bar' }, h('i', { id: 'load-bar', style: 'width:0' })))); this.root.appendChild(this.loader); }
    (this.loader.querySelector('#load-text') as HTMLElement).textContent = text;
    (this.loader.querySelector('#load-bar') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
  }
  hideLoader(): void { this.loader?.remove(); this.loader = null; }

  async go(name: string, params?: unknown, push = true): Promise<void> {
    const b = this.screens.get(name) ?? BUILTIN[name];
    if (!b) { toast(`Screen "${name}" is not available`); return; }
    if (push) this.stack.push([name, params]);
    const el = await b(this, params);
    this.screenEl?.remove();
    this.screenEl = el;
    this.root.appendChild(el);
    if (name === 'main') { this.backdrop?.show(); } else this.backdrop?.hide();
    audio.ui('click');
    requestAnimationFrame(() => (el.querySelector('.menu-item.hero, .btn.primary, .btn') as HTMLElement | null)?.focus?.({ preventScroll: true }));
  }

  back(): void {
    this.stack.pop();
    const prev = this.stack.pop();
    void this.go(prev?.[0] ?? 'main', prev?.[1]);
  }

  /** Runs a watched match on top of the UI. `managed` is the side (or both) whose tactics and subs the user controls. */
  play(match: Match, managed: Side | 'both' | null, onDone: (r: SessionResult) => void, extra: Partial<ConstructorParameters<typeof GameSession>[1]> = {}): void {
    this.screenEl?.remove(); this.screenEl = null;
    this.backdrop?.hide();
    this.nav.enabled = false;
    audio.stopMusic();
    this.session = new GameSession(this.root, {
      match, managed, openSettings: (parent) => buildSettings(parent), ...extra,
      onExit: (r) => { this.session = null; this.nav.enabled = true; if (settings.value.audio.menuMusic) audio.startMusic('menu'); onDone(r); },
    });
  }
}

function detectPreset(): 'Low' | 'Medium' | 'High' | 'Ultra' {
  if (isMobile()) return 'Low';
  try {
    const cores = navigator.hardwareConcurrency ?? 4, mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
    if (cores <= 2 || mem <= 2) return 'Low';
    if (cores >= 8 && mem >= 8) return 'High';
    return defaultQualityName() === 'Low' ? 'Low' : 'Medium';
  } catch { return 'Medium'; }
}

// ===================================================================== screens
const BUILTIN: Record<string, ScreenBuilder> = {
  main: (app) => mainMenu(app),
  settings: (app) => {
    const el = h('div', { class: 'ui-layer screen' });
    buildSettings(el, { onBack: () => app.back() });
    return el;
  },
  credits: (app) => creditsScreen(app),
  quick: (app, p) => exhibition(app, (p as QuickParams | undefined) ?? {}),
};

async function latestSave(): Promise<{ key: string; st: CareerState } | null> {
  let best: { key: string; st: CareerState; score: number } | null = null;
  for (const key of ['career:auto', 'career:slot1', 'career:slot2', 'career:slot3']) {
    const v = await storage.get<{ data: CareerState } | CareerState>(key);
    const st = v && 'data' in (v as object) ? (v as { data: CareerState }).data : (v as CareerState | undefined);
    if (st?.world) { const score = st.season * 100 + st.week; if (!best || score > best.score) best = { key, st, score }; }
  }
  return best;
}

async function mainMenu(app: App): Promise<HTMLElement> {
  const save = await latestSave();
  const item = (iconName: string, title: string, desc: string, fn: () => void, hero = false): HTMLElement =>
    h('button', { class: 'menu-item' + (hero ? ' hero' : ''), onclick: fn, onmouseenter: (): void => audio.ui('hover') }, icon(iconName), h('div', null, h('div', { class: 't' }, title), h('div', { class: 'd' }, desc)));
  const sc = save ? save.st : null;
  const club = sc ? sc.world.clubs[sc.userClubId] : null;
  return h('div', { class: 'ui-layer landing screen clear' },
    h('div', { class: 'left' },
      logo(),
      h('div', { class: 'display tag' }, 'Build a ', h('span', null, 'dynasty'), '.', h('br'), 'One match at a time.'),
      h('div', { class: 'sub' }, 'Pick a club, set the tactics, sign the stars. Matches play out in about a minute — the football is down to you, not your thumbs.'),
      h('div', { class: 'menu-list' },
        save && club ? item('play', 'Continue career', `${club.name} · Season ${sc!.season} · Week ${sc!.week}`, () => void app.go('career-hub', save.st), true) : null,
        item('career', save ? 'New career' : 'Start your career', 'Manage a club through the seasons', () => void app.go('career'), !save),
        item('versus', 'Exhibition match', 'Any two clubs, your tactics, ~1 minute', () => void app.go('quick')),
        item('cup', 'Tournament', 'World-cup style or knockout cup', () => void app.go('tournament')),
        item('settings', 'Settings', 'Match length, speed, graphics, audio', () => void app.go('settings')),
        item('info', 'About', 'Credits & licences', () => void app.go('credits'))),
      h('div', { class: 'foot' }, h('span', null, 'v1.0'), h('span', null, 'Every club, player and sponsor is fictional'), h('span', null, 'Saves stay on this device'))),
    h('div', { class: 'right' }, club ? h('div', { class: 'card save-card', onclick: (): void => void app.go('career-hub', save!.st) }, crest(club.kits.home), h('div', null, h('div', { class: 'eyebrow' }, 'Latest save'), h('div', { style: 'font-size:20px;font-weight:800' }, club.name), h('div', { class: 'muted', style: 'font-size:13px' }, `${sc!.managerName} · Season ${sc!.season}, week ${sc!.week}`))) : null));
}

function creditsScreen(app: App): HTMLElement {
  return h('div', { class: 'ui-layer screen' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', null, 'About'), h('button', { class: 'btn', 'data-back': true, onclick: (): void => app.back() }, 'Back')),
    h('div', { class: 'card', style: 'margin-top:16px;line-height:1.75;max-width:760px' }, 'Football Simulator is a manager game built with TypeScript, Vite and Canvas 2D (no runtime dependencies). Matches are simulated by a full football engine — ball physics, positioning, fouls, offsides, set pieces, fatigue — and played out in fast-forward from a top-down camera. All clubs, leagues, nations, players, kits, stadiums and sponsors are fictional and procedurally generated. Audio is generated in the browser; there are no bundled third-party media assets. See CREDITS.md in the repository for licences.'));
}

// ===================================================================== exhibition
export interface QuickParams { home?: string; away?: string }

function exhibition(app: App, p: QuickParams): HTMLElement {
  const w = app.world;
  const leagues = Object.values(w.leagues);
  const clubs = Object.values(w.clubs);
  const state = {
    home: p.home ?? clubs[0]!.id, away: p.away ?? clubs[1]!.id, manage: 'home' as 'home' | 'away' | 'both' | 'none',
    stadium: 'random' as 'random' | number, weather: 'random' as string, tod: 'random' as string, length: settings.value.gameplay.matchLength as MatchLength, knockout: false,
    formation: { home: w.clubs[p.home ?? clubs[0]!.id]!.formation, away: w.clubs[p.away ?? clubs[1]!.id]!.formation },
    tactics: { home: null as Tactics | null, away: null as Tactics | null },
    lineup: { home: null as string[] | null, away: null as string[] | null },
  };
  const root = h('div', { class: 'ui-layer screen' });
  const sideCard = (which: 'home' | 'away', label: string): HTMLElement => {
    const box = h('div', { class: 'card col', style: 'gap:14px' });
    const leagueSel = h('select'); const clubSel = h('select'); const info = h('div', { class: 'col', style: 'gap:12px' });
    const club = (): (typeof w.clubs)[string] => w.clubs[state[which]]!;
    const renderInfo = (): void => {
      const c = club(); const r = teamRatings(w, c.id);
      clear(info);
      info.append(h('div', { class: 'row', style: 'gap:14px' }, crest(c.kits.home, 54), h('div', null, h('div', { style: 'font-size:20px;font-weight:800' }, c.name), h('div', { class: 'muted', style: 'font-size:13px' }, `${c.stadium.name} · ${c.stadium.capacity.toLocaleString()}`))),
        h('div', { class: 'row wrap', style: 'gap:6px' }, ...(['ovr', 'att', 'mid', 'def', 'gk'] as const).map((k) => h('span', { class: 'pill' + (k === 'ovr' ? ' accent' : '') }, `${k.toUpperCase()} ${r[k]}`)), h('span', { class: 'pill blue' }, state.formation[which])));
    };
    const fillClubs = (lid: string): void => { clear(clubSel); for (const id of w.leagues[lid]!.clubs) clubSel.appendChild(h('option', { value: id, selected: id === state[which] }, w.clubs[id]!.name)); };
    for (const l of leagues) leagueSel.appendChild(h('option', { value: l.id, selected: l.id === club().leagueId }, l.name));
    fillClubs(club().leagueId);
    const pickClub = (id: string): void => { state[which] = id; state.formation[which] = w.clubs[id]!.formation; state.tactics[which] = null; state.lineup[which] = null; renderInfo(); updateCompare(); };
    leagueSel.onchange = (): void => { fillClubs(leagueSel.value); pickClub(clubSel.value); };
    clubSel.onchange = (): void => pickClub(clubSel.value);
    renderInfo();
    box.append(h('h3', null, label), h('div', { class: 'split', style: 'gap:10px' }, h('div', { class: 'field' }, h('label', null, 'League'), leagueSel), h('div', { class: 'field' }, h('label', null, 'Club'), clubSel)), info,
      h('button', { class: 'btn', onclick: (): void => editTeam(which, renderInfo) }, icon('tactics'), 'Formation, lineup & tactics'));
    return box;
  };
  const cmp = h('div', { class: 'card' });
  const updateCompare = (): void => {
    const a = w.clubs[state.home]!, b = w.clubs[state.away]!;
    clear(cmp); cmp.append(h('h3', null, 'Head to head'), compareBlock({ name: a.short, ...teamRatings(w, a.id) }, { name: b.short, ...teamRatings(w, b.id) }, a.kits.home.primary, b.kits.home.primary));
  };
  const editTeam = (which: 'home' | 'away', onDone: () => void): void => {
    const c = w.clubs[state[which]]!;
    const squad = c.squad.map((id) => w.players[id]!).filter(Boolean);
    const tactics = state.tactics[which] ?? { ...c.tactics };
    state.tactics[which] = tactics;
    let formation = formationById(state.formation[which]);
    let starters = (state.lineup[which] ?? pickLineup(squad, formation).starters.map((q) => q.id)).slice();
    const body = h('div', { class: 'col', style: 'gap:22px' });
    const draw = (): void => {
      clear(body);
      body.append(h('div', { class: 'col', style: 'gap:10px' }, h('h3', null, 'Formation'), formationPicker(formation.id, (id) => { formation = formationById(id); state.formation[which] = id; starters = pickLineup(squad, formation).starters.map((q) => q.id); state.lineup[which] = starters; draw(); })),
        h('div', { class: 'col', style: 'gap:10px' }, h('h3', null, 'Starting XI'), lineupEditor({ squad, formation, starters, kit: c.kits.home, onChange: (ids) => { state.lineup[which] = ids; } })),
        tacticsEditor(tactics, () => undefined));
    };
    draw();
    const ov = modal(h('div', { class: 'col' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'row' }, crest(c.kits.home, 32), h('h2', null, c.name)), h('button', { class: 'btn primary', onclick: (): void => { ov.remove(); onDone(); } }, icon('check'), 'Done')), body), undefined, 'wide');
    root.appendChild(ov);
  };
  const opt = (label: string, ctl: HTMLElement): HTMLElement => h('div', { class: 'field' }, h('label', null, label), ctl);
  const sel = (vals: Array<[string | number, string]>, cur: string | number, set: (v: string) => void): HTMLElement => h('select', { onchange: (e: Event): void => set((e.target as HTMLSelectElement).value) }, vals.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(cur) }, l)));
  const manageSeg = h('div', { class: 'seg' });
  const renderManage = (): void => { clear(manageSeg); for (const [m, l] of [['home', 'Manage home'], ['away', 'Manage away'], ['both', 'Manage both'], ['none', 'Just watch']] as const) manageSeg.appendChild(h('button', { class: state.manage === m ? 'on' : '', onclick: (): void => { state.manage = m; renderManage(); } }, l)); };
  renderManage();

  const start = (): void => {
    const over: Partial<MatchConfig> = {
      halfLength: MATCH_LENGTHS[state.length].half, stadiumStyle: state.stadium === 'random' ? Math.floor(Math.random() * 8) : state.stadium,
      weather: (state.weather === 'random' ? ['clear', 'clear', 'rain', 'fog', 'snow'][Math.floor(Math.random() * 5)] : state.weather) as MatchConfig['weather'],
      timeOfDay: (state.tod === 'random' ? ['day', 'dusk', 'night'][Math.floor(Math.random() * 3)] : state.tod) as MatchConfig['timeOfDay'],
      knockout: state.knockout, extraTime: state.knockout, penalties: state.knockout,
    };
    const cfg = matchConfigFromSettings(over);
    const clash = Math.abs(parseInt(w.clubs[state.home]!.kits.home.primary.slice(1), 16) - parseInt(w.clubs[state.away]!.kits.home.primary.slice(1), 16)) < 0x280000;
    const home = teamSetupFromClub(w, state.home, { formation: state.formation.home, tactics: state.tactics.home ?? undefined, lineup: state.lineup.home ?? undefined });
    const away = teamSetupFromClub(w, state.away, { formation: state.formation.away, tactics: state.tactics.away ?? undefined, lineup: state.lineup.away ?? undefined, away: clash });
    const match = new Match(cfg, home, away);
    const managed: Side | 'both' | null = state.manage === 'home' ? 0 : state.manage === 'away' ? 1 : state.manage === 'both' ? 'both' : null;
    app.play(match, managed, () => void app.go('quick', { home: state.home, away: state.away }, false), { fullTimeTitle: 'Exhibition' });
  };

  root.append(
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:16px' }, h('div', null, h('div', { class: 'eyebrow' }, 'Exhibition'), h('h1', null, 'Set up a match')), h('button', { class: 'btn', 'data-back': true, onclick: (): void => app.back() }, 'Back')),
    h('div', { class: 'col' },
      h('div', { class: 'split' }, sideCard('home', 'Home'), sideCard('away', 'Away')),
      cmp,
      h('div', { class: 'card' }, h('h3', null, 'Match settings'), h('div', { class: 'col', style: 'gap:18px' }, manageSeg, h('div', { class: 'split', style: 'grid-template-columns:repeat(3,1fr)' },
        opt('Match length', sel((Object.keys(MATCH_LENGTHS) as MatchLength[]).map((k) => [k, `${MATCH_LENGTHS[k].label} (~${MATCH_LENGTHS[k].seconds}s)`] as [string, string]), state.length, (v) => { state.length = v as MatchLength; })),
        opt('Stadium', sel([['random', 'Random'], ...STADIUM_STYLES.map((s, i) => [i, s.name] as [number, string])], state.stadium, (v) => { state.stadium = v === 'random' ? 'random' : Number(v); })),
        opt('Weather', sel([['random', 'Random'], ['clear', 'Clear'], ['rain', 'Rain'], ['fog', 'Fog'], ['snow', 'Snow']], state.weather, (v) => { state.weather = v; })),
        opt('Time of day', sel([['random', 'Random'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']], state.tod, (v) => { state.tod = v; })),
        opt('Cup rules (extra time & penalties)', sel([['no', 'No'], ['yes', 'Yes']], state.knockout ? 'yes' : 'no', (v) => { state.knockout = v === 'yes'; }))))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary big', onclick: start }, icon('play'), 'Kick off'))));
  updateCompare();
  return root;
}
