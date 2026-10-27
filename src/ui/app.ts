import { h, clear, toast, kitChip } from './dom';
import { MenuNav } from './menunav';
import { InputManager, type SlotScheme } from '../input/manager';
import { settings } from '../core/settings';
import { generateWorld } from '../data/generate';
import type { World } from '../data/types';
import { Match } from '../match/match';
import { teamRatings, teamSetupFromClub } from '../match/setup';
import { GameSession, matchConfigFromSettings, type HumanSpec, type SessionResult } from './session';
import { buildSettings } from './settingsui';
import { audio } from '../audio/engine';
import { STADIUM_STYLES } from '../render/stadium';
import { DIFFICULTIES } from '../match/types';
import { qualityFor, defaultQualityName, isMobile } from '../render/quality';
import type { MatchConfig } from '../match/types';
import type { Side } from '../match/constants';

export type ScreenBuilder = (app: App, params?: unknown) => HTMLElement | Promise<HTMLElement>;

export class App {
  readonly root: HTMLElement;
  input!: InputManager;
  nav = new MenuNav();
  world!: World;
  private screenEl: HTMLElement | null = null;
  private stack: Array<[string, unknown]> = [];
  private screens = new Map<string, ScreenBuilder>();
  session: GameSession | null = null;
  private loader: HTMLElement | null = null;

  constructor(root: HTMLElement) { this.root = root; }

  register(name: string, fn: ScreenBuilder): void { this.screens.set(name, fn); }

  async boot(): Promise<void> {
    this.showLoader('Loading', 0.1);
    await settings.load();
    this.showLoader('Preparing input', 0.3);
    this.input = new InputManager(this.root, true);
    if (isMobile()) this.input.touch?.root.classList.add('active');
    this.showLoader('Generating the world', 0.5);
    await new Promise((r) => setTimeout(r, 30));
    this.world = generateWorld({ seed: 'football-simulator' });
    this.showLoader('Ready', 1);
    // unlock audio on the first gesture
    const unlock = (): void => { audio.unlock(); audio.startMusic('menu'); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    await new Promise((r) => setTimeout(r, 120));
    this.hideLoader();
    if (!settings.value.graphics.autoDetected) {
      settings.update((s) => { s.graphics.autoDetected = true; s.graphics.preset = detectPreset(); });
    }
    this.go('main');
  }

  showLoader(text: string, p: number): void {
    if (!this.loader) { this.loader = h('div', { class: 'loading' }, h('div', { class: 'col', style: 'align-items:center' }, h('div', { class: 'brand' }, h('div', { class: 'mark' }, 'F'), h('h1', null, 'Football Simulator')), h('div', { class: 'muted', id: 'load-text' }), h('div', { class: 'bar' }, h('i', { id: 'load-bar', style: 'width:0' })))); this.root.appendChild(this.loader); }
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
    audio.ui('click');
    requestAnimationFrame(() => (el.querySelector('.btn.primary, .btn') as HTMLElement | null)?.focus?.({ preventScroll: true }));
  }

  back(): void {
    this.stack.pop();
    const prev = this.stack.pop();
    void this.go(prev?.[0] ?? 'main', prev?.[1]);
  }

  /** Runs a match session on top of the UI. */
  play(match: Match, humans: HumanSpec[], onDone: (r: SessionResult) => void, extra: Partial<ConstructorParameters<typeof GameSession>[1]> = {}): void {
    this.screenEl?.remove(); this.screenEl = null;
    this.nav.enabled = false;
    audio.stopMusic();
    this.session = new GameSession(this.root, {
      match, humans, input: this.input, openSettings: (parent) => buildSettings(parent, this.input), ...extra,
      onExit: (r) => { this.session = null; this.nav.enabled = true; if (settings.value.audio.menuMusic) audio.startMusic('menu'); onDone(r); },
    });
  }

  /** Default human control schemes. */
  schemes(n: 1 | 2): SlotScheme[] {
    const pads = [...(navigator.getGamepads?.() ?? [])].filter((g) => g && g.connected).length;
    if (n === 1) return [{ keyboard: 'p1', pad: pads > 0 ? 0 : null, touch: true, mouse: true }];
    return pads >= 2 ? [{ keyboard: 'p1', pad: 0, touch: false, mouse: true }, { keyboard: 'p2', pad: 1, touch: false, mouse: false }]
      : [{ keyboard: 'p1', pad: null, touch: false, mouse: true }, { keyboard: 'p2', pad: pads > 0 ? 0 : null, touch: false, mouse: false }];
  }
}

function detectPreset(): 'Low' | 'Medium' | 'High' | 'Ultra' {
  if (isMobile()) return 'Low';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'Low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(r)) return 'Low';
    const cores = navigator.hardwareConcurrency ?? 4, mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
    if (/rtx|radeon rx [6-9]|apple m[1-9]|rx 7/i.test(r) && cores >= 8 && mem >= 8) return 'High';
    if (/intel/i.test(r) && !/iris xe|arc/i.test(r)) return 'Low';
    return defaultQualityName() === 'Low' ? 'Low' : 'Medium';
  } catch { return 'Medium'; }
}

// ===================================================================== screens
const BUILTIN: Record<string, ScreenBuilder> = {
  main: (app) => mainMenu(app),
  settings: (app) => {
    const el = h('div', { class: 'ui-layer screen' });
    buildSettings(el, app.input, { onBack: () => app.back() });
    return el;
  },
  credits: (app) => creditsScreen(app),
  quick: (app, p) => quickMatch(app, (p as QuickParams | undefined) ?? { mode: '1p' }),
};

function mainMenu(app: App): HTMLElement {
  const item = (label: string, fn: () => void, primary = false): HTMLElement => h('button', { class: 'btn' + (primary ? ' primary' : ''), onclick: fn, onmouseenter: (): void => audio.ui('hover') }, label);
  return h('div', { class: 'ui-layer screen' },
    h('div', { class: 'brand' }, h('div', { class: 'mark' }, 'F'), h('div', { class: 'col', style: 'gap:2px' }, h('div', { class: 'hero-title' }, 'Football Simulator'), h('div', { class: 'muted' }, 'Original clubs · original players · original everything'))),
    h('div', { class: 'grow row wrap', style: 'align-items:flex-start;gap:48px' },
      h('div', { class: 'menu-list' },
        item('Quick match', () => void app.go('quick', { mode: '1p' }), true), item('Career', () => void app.go('career')), item('Tournament', () => void app.go('tournament')),
        item('Skill games & training', () => void app.go('training')), item('Local versus', () => void app.go('quick', { mode: '2p' })), item('Settings', () => void app.go('settings')), item('Credits', () => void app.go('credits'))),
      h('div', { class: 'card', style: 'max-width:420px' }, h('h3', null, 'Controls'), h('div', { class: 'muted', style: 'line-height:1.6' }, 'Keyboard: WASD move · J pass · K through · L lob/cross · I shoot · Shift sprint · Ctrl precision · Q switch/chip · E finesse/press · 1–4 skill moves · Esc pause.', h('br'), 'Gamepad and touch controls are detected automatically and prompts follow your device.'))),
    h('div', { class: 'muted', style: 'font-size:12px' }, 'v0.1 · saves stay on this device'));
}

function creditsScreen(app: App): HTMLElement {
  return h('div', { class: 'ui-layer screen' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', null, 'Credits'), h('button', { class: 'btn', 'data-back': true, onclick: (): void => app.back() }, 'Back')),
    h('div', { class: 'card', style: 'margin-top:16px;line-height:1.7;max-width:720px' }, 'Football Simulator is built with TypeScript, Vite and Three.js (MIT). All clubs, leagues, nations, players, kits, stadiums and sponsors are fictional and procedurally generated. Audio is generated in the browser; there are no bundled third-party media assets. See CREDITS.md in the repository for licences.'));
}

export interface QuickParams { mode: '1p' | '2p' | 'coop' | 'cpu'; home?: string; away?: string }

function quickMatch(app: App, p: QuickParams): HTMLElement {
  const w = app.world;
  const leagues = Object.values(w.leagues);
  const state = {
    mode: p.mode, home: p.home ?? Object.values(w.clubs)[0]!.id, away: p.away ?? Object.values(w.clubs)[1]!.id,
    stadium: 'random' as 'random' | number, weather: settings.value.gameplay.weather as string, tod: settings.value.gameplay.timeOfDay as string,
    half: settings.value.gameplay.halfLength, diff: settings.value.gameplay.difficulty as string, knockout: false,
  };
  const side = (which: 'home' | 'away', label: string): HTMLElement => {
    const box = h('div', { class: 'card col' });
    const leagueSel = h('select');
    const clubSel = h('select');
    const info = h('div', { class: 'col', style: 'gap:8px' });
    const club = (): ReturnType<() => typeof w.clubs[string]> => w.clubs[state[which]]!;
    const renderInfo = (): void => {
      const c = club(); const r = teamRatings(w, c.id);
      clear(info);
      info.append(h('div', { class: 'row' }, kitChip(c.kits.home.primary), kitChip(c.kits.home.secondary), h('b', null, c.name)), h('div', { class: 'muted' }, `${c.stadium.name} · ${c.stadium.capacity.toLocaleString()} · ${c.formation}`),
        h('div', { class: 'row wrap' }, ...(['ovr', 'att', 'mid', 'def', 'gk'] as const).map((k) => h('span', { class: 'pill' + (k === 'ovr' ? ' accent' : '') }, `${k.toUpperCase()} ${r[k]}`))));
    };
    const fillClubs = (lid: string): void => {
      clear(clubSel);
      for (const id of w.leagues[lid]!.clubs) clubSel.appendChild(h('option', { value: id, selected: id === state[which] }, w.clubs[id]!.name));
    };
    for (const l of leagues) leagueSel.appendChild(h('option', { value: l.id, selected: l.id === club().leagueId }, l.name));
    fillClubs(club().leagueId);
    leagueSel.onchange = (): void => { fillClubs(leagueSel.value); state[which] = clubSel.value; renderInfo(); };
    clubSel.onchange = (): void => { state[which] = clubSel.value; renderInfo(); };
    renderInfo();
    box.append(h('h3', null, label), h('div', { class: 'field' }, h('label', null, 'League'), leagueSel), h('div', { class: 'field' }, h('label', null, 'Club'), clubSel), info);
    return box;
  };
  const opt = (label: string, ctl: HTMLElement): HTMLElement => h('div', { class: 'field' }, h('label', null, label), ctl);
  const sel = (vals: Array<[string | number, string]>, cur: string | number, set: (v: string) => void): HTMLElement => h('select', { onchange: (e: Event): void => set((e.target as HTMLSelectElement).value) }, vals.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(cur) }, l)));
  const modeSeg = h('div', { class: 'seg' });
  const renderMode = (): void => { clear(modeSeg); for (const [m, l] of [['1p', '1 player'], ['2p', '2 players (versus)'], ['coop', '2 players co-op'], ['cpu', 'CPU vs CPU']] as const) modeSeg.appendChild(h('button', { class: state.mode === m ? 'on' : '', onclick: (): void => { state.mode = m; renderMode(); } }, l)); };
  renderMode();

  const start = (): void => {
    const touch = app.input.active === 'touch';
    const over: Partial<MatchConfig> = {
      halfLength: state.half, difficulty: state.diff as MatchConfig['difficulty'], stadiumStyle: state.stadium === 'random' ? Math.floor(Math.random() * 8) : state.stadium,
      weather: (state.weather === 'random' ? ['clear', 'clear', 'rain', 'fog', 'snow'][Math.floor(Math.random() * 5)] : state.weather) as MatchConfig['weather'],
      timeOfDay: (state.tod === 'random' ? ['day', 'dusk', 'night'][Math.floor(Math.random() * 3)] : state.tod) as MatchConfig['timeOfDay'],
      knockout: state.knockout, headless: state.mode === 'cpu',
    };
    const cfg = matchConfigFromSettings(over, touch);
    const clash = Math.abs(parseInt(w.clubs[state.home]!.kits.home.primary.slice(1), 16) - parseInt(w.clubs[state.away]!.kits.home.primary.slice(1), 16)) < 0x280000;
    const home = teamSetupFromClub(w, state.home), away = teamSetupFromClub(w, state.away, { away: clash });
    const match = new Match(cfg, home, away);
    const humans: HumanSpec[] = [];
    if (state.mode === '1p') humans.push({ side: 0, scheme: app.schemes(1)[0]! });
    else if (state.mode === '2p') { const sc = app.schemes(2); humans.push({ side: 0, scheme: sc[0]! }, { side: 1, scheme: sc[1]! }); }
    else if (state.mode === 'coop') { const sc = app.schemes(2); humans.push({ side: 0, scheme: sc[0]! }, { side: 0, scheme: sc[1]! }); }
    else humans.push({ side: 0 as Side, scheme: app.schemes(1)[0]!, keeperOnly: false });
    if (state.mode === 'cpu') { humans.length = 0; humans.push({ side: 0, scheme: { keyboard: 'p1', pad: null, touch: false, mouse: false } }); }
    app.play(match, humans, () => void app.go('quick', { ...p, mode: state.mode, home: state.home, away: state.away }, false));
  };

  return h('div', { class: 'ui-layer screen' },
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' }, h('h2', null, p.mode === '2p' ? 'Local versus' : 'Quick match'), h('button', { class: 'btn', 'data-back': true, onclick: (): void => app.back() }, 'Back')),
    h('div', { class: 'col' }, modeSeg,
      h('div', { class: 'split' }, side('home', 'Home'), side('away', 'Away')),
      h('div', { class: 'card' }, h('h3', null, 'Match settings'), h('div', { class: 'split' },
        opt('Stadium', sel([['random', 'Random'], ...STADIUM_STYLES.map((s, i) => [i, s.name] as [number, string])], state.stadium, (v) => { state.stadium = v === 'random' ? 'random' : Number(v); })),
        opt('Weather', sel([['random', 'Random'], ['clear', 'Clear'], ['rain', 'Rain'], ['fog', 'Fog'], ['snow', 'Snow']], state.weather, (v) => { state.weather = v; })),
        opt('Time of day', sel([['random', 'Random'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']], state.tod, (v) => { state.tod = v; })),
        opt('Half length', sel([3, 5, 8, 10, 15, 20].map((n) => [n, `${n} minutes`] as [number, string]), state.half, (v) => { state.half = Number(v); })),
        opt('Difficulty', sel(DIFFICULTIES.map((d) => [d, d] as [string, string]), state.diff, (v) => { state.diff = v; })),
        opt('Cup rules (extra time & penalties)', sel([['no', 'No'], ['yes', 'Yes']], state.knockout ? 'yes' : 'no', (v) => { state.knockout = v === 'yes'; })))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: start }, 'Kick off'), h('span', { class: 'muted' }, qualityFor(settings.value.graphics.preset).name + ' graphics')))
  );
}
