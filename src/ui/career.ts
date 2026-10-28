import { h, add, clear, toast, money } from './dom';
import { modal } from './panels';
import type { App } from './app';
import { storage, wrapSave, parseSave, downloadJson, pickJsonFile } from '../core/storage';
import { createCareer, leagueTable, nextUserFixture, squadOf, userFixtureThisWeek, applyResult, upgradeFacility, promoteYouth, acceptJob, cupRoundReached, ensureSquad } from '../manager/career';
import { CareerRunner } from '../sim/runner';
import type { Command } from '../manager/commands';
import { CUP_ROUND_NAMES, isWindowOpen, type CareerState, type Fixture } from '../manager/state';
import { askingPrice, evaluateBid, executeTransfer, releasePlayer, renewContract, renewDemand, resolveSellOffer, scoutedOverall, searchMarket, club, player, type MarketFilter } from '../manager/transfers';
import { facilityUpgradeCost, weeklyWages } from '../manager/economy';
import type { Player } from '../data/types';
import { formationById } from '../data/formations';
import { pickLineup, teamRatings, teamSetupFromClub } from '../match/setup';
import { Match } from '../match/match';
import { matchConfigFromSettings } from './session';
import { toSimResult } from '../match/stats';
import { POS_GROUP } from '../data/rating';
import { audio } from '../audio/engine';
import type { Side } from '../match/constants';
import { compareBlock, crest, formDots, formationPicker, icon, lineupEditor, logo, ovrBadge, playerCardEl, posTag, tacticsEditor } from './components';

const SLOTS = ['career:slot1', 'career:slot2', 'career:slot3'];

export function registerCareer(app: App): void {
  app.register('career', (a) => careerStart(a));
  app.register('career-hub', (a, p) => new CareerHub(a, p as CareerState).render());
  app.register('career-match', (a, p) => matchPrep(a, p as { state: CareerState; fixtureId: string; runner: CareerRunner }));
}

const ord = (n: number): string => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
const POS_ORDER = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];
const groupOf = (p: Player): string => (p.positions[0] === 'GK' ? 'GK' : (POS_GROUP as Record<string, string>)[p.positions[0]!] ?? 'MID');

// ============================================================================ start / load
async function careerStart(app: App): Promise<HTMLElement> {
  const metas: Array<{ key: string; label: string; sub: string; kit: { primary: string; secondary: string; pattern: string } }> = [];
  for (const key of [...SLOTS, 'career:auto']) {
    const v = await storage.get<{ data: CareerState } | CareerState>(key);
    const st = v && 'data' in (v as object) ? (v as { data: CareerState }).data : (v as CareerState | undefined);
    if (st?.world) { const c = st.world.clubs[st.userClubId]!; metas.push({ key, label: c.name, sub: `${st.managerName} · Season ${st.season}, week ${st.week}${key === 'career:auto' ? ' · autosave' : ''}`, kit: c.kits.home }); }
  }
  const w = app.world;
  const leagues = Object.values(w.leagues);
  const sel = { league: leagues[0]!.id, club: leagues[0]!.clubs[0]!, name: 'Manager' };
  const grid = h('div', { class: 'grid-auto', style: 'grid-template-columns:repeat(auto-fill,minmax(210px,1fr))' });
  const detail = h('div', { class: 'card col', style: 'position:sticky;top:0;gap:14px' });
  const leagueSeg = h('div', { class: 'seg' });
  const renderAll = (): void => {
    clear(leagueSeg);
    for (const l of leagues) leagueSeg.appendChild(h('button', { class: sel.league === l.id ? 'on' : '', onclick: (): void => { sel.league = l.id; sel.club = w.leagues[l.id]!.clubs[0]!; renderAll(); } }, l.name));
    clear(grid);
    const lg = w.leagues[sel.league]!;
    for (const id of [...lg.clubs].sort((a, b) => w.clubs[b]!.reputation - w.clubs[a]!.reputation)) {
      const c = w.clubs[id]!; const r = teamRatings(w, id);
      grid.appendChild(h('div', { class: 'card tight' + (sel.club === id ? ' accent' : ''), style: 'cursor:pointer;display:flex;gap:12px;align-items:center', onclick: (): void => { sel.club = id; audio.ui('click'); renderAll(); } }, crest(c.kits.home, 40), h('div', { class: 'grow' }, h('div', { style: 'font-weight:800' }, c.name), h('div', { class: 'muted', style: 'font-size:12px' }, `${c.stadium.capacity.toLocaleString()} seats · ${money(c.budget)}`)), ovrBadge(r.ovr)));
    }
    const c = w.clubs[sel.club]!; const r = teamRatings(w, c.id);
    clear(detail);
    detail.append(h('div', { class: 'row', style: 'gap:16px' }, crest(c.kits.home, 64), h('div', null, h('div', { class: 'eyebrow' }, w.leagues[c.leagueId]!.name), h('div', { style: 'font-size:24px;font-weight:900;letter-spacing:-.02em' }, c.name), h('div', { class: 'muted', style: 'font-size:13px' }, c.stadium.name))),
      h('div', { class: 'compare', style: 'grid-template-columns:1fr 64px 1fr' }, ...(['att', 'mid', 'def', 'gk'] as const).flatMap((k) => [h('div', { class: 'a' }, h('b', null, r[k]), h('div', { class: 'bar' }, h('i', { style: `width:${r[k]}%` }))), h('div', { class: 'k' }, k.toUpperCase()), h('div')])),
      h('div', { class: 'row wrap', style: 'gap:6px' }, h('span', { class: 'pill accent' }, `OVR ${r.ovr}`), h('span', { class: 'pill gold' }, `Budget ${money(c.budget)}`), h('span', { class: 'pill blue' }, c.formation), h('span', { class: 'pill' }, `Rep ${c.reputation}`)),
      h('div', { class: 'field' }, h('label', null, 'Your name'), h('input', { type: 'text', value: sel.name, oninput: (e: Event): void => { sel.name = (e.target as HTMLInputElement).value || 'Manager'; } })),
      h('button', { class: 'btn primary big', onclick: (): void => { const st = createCareer({ clubId: sel.club, managerName: sel.name, mode: 'manager', world: w, seed: `career-${Date.now()}` }); void app.go('career-hub', st); } }, icon('play'), 'Start career'));
  };
  renderAll();
  const loadCard = metas.length ? h('div', { class: 'card col', style: 'gap:10px' }, h('h3', null, 'Continue a career'),
    metas.map((m) => h('div', { class: 'row' }, h('button', { class: 'btn grow', style: 'justify-content:flex-start;gap:14px;padding:12px 16px', onclick: async (): Promise<void> => { const v = await storage.get<{ data: CareerState } | CareerState>(m.key); const st = v && 'data' in (v as object) ? (v as { data: CareerState }).data : (v as CareerState); void app.go('career-hub', st); } }, crest(m.kit, 28), h('div', { style: 'text-align:left' }, h('div', { style: 'font-weight:800' }, m.label), h('div', { class: 'muted', style: 'font-size:12px' }, m.sub))),
      h('button', { class: 'btn small danger', onclick: async (): Promise<void> => { if (confirm('Delete this save?')) { await storage.del(m.key); void app.go('career', undefined, false); } } }, 'Delete'))),
    h('button', { class: 'btn small', onclick: async (): Promise<void> => { try { const env = parseSave(await pickJsonFile()); const st = env.data as CareerState; if (!st.world) throw new Error('bad'); await storage.set('career:slot1', wrapSave(st)); toast('Imported into slot 1'); void app.go('career', undefined, false); } catch { toast('That is not a valid save file'); } } }, 'Import save file')) : null;
  return h('div', { class: 'ui-layer screen' },
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:18px' }, h('div', null, h('div', { class: 'eyebrow' }, 'Career'), h('h1', null, 'Choose your club')), h('button', { class: 'btn', 'data-back': true, onclick: (): void => app.back() }, 'Back')),
    loadCard, h('div', { style: 'height:16px' }),
    h('div', { class: 'ed', style: 'grid-template-columns:1fr minmax(320px,400px);align-items:start' }, h('div', { class: 'col' }, leagueSeg, grid), detail));
}

// ============================================================================ match preparation
async function matchPrep(app: App, p: { state: CareerState; fixtureId: string; runner: CareerRunner }): Promise<HTMLElement> {
  const s = p.state;
  const f = s.fixtures.find((x) => x.id === p.fixtureId)!;
  const mine: Side = f.home === s.userClubId ? 0 : 1;
  const home = club(s, f.home), away = club(s, f.away);
  const opp = club(s, mine === 0 ? f.away : f.home);
  const my = club(s, s.userClubId);
  const cup = f.comp.startsWith('cup:');
  const squad = squadOf(s, s.userClubId);
  ensureLineup(s);
  const root = h('div', { class: 'ui-layer screen' });
  let tab: 'lineup' | 'tactics' | 'report' = 'lineup';
  const body = h('div');
  const tabs = h('div', { class: 'tabs' });
  const rMine = teamRatings(s.world, my.id), rOpp = teamRatings(s.world, opp.id);
  const form = (id: string): Array<'W' | 'D' | 'L'> => s.fixtures.filter((x) => x.played && (x.home === id || x.away === id)).slice(-5).map((x) => { const d = x.home === id ? x.hg! - x.ag! : x.ag! - x.hg!; return d > 0 ? 'W' : d < 0 ? 'L' : 'D'; });

  const kickOff = async (): Promise<void> => {
    toast('Preparing the match…');
    try { const r = await p.runner.run(s, { cmd: 'simWeek' }); Object.assign(s, r.state); } catch { /* the user fixture is still playable */ }
    ensureSquad(s);
    const lineup = s.lineup.starters.length === 11 && s.lineup.starters.every((id) => player(s, id).injuredUntil === 0 && player(s, id).suspended === 0) ? s.lineup.starters : undefined;
    const setupOf = (id: string, away: boolean): ReturnType<typeof teamSetupFromClub> => id === s.userClubId ? teamSetupFromClub(s.world, id, { formation: s.lineup.formation, tactics: s.lineup.tactics, lineup, away }) : teamSetupFromClub(s.world, id, { away });
    const clash = Math.abs(parseInt(home.kits.home.primary.slice(1), 16) - parseInt(away.kits.home.primary.slice(1), 16)) < 0x280000;
    const cfg = matchConfigFromSettings({ seed: `${s.seed}:${f.id}`, stadiumStyle: home.stadium.style, knockout: cup, extraTime: cup, penalties: cup, injuries: true });
    const match = new Match(cfg, setupOf(f.home, false), setupOf(f.away, clash));
    app.play(match, mine, async (r) => {
      if (r.quit) { void app.go('career-hub', s, false); return; }
      const res = toSimResult(match);
      if (cup && res.winner === null) res.winner = Math.random() < 0.5 ? 0 : 1;
      applyResult(s, f, res);
      s.lastResult = s.lastResult;
      const done = await p.runner.run(s, { cmd: 'finishWeek' });
      Object.assign(s, done.state);
      ensureSquad(s);
      await storage.set('career:auto', wrapSave(s));
      void app.go('career-hub', s, false);
    }, { fullTimeTitle: cup ? 'Cup tie' : 'League match' });
  };
  const simIt = async (): Promise<void> => {
    toast('Simulating…');
    const r = await p.runner.run(s, { cmd: 'autoWeek' }); Object.assign(s, r.state); ensureSquad(s);
    await storage.set('career:auto', wrapSave(s));
    const res = s.fixtures.find((x) => x.id === f.id)!;
    toast(`${home.short} ${res.hg}–${res.ag} ${away.short}`);
    void app.go('career-hub', s, false);
  };

  const draw = (): void => {
    clear(tabs); clear(body);
    for (const [k, l] of [['lineup', 'Formation & lineup'], ['tactics', 'Tactics'], ['report', 'Opposition report']] as const) tabs.appendChild(h('button', { class: tab === k ? 'on' : '', onclick: (): void => { tab = k; draw(); } }, l));
    if (tab === 'lineup') body.appendChild(lineupSection(s, squad, () => draw()));
    else if (tab === 'tactics') body.appendChild(h('div', { class: 'card' }, tacticsEditor(s.lineup.tactics, () => undefined)));
    else body.appendChild(oppositionReport(s, opp.id));
  };

  root.append(
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:14px' }, h('div', null, h('div', { class: 'eyebrow' }, cup ? CUP_ROUND_NAMES[f.round - 1] : `${s.world.leagues[f.comp]?.name} · round ${f.round}`), h('h1', null, 'Matchday')), h('button', { class: 'btn', 'data-back': true, onclick: (): void => void app.go('career-hub', s, false) }, 'Back')),
    h('div', { class: 'fixture-hero' },
      h('div', { class: 'tm' }, crest(home.kits.home), h('div', { class: 'nm' }, home.name), formDots(form(home.id)), h('span', { class: 'pill' }, `OVR ${mine === 0 ? rMine.ovr : rOpp.ovr}`)),
      h('div', { class: 'vs' }, h('div', { class: 'when' }, `Week ${f.week}`), h('div', { class: 'big' }, 'VS'), h('div', { class: 'muted', style: 'font-size:12px' }, `${home.stadium.name}`)),
      h('div', { class: 'tm' }, crest(away.kits.home), h('div', { class: 'nm' }, away.name), formDots(form(away.id)), h('span', { class: 'pill' }, `OVR ${mine === 1 ? rMine.ovr : rOpp.ovr}`))),
    h('div', { class: 'card' }, compareBlock({ name: home.short, ...(mine === 0 ? rMine : rOpp) }, { name: away.short, ...(mine === 1 ? rMine : rOpp) }, home.kits.home.primary, away.kits.home.primary)),
    tabs, body,
    h('div', { class: 'row', style: 'position:sticky;bottom:0;padding:14px 0 2px;margin-top:10px;background:linear-gradient(0deg,var(--bg) 60%,transparent);justify-content:flex-end' },
      h('button', { class: 'btn big', onclick: (): void => void simIt() }, icon('ff'), 'Simulate'), h('button', { class: 'btn primary big', onclick: (): void => void kickOff() }, icon('play'), 'Kick off')));
  draw();
  return root;
}

/** Makes sure the stored starting XI matches the chosen formation and squad. */
function ensureLineup(s: CareerState): void {
  const f = formationById(s.lineup.formation);
  const squad = squadOf(s, s.userClubId);
  const ok = s.lineup.starters.length === f.slots.length && s.lineup.starters.every((id) => squad.some((p) => p.id === id));
  if (!ok) s.lineup.starters = pickLineup(squad, f).starters.map((p) => p.id);
}

function lineupSection(s: CareerState, squad: Player[], redraw: () => void): HTMLElement {
  const f = formationById(s.lineup.formation);
  ensureLineup(s);
  const c = club(s, s.userClubId);
  return h('div', { class: 'col', style: 'gap:18px' },
    h('div', { class: 'card col', style: 'gap:12px' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { style: 'margin:0' }, 'Formation'), h('button', { class: 'btn small', onclick: (): void => { s.lineup.starters = pickLineup(squad, f).starters.map((p) => p.id); redraw(); toast('Best XI picked'); } }, icon('bolt'), 'Auto-pick best XI')),
      formationPicker(s.lineup.formation, (id) => { s.lineup.formation = id; s.lineup.starters = pickLineup(squad, formationById(id)).starters.map((p) => p.id); redraw(); })),
    h('div', { class: 'card' }, lineupEditor({ squad, formation: f, starters: s.lineup.starters, kit: c.kits.home, onChange: (ids) => { s.lineup.starters = ids; } })));
}

function oppositionReport(s: CareerState, oppId: string): HTMLElement {
  const c = club(s, oppId);
  const squad = squadOf(s, oppId);
  const f = formationById(c.formation);
  const { starters } = pickLineup(squad, f);
  const top = [...starters].sort((a, b) => b.overall - a.overall).slice(0, 4);
  const t = c.tactics;
  const tags: string[] = [];
  if (t.pressing >= 70) tags.push('Presses high'); if (t.lineHeight <= 30) tags.push('Defends deep'); if (t.directness >= 70) tags.push('Plays direct'); if (t.tempo >= 65) tags.push('Fast tempo'); if (t.width >= 65) tags.push('Uses the wings'); if (t.offsideTrap) tags.push('Offside trap');
  return h('div', { class: 'col' },
    h('div', { class: 'card row', style: 'gap:18px' }, crest(c.kits.home, 48), h('div', { class: 'grow' }, h('div', { style: 'font-weight:800;font-size:18px' }, c.name), h('div', { class: 'row wrap', style: 'gap:6px;margin-top:6px' }, h('span', { class: 'pill blue' }, f.name), h('span', { class: 'pill' }, `${t.style}`), ...tags.map((x) => h('span', { class: 'pill warn' }, x))))),
    h('h3', null, 'Players to watch'), h('div', { class: 'grid-auto' }, top.map((p) => playerCardEl(p, { color: c.kits.home.primary }))));
}

// ============================================================================ hub
type Tab = 'Overview' | 'Squad' | 'Tactics' | 'Transfers' | 'Scouting' | 'Finances' | 'Youth' | 'Fixtures' | 'Table' | 'Board' | 'News';
const TABS: Array<[Tab, string]> = [['Overview', 'home'], ['Squad', 'squad'], ['Tactics', 'tactics'], ['Transfers', 'transfer'], ['Scouting', 'scout'], ['Youth', 'youth'], ['Finances', 'finance'], ['Fixtures', 'calendar'], ['Table', 'table'], ['Board', 'board'], ['News', 'news']];

class CareerHub {
  private root = h('div', { class: 'ui-layer shell screen' });
  private rail = h('div', { class: 'rail' });
  private top = h('div', { class: 'topbar' });
  private body = h('div', { class: 'page' });
  private tab: Tab = 'Overview';
  private runner = new CareerRunner();
  private busy = false;
  private market: MarketFilter = { sort: 'overall' };
  private tableLeague: string;
  private squadView: 'cards' | 'list' = 'cards';
  private squadFilter = 'ALL';

  constructor(private app: App, private s: CareerState) { this.tableLeague = club(s, s.userClubId).leagueId; ensureSquad(s); ensureLineup(s); }

  render(): HTMLElement {
    this.root.append(this.rail, h('div', { class: 'content' }, this.top, this.body));
    this.refresh();
    return this.root;
  }

  private badgeFor(t: Tab): number {
    const s = this.s;
    if (t === 'Transfers') return s.offers.filter((o) => o.status === 'open' && o.kind === 'sell').length;
    if (t === 'Squad') return squadOf(s, s.userClubId).filter((p) => p.injuredUntil > 0 || p.suspended > 0).length;
    return 0;
  }

  private refresh(): void {
    const s = this.s;
    const c = club(s, s.userClubId);
    const lg = s.world.leagues[c.leagueId]!;
    const tbl = leagueTable(s, lg.id);
    const pos = tbl.findIndex((r) => r.club === c.id) + 1;
    const f = userFixtureThisWeek(s);
    // rail
    clear(this.rail);
    this.rail.append(logo());
    for (const [t, ic] of TABS) { const b = this.badgeFor(t); this.rail.appendChild(h('button', { class: 'nav' + (this.tab === t ? ' on' : ''), onclick: (): void => { this.tab = t; audio.ui('click'); this.refresh(); } }, icon(ic), t, b ? h('span', { class: 'badge' }, b) : null)); }
    this.rail.append(h('div', { class: 'sp' }),
      h('button', { class: 'nav', onclick: (): void => void this.save('career:slot1') }, icon('save'), 'Save game'),
      h('button', { class: 'nav', onclick: (): void => downloadJson(`career-${s.season}-w${s.week}.json`, wrapSave(this.s)) }, icon('news'), 'Export save'),
      h('button', { class: 'nav', onclick: async (): Promise<void> => { await this.save('career:auto'); this.runner.dispose(); void this.app.go('main'); } }, icon('exit'), 'Exit to menu'));
    // top bar
    clear(this.top);
    this.top.append(crest(c.kits.home), h('div', null, h('div', { class: 'club' }, c.name), h('div', { class: 'sub' }, `${s.managerName} · ${lg.name}`)), h('div', { class: 'grow' }),
      h('div', { class: 'stat-tile' }, h('div', { class: 'k' }, 'Season'), h('div', { class: 'v' }, `${s.season} · W${s.week}`)),
      h('div', { class: 'stat-tile' }, h('div', { class: 'k' }, 'League'), h('div', { class: 'v' }, `${pos}${ord(pos)}`)),
      h('div', { class: 'stat-tile' }, h('div', { class: 'k' }, 'Cash'), h('div', { class: 'v gold' }, money(c.budget))),
      h('div', { class: 'stat-tile' }, h('div', { class: 'k' }, 'Window'), h('div', { class: 'v ' + (isWindowOpen(s.week) ? 'good' : 'muted') }, isWindowOpen(s.week) ? 'Open' : 'Closed')),
      this.nextBtn(f));
    clear(this.body);
    this.body.scrollTop = 0;
    if (s.board.sacked) { this.body.appendChild(this.sackedView()); return; }
    ({ Overview: () => this.overview(), Squad: () => this.squadPage(), Tactics: () => this.tacticsPage(), Transfers: () => this.transfersView(), Scouting: () => this.scoutingView(), Finances: () => this.financeView(), Youth: () => this.youthView(), Fixtures: () => this.fixturesView(), Table: () => this.tableView(), Board: () => this.boardView(), News: () => this.newsView() } as Record<Tab, () => void>)[this.tab]();
  }

  private async save(key: string): Promise<void> { await storage.set(key, wrapSave(this.s)); if (key !== 'career:auto') toast('Career saved'); }

  // ------------------------------------------------------------ simulation commands
  private async exec(command: Command): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const spin = h('div', { class: 'toast' }, 'Simulating…'); document.body.appendChild(spin);
    try {
      const r = await this.runner.run(this.s, command);
      this.s = r.state;
      if (r.report.seasonEnded) toast(`Season complete — welcome to ${this.s.season}`);
      if (r.report.sacked) toast('You have been sacked');
    } catch (e) { toast('Simulation failed: ' + String(e)); } finally { spin.remove(); this.busy = false; }
    ensureSquad(this.s); ensureLineup(this.s);
    void this.save('career:auto');
    this.refresh();
  }

  private matchDay(f: Fixture): void { void this.app.go('career-match', { state: this.s, fixtureId: f.id, runner: this.runner }); }

  private nextBtn(f: Fixture | null): HTMLElement {
    const s = this.s;
    if (f) return h('button', { class: 'btn primary big', onclick: (): void => this.matchDay(f) }, icon('play'), 'Matchday');
    return h('button', { class: 'btn primary big', onclick: (): void => void this.exec({ cmd: 'finishWeek' }) }, icon('ff'), s.week >= 52 ? 'Finish season' : 'Advance week');
  }

  // ------------------------------------------------------------ views
  private overview(): void {
    const s = this.s;
    const c = club(s, s.userClubId);
    const lg = s.world.leagues[c.leagueId]!;
    const tbl = leagueTable(s, lg.id);
    const pos = tbl.findIndex((r) => r.club === c.id) + 1;
    const next = nextUserFixture(s);
    const formOf = (id: string): Array<'W' | 'D' | 'L'> => s.fixtures.filter((f) => f.played && (f.home === id || f.away === id) && f.comp === lg.id).slice(-5).map((f) => { const my = f.home === id ? f.hg! - f.ag! : f.ag! - f.hg!; return my > 0 ? 'W' : my < 0 ? 'L' : 'D'; });
    const squad = squadOf(s, s.userClubId);
    const hurt = squad.filter((p) => p.injuredUntil > 0), susp = squad.filter((p) => p.suspended > 0), expiring = squad.filter((p) => p.contractEnd - s.season <= 0);
    // hero
    let hero: HTMLElement;
    if (next) {
      const hc = club(s, next.home), ac = club(s, next.away);
      const rh = teamRatings(s.world, hc.id), ra = teamRatings(s.world, ac.id);
      hero = h('div', { class: 'col', style: 'gap:14px' }, h('div', { class: 'fixture-hero' },
        h('div', { class: 'tm' }, crest(hc.kits.home), h('div', { class: 'nm' }, hc.name), formDots(formOf(hc.id))),
        h('div', { class: 'vs' }, h('div', { class: 'when' }, next.week === s.week ? 'This week' : `Week ${next.week}`), h('div', { class: 'big' }, 'VS'), h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, next.comp.startsWith('cup:') ? CUP_ROUND_NAMES[next.round - 1] : lg.name)),
        h('div', { class: 'tm' }, crest(ac.kits.home), h('div', { class: 'nm' }, ac.name), formDots(formOf(ac.id)))),
        h('div', { class: 'card' }, compareBlock({ name: hc.short, ...rh }, { name: ac.short, ...ra }, hc.kits.home.primary, ac.kits.home.primary)));
    } else hero = h('div', { class: 'card col' }, h('h2', null, 'No more fixtures this season'), h('div', { class: 'muted' }, 'Advance the calendar to finish the season.'));
    // mini table around the user
    const lo = Math.max(0, Math.min(tbl.length - 7, pos - 4)); const rows = tbl.slice(lo, lo + 7);
    const miniTable = h('table', null, h('tbody', null, rows.map((r, i) => h('tr', { class: r.club === c.id ? 'sel' : '' }, h('td', { style: 'width:28px;color:var(--text-dim)' }, lo + i + 1), h('td', null, h('span', { class: 'row', style: 'gap:8px' }, crest(club(s, r.club).kits.home, 18), club(s, r.club).name)), h('td', { class: 'num', style: 'text-align:right' }, `${r.p}`), h('td', { class: 'num', style: 'text-align:right;font-weight:800' }, r.pts)))));
    const alerts: HTMLElement[] = [];
    for (const p of hurt) alerts.push(h('div', { class: 'row' }, h('span', { class: 'pill bad' }, '✚ Injured'), h('span', { class: 'grow' }, `${p.name} · ${p.injuredUntil}w`)));
    for (const p of susp) alerts.push(h('div', { class: 'row' }, h('span', { class: 'pill warn' }, 'Suspended'), h('span', { class: 'grow' }, `${p.name} · ${p.suspended}m`)));
    for (const p of expiring.slice(0, 4)) alerts.push(h('div', { class: 'row' }, h('span', { class: 'pill gold' }, 'Contract'), h('span', { class: 'grow' }, `${p.name} expires ${p.contractEnd}`)));
    const sells = s.offers.filter((o) => o.status === 'open' && o.kind === 'sell');
    for (const o of sells.slice(0, 3)) alerts.push(h('div', { class: 'row' }, h('span', { class: 'pill blue' }, 'Offer'), h('span', { class: 'grow' }, `${club(s, o.from).short} bid ${money(o.fee)} for ${player(s, o.playerId!).shortName}`)));
    this.body.append(hero,
      h('div', { class: 'grid-3' },
        h('div', { class: 'card' }, h('h3', null, `${lg.name} · you are ${pos}${ord(pos)}`), miniTable),
        h('div', { class: 'card col', style: 'gap:10px' }, h('h3', { style: 'margin:0' }, 'Needs your attention'), alerts.length ? alerts.slice(0, 7) : h('div', { class: 'muted' }, 'Squad is fit and settled.')),
        h('div', { class: 'card col', style: 'gap:10px' }, h('h3', { style: 'margin:0' }, 'Board objectives'), s.board.objectives.map((o) => h('div', { class: 'row' }, h('span', { class: 'pill ' + (o.done ? 'accent' : o.failed ? 'bad' : '') }, o.done ? '✓' : o.failed ? '✗' : '•'), o.text)), h('div', { class: 'bar' }, h('i', { style: `width:${s.board.confidence}%` })), h('div', { class: 'muted', style: 'font-size:12px' }, `Board confidence ${Math.round(s.board.confidence)}%`))),
      h('div', { class: 'split' },
        h('div', { class: 'card col', style: 'gap:8px' }, h('h3', { style: 'margin:0 0 6px' }, 'Latest news'), s.news.slice(0, 7).map((n) => h('div', { style: 'font-size:13.5px' }, h('span', { class: 'faint' }, `W${n.week}  `), n.text))),
        h('div', { class: 'card col', style: 'gap:10px' }, h('h3', { style: 'margin:0' }, 'Quick actions'),
          h('button', { class: 'btn', onclick: (): void => { this.tab = 'Tactics'; this.refresh(); } }, icon('tactics'), 'Set formation & tactics'),
          h('button', { class: 'btn', onclick: (): void => { this.tab = 'Transfers'; this.refresh(); } }, icon('transfer'), 'Browse the transfer market'),
          h('button', { class: 'btn', onclick: (): void => void this.exec({ cmd: 'toNextMatch' }) }, icon('ff'), 'Skip to next match'),
          h('button', { class: 'btn ghost', onclick: (): void => { if (confirm('Auto-sim the rest of the season? Your lineup and tactics are used.')) void this.exec({ cmd: 'toSeasonEnd' }); } }, icon('skip'), 'Sim the rest of the season'))));
  }

  private squadPage(): void {
    const s = this.s; const squad = squadOf(s, s.userClubId);
    const c = club(s, s.userClubId);
    const flt = h('div', { class: 'seg' });
    const grid = h('div');
    const draw = (): void => {
      clear(flt); clear(grid);
      for (const g of ['ALL', 'GK', 'DEF', 'MID', 'ATT']) flt.appendChild(h('button', { class: this.squadFilter === g ? 'on' : '', onclick: (): void => { this.squadFilter = g; draw(); } }, g));
      const list = squad.filter((p) => this.squadFilter === 'ALL' || groupOf(p) === this.squadFilter).sort((a, b) => POS_ORDER.indexOf(a.positions[0]!) - POS_ORDER.indexOf(b.positions[0]!) || b.overall - a.overall);
      if (this.squadView === 'cards') grid.appendChild(h('div', { class: 'grid-auto' }, list.map((p) => playerCardEl(p, { color: c.kits.home.primary, onClick: (): void => this.playerModal(p), extra: [s.listed.includes(p.id) ? h('span', { class: 'pill blue' }, 'Listed') : null, h('span', { class: 'pill' }, `Fit ${Math.round(p.fitness)}`)] }))));
      else grid.appendChild(h('div', { class: 'card', style: 'overflow:auto;padding:8px' }, h('table', null, h('thead', null, h('tr', null, ['Pos', 'Name', 'Age', 'OVR', 'POT', 'Fit', 'Form', 'Wage', 'Value', 'Contract'].map((x) => h('th', null, x)))),
        h('tbody', null, list.map((p) => h('tr', { class: 'click', onclick: (): void => this.playerModal(p) }, h('td', null, posTag(p.positions[0]!)), h('td', null, p.name, p.injuredUntil ? h('span', { class: 'pill bad', style: 'margin-left:6px' }, `inj ${p.injuredUntil}w`) : null, p.suspended ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'susp') : null), h('td', null, p.age), h('td', null, ovrBadge(p.overall)), h('td', null, p.potential), h('td', null, Math.round(p.fitness)), h('td', null, p.form.toFixed(1)), h('td', null, money(p.wage)), h('td', null, money(p.value)), h('td', null, p.contractEnd)))))));
    };
    draw();
    this.body.append(h('div', { class: 'section-title' }, h('h2', null, `Squad · ${squad.length} players`), h('div', { class: 'row' }, flt, h('div', { class: 'seg' }, (['cards', 'list'] as const).map((v) => h('button', { class: this.squadView === v ? 'on' : '', onclick: (): void => { this.squadView = v; draw(); this.refresh(); } }, v === 'cards' ? 'Cards' : 'List'))))), grid);
  }

  private playerModal(p: Player): void {
    const s = this.s;
    const mine = p.clubId === s.userClubId;
    const sc = scoutedOverall(s, p);
    const a = p.attrs;
    const avg = (...k: Array<keyof typeof a>): number => Math.round(k.reduce((t, x) => t + a[x], 0) / k.length);
    const six: Array<[string, number]> = p.positions[0] === 'GK'
      ? [['DIV', a.gkDiving], ['HAN', a.gkHandling], ['KIC', a.gkKicking], ['POS', a.gkPositioning], ['REF', a.gkReflexes], ['SPD', avg('acceleration', 'sprintSpeed')]]
      : [['PAC', avg('acceleration', 'sprintSpeed')], ['SHO', avg('finishing', 'shotPower', 'longShots')], ['PAS', avg('vision', 'shortPass', 'longPass')], ['DRI', avg('agility', 'ballControl', 'dribbling')], ['DEF', avg('interceptions', 'marking', 'standingTackle')], ['PHY', avg('strength', 'stamina', 'jumping')]];
    const group = (title: string, keys: Array<keyof typeof a>): HTMLElement => h('div', { class: 'col', style: 'gap:6px' }, h('h3', null, title), keys.map((k) => h('div', { class: 'row', style: 'gap:8px;font-size:13px' }, h('span', { style: 'width:118px;color:var(--text-dim)' }, String(k).replace(/([A-Z])/g, ' $1').toLowerCase()), h('div', { class: 'bar grow' }, h('i', { style: `width:${a[k]}%` })), h('span', { style: 'width:24px;text-align:right;font-weight:700' }, a[k]))));
    const actions = h('div', { class: 'row wrap' });
    if (mine) {
      const d = renewDemand(s, p);
      actions.append(
        h('button', { class: 'btn small', onclick: (): void => { if (s.listed.includes(p.id)) s.listed = s.listed.filter((x) => x !== p.id); else s.listed.push(p.id); toast(s.listed.includes(p.id) ? 'Listed for transfer' : 'Removed from list'); ov.remove(); this.refresh(); } }, s.listed.includes(p.id) ? 'Unlist' : 'List for transfer'),
        h('button', { class: 'btn small', onclick: (): void => { const r = renewContract(s, p.id, d.wage, d.years); toast(r.reason + ` (${money(d.wage)}/wk · ${d.years}y)`); ov.remove(); this.refresh(); } }, `Renew (${money(d.wage)}/wk)`),
        h('button', { class: 'btn small danger', onclick: (): void => { if (confirm(`Release ${p.name}?`)) { const r = releasePlayer(s, p.id); if (r < 0) toast('Squad too small'); else toast(`Released (¤${r.toLocaleString()})`); ov.remove(); this.refresh(); } } }, 'Release'));
    } else actions.append(h('button', { class: 'btn small primary', onclick: (): void => { ov.remove(); this.offerDialog(p); } }, 'Make offer'), h('button', { class: 'btn small', onclick: (): void => { if (!s.scouting.shortlist.includes(p.id)) s.scouting.shortlist.push(p.id); toast('Added to shortlist'); } }, 'Shortlist'));
    const ov = modal(h('div', { class: 'col' },
      h('div', { class: 'row', style: 'gap:20px;align-items:center' }, h('div', { class: 'ovr-badge t' + (sc.exact ? Math.min(4, Math.max(0, Math.floor((p.overall - 50) / 8))) : 2), style: 'min-width:80px;height:64px;font-size:34px;border-radius:14px;font-style:italic' }, sc.exact ? String(p.overall) : `${sc.lo}-${sc.hi}`),
        h('div', { class: 'grow' }, h('h2', null, p.name), h('div', { class: 'muted', style: 'margin-top:4px' }, `${p.positions.join(' / ')} · age ${p.age} · ${p.heightCm}cm · ${p.foot === 'L' ? 'left' : 'right'}-footed · ${s.world.nations[p.nation]?.name} · ${p.clubId ? club(s, p.clubId).name : 'Free agent'}`)),
        p.clubId ? crest(club(s, p.clubId).kits.home, 40) : null),
      sc.exact ? h('div', { class: 'row', style: 'gap:10px;justify-content:space-between' }, six.map(([k, v]) => h('div', { class: 'stat-tile', style: 'flex:1;text-align:center' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)))) : null,
      h('div', { class: 'row wrap', style: 'gap:6px' }, h('span', { class: 'pill' }, `Weak foot ${'★'.repeat(p.weakFoot)}`), h('span', { class: 'pill' }, `Skill ${'★'.repeat(p.skillMoves)}`), h('span', { class: 'pill' }, `Work rate ${p.workAtt}/${p.workDef}`), ...p.traits.map((t) => h('span', { class: 'pill accent' }, t))),
      h('div', { class: 'muted' }, `Value ${money(p.value)} · wage ${money(p.wage)}/wk · contract to ${p.contractEnd} · potential ${sc.exact ? p.potential : '?'} · morale ${Math.round(p.morale)} · ${p.goals}G ${p.assists}A in ${p.apps} apps`),
      sc.exact ? h('div', { class: 'split', style: 'grid-template-columns:repeat(3,1fr)' }, group('Attacking', ['finishing', 'shotPower', 'longShots', 'volleys', 'penalties', 'crossing', 'curve']), group('Skill & mind', ['vision', 'shortPass', 'longPass', 'freeKick', 'agility', 'balance', 'ballControl', 'dribbling', 'reactions']), p.positions[0] === 'GK' ? group('Goalkeeping', ['gkDiving', 'gkHandling', 'gkKicking', 'gkPositioning', 'gkReflexes']) : group('Defending & physical', ['interceptions', 'marking', 'standingTackle', 'slidingTackle', 'heading', 'strength', 'stamina', 'jumping', 'aggression'])) : h('div', { class: 'muted' }, 'Scout this player further to reveal detailed attributes.'),
      actions, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (): void => ov.remove() }, 'Close'))), () => ov.remove(), 'wide');
    this.root.appendChild(ov);
  }

  private tacticsPage(): void {
    const s = this.s; const squad = squadOf(s, s.userClubId);
    this.body.append(h('div', { class: 'section-title' }, h('div', null, h('div', { class: 'eyebrow' }, 'Manager'), h('h2', null, 'Formation, lineup & tactics')), h('div', { class: 'muted' }, 'Used for every match you play or simulate.')),
      lineupSection(s, squad, () => this.refresh()),
      h('div', { class: 'card col' }, h('h3', null, 'Match instructions'), tacticsEditor(s.lineup.tactics, () => undefined),
        h('div', { class: 'field', style: 'max-width:320px' }, h('label', null, 'Training focus'), h('select', { onchange: (e: Event): void => { s.trainingFocus = (e.target as HTMLSelectElement).value as typeof s.trainingFocus; } }, ['balanced', 'attacking', 'defending', 'passing', 'physical'].map((k) => h('option', { value: k, selected: s.trainingFocus === k }, k))))));
  }

  private fixturesView(): void {
    const s = this.s;
    const mine = s.fixtures.filter((f) => f.home === s.userClubId || f.away === s.userClubId).sort((a, b) => a.week - b.week);
    this.body.append(h('div', { class: 'section-title' }, h('h2', null, 'Fixtures & results')), h('div', { class: 'card', style: 'overflow:auto;padding:8px' }, h('table', null, h('tbody', null, mine.map((f) => {
      const my = f.home === s.userClubId; const d = f.played ? (my ? f.hg! - f.ag! : f.ag! - f.hg!) : 0;
      return h('tr', { class: f.week === s.week ? 'sel' : '' }, h('td', { class: 'faint' }, `W${f.week}`), h('td', { class: 'muted' }, f.comp.startsWith('cup:') ? CUP_ROUND_NAMES[f.round - 1] : `R${f.round}`), h('td', { style: 'text-align:right' }, club(s, f.home).name), h('td', { style: 'text-align:center;width:110px;font-weight:800' }, f.played ? h('span', { class: d > 0 ? 'good' : d < 0 ? 'bad' : 'gold' }, `${f.hg} – ${f.ag}${f.pens ? ` (${f.pens[0]}–${f.pens[1]})` : ''}`) : h('span', { class: 'faint' }, 'v')), h('td', null, club(s, f.away).name));
    })))));
  }

  private tableView(): void {
    const s = this.s;
    const lgs = Object.values(s.world.leagues);
    const tbl = leagueTable(s, this.tableLeague);
    this.body.append(h('div', { class: 'section-title' }, h('h2', null, 'League table'), h('select', { onchange: (e: Event): void => { this.tableLeague = (e.target as HTMLSelectElement).value; this.refresh(); } }, lgs.map((l) => h('option', { value: l.id, selected: l.id === this.tableLeague }, l.name)))),
      h('div', { class: 'card', style: 'overflow:auto;padding:8px' }, h('table', null, h('thead', null, h('tr', null, ['#', 'Club', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'].map((x) => h('th', null, x)))),
        h('tbody', null, tbl.map((r, i) => h('tr', { class: r.club === s.userClubId ? 'sel' : '' }, h('td', null, i + 1), h('td', null, h('span', { class: 'row', style: 'gap:10px' }, crest(club(s, r.club).kits.home, 20), club(s, r.club).name)), h('td', null, r.p), h('td', null, r.w), h('td', null, r.d), h('td', null, r.l), h('td', null, r.gf), h('td', null, r.ga), h('td', null, r.gf - r.ga), h('td', null, h('b', null, r.pts))))))),
      h('div', { class: 'muted' }, `Cup: you reached round ${cupRoundReached(s, s.userClubId)} of 5.`));
  }

  private transfersView(): void {
    const s = this.s; const f = this.market;
    const open = isWindowOpen(s.week);
    const results = searchMarket(s, f, 48);
    const sells = s.offers.filter((o) => o.status === 'open' && o.kind === 'sell');
    const exp = squadOf(s, s.userClubId).filter((p) => p.contractEnd - s.season <= 1);
    const sel = (opts: Array<[string, string]>, cur: string, set: (v: string) => void): HTMLElement => h('select', { onchange: (e: Event): void => set((e.target as HTMLSelectElement).value) }, opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
    add(this.body,
      h('div', { class: 'section-title' }, h('div', null, h('div', { class: 'eyebrow' }, 'Signings'), h('h2', null, 'Transfer market')), h('div', { class: 'row' }, open ? h('span', { class: 'pill accent' }, 'Window open') : h('span', { class: 'pill warn' }, 'Window closed — free agents only'), h('span', { class: 'pill gold' }, `Budget ${money(club(s, s.userClubId).budget)}`))),
      sells.length ? h('div', { class: 'card col accent', style: 'gap:10px' }, h('h3', { style: 'margin:0' }, 'Offers for your players'), sells.map((o) => { const p = player(s, o.playerId!); return h('div', { class: 'row wrap' }, crest(club(s, o.from).kits.home, 22), h('b', { class: 'grow' }, `${club(s, o.from).name} → ${p.name}: ${money(o.fee)}`), h('button', { class: 'btn small primary', onclick: (): void => { toast(resolveSellOffer(s, o.id, true)); this.refresh(); } }, 'Accept'), h('button', { class: 'btn small', onclick: (): void => { resolveSellOffer(s, o.id, false); this.refresh(); } }, 'Reject')); })) : null,
      exp.length ? h('div', { class: 'card col', style: 'gap:10px' }, h('h3', { style: 'margin:0' }, 'Contracts expiring'), exp.map((p) => h('div', { class: 'row' }, posTag(p.positions[0]!), h('span', { class: 'grow' }, `${p.name} (${p.contractEnd})`), h('button', { class: 'btn small', onclick: (): void => this.playerModal(p) }, 'Open')))) : null,
      h('div', { class: 'card col', style: 'gap:14px' }, h('div', { class: 'row wrap' },
        sel([['', 'All positions'], ['GK', 'Goalkeepers'], ['DEF', 'Defenders'], ['MID', 'Midfielders'], ['ATT', 'Attackers']], f.group ?? '', (v) => { f.group = (v || undefined) as MarketFilter['group']; this.refresh(); }),
        sel([['0', 'Any age'], ['21', '≤21'], ['25', '≤25'], ['30', '≤30']], String(f.maxAge ?? 0), (v) => { f.maxAge = Number(v) || undefined; this.refresh(); }),
        sel([['overall', 'Sort: overall'], ['potential', 'Sort: potential'], ['value', 'Sort: value'], ['age', 'Sort: age']], f.sort ?? 'overall', (v) => { f.sort = v as MarketFilter['sort']; this.refresh(); }),
        h('label', { class: 'row', style: 'gap:8px' }, h('input', { class: 'toggle', type: 'checkbox', checked: !!f.freeOnly, onchange: (e: Event): void => { f.freeOnly = (e.target as HTMLInputElement).checked; this.refresh(); } }), 'Free agents'),
        h('input', { type: 'search', placeholder: 'Search by name…', value: f.query ?? '', onchange: (e: Event): void => { f.query = (e.target as HTMLInputElement).value; this.refresh(); } })),
        h('div', { class: 'grid-auto' }, results.map((p) => { const sc = scoutedOverall(s, p); return playerCardEl(p, { ovr: sc.exact ? p.overall : `${sc.lo}-${sc.hi}`, color: p.clubId ? club(s, p.clubId).kits.home.primary : '#8fa0b8', club: p.clubId ? club(s, p.clubId).short : 'Free agent', extra: [h('span', { class: 'pill gold' }, p.clubId ? money(askingPrice(s, p)) : 'Free')], onClick: (): void => this.playerModal(p) }); }))));
  }

  private offerDialog(p: Player): void {
    const s = this.s;
    const ask = askingPrice(s, p);
    const st = { fee: ask, wage: Math.round(p.wage * 1.15), years: 3 };
    const msg = h('div', { class: 'muted', style: 'min-height:22px' });
    const inputs: Record<string, HTMLInputElement> = {};
    const mk = (label: string, key: keyof typeof st, step: number): HTMLElement => { const i = h('input', { type: 'number', value: st[key], step, onchange: (e: Event): void => { st[key] = Number((e.target as HTMLInputElement).value); } }) as HTMLInputElement; inputs[key] = i; return h('div', { class: 'field' }, h('label', null, label), i); };
    const ov = modal(h('div', { class: 'col' }, h('h2', null, `Offer for ${p.name}`), h('div', { class: 'muted' }, p.clubId ? `${club(s, p.clubId).name} value him around ${money(ask)}.` : 'Free agent — no transfer fee.'),
      p.clubId ? mk('Transfer fee', 'fee', 250_000) : null, mk('Weekly wage', 'wage', 500), mk('Contract (years)', 'years', 1), msg,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: (): void => { const fee = p.clubId ? st.fee : 0; const r = evaluateBid(s, p.id, fee, st.wage, st.years); msg.textContent = r.reason; if (r.status === 'counter') { st.fee = r.counter!; if (inputs.fee) inputs.fee.value = String(st.fee); } if (r.status === 'accepted') { executeTransfer(s, p.id, s.userClubId, fee, st.wage, st.years); toast(`${p.shortName} signed!`); audio.ui('confirm'); ov.remove(); this.refresh(); } } }, 'Submit offer'), h('button', { class: 'btn', onclick: (): void => ov.remove() }, 'Cancel'))), () => ov.remove(), 'narrow');
    this.root.appendChild(ov);
  }

  private scoutingView(): void {
    const s = this.s;
    const short = s.scouting.shortlist.map((id) => s.world.players[id]).filter((p): p is Player => !!p);
    this.body.append(h('div', { class: 'section-title' }, h('h2', null, 'Scouting')), h('div', { class: 'split' },
      h('div', { class: 'card col' }, h('h3', null, 'Scouting network'), s.scouting.scouts.map((sc) => h('div', { class: 'col', style: 'gap:8px;border-bottom:1px solid var(--line);padding-bottom:12px' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, `${sc.name} ${'★'.repeat(sc.quality)}`), h('label', { class: 'row', style: 'gap:8px' }, h('input', { class: 'toggle', type: 'checkbox', checked: sc.assigned, onchange: (e: Event): void => { sc.assigned = (e.target as HTMLInputElement).checked; } }), 'Active')),
        h('div', { class: 'row' }, h('select', { onchange: (e: Event): void => { sc.nation = (e.target as HTMLSelectElement).value; } }, [...new Set(Object.values(s.world.leagues).map((l) => l.nation))].map((n) => h('option', { value: n, selected: sc.nation === n }, s.world.nations[n]?.name ?? n))), h('select', { onchange: (e: Event): void => { sc.group = (e.target as HTMLSelectElement).value as typeof sc.group; } }, ['ANY', 'GK', 'DEF', 'MID', 'ATT'].map((g) => h('option', { value: g, selected: sc.group === g }, g)))))),
        h('div', { class: 'muted' }, `Players discovered: ${Object.keys(s.scouting.known).length}. Scouts reveal more detail each week they observe a player.`)),
      h('div', { class: 'card col' }, h('h3', null, 'Shortlist'), short.length ? short.map((p) => h('div', { class: 'row' }, h('button', { class: 'btn small grow', style: 'justify-content:flex-start', onclick: (): void => this.playerModal(p) }, posTag(p.positions[0]!), `${p.name} · ${p.clubId ? club(s, p.clubId).name : 'free'}`), h('button', { class: 'btn small ghost', onclick: (): void => { s.scouting.shortlist = s.scouting.shortlist.filter((x) => x !== p.id); this.refresh(); } }, '✕'))) : h('div', { class: 'muted' }, 'Add players from the market.'))));
  }

  private financeView(): void {
    const s = this.s; const c = club(s, s.userClubId); const f = s.seasonFinance;
    const fac = (k: 'training' | 'youth' | 'stadium', label: string, desc: string): HTMLElement => h('div', { class: 'col', style: 'gap:8px;padding:10px 0;border-bottom:1px solid var(--line)' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { style: 'font-weight:700' }, label), h('div', { class: 'muted', style: 'font-size:12px' }, desc)), h('button', { class: 'btn small', onclick: (): void => { toast(upgradeFacility(s, k)); this.refresh(); } }, s.facilities[k] >= 5 ? 'Max' : `Upgrade ${money(facilityUpgradeCost(s.facilities[k], c))}`)), h('div', { class: 'bar' }, h('i', { style: `width:${s.facilities[k] * 20}%` })));
    const rows: Array<[string, number]> = [['Cash', c.budget], ['Income', f.income], ['Wages', -f.wages], ['Other costs', -f.other], ['Transfers in', -f.transfersIn], ['Transfers out', f.transfersOut], ['Weekly wage bill', -weeklyWages(c, s.world.players)]];
    this.body.append(h('div', { class: 'section-title' }, h('h2', null, 'Finances')), h('div', { class: 'split' },
      h('div', { class: 'card col' }, h('h3', null, 'This season'), h('table', null, h('tbody', null, rows.map(([l, v]) => h('tr', null, h('td', null, l), h('td', { style: 'text-align:right;font-weight:700;color:' + (v < 0 ? 'var(--danger)' : 'var(--text)') }, money(v))))))),
      h('div', { class: 'card col', style: 'gap:0' }, h('h3', null, 'Facilities'), fac('training', 'Training ground', 'Faster player development'), fac('youth', 'Youth academy', 'Better prospects each season'), fac('stadium', 'Stadium', 'More matchday income'))));
  }

  private youthView(): void {
    const s = this.s;
    this.body.append(h('div', { class: 'section-title' }, h('h2', null, 'Youth academy')), s.youth.length ? h('div', { class: 'grid-auto' }, s.youth.map((p) => h('div', { class: 'col' }, playerCardEl(p, { extra: [h('span', { class: 'pill accent' }, `POT ${p.potential}`)] }),
      h('div', { class: 'row' }, h('button', { class: 'btn small grow', onclick: (): void => { toast(promoteYouth(s, p.id)); this.refresh(); } }, 'Promote'), h('button', { class: 'btn small ghost', onclick: (): void => { s.youth = s.youth.filter((x) => x.id !== p.id); this.refresh(); } }, 'Release'))))) : h('div', { class: 'card muted' }, 'No prospects right now. A new intake arrives each season.'));
  }

  private boardView(): void {
    const s = this.s;
    this.body.append(h('div', { class: 'section-title' }, h('h2', null, 'Board & history')), h('div', { class: 'split' }, h('div', { class: 'card col' }, h('h3', null, 'Board'), h('div', { class: 'bar' }, h('i', { style: `width:${s.board.confidence}%` })), h('div', { class: 'muted' }, `Confidence ${Math.round(s.board.confidence)}% · manager reputation ${Math.round(s.board.managerRep)}`), s.board.objectives.map((o) => h('div', null, `${o.done ? '✓' : o.failed ? '✗' : '•'} ${o.text}`)), h('div', { class: 'muted' }, `Trophies: ${s.stats.trophies.length ? s.stats.trophies.join(', ') : 'none yet'}`)),
      h('div', { class: 'card col' }, h('h3', null, 'History'), s.history.length ? s.history.map((x) => h('div', { class: 'muted' }, `${x.season}: ${x.position}${ord(x.position)} (${x.points} pts) · cup ${x.cupRound} · champion ${x.champion}`)) : h('div', { class: 'muted' }, 'No completed seasons yet.')),
      s.jobOffers.length ? h('div', { class: 'card col' }, h('h3', null, 'Job offers'), s.jobOffers.map((o) => h('div', { class: 'row' }, h('span', { class: 'grow' }, o.note), h('button', { class: 'btn small', onclick: (): void => { if (confirm('Leave your current club?')) { acceptJob(s, o.from); this.tableLeague = club(s, o.from).leagueId; this.refresh(); } } }, 'Accept')))) : null));
  }

  private newsView(): void { this.body.append(h('div', { class: 'section-title' }, h('h2', null, 'News')), h('div', { class: 'card col', style: 'gap:8px' }, this.s.news.map((n) => h('div', null, h('span', { class: 'faint' }, `${n.season} W${n.week}  `), n.text)))); }

  private sackedView(): HTMLElement {
    const s = this.s;
    return h('div', { class: 'card col' }, h('h2', null, 'You have been sacked'), h('div', { class: 'muted' }, 'Choose a new job, or leave management.'),
      s.jobOffers.length ? s.jobOffers.map((o) => h('button', { class: 'btn', onclick: (): void => { acceptJob(s, o.from); this.tableLeague = club(s, o.from).leagueId; this.refresh(); } }, o.note)) : h('div', { class: 'muted' }, 'No clubs are interested right now.'),
      h('button', { class: 'btn danger', onclick: (): void => void this.app.go('main') }, 'Return to main menu'));
  }
}
