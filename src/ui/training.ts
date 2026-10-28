import { h, clear, toast } from './dom';
import type { App } from './app';
import { Match } from '../match/match';
import { teamSetupFromClub } from '../match/setup';
import { matchConfigFromSettings, type SessionResult } from './session';
import { startSetPiece } from '../match/rules';
import { SKILL_MOVES, skillById } from '../match/skills';
import { settings } from '../core/settings';
import { HALF_GOAL, HALF_L, GOAL_H, BALL_R } from '../match/constants';
import type { DrillMarker } from '../render/matchview';
import type { MPlayer } from '../match/entities';
import { keyLabel } from '../input/prompts';
import { findConflictFree } from './trainingutil';

type Drill = 'freekick' | 'penalty' | 'keeper' | 'shooting' | 'passing' | 'dribbling' | 'skilllab';

export function registerTraining(app: App): void {
  app.register('training', (a) => trainingMenu(a));
}

function trainingMenu(app: App): HTMLElement {
  const card = (id: Drill, title: string, desc: string): HTMLElement => h('button', { class: 'card', style: 'text-align:left;cursor:pointer', onclick: (): void => startDrill(app, id) }, h('h2', null, title), h('div', { class: 'muted', style: 'margin-top:6px' }, desc));
  return h('div', { class: 'ui-layer screen' }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:16px' }, h('h2', null, 'Skill games & training'), h('button', { class: 'btn', 'data-back': true, onclick: (): void => app.back() }, 'Back')),
    h('div', { class: 'split' },
      card('skilllab', 'Skill Lab', 'Practise any of the 45 skill moves. See the exact input for your device and a success / fail indicator.'),
      card('dribbling', 'Dribbling gates', 'Slalom through the gates as fast as you can. Cones add time penalties.'),
      card('passing', 'Passing accuracy', 'Hit the highlighted teammate. 60 seconds, accuracy counts.'),
      card('shooting', 'Shooting accuracy', 'Place shots into the highlighted target. Corners score the most.'),
      card('freekick', 'Free-kick practice', 'Random positions with a wall and keeper. Aim, curl and power.'),
      card('penalty', 'Penalty practice', 'Take penalties against the keeper.'),
      card('keeper', 'Goalkeeper training', 'Face penalties. Dive with Q/E, A/D or the dive buttons.')));
}

function startDrill(app: App, kind: Drill): void {
  const w = app.world;
  const ids = Object.keys(w.clubs);
  const cfg = matchConfigFromSettings({ seed: `drill${Date.now()}`, halfLength: 20, timeOfDay: 'day', weather: 'clear', stadiumStyle: 1, injuries: false, fatigue: false, refStrictness: 0.2, foulFrequency: 0.3 }, app.input.active === 'touch');
  const match = new Match(cfg, teamSetupFromClub(w, ids[0]!), teamSetupFromClub(w, ids[1]!, { away: true }));
  match.teams[0].tactics.style = 'balanced';
  const side = kind === 'keeper' ? 1 : 0;
  const scheme = app.schemes(1)[0]!;
  const humans = [{ side: side as 0 | 1, scheme, keeperOnly: kind === 'keeper' }];
  let init = false;
  const hud = h('div', { class: 'card', style: 'position:absolute;left:50%;transform:translateX(-50%);top:70px;pointer-events:none;text-align:center;min-width:260px' });
  const drill: DrillMarker[] = [];
  const gateColor = (i: number, gate: number): string => (i === gate ? '#3ddc97' : i < gate ? '#6b7280' : '#f59e0b');
  const state = { attempts: 0, score: 0, hits: 0, t: 0, target: 0, gate: 0, penalty: 0, cooldown: 0, waiting: false, lastTouchAttempt: -1, passes: 0, okPasses: 0, best: Infinity, done: false, lastSkill: '—', skillOK: 0, skillFail: 0 };
  const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
  const attack = match.teams[0].dir;

  const park = (m: Match, side: 0 | 1, x: number, y: number): void => { for (const p of m.teams[side].players) { p.x = p.px = x + (p.slot - 5) * 0.8; p.y = p.py = y; p.vx = p.vy = 0; } m.teams[side].frozen = true; };
  const hero = (m: Match): MPlayer => m.humans[0]!.player ?? m.teams[0].players[9]!;
  const give = (m: Match, p: MPlayer, x: number, y: number, face = attack > 0 ? 0 : Math.PI): void => {
    m.forceResume(); m.sp = null; m.phase = 'play'; p.x = p.px = x; p.y = p.py = y; p.vx = p.vy = 0; p.face = p.pface = face;
    m.ball.reset(x + Math.cos(face) * 0.7, y + Math.sin(face) * 0.7); m.owner = p; m.possessionSide = 0; m.lastTouch = p; m.lastTouchT = m.time;
  };
  let lastScoreCheck = 0;

  const onTick = (m: Match, dt: number): void => {
    const sess = app.session; if (!sess) return;
    if (!init) {
      init = true;
      sess.root.appendChild(hud); sess.view.drill = drill;
      m.forceResume();
      m.teams[1].frozen = kind !== 'freekick' && kind !== 'penalty' && kind !== 'keeper';
      if (kind === 'skilllab') { sess.root.appendChild(skillLabPanel(app, m, state)); }
    }
    state.t += dt; state.cooldown -= dt;
    const p = hero(m);
    switch (kind) {
      case 'freekick': case 'penalty': {
        const fk = kind === 'freekick';
        if (!state.waiting && !m.sp) {
          // new attempt
          state.attempts++;
          const gx = attack * HALF_L;
          const x = fk ? gx - attack * rnd(19, 30) : gx - attack * 11, y = fk ? rnd(-14, 14) : 0;
          m.teams[1].frozen = false;
          startSetPiece(m, { type: fk ? 'freeKick' : 'penalty', side: 0, x, y });
          state.waiting = true; state.cooldown = 0;
        } else if (state.waiting && !m.sp) {
          // ball in flight: resolve after a few seconds or on goal
          if (m.teams[0].score > state.score) { state.score = m.teams[0].score; state.hits++; state.waiting = false; state.cooldown = 1.2; toast('Goal!'); }
          else if (state.t - lastScoreCheck > 5 && state.cooldown < 0) { state.waiting = false; }
          if (m.ball.speed() < 0.5 && state.cooldown < 0) state.waiting = false;
        } else lastScoreCheck = state.t;
        hud.textContent = `${fk ? 'Free kicks' : 'Penalties'}: ${state.hits} scored from ${Math.max(0, state.attempts - (state.waiting && m.sp ? 1 : 0))}`;
        if (m.phase === 'goal') { m.phaseT = 99; m.forceResume(); m.sp = null; state.waiting = false; }
        break;
      }
      case 'keeper': {
        if (!m.sp && !state.waiting) { startSetPiece(m, { type: 'penalty', side: 0, x: attack * (HALF_L - 11), y: 0 }); state.waiting = true; state.attempts++; }
        break;
      }
      case 'shooting': {
        if (!init || state.done) break;
        if (state.t < 0.3) { park(m, 1, -attack * 40, 30); park(m, 0, -attack * 30, -30); for (const q of m.teams[0].players) if (q !== p) { q.x = q.px = -attack * 30; q.y = q.py = -30; } m.teams[0].frozen = true; }
        const needs = !m.owner || m.owner !== p;
        if (state.cooldown <= 0 && (needs && (m.ball.speed() < 0.4 || Math.abs(m.ball.x) > HALF_L))) {
          state.attempts++; state.target = Math.floor(Math.random() * 4);
          const gx = attack * HALF_L;
          give(m, p, gx - attack * rnd(14, 24), rnd(-12, 12));
          drill.length = 0;
          const ty = [(-1), 1, -1, 1][state.target]! * HALF_GOAL * 0.78, tz = [0.5, 0.5, 2.0, 2.0][state.target]!;
          drill.push({ kind: 'ring', x: gx, y: ty, r: 0.6, color: tz > 1 ? '#38bdf8' : '#3ddc97', pulse: true, label: tz > 1 ? 'HIGH' : 'LOW' });
          state.cooldown = 3;
        }
        if (state.lastTouchAttempt !== state.attempts && m.ball.speed() > 12 && Math.abs(m.ball.x) > HALF_L - 0.3) {
          state.lastTouchAttempt = state.attempts;
          const gx = attack * HALF_L; const ty = [(-1), 1, -1, 1][state.target]! * HALF_GOAL * 0.78, tz = [0.5, 0.5, 2.0, 2.0][state.target]!;
          const d = Math.hypot(m.ball.y - ty, m.ball.z - tz);
          if (Math.abs(m.ball.y) < HALF_GOAL && m.ball.z < GOAL_H) { const pts = d < 0.9 ? 3 : 1; state.score += pts; toast(pts === 3 ? 'On target! +3' : 'Goal +1'); } else toast('Missed');
          state.cooldown = 1.2; void gx;
        }
        if (state.attempts > 10 && state.cooldown < 0.1 && m.ball.speed() < 0.5) state.done = true;
        hud.textContent = state.done ? `Finished: ${state.score} / 30 points` : `Shot ${state.attempts}/10 · ${state.score} points`;
        break;
      }
      case 'passing': {
        if (state.t < 0.3) {
          give(m, p, 0, 0); park(m, 1, attack * 45, 33);
          const spots = [[-18, -10], [-18, 10], [18, -10], [18, 10], [0, -18], [0, 18]];
          m.teams[0].players.filter((q) => q !== p).slice(0, 6).forEach((q, i) => { q.x = q.px = spots[i]![0]!; q.y = q.py = spots[i]![1]!; });
          m.teams[0].players.filter((q) => q !== p).slice(6).forEach((q) => { q.x = q.px = -45; q.y = q.py = 33; });
          m.teams[0].frozen = true; state.target = -1;
        }
        const mates = m.teams[0].players.filter((q) => q.active() && q.x > -44 && q !== m.owner);
        const t = mates[state.target];
        if (!t || m.owner === t) {
          if (t && m.owner === t) { state.score++; toast('Nice!'); }
          state.target = Math.floor(Math.random() * Math.max(1, mates.filter((q) => q !== m.owner).length));
          drill.length = 0;
        }
        const tt = m.teams[0].players.filter((q) => q.active() && q.x > -44 && q !== m.owner)[state.target];
        drill.length = 0;
        if (tt) drill.push({ kind: 'ring', x: tt.x, y: tt.y, r: 1.5, color: '#f2c14e', pulse: true });
        if (state.t > 60) { state.done = true; }
        hud.textContent = state.done ? `Finished: ${state.score} passes found their target` : `Time ${Math.max(0, 60 - state.t).toFixed(0)}s · ${state.score} on target`;
        if (state.done) { m.teams[0].frozen = true; }
        break;
      }
      case 'dribbling': {
        const gates: Array<[number, number]> = [[-35, -20], [-25, 12], [-15, -14], [-5, 14], [5, -12], [15, 12], [25, -10], [35, 8]];
        if (state.t < 0.3) {
          give(m, p, -43, 0, 0); park(m, 1, 0, 33); for (const q of m.teams[0].players) if (q !== p) { q.x = q.px = -45; q.y = q.py = 33; } m.teams[0].frozen = true;
          drill.length = 0;
          gates.forEach(([x, y], i) => { drill.push({ kind: 'cone', x, y: y - 2, r: 0.6, color: gateColor(i, 0) }, { kind: 'cone', x, y: y + 2, r: 0.6, color: gateColor(i, 0) }); });
          state.gate = 0; state.t = 0.3;
        }
        const g = gates[state.gate];
        if (g && !state.done) {
          const b = m.ball;
          if (Math.abs(b.x - g[0]) < 0.9 && Math.abs(b.y - g[1]) < 2) { state.gate++; toast(`Gate ${state.gate}/8`); drill.forEach((c, i) => { c.color = gateColor(Math.floor(i / 2), state.gate); }); }
          for (const c of drill) if (Math.hypot(c.x - b.x, c.y - b.y) < 0.42 && state.cooldown < 0) { state.t += 2; state.cooldown = 0.6; toast('Cone hit +2s'); }
          if (state.gate >= gates.length) { state.done = true; state.best = Math.min(state.best, state.t); }
        }
        hud.textContent = state.done ? `Finished in ${state.t.toFixed(1)}s` : `Gate ${state.gate}/8 · ${state.t.toFixed(1)}s`;
        void BALL_R;
        break;
      }
      case 'skilllab': {
        if (state.t < 0.3) { give(m, p, -10, 0, attack > 0 ? 0 : Math.PI); park(m, 1, -attack * 40, 33); for (const q of m.teams[0].players) if (q !== p) { q.x = q.px = -45; q.y = q.py = -33; } m.teams[0].frozen = true; p.data = { ...p.data, skillMoves: 5 }; const d = m.teams[1].players[4]!; d.x = d.px = p.x + attack * 4; d.y = d.py = 0; }
        // keep the ball with the hero and respawn if it runs away
        if (!m.owner || m.owner !== p) { if (m.ball.speed() < 0.5 || Math.hypot(m.ball.x - p.x, m.ball.y - p.y) > 14) give(m, p, p.x, p.y, p.face); }
        hud.textContent = `Last: ${state.lastSkill} · ✓ ${state.skillOK}  ✗ ${state.skillFail}`;
        break;
      }
    }
    // the practice never ends by itself: keep the clock from running out
    m.periodClock = Math.min(m.periodClock, 40 * 60);
    void findConflictFree;
  };

  // bind skill events for the lab
  match.bus.on('skill', (e) => { state.lastSkill = `${skillById(e.id)?.name ?? e.id}`; if (e.success) state.skillOK++; else state.skillFail++; });
  void keyLabel;
  app.play(match, humans, (r: SessionResult) => { void app.go('training', undefined, false); void r; }, { skipIntro: true, noReplays: true, hideScoreboard: true, onTick, fullTimeTitle: 'Practice' });
  void settings;
}

function skillLabPanel(app: App, m: Match, state: { lastSkill: string }): HTMLElement {
  void m; void state;
  const info = h('div', { class: 'muted', style: 'font-size:12px;line-height:1.5' });
  const sel = h('select', { style: 'width:100%', onchange: (): void => render() }, [1, 2, 3, 4, 5].map((st) => h('optgroup', { label: '★'.repeat(st) }, SKILL_MOVES.filter((s) => s.stars === st).map((mv) => h('option', { value: mv.id }, mv.name)))));
  const panel = h('div', { class: 'card col', style: 'position:absolute;right:16px;top:70px;width:min(320px,42vw);pointer-events:auto;gap:8px' }, h('h3', null, 'Skill Lab'), sel, info);
  const render = (): void => {
    const mv = skillById((sel as HTMLSelectElement).value)!;
    const lo = settings.value.controls.skillLoadout;
    const slot = lo.indexOf(mv.id);
    const kb = settings.value.controls.keyboard;
    clear(info);
    const arrows = ['↑', '→', '↓', '←'];
    const hint = slot >= 0
      ? `Slot ${slot + 1}: right stick flick ${arrows[slot]} · key ${keyLabel(kb.skill1[0] && ['Digit1', 'Digit2', 'Digit3', 'Digit4'][slot] ? ['Digit1', 'Digit2', 'Digit3', 'Digit4'][slot]! : 'Digit1')} / arrow ${arrows[slot]} · touch skill button ${slot + 1}`
      : 'Not in your loadout — assign it to a slot below to practise it.';
    info.append(h('div', null, `${'★'.repeat(mv.stars)} · ${mv.desc}`), h('div', null, hint), h('div', { class: 'row wrap' }, [0, 1, 2, 3].map((i) => h('button', { class: 'btn small', onclick: (): void => { settings.update((s) => { const prev = s.controls.skillLoadout.indexOf(mv.id); if (prev >= 0) s.controls.skillLoadout[prev] = s.controls.skillLoadout[i]!; s.controls.skillLoadout[i] = mv.id; }); render(); } }, `→ slot ${i + 1}`))),
      h('div', null, `Gesture pattern: ${mv.pattern.map((d) => ({ U: '↑', D: '↓', L: '←', R: '→' })[d]).join(' ')}`));
    if (app.session) app.session.match.cfg.loadout = [...settings.value.controls.skillLoadout];
  };
  render();
  return panel;
}
