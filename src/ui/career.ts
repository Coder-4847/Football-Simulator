import { h, clear, toast, money, kitChip } from './dom';
import { modal } from './panels';
import type { App } from './app';
import { storage, wrapSave, parseSave, downloadJson, pickJsonFile } from '../core/storage';
import { createCareer, leagueTable, nextUserFixture, squadOf, userFixtureThisWeek, applyResult, simFixture, upgradeFacility, promoteYouth, acceptJob, cupRoundReached, ensureSquad } from '../manager/career';
import { CareerRunner } from '../sim/runner';
import type { Command } from '../manager/commands';
import { CUP_ROUND_NAMES, isWindowOpen, type CareerState, type Fixture } from '../manager/state';
import { askingPrice, evaluateBid, executeTransfer, releasePlayer, renewContract, renewDemand, resolveSellOffer, scoutedOverall, searchMarket, club, player, type MarketFilter } from '../manager/transfers';
import { facilityUpgradeCost, weeklyWages } from '../manager/economy';
import type { Player } from '../data/types';
import { ATTR_KEYS } from '../data/types';
import { FORMATIONS, formationById, makeTactics, STYLE_TACTICS } from '../data/formations';
import { pickLineup, teamRatings, teamSetupFromClub } from '../match/setup';
import { Match } from '../match/match';
import { matchConfigFromSettings } from './session';
import { toSimResult } from '../match/stats';
import { settings } from '../core/settings';
import { SKILL_MOVES, skillById } from '../match/skills';
import { ratingAt, POS_GROUP } from '../data/rating';
import { audio } from '../audio/engine';
import type { Side } from '../match/constants';

const SLOTS = ['career:slot1', 'career:slot2', 'career:slot3'];

export function registerCareer(app: App): void {
  app.register('career', (a) => careerStart(a));
  app.register('career-hub', (a, p) => new CareerHub(a, p as CareerState).render());
}

// ============================================================================ start / load
async function careerStart(app: App): Promise<HTMLElement> {
  const metas: Array<{ key: string; label: string }> = [];
  for (const key of [...SLOTS, 'career:auto']) {
    const v = await storage.get<{ data: CareerState } | CareerState>(key);
    const st = v && 'data' in (v as object) ? (v as { data: CareerState }).data : (v as CareerState | undefined);
    if (st?.world) metas.push({ key, label: `${st.managerName} · ${st.world.clubs[st.userClubId]?.name} · ${st.season} wk ${st.week}${key === 'career:auto' ? ' (autosave)' : ''}` });
  }
  const w = app.world;
  const sel = { league: Object.values(w.leagues)[0]!.id, club: Object.values(w.leagues)[0]!.clubs[0]!, name: 'Manager', mode: 'manager' as 'manager' | 'player' };
  const clubSel = h('select'), info = h('div', { class: 'muted' });
  const renderClub = (): void => {
    const lg = w.leagues[sel.league]!;
    clear(clubSel);
    for (const id of lg.clubs) clubSel.appendChild(h('option', { value: id, selected: id === sel.club }, `${w.clubs[id]!.name}  (rep ${w.clubs[id]!.reputation})`));
    if (!lg.clubs.includes(sel.club)) sel.club = lg.clubs[0]!;
    clubSel.value = sel.club;
    const c = w.clubs[sel.club]!; const r = teamRatings(w, c.id);
    clear(info); info.append(h('div', { class: 'row' }, kitChip(c.kits.home.primary), kitChip(c.kits.home.secondary), h('b', null, c.name)), `Budget ${money(c.budget)} · Stadium ${c.stadium.capacity.toLocaleString()} · OVR ${r.ovr}`);
  };
  const leagueSel = h('select', { onchange: (e: Event): void => { sel.league = (e.target as HTMLSelectElement).value; renderClub(); } }, Object.values(w.leagues).map((l) => h('option', { value: l.id }, l.name)));
  clubSel.onchange = (): void => { sel.club = clubSel.value; renderClub(); };
  renderClub();
  const modeSeg = h('div', { class: 'seg' });
  const rm = (): void => { clear(modeSeg); for (const [m, l] of [['manager', 'Manager'], ['player', 'Player (be a pro)']] as const) modeSeg.appendChild(h('button', { class: sel.mode === m ? 'on' : '', onclick: (): void => { sel.mode = m; rm(); } }, l)); };
  rm();
  const start = (): void => {
    const st = createCareer({ clubId: sel.club, managerName: sel.name, mode: sel.mode, world: w, seed: `career-${Date.now()}` });
    if (sel.mode === 'player') { const best = squadOf(st, sel.club).filter((p) => p.positions[0] !== 'GK').sort((a, b) => b.overall - a.overall)[Math.min(4, 2)]!; st.userPlayerId = best.id; }
    void app.go('career-hub', st);
  };
  const loadCard = h('div', { class: 'card col' }, h('h3', null, 'Continue'),
    metas.length ? metas.map((m) => h('div', { class: 'row' }, h('button', { class: 'btn grow', onclick: async (): Promise<void> => { const v = await storage.get<{ data: CareerState } | CareerState>(m.key); const st = v && 'data' in (v as object) ? (v as { data: CareerState }).data : (v as CareerState); void app.go('career-hub', st); } }, m.label),
      h('button', { class: 'btn small danger', onclick: async (): Promise<void> => { if (confirm('Delete this save?')) { await storage.del(m.key); void app.go('career', undefined, false); } } }, 'Delete'))) : h('div', { class: 'muted' }, 'No saves yet.'),
    h('button', { class: 'btn small', onclick: async (): Promise<void> => { try { const env = parseSave(await pickJsonFile()); const st = env.data as CareerState; if (!st.world) throw new Error('bad'); await storage.set('career:slot1', wrapSave(st)); toast('Imported into slot 1'); void app.go('career', undefined, false); } catch { toast('That is not a valid save file'); } } }, 'Import save file'));
  return h('div', { class: 'ui-layer screen' },
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' }, h('h2', null, 'Career'), h('button', { class: 'btn', 'data-back': true, onclick: (): void => app.back() }, 'Back')),
    h('div', { class: 'split' },
      h('div', { class: 'card col' }, h('h3', null, 'New career'), modeSeg,
        h('div', { class: 'field' }, h('label', null, 'Your name'), h('input', { type: 'text', value: sel.name, oninput: (e: Event): void => { sel.name = (e.target as HTMLInputElement).value || 'Manager'; } })),
        h('div', { class: 'field' }, h('label', null, 'League'), leagueSel), h('div', { class: 'field' }, h('label', null, 'Club'), clubSel), info,
        h('button', { class: 'btn primary', onclick: start }, 'Start career')), loadCard));
}

// ============================================================================ hub
type Tab = 'Overview' | 'Squad' | 'Lineup' | 'Fixtures' | 'Table' | 'Transfers' | 'Scouting' | 'Finances' | 'Youth' | 'Board' | 'News';
const TABS: Tab[] = ['Overview', 'Squad', 'Lineup', 'Fixtures', 'Table', 'Transfers', 'Scouting', 'Finances', 'Youth', 'Board', 'News'];

class CareerHub {
  private root = h('div', { class: 'ui-layer screen' });
  private body = h('div', { style: 'flex:1' });
  private top = h('div');
  private tabsEl = h('div', { class: 'tabs' });
  private tab: Tab = 'Overview';
  private runner = new CareerRunner();
  private busy = false;
  private market: MarketFilter = { sort: 'overall' };
  private tableLeague: string;

  constructor(private app: App, private s: CareerState) { this.tableLeague = club(s, s.userClubId).leagueId; ensureSquad(s); }

  render(): HTMLElement {
    this.root.append(this.top, this.tabsEl, this.body);
    this.refresh();
    return this.root;
  }

  private refresh(): void {
    const s = this.s;
    clear(this.top);
    const c = club(s, s.userClubId);
    const next = nextUserFixture(s);
    this.top.append(h('div', { class: 'row wrap', style: 'justify-content:space-between;margin-bottom:8px' },
      h('div', { class: 'row' }, kitChip(c.kits.home.primary), h('h2', null, c.name), h('span', { class: 'pill' }, `Season ${s.season} · Week ${s.week}`), h('span', { class: 'pill' + (isWindowOpen(s.week) ? ' accent' : '') }, isWindowOpen(s.week) ? 'Window open' : 'Window closed'), h('span', { class: 'pill' }, `Cash ${money(c.budget)}`)),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: (): void => void this.save('career:slot1') }, 'Save'), h('button', { class: 'btn small', onclick: (): void => downloadJson(`career-${s.season}-w${s.week}.json`, wrapSave(this.s)) }, 'Export'),
        h('button', { class: 'btn small', 'data-back': true, onclick: async (): Promise<void> => { await this.save('career:auto'); this.runner.dispose(); void this.app.go('main'); } }, 'Exit'))));
    clear(this.tabsEl);
    for (const t of TABS) this.tabsEl.appendChild(h('button', { class: this.tab === t ? 'on' : '', onclick: (): void => { this.tab = t; this.refresh(); } }, t));
    clear(this.body);
    if (s.board.sacked) { this.body.appendChild(this.sackedView()); return; }
    ({ Overview: () => this.overview(), Squad: () => this.squadView(), Lineup: () => this.lineupView(), Fixtures: () => this.fixturesView(), Table: () => this.tableView(), Transfers: () => this.transfersView(), Scouting: () => this.scoutingView(), Finances: () => this.financeView(), Youth: () => this.youthView(), Board: () => this.boardView(), News: () => this.newsView() } as Record<Tab, () => void>)[this.tab]();
    void next;
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
    ensureSquad(this.s);
    void this.save('career:auto');
    this.refresh();
  }

  private matchDay(f: Fixture): void {
    const s = this.s;
    const home = club(s, f.home), away = club(s, f.away);
    const mine = f.home === s.userClubId ? 0 : 1;
    const cup = f.comp.startsWith('cup:');
    const hint = h('div', { class: 'muted' }, cup ? CUP_ROUND_NAMES[f.round - 1] : `${s.world.leagues[f.comp]?.name} · round ${f.round}`);
    const play = (): void => {
      void this.exec({ cmd: 'simWeek' }).then(() => this.playFull(f.id));
    };
    const m = h('div', { class: 'col' }, h('h2', null, `${home.name} vs ${away.name}`), hint,
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: play }, 'Play match'),
        h('button', { class: 'btn', onclick: async (): Promise<void> => { overlay.remove(); await this.exec({ cmd: 'autoWeek' }); const res = this.s.fixtures.find((x) => x.id === f.id)!; toast(`${home.short} ${res.hg}–${res.ag} ${away.short}`); } }, 'Quick sim'),
        h('button', { class: 'btn ghost', onclick: (): void => overlay.remove() }, 'Cancel')));
    const overlay = modal(m, () => overlay.remove()); this.root.appendChild(overlay); void mine;
  }

  /** Plays the user's fixture in the full 3D match engine. */
  private playFull(fixtureId: string): void {
    const s = this.s;
    const f = s.fixtures.find((x) => x.id === fixtureId);
    if (!f || f.played) { this.refresh(); return; }
    const mine: Side = f.home === s.userClubId ? 0 : 1;
    const lineup = s.lineup.starters.length === 11 && s.lineup.starters.every((id) => player(s, id).injuredUntil === 0 && player(s, id).suspended === 0) ? s.lineup.starters : undefined;
    const setupOf = (id: string, away: boolean): ReturnType<typeof teamSetupFromClub> => id === s.userClubId ? teamSetupFromClub(s.world, id, { formation: s.lineup.formation, tactics: s.lineup.tactics, lineup, away }) : teamSetupFromClub(s.world, id, { away });
    const clash = Math.abs(parseInt(club(s, f.home).kits.home.primary.slice(1), 16) - parseInt(club(s, f.away).kits.home.primary.slice(1), 16)) < 0x280000;
    const cup = f.comp.startsWith('cup:');
    const cfg = matchConfigFromSettings({ seed: `${s.seed}:${f.id}`, stadiumStyle: club(s, f.home).stadium.style, knockout: cup, extraTime: cup, penalties: cup, injuries: true }, this.app.input.active === 'touch');
    const match = new Match(cfg, setupOf(f.home, false), setupOf(f.away, clash));
    const humans = [{ side: mine, scheme: this.app.schemes(1)[0]!, lockId: s.mode === 'player' ? s.userPlayerId : undefined }];
    this.app.play(match, humans, async (r) => {
      if (r.quit) { void this.app.go('career-hub', this.s, false); return; }
      const res = toSimResult(match);
      if (cup && res.winner === null) res.winner = Math.random() < 0.5 ? 0 : 1;
      applyResult(this.s, f, res);
      this.s.lastResult = this.s.lastResult;
      this.s = (await this.runner.run(this.s, { cmd: 'finishWeek' })).state;
      ensureSquad(this.s);
      void this.save('career:auto');
      void this.app.go('career-hub', this.s, false);
    }, { fullTimeTitle: cup ? 'Cup tie' : 'League match' });
  }

  // ------------------------------------------------------------ views
  private nextBtn(): HTMLElement {
    const s = this.s;
    const f = userFixtureThisWeek(s);
    if (f) return h('button', { class: 'btn primary', onclick: (): void => this.matchDay(f) }, 'Match day →');
    return h('button', { class: 'btn primary', onclick: (): void => void this.exec({ cmd: 'finishWeek' }).then(() => void 0) }, s.week >= 52 ? 'Finish season' : 'Advance a week');
  }

  private overview(): void {
    const s = this.s;
    const c = club(s, s.userClubId);
    const lg = s.world.leagues[c.leagueId]!;
    const tbl = leagueTable(s, lg.id);
    const pos = tbl.findIndex((r) => r.club === c.id) + 1;
    const next = nextUserFixture(s);
    const opp = next ? club(s, next.home === c.id ? next.away : next.home) : null;
    const form = s.fixtures.filter((f) => f.played && (f.home === c.id || f.away === c.id) && f.comp === lg.id).slice(-5).map((f) => { const my = f.home === c.id ? f.hg! - f.ag! : f.ag! - f.hg!; return my > 0 ? 'W' : my < 0 ? 'L' : 'D'; });
    this.body.append(h('div', { class: 'split' },
      h('div', { class: 'card col' }, h('h3', null, 'Next'), next ? [h('div', { class: 'row' }, kitChip(club(s, next.home).kits.home.primary), h('b', null, `${club(s, next.home).name} v ${club(s, next.away).name}`)), h('div', { class: 'muted' }, `Week ${next.week} · ${next.comp.startsWith('cup:') ? CUP_ROUND_NAMES[next.round - 1] : lg.name}`), opp ? h('div', { class: 'pill' }, `${opp.name} OVR ${teamRatings(s.world, opp.id).ovr}`) : null] : h('div', { class: 'muted' }, 'No more fixtures this season.'), h('div', { class: 'row' }, this.nextBtn(),
        h('button', { class: 'btn', onclick: (): void => void this.exec({ cmd: 'toNextMatch' }) }, 'Skip to next match'), h('button', { class: 'btn ghost', onclick: (): void => { if (confirm('Auto-sim the rest of the season?')) void this.exec({ cmd: 'toSeasonEnd' }); } }, 'Sim season'))),
      h('div', { class: 'card col' }, h('h3', null, 'Standing'), h('div', { class: 'hero-title' }, `${pos}${ord(pos)}`), h('div', { class: 'muted' }, `${lg.name} · ${tbl[pos - 1]!.pts} pts from ${tbl[pos - 1]!.p}`), h('div', { class: 'row' }, form.map((r) => h('span', { class: 'pill ' + (r === 'W' ? 'accent' : r === 'L' ? 'bad' : 'warn') }, r)))),
      h('div', { class: 'card col' }, h('h3', null, 'Board objectives'), s.board.objectives.map((o) => h('div', { class: 'row' }, h('span', { class: 'pill ' + (o.done ? 'accent' : o.failed ? 'bad' : '') }, o.done ? '✓' : o.failed ? '✗' : '•'), o.text)), h('div', { class: 'bar' }, h('i', { style: `width:${s.board.confidence}%` })), h('div', { class: 'muted' }, `Board confidence ${Math.round(s.board.confidence)}%`)),
      h('div', { class: 'card col' }, h('h3', null, 'Latest news'), s.news.slice(0, 6).map((n) => h('div', { class: 'muted' }, `W${n.week}: ${n.text}`)))));
    if (s.mode === 'player' && s.userPlayerId) { const p = s.world.players[s.userPlayerId]; if (p) this.body.append(h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', null, 'Your player'), `${p.name} · ${p.positions[0]} · OVR ${p.overall} · ${p.goals} goals, ${p.assists} assists · form ${p.form.toFixed(2)}`)); }
  }

  private squadView(): void {
    const s = this.s; const squad = squadOf(s, s.userClubId);
    let sort: keyof Player | 'pos' = 'overall'; let dir = -1;
    const tbl = h('div');
    const draw = (): void => {
      clear(tbl);
      const rows = [...squad].sort((a, b) => sort === 'pos' ? POS_ORDER.indexOf(a.positions[0]!) - POS_ORDER.indexOf(b.positions[0]!) : (((a[sort] as number) - (b[sort] as number)) * dir) || 0);
      tbl.appendChild(h('table', null, h('thead', null, h('tr', null, ...([['pos', 'Pos'], ['shortName', 'Name'], ['age', 'Age'], ['overall', 'OVR'], ['potential', 'POT'], ['fitness', 'Fit'], ['form', 'Form'], ['wage', 'Wage'], ['value', 'Value'], ['contractEnd', 'Contract']] as const).map(([k, l]) => h('th', { style: 'cursor:pointer', onclick: (): void => { if (sort === k) dir *= -1; else { sort = k as typeof sort; dir = -1; } draw(); } }, l)), h('th'))),
        h('tbody', null, rows.map((p) => h('tr', { class: 'click', onclick: (): void => this.playerCard(p) }, h('td', null, p.positions[0]), h('td', null, p.name, p.injuredUntil ? h('span', { class: 'pill bad', style: 'margin-left:6px' }, `inj ${p.injuredUntil}w`) : null, p.suspended ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'susp') : null, s.listed.includes(p.id) ? h('span', { class: 'pill', style: 'margin-left:6px' }, 'listed') : null), h('td', null, p.age), h('td', null, p.overall), h('td', null, p.potential), h('td', null, Math.round(p.fitness)), h('td', null, p.form.toFixed(1)), h('td', null, money(p.wage)), h('td', null, money(p.value)), h('td', null, p.contractEnd), h('td', null, '›'))))));
    };
    draw();
    this.body.append(h('div', { class: 'card', style: 'overflow:auto' }, tbl));
  }

  private playerCard(p: Player): void {
    const s = this.s;
    const mine = p.clubId === s.userClubId;
    const sc = scoutedOverall(s, p);
    const group = (title: string, keys: string[]): HTMLElement => h('div', null, h('h3', null, title), keys.map((k) => h('div', { class: 'row', style: 'gap:8px;font-size:13px' }, h('span', { style: 'width:110px' }, k.replace(/([A-Z])/g, ' $1').toLowerCase()), h('div', { class: 'bar grow' }, h('i', { style: `width:${p.attrs[k as keyof typeof p.attrs]}%` })), h('span', { style: 'width:24px;text-align:right' }, p.attrs[k as keyof typeof p.attrs]))));
    const actions = h('div', { class: 'row wrap' });
    if (mine) {
      const d = renewDemand(s, p);
      actions.append(
        h('button', { class: 'btn small', onclick: (): void => { if (s.listed.includes(p.id)) s.listed = s.listed.filter((x) => x !== p.id); else s.listed.push(p.id); toast(s.listed.includes(p.id) ? 'Listed for transfer' : 'Removed from list'); ov.remove(); this.refresh(); } }, s.listed.includes(p.id) ? 'Unlist' : 'List for transfer'),
        h('button', { class: 'btn small', onclick: (): void => { const r = renewContract(s, p.id, d.wage, d.years); toast(r.reason + ` (${money(d.wage)}/wk · ${d.years}y)`); ov.remove(); this.refresh(); } }, `Renew (${money(d.wage)}/wk)`),
        h('button', { class: 'btn small danger', onclick: (): void => { if (confirm(`Release ${p.name}?`)) { const r = releasePlayer(s, p.id); if (r < 0) toast('Squad too small'); else toast(`Released (¤${r.toLocaleString()})`); ov.remove(); this.refresh(); } } }, 'Release'));
      actions.append(h('select', { title: 'Goal celebration', onchange: (e: Event): void => { settings.update((st) => { st.gameplay.celebrations[p.id] = Number((e.target as HTMLSelectElement).value); }); } }, ['Airplane run', 'Fist pump', 'Knee slide', 'Point to the sky', 'Cup the ears', 'Arms crossed'].map((n, i) => h('option', { value: i, selected: (settings.value.gameplay.celebrations[p.id] ?? -1) === i }, `🎉 ${n}`))));
      if (p.skillMoves >= 1) actions.append(h('button', { class: 'btn small', onclick: (): void => { ov.remove(); this.skillOverride(p); } }, 'Skill loadout'));
    } else actions.append(h('button', { class: 'btn small primary', onclick: (): void => { ov.remove(); this.offerDialog(p); } }, 'Make offer'), h('button', { class: 'btn small', onclick: (): void => { if (!s.scouting.shortlist.includes(p.id)) s.scouting.shortlist.push(p.id); toast('Added to shortlist'); } }, 'Shortlist'));
    const ov = modal(h('div', { class: 'col' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', null, h('h2', null, p.name), h('div', { class: 'muted' }, `${p.positions.join('/')} · age ${p.age} · ${p.heightCm}cm · ${p.foot === 'L' ? 'left' : 'right'}-footed · ${s.world.nations[p.nation]?.name} · ${p.clubId ? club(s, p.clubId).name : 'Free agent'}`)), h('div', { class: 'hero-title' }, sc.exact ? String(p.overall) : `${sc.lo}–${sc.hi}`)),
      h('div', { class: 'row wrap' }, h('span', { class: 'pill' }, `Weak foot ${'★'.repeat(p.weakFoot)}`), h('span', { class: 'pill' }, `Skill moves ${'★'.repeat(p.skillMoves)}`), h('span', { class: 'pill' }, `WR ${p.workAtt}/${p.workDef}`), ...p.traits.map((t) => h('span', { class: 'pill accent' }, t))),
      h('div', { class: 'muted' }, `Value ${money(p.value)} · wage ${money(p.wage)}/wk · contract to ${p.contractEnd} · potential ${sc.exact ? p.potential : '?'} · morale ${Math.round(p.morale)} · ${p.goals}G ${p.assists}A in ${p.apps}`),
      sc.exact ? h('div', { class: 'split' }, group('Pace & shooting', ['acceleration', 'sprintSpeed', 'finishing', 'shotPower', 'longShots', 'volleys', 'penalties']), group('Passing & dribbling', ['vision', 'shortPass', 'longPass', 'crossing', 'curve', 'freeKick', 'agility', 'balance', 'ballControl', 'dribbling', 'reactions']), group('Defending & physical', ['interceptions', 'marking', 'standingTackle', 'slidingTackle', 'heading', 'strength', 'stamina', 'jumping', 'aggression']), p.positions[0] === 'GK' ? group('Goalkeeping', ['gkDiving', 'gkHandling', 'gkKicking', 'gkPositioning', 'gkReflexes']) : h('div')) : h('div', { class: 'muted' }, 'Scout this player further to reveal detailed attributes.'),
      actions, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (): void => ov.remove() }, 'Close'))), () => ov.remove());
    this.root.appendChild(ov);
  }

  private skillOverride(p: Player): void {
    const cur = settings.value.controls.skillOverrides[p.id] ?? [...settings.value.controls.skillLoadout];
    const allowed = SKILL_MOVES.filter((m) => m.stars <= p.skillMoves);
    const slots = h('div', { class: 'col' });
    const draw = (): void => {
      clear(slots);
      for (let i = 0; i < 4; i++) slots.appendChild(h('div', { class: 'field' }, h('label', null, `Slot ${i + 1}`), h('select', { onchange: (e: Event): void => { cur[i] = (e.target as HTMLSelectElement).value; settings.update((st) => { st.controls.skillOverrides[p.id] = [...cur]; }); } }, [h('option', { value: '' }, '— (global default)'), ...allowed.map((m) => h('option', { value: m.id, selected: cur[i] === m.id }, `${'★'.repeat(m.stars)} ${m.name}`))])));
    };
    draw();
    const ov = modal(h('div', { class: 'col' }, h('h2', null, `${p.shortName} · ${'★'.repeat(p.skillMoves)} skill moves`), h('div', { class: 'muted' }, 'Per-player override of your global four-move loadout. Moves above this player\'s star rating are unavailable.'), slots, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (): void => ov.remove() }, 'Done'))), () => ov.remove());
    this.root.appendChild(ov);
  }

  private lineupView(): void {
    const s = this.s; const squad = squadOf(s, s.userClubId);
    const f = formationById(s.lineup.formation);
    const cur = s.lineup.starters.length === 11 ? s.lineup.starters.map((id) => player(s, id)) : pickLineup(squad, f).starters;
    const apply = (ids: string[]): void => { s.lineup.starters = ids; };
    const slotSel = f.slots.map((slot, i) => h('div', { class: 'field' }, h('label', null, `${slot.pos} · ${slot.role}`), h('select', { onchange: (e: Event): void => { const ids = cur.map((p) => p.id); const nid = (e.target as HTMLSelectElement).value; const swap = ids.indexOf(nid); if (swap >= 0) ids[swap] = ids[i]!; ids[i] = nid; apply(ids); this.refresh(); } },
      squad.filter((p) => (slot.pos === 'GK') === (p.positions[0] === 'GK')).sort((a, b) => ratingAt(b, slot.pos) - ratingAt(a, slot.pos)).map((p) => h('option', { value: p.id, selected: p.id === cur[i]!.id }, `${p.shortName} · ${ratingAt(p, slot.pos)}${p.injuredUntil ? ' (inj)' : ''}${p.suspended ? ' (susp)' : ''}`)))));
    const t = s.lineup.tactics;
    const slider = (label: string, k: 'lineHeight' | 'compactness' | 'width' | 'pressing' | 'tempo' | 'directness'): HTMLElement => h('div', { class: 'field' }, h('label', null, label), h('input', { type: 'range', min: 0, max: 100, value: t[k], oninput: (e: Event): void => { t[k] = Number((e.target as HTMLInputElement).value); } }));
    this.body.append(h('div', { class: 'split' },
      h('div', { class: 'card col' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', null, 'Starting XI'), h('div', { class: 'row' }, h('select', { onchange: (e: Event): void => { s.lineup.formation = (e.target as HTMLSelectElement).value; s.lineup.starters = []; this.refresh(); } }, FORMATIONS.map((x) => h('option', { value: x.id, selected: x.id === s.lineup.formation }, x.name))), h('button', { class: 'btn small', onclick: (): void => { s.lineup.starters = []; this.refresh(); } }, 'Auto pick'))), slotSel),
      h('div', { class: 'card col' }, h('h3', null, 'Tactics'), h('div', { class: 'field' }, h('label', null, 'Style preset'), h('select', { onchange: (e: Event): void => { s.lineup.tactics = makeTactics((e.target as HTMLSelectElement).value as 'balanced'); this.refresh(); } }, Object.keys(STYLE_TACTICS).map((k) => h('option', { value: k, selected: t.style === k }, k)))),
        slider('Defensive line', 'lineHeight'), slider('Compactness', 'compactness'), slider('Width', 'width'), slider('Pressing', 'pressing'), slider('Tempo', 'tempo'), slider('Directness', 'directness'),
        h('label', { class: 'row' }, h('input', { class: 'toggle', type: 'checkbox', checked: t.offsideTrap, onchange: (e: Event): void => { t.offsideTrap = (e.target as HTMLInputElement).checked; } }), 'Offside trap'),
        h('div', { class: 'field' }, h('label', null, 'Training focus'), h('select', { onchange: (e: Event): void => { s.trainingFocus = (e.target as HTMLSelectElement).value as typeof s.trainingFocus; } }, ['balanced', 'attacking', 'defending', 'passing', 'physical'].map((k) => h('option', { value: k, selected: s.trainingFocus === k }, k)))))));
  }

  private fixturesView(): void {
    const s = this.s;
    const mine = s.fixtures.filter((f) => f.home === s.userClubId || f.away === s.userClubId).sort((a, b) => a.week - b.week);
    this.body.append(h('div', { class: 'card', style: 'overflow:auto' }, h('table', null, h('tbody', null, mine.map((f) => h('tr', { class: f.week === s.week ? 'sel' : '' }, h('td', null, `W${f.week}`), h('td', null, f.comp.startsWith('cup:') ? CUP_ROUND_NAMES[f.round - 1] : `R${f.round}`), h('td', null, club(s, f.home).name), h('td', { style: 'text-align:center' }, f.played ? `${f.hg} – ${f.ag}${f.pens ? ` (${f.pens[0]}–${f.pens[1]})` : ''}` : 'v'), h('td', null, club(s, f.away).name)))))));
  }

  private tableView(): void {
    const s = this.s;
    const lgs = Object.values(s.world.leagues);
    const tbl = leagueTable(s, this.tableLeague);
    this.body.append(h('div', { class: 'row', style: 'margin-bottom:12px' }, h('select', { onchange: (e: Event): void => { this.tableLeague = (e.target as HTMLSelectElement).value; this.refresh(); } }, lgs.map((l) => h('option', { value: l.id, selected: l.id === this.tableLeague }, l.name)))),
      h('div', { class: 'card', style: 'overflow:auto' }, h('table', null, h('thead', null, h('tr', null, ['#', 'Club', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'].map((x) => h('th', null, x)))),
        h('tbody', null, tbl.map((r, i) => h('tr', { class: r.club === s.userClubId ? 'sel' : '' }, h('td', null, i + 1), h('td', null, kitChip(club(s, r.club).kits.home.primary), club(s, r.club).name), h('td', null, r.p), h('td', null, r.w), h('td', null, r.d), h('td', null, r.l), h('td', null, r.gf), h('td', null, r.ga), h('td', null, r.gf - r.ga), h('td', null, h('b', null, r.pts))))))),
      h('div', { class: 'muted', style: 'margin-top:8px' }, `Cup: you reached round ${cupRoundReached(s, s.userClubId)} of 5.`));
  }

  private transfersView(): void {
    const s = this.s; const f = this.market;
    const open = isWindowOpen(s.week);
    const results = searchMarket(s, f, 50);
    const sells = s.offers.filter((o) => o.status === 'open' && o.kind === 'sell');
    const exp = squadOf(s, s.userClubId).filter((p) => p.contractEnd - s.season <= 1);
    const parts: Array<HTMLElement | null> = [
      sells.length ? h('div', { class: 'card col', style: 'margin-bottom:16px' }, h('h3', null, 'Offers for your players'), sells.map((o) => { const p = player(s, o.playerId!); return h('div', { class: 'row wrap' }, h('b', { class: 'grow' }, `${club(s, o.from).name} → ${p.name}: ${money(o.fee)}`), h('button', { class: 'btn small primary', onclick: (): void => { toast(resolveSellOffer(s, o.id, true)); this.refresh(); } }, 'Accept'), h('button', { class: 'btn small', onclick: (): void => { resolveSellOffer(s, o.id, false); this.refresh(); } }, 'Reject')); })) : null,
      exp.length ? h('div', { class: 'card col', style: 'margin-bottom:16px' }, h('h3', null, 'Contracts expiring'), exp.map((p) => h('div', { class: 'row' }, h('span', { class: 'grow' }, `${p.name} (${p.contractEnd})`), h('button', { class: 'btn small', onclick: (): void => this.playerCard(p) }, 'Open')))) : null,
      h('div', { class: 'card col' }, h('div', { class: 'row wrap' }, h('h3', null, 'Market'), open ? null : h('span', { class: 'pill warn' }, 'Window closed — only free agents'),
        h('select', { onchange: (e: Event): void => { f.group = ((e.target as HTMLSelectElement).value || undefined) as MarketFilter['group']; this.refresh(); } }, [['', 'All positions'], ['GK', 'Goalkeepers'], ['DEF', 'Defenders'], ['MID', 'Midfielders'], ['ATT', 'Attackers']].map(([v, l]) => h('option', { value: v, selected: f.group === v }, l))),
        h('select', { onchange: (e: Event): void => { f.maxAge = Number((e.target as HTMLSelectElement).value) || undefined; this.refresh(); } }, [[0, 'Any age'], [21, '≤21'], [25, '≤25'], [30, '≤30']].map(([v, l]) => h('option', { value: String(v), selected: (f.maxAge ?? 0) === v }, String(l)))),
        h('label', { class: 'row' }, h('input', { class: 'toggle', type: 'checkbox', checked: !!f.freeOnly, onchange: (e: Event): void => { f.freeOnly = (e.target as HTMLInputElement).checked; this.refresh(); } }), 'Free agents'),
        h('select', { onchange: (e: Event): void => { f.sort = (e.target as HTMLSelectElement).value as MarketFilter['sort']; this.refresh(); } }, ['overall', 'potential', 'value', 'age'].map((k) => h('option', { value: k, selected: f.sort === k }, `Sort: ${k}`))),
        h('input', { type: 'search', placeholder: 'Name…', value: f.query ?? '', onchange: (e: Event): void => { f.query = (e.target as HTMLInputElement).value; this.refresh(); } })),
        h('table', null, h('thead', null, h('tr', null, ['Pos', 'Name', 'Age', 'OVR', 'Club', 'Ask'].map((x) => h('th', null, x)))), h('tbody', null, results.map((p) => { const sc = scoutedOverall(s, p); return h('tr', { class: 'click', onclick: (): void => this.playerCard(p) }, h('td', null, p.positions[0]), h('td', null, p.name), h('td', null, p.age), h('td', null, sc.exact ? p.overall : `${sc.lo}-${sc.hi}`), h('td', null, p.clubId ? club(s, p.clubId).name : 'Free agent'), h('td', null, p.clubId ? money(askingPrice(s, p)) : 'Free')); })))),
    ];
    for (const part of parts) if (part) this.body.appendChild(part);
  }

  private offerDialog(p: Player): void {
    const s = this.s;
    const ask = askingPrice(s, p);
    const st = { fee: ask, wage: Math.round(p.wage * 1.15), years: 3 };
    const msg = h('div', { class: 'muted' });
    const mk = (label: string, key: keyof typeof st, step: number): HTMLElement => h('div', { class: 'field' }, h('label', null, label), h('input', { type: 'number', value: st[key], step, onchange: (e: Event): void => { st[key] = Number((e.target as HTMLInputElement).value); } }));
    const ov = modal(h('div', { class: 'col' }, h('h2', null, `Offer for ${p.name}`), h('div', { class: 'muted' }, p.clubId ? `${club(s, p.clubId).name} value him around ${money(ask)}.` : 'Free agent — no transfer fee.'),
      p.clubId ? mk('Transfer fee', 'fee', 250_000) : null, mk('Weekly wage', 'wage', 500), mk('Contract (years)', 'years', 1), msg,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: (): void => { const fee = p.clubId ? st.fee : 0; const r = evaluateBid(s, p.id, fee, st.wage, st.years); msg.textContent = r.reason; if (r.status === 'counter') { st.fee = r.counter!; ov.querySelectorAll('input')[0]!.setAttribute('value', String(st.fee)); (ov.querySelectorAll('input')[0] as HTMLInputElement).value = String(st.fee); } if (r.status === 'accepted') { executeTransfer(s, p.id, s.userClubId, fee, st.wage, st.years); toast(`${p.shortName} signed!`); audio.ui('confirm'); ov.remove(); this.refresh(); } } }, 'Submit offer'), h('button', { class: 'btn', onclick: (): void => ov.remove() }, 'Cancel'))), () => ov.remove());
    this.root.appendChild(ov);
  }

  private scoutingView(): void {
    const s = this.s;
    const short = s.scouting.shortlist.map((id) => s.world.players[id]).filter((p): p is Player => !!p);
    this.body.append(h('div', { class: 'split' },
      h('div', { class: 'card col' }, h('h3', null, 'Scouting network'), s.scouting.scouts.map((sc) => h('div', { class: 'col', style: 'gap:6px;border-bottom:1px solid var(--line);padding-bottom:10px' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, `${sc.name} ${'★'.repeat(sc.quality)}`), h('label', { class: 'row' }, h('input', { class: 'toggle', type: 'checkbox', checked: sc.assigned, onchange: (e: Event): void => { sc.assigned = (e.target as HTMLInputElement).checked; } }), 'Active')),
        h('div', { class: 'row' }, h('select', { onchange: (e: Event): void => { sc.nation = (e.target as HTMLSelectElement).value; } }, [...new Set(Object.values(s.world.leagues).map((l) => l.nation))].map((n) => h('option', { value: n, selected: sc.nation === n }, s.world.nations[n]?.name ?? n))), h('select', { onchange: (e: Event): void => { sc.group = (e.target as HTMLSelectElement).value as typeof sc.group; } }, ['ANY', 'GK', 'DEF', 'MID', 'ATT'].map((g) => h('option', { value: g, selected: sc.group === g }, g)))))),
        h('div', { class: 'muted' }, `Players discovered: ${Object.keys(s.scouting.known).length}. Scouts reveal more detail each week they observe a player.`)),
      h('div', { class: 'card col' }, h('h3', null, 'Shortlist'), short.length ? short.map((p) => h('div', { class: 'row' }, h('button', { class: 'btn small grow', onclick: (): void => this.playerCard(p) }, `${p.positions[0]} ${p.name} · ${p.clubId ? club(s, p.clubId).name : 'free'}`), h('button', { class: 'btn small ghost', onclick: (): void => { s.scouting.shortlist = s.scouting.shortlist.filter((x) => x !== p.id); this.refresh(); } }, '✕'))) : h('div', { class: 'muted' }, 'Add players from the market.'))));
  }

  private financeView(): void {
    const s = this.s; const c = club(s, s.userClubId); const f = s.seasonFinance;
    const fac = (k: 'training' | 'youth' | 'stadium', label: string): HTMLElement => h('div', { class: 'row' }, h('span', { class: 'grow' }, `${label} — level ${s.facilities[k]}/5`), h('button', { class: 'btn small', onclick: (): void => { toast(upgradeFacility(s, k)); this.refresh(); } }, s.facilities[k] >= 5 ? 'Max' : `Upgrade ${money(facilityUpgradeCost(s.facilities[k], c))}`));
    this.body.append(h('div', { class: 'split' },
      h('div', { class: 'card col' }, h('h3', null, 'This season'), h('table', null, h('tbody', null, [['Cash', c.budget], ['Income', f.income], ['Wages', -f.wages], ['Other costs', -f.other], ['Transfers in', -f.transfersIn], ['Transfers out', f.transfersOut], ['Weekly wage bill', -weeklyWages(c, s.world.players)]].map(([l, v]) => h('tr', null, h('td', null, l as string), h('td', { style: 'text-align:right;color:' + ((v as number) < 0 ? 'var(--danger)' : 'var(--text)') }, money(v as number))))))),
      h('div', { class: 'card col' }, h('h3', null, 'Facilities'), fac('training', 'Training ground'), fac('youth', 'Youth academy'), fac('stadium', 'Stadium'))));
  }

  private youthView(): void {
    const s = this.s;
    this.body.append(h('div', { class: 'card', style: 'overflow:auto' }, h('table', null, h('thead', null, h('tr', null, ['Pos', 'Name', 'Age', 'OVR', 'POT', ''].map((x) => h('th', null, x)))), h('tbody', null, s.youth.map((p) => h('tr', null, h('td', null, p.positions[0]), h('td', null, p.name), h('td', null, p.age), h('td', null, p.overall), h('td', null, p.potential), h('td', { style: 'text-align:right' }, h('button', { class: 'btn small', onclick: (): void => { toast(promoteYouth(s, p.id)); this.refresh(); } }, 'Promote'), h('button', { class: 'btn small ghost', onclick: (): void => { s.youth = s.youth.filter((x) => x.id !== p.id); this.refresh(); } }, 'Release'))))))));
  }

  private boardView(): void {
    const s = this.s;
    this.body.append(h('div', { class: 'split' }, h('div', { class: 'card col' }, h('h3', null, 'Board'), h('div', { class: 'bar' }, h('i', { style: `width:${s.board.confidence}%` })), h('div', { class: 'muted' }, `Confidence ${Math.round(s.board.confidence)}% · manager reputation ${Math.round(s.board.managerRep)}`), s.board.objectives.map((o) => h('div', null, `${o.done ? '✓' : o.failed ? '✗' : '•'} ${o.text}`)), h('div', { class: 'muted' }, `Trophies: ${s.stats.trophies.length ? s.stats.trophies.join(', ') : 'none yet'}`)),
      h('div', { class: 'card col' }, h('h3', null, 'History'), s.history.length ? s.history.map((x) => h('div', { class: 'muted' }, `${x.season}: ${x.position}${ord(x.position)} (${x.points} pts) · cup ${x.cupRound} · champion ${x.champion}`)) : h('div', { class: 'muted' }, 'No completed seasons yet.')),
      s.jobOffers.length ? h('div', { class: 'card col' }, h('h3', null, 'Job offers'), s.jobOffers.map((o) => h('div', { class: 'row' }, h('span', { class: 'grow' }, o.note), h('button', { class: 'btn small', onclick: (): void => { if (confirm('Leave your current club?')) { acceptJob(s, o.from); this.tableLeague = club(s, o.from).leagueId; this.refresh(); } } }, 'Accept')))) : null));
  }

  private newsView(): void { this.body.append(h('div', { class: 'card col' }, this.s.news.map((n) => h('div', null, h('span', { class: 'muted' }, `${n.season} W${n.week}  `), n.text)))); }

  private sackedView(): HTMLElement {
    const s = this.s;
    return h('div', { class: 'card col' }, h('h2', null, 'You have been sacked'), h('div', { class: 'muted' }, 'Choose a new job, or leave management.'),
      s.jobOffers.length ? s.jobOffers.map((o) => h('button', { class: 'btn', onclick: (): void => { acceptJob(s, o.from); this.tableLeague = club(s, o.from).leagueId; this.refresh(); } }, o.note)) : h('div', { class: 'muted' }, 'No clubs are interested right now.'),
      h('button', { class: 'btn danger', onclick: (): void => void this.app.go('main') }, 'Return to main menu'));
  }
}

const POS_ORDER = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];
const ord = (n: number): string => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
void ATTR_KEYS; void simFixture; void skillById; void POS_GROUP;
