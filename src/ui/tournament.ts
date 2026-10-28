import { h, clear, toast } from './dom';
import { crest, icon } from './components';
import type { App } from './app';
import { createTournament, groupTable, pending, playersMap, setResult, simTournamentFixture, teamOf, userPending, winnerOf, type TFix, type Tournament } from '../manager/tournament';
import { storage } from '../core/storage';
import { Match } from '../match/match';
import { teamSetupFromClub } from '../match/setup';
import { matchConfigFromSettings } from './session';
import { toSimResult } from '../match/stats';
import { NATION_DEFS } from '../data/names';

export function registerTournament(app: App): void {
  app.register('tournament', (a) => setup(a));
  app.register('tournament-view', (a, p) => view(a, p as Tournament));
}

async function setup(app: App): Promise<HTMLElement> {
  const saved = await storage.get<Tournament>('tournament:current');
  const st = { type: 'groups' as 'groups' | 'knockout', size: 16, user: NATION_DEFS[0]!.id };
  const sizeInfo = h('span', { class: 'muted' });
  const size = h('input', { type: 'range', min: 4, max: 24, step: 1, value: st.size, oninput: (e: Event): void => { st.size = Number((e.target as HTMLInputElement).value); sizeInfo.textContent = `${st.size} nations`; } });
  sizeInfo.textContent = `${st.size} nations`;
  const type = h('div', { class: 'seg' });
  const rt = (): void => { clear(type); for (const [v, l] of [['groups', 'Group stage + knockout'], ['knockout', 'Knockout cup']] as const) type.appendChild(h('button', { class: st.type === v ? 'on' : '', onclick: (): void => { st.type = v; rt(); } }, l)); };
  rt();
  return h('div', { class: 'ui-layer screen' }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:16px' }, h('div', null, h('div', { class: 'eyebrow' }, 'Competition'), h('h1', null, 'Tournament')), h('button', { class: 'btn', 'data-back': true, onclick: (): void => app.back() }, 'Back')),
    h('div', { class: 'split' }, h('div', { class: 'card col' }, h('h3', null, 'New tournament'), type,
      h('div', { class: 'field' }, h('label', null, 'Your nation'), h('select', { onchange: (e: Event): void => { st.user = (e.target as HTMLSelectElement).value; } }, NATION_DEFS.map((n) => h('option', { value: n.id }, n.name)))),
      h('div', { class: 'field' }, h('label', null, 'Size (custom 4–24)'), size, sizeInfo),
      h('button', { class: 'btn primary', onclick: (): void => { const t = createTournament({ type: st.type, size: st.size, user: st.user }); void storage.set('tournament:current', t); void app.go('tournament-view', t); } }, 'Start')),
      h('div', { class: 'card col' }, h('h3', null, 'Continue'), saved ? [h('div', null, `${saved.type === 'groups' ? 'World-cup style' : 'Knockout'} · ${saved.ids.length} nations · ${saved.phase === 'done' ? 'finished' : 'in progress'}`), h('button', { class: 'btn', onclick: (): void => void app.go('tournament-view', saved) }, 'Resume')] : h('div', { class: 'muted' }, 'No tournament in progress.'))));
}

function view(app: App, t: Tournament): HTMLElement {
  const root = h('div', { class: 'ui-layer screen' });
  const nm = (id: string): string => t.nations[id]!.name;
  const save = (): void => void storage.set('tournament:current', t);
  const draw = (): void => {
    clear(root);
    const next = userPending(t);
    const fixRow = (f: TFix): HTMLElement => h('tr', { class: f.a === t.user || f.b === t.user ? 'sel' : '' }, h('td', null, f.stage), h('td', null, nm(f.a)), h('td', { style: 'text-align:center' }, f.played ? `${f.ga} – ${f.gb}${f.pens ? ` (${f.pens[0]}–${f.pens[1]})` : ''}` : 'v'), h('td', null, nm(f.b)));
    const body = h('div', { class: 'col' });
    if (t.phase === 'done') body.appendChild(h('div', { class: 'card' }, h('div', { class: 'hero-title' }, `🏆 ${nm(t.champion!)}`), h('div', { class: 'muted' }, t.champion === t.user ? 'Your nation won the tournament!' : 'Tournament complete.')));
    if (t.groups.length) body.appendChild(h('div', { class: 'split' }, t.groups.map((_, gi) => h('div', { class: 'card' }, h('h3', null, `Group ${String.fromCharCode(65 + gi)}`), h('table', null, h('thead', null, h('tr', null, ['Nation', 'P', 'W', 'D', 'L', 'GD', 'Pts'].map((x) => h('th', null, x)))), h('tbody', null, groupTable(t, gi).map((r) => h('tr', { class: r.id === t.user ? 'sel' : '' }, h('td', null, h('span', { class: 'row', style: 'gap:8px' }, crest({ primary: t.nations[r.id]!.primary, secondary: t.nations[r.id]!.secondary }, 18), nm(r.id))), h('td', null, r.p), h('td', null, r.w), h('td', null, r.d), h('td', null, r.l), h('td', null, r.gf - r.ga), h('td', null, h('b', null, r.pts))))))))));
    body.appendChild(h('div', { class: 'card', style: 'overflow:auto' }, h('h3', null, 'Fixtures & results'), h('table', null, h('tbody', null, t.fixtures.map(fixRow)))));
    root.append(h('div', { class: 'row wrap', style: 'justify-content:space-between;margin-bottom:12px' }, h('h2', null, t.type === 'groups' ? 'World-cup style tournament' : 'Knockout cup'),
      h('div', { class: 'row' }, next && t.phase !== 'done' ? h('button', { class: 'btn primary', onclick: (): void => playUser(next) }, icon('play'), `Play: ${nm(next.a)} v ${nm(next.b)}`) : null,
        t.phase !== 'done' ? h('button', { class: 'btn', onclick: (): void => { for (const f of pending(t).filter((x) => x !== next)) simTournamentFixture(t, f); if (next) { simTournamentFixture(t, next); } save(); draw(); } }, next ? 'Sim round (incl. mine)' : 'Sim round') : null,
        t.phase !== 'done' ? h('button', { class: 'btn ghost', onclick: (): void => { let g = 0; while (t.phase !== 'done' && g++ < 200) for (const f of pending(t)) simTournamentFixture(t, f); save(); draw(); } }, 'Sim to the end') : null,
        h('button', { class: 'btn', 'data-back': true, onclick: (): void => void app.go('main') }, 'Exit'))), body);
  };
  const playUser = (f: TFix): void => {
    const A = teamOf(t, f.a), B = teamOf(t, f.b);
    const world = { clubs: { [A.club.id]: A.club, [B.club.id]: B.club }, players: playersMap(t, [f.a, f.b]) };
    const knock = !f.stage.startsWith('Group');
    const cfg = matchConfigFromSettings({ seed: `${t.seed}:${f.id}`, knockout: knock, extraTime: knock, penalties: knock, stadiumStyle: Math.abs(hashStr(f.id)) % 8 });
    const same = A.club.kits.home.primary === B.club.kits.home.primary;
    const match = new Match(cfg, teamSetupFromClub(world, A.club.id), teamSetupFromClub(world, B.club.id, { away: same }));
    const mine = f.a === t.user ? 0 : 1;
    app.play(match, mine, (r) => {
      if (r.quit) { void app.go('tournament-view', t, false); return; }
      const res = toSimResult(match);
      let pens = res.shootout;
      if (knock && res.score[0] === res.score[1] && !pens) pens = Math.random() < 0.5 ? [5, 4] : [4, 5];
      setResult(t, f, res.score[0], res.score[1], pens);
      for (const g of pending(t).filter((x) => x.stage === f.stage && x !== f)) simTournamentFixture(t, g);
      void winnerOf; save(); void app.go('tournament-view', t, false); toast('Result recorded');
    }, { fullTimeTitle: f.stage });
  };
  draw();
  return root;
}

function hashStr(s: string): number { let h2 = 0; for (let i = 0; i < s.length; i++) h2 = (Math.imul(h2, 31) + s.charCodeAt(i)) | 0; return h2; }
