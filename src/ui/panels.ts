import { h, clear, toast } from './dom';
import type { Match } from '../match/match';
import { summarize, playerResults, type PlayerResult } from '../match/stats';
import { PITCH_L } from '../match/constants';
import type { Side } from '../match/constants';
import type { MPlayer } from '../match/entities';
import { audio } from '../audio/engine';
import { crest, formationPicker, icon, ovrBadge, posTag, tacticsEditor } from './components';

export function modal(content: HTMLElement, onBg?: () => void, cls = ''): HTMLElement {
  const bg = h('div', { class: 'modal-bg' }, h('div', { class: `modal ${cls}`.trim() }, content));
  if (onBg) bg.addEventListener('pointerdown', (e) => { if (e.target === bg) onBg(); });
  return bg;
}

export function statRow(label: string, a: string | number, b: string | number, pa: number, pb: number, colA: string, colB: string): HTMLElement {
  const tot = pa + pb || 1;
  return h('div', { class: 'statrow' }, h('div', { class: 'l' }, a), h('div', { class: 'c' }, label), h('div', null, b),
    h('div', { class: 'statbar' }, h('i', { style: `width:${(pa / tot) * 100}%;background:${colA}` }), h('i', { style: `width:${(pb / tot) * 100}%;background:${colB}` })));
}

export function heatCanvas(heat: Float32Array, color: string): HTMLCanvasElement {
  const c = h('canvas', { width: 300, height: 200, style: 'width:100%;border-radius:10px;background:#143a1f' }) as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  let max = 1; for (const v of heat) max = Math.max(max, v);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 30; x++) {
    const v = heat[y * 30 + x]! / max;
    if (v <= 0.02) continue;
    g.fillStyle = color; g.globalAlpha = Math.min(0.9, v * 1.2); g.fillRect(x * 10, y * 10, 10, 10);
  }
  g.globalAlpha = 1; g.strokeStyle = 'rgba(255,255,255,.4)'; g.strokeRect(1, 1, 298, 198);
  g.beginPath(); g.moveTo(150, 0); g.lineTo(150, 200); g.stroke(); g.beginPath(); g.arc(150, 100, 26, 0, Math.PI * 2); g.stroke();
  g.strokeRect(0, 55, 50, 90); g.strokeRect(250, 55, 50, 90);
  return c;
}

export function passMapCanvas(m: Match, side: Side, color: string): HTMLCanvasElement {
  const c = h('canvas', { width: 300, height: 200, style: 'width:100%;border-radius:10px;background:#143a1f' }) as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,.3)'; g.strokeRect(1, 1, 298, 198); g.beginPath(); g.moveTo(150, 0); g.lineTo(150, 200); g.stroke();
  const dir = m.teams[side].dir;
  g.strokeStyle = color; g.globalAlpha = 0.35; g.lineWidth = 1;
  for (const p of m.passMap) {
    if (p.side !== side) continue;
    const x0 = 150 + (p.x0 * dir / (PITCH_L / 2)) * 150, x1 = 150 + (p.x1 * dir / (PITCH_L / 2)) * 150;
    g.beginPath(); g.moveTo(x0, 100 + (p.y0 / 34) * 100); g.lineTo(x1, 100 + (p.y1 / 34) * 100); g.stroke();
  }
  return c;
}

export function statsPanel(m: Match, title: string, onClose: () => void, closeLabel: string, extra?: HTMLElement[]): HTMLElement {
  const [A, B] = summarize(m);
  const ca = m.teams[0].kit.primary, cb = m.teams[1].kit.primary;
  const res = playerResults(m);
  const mom = [...res].sort((a, b) => b.rating - a.rating)[0];
  const rows = [
    statRow('Possession', `${A.possession}%`, `${B.possession}%`, A.possession, B.possession, ca, cb),
    statRow('Shots', A.shots, B.shots, A.shots, B.shots, ca, cb), statRow('On target', A.onTarget, B.onTarget, A.onTarget, B.onTarget, ca, cb),
    statRow('Expected goals', A.xg.toFixed(2), B.xg.toFixed(2), A.xg, B.xg, ca, cb),
    statRow('Passes', `${A.passes} (${A.passAcc}%)`, `${B.passes} (${B.passAcc}%)`, A.passes, B.passes, ca, cb),
    statRow('Tackles', A.tackles, B.tackles, A.tackles, B.tackles, ca, cb), statRow('Fouls', A.fouls, B.fouls, A.fouls, B.fouls, ca, cb),
    statRow('Offsides', A.offsides, B.offsides, A.offsides, B.offsides, ca, cb), statRow('Corners', A.corners, B.corners, A.corners, B.corners, ca, cb),
    statRow('Cards', `${A.yellow}Y ${A.red}R`, `${B.yellow}Y ${B.red}R`, A.yellow + A.red * 2, B.yellow + B.red * 2, ca, cb),
  ];
  const ratingTable = (side: Side): HTMLElement => h('table', null, h('tbody', null, res.filter((r) => r.side === side).sort((a, b) => b.rating - a.rating).slice(0, 8).map((r: PlayerResult) =>
    h('tr', null, h('td', null, r.name + (r.goals ? ` ⚽${r.goals}` : '')), h('td', { style: 'text-align:right' }, ovrBadge(Math.round(r.rating * 10)))))));
  const shootout = m.shootout ? h('div', { class: 'muted', style: 'text-align:center' }, `Penalties ${m.shootout.score[0]} – ${m.shootout.score[1]}`) : null;
  const goals = m.eventLog.filter((e) => e.type === 'goal');
  return h('div', { class: 'col' },
    h('div', { class: 'result-hero' }, h('div', { class: 'tm' }, crest(m.teams[0].kit), h('h2', null, A.name)), h('div', null, h('div', { class: 'sc' }, `${A.goals} – ${B.goals}`), h('div', { class: 'muted' }, title)), h('div', { class: 'tm' }, crest(m.teams[1].kit), h('h2', null, B.name))),
    shootout,
    goals.length ? h('div', { class: 'row wrap', style: 'justify-content:center;gap:10px 22px' }, goals.map((g) => h('span', { class: 'pill' }, `⚽ ${g.text} ${g.minute}'`))) : null,
    h('div', { class: 'card flat' }, rows), mom ? h('div', { class: 'card flat row' }, icon('trophy', 'gold'), h('div', null, h('h3', { style: 'margin:0 0 4px' }, 'Man of the match'), h('b', null, `${mom.name}`), h('span', { class: 'muted' }, ` — ${mom.rating.toFixed(1)}`))) : null,
    h('div', { class: 'split' }, h('div', null, h('h3', { style: 'margin-bottom:8px' }, `${A.short} ratings`), ratingTable(0)), h('div', null, h('h3', { style: 'margin-bottom:8px' }, `${B.short} ratings`), ratingTable(1))),
    h('div', { class: 'split' }, h('div', null, h('h3', { style: 'margin-bottom:8px' }, `${A.short} heat map`), heatCanvas(m.heat[0], ca)), h('div', null, h('h3', { style: 'margin-bottom:8px' }, `${B.short} heat map`), heatCanvas(m.heat[1], cb))),
    h('div', { class: 'split' }, h('div', null, h('h3', { style: 'margin-bottom:8px' }, `${A.short} pass map`), passMapCanvas(m, 0, ca)), h('div', null, h('h3', { style: 'margin-bottom:8px' }, `${B.short} pass map`), passMapCanvas(m, 1, cb))),
    ...(extra ?? []),
    h('div', { class: 'row sticky-foot' }, h('button', { class: 'btn primary big', onclick: onClose }, closeLabel)));
}

/** Team sheets shown for a few seconds before kick-off. */
export function kickoffCard(m: Match, managed: Side | 'both' | null, onGo: () => void): HTMLElement {
  const col = (side: Side): HTMLElement => {
    const t = m.teams[side];
    const mine = managed === 'both' || managed === side;
    return h('div', { class: 'tm' }, crest(t.kit), h('div', { class: 'nm' }, t.name), h('div', { class: 'row', style: 'gap:8px' }, h('span', { class: 'pill accent' }, t.formation.name), mine ? h('span', { class: 'pill gold' }, 'Your team') : null),
      h('div', { class: 'xi' }, t.players.map((p) => h('div', null, h('span', { class: 'no' }, p.data.number), h('span', null, p.data.shortName), h('span', { class: 'muted', style: 'margin-left:auto' }, p.data.overall)))));
  };
  return h('div', { class: 'kickoff-card' }, h('div', { class: 'cols' }, col(0), h('div', { class: 'display', style: 'align-self:center;font-size:44px;color:var(--text-faint)' }, 'VS'), col(1)),
    h('div', { class: 'row', style: 'justify-content:center;margin-top:22px' }, h('button', { class: 'btn primary big', onclick: onGo }, icon('play'), 'Kick off')));
}

/** Substitutions: pick who leaves, then who comes on. */
export function subsPanel(m: Match, side: Side, onDone: () => void, forced?: MPlayer): HTMLElement {
  const t = m.teams[side];
  let off: MPlayer | null = forced ?? null;
  const left = m.cfg.maxSubs - t.subsMade;
  const list = h('div', { class: 'col', style: 'gap:6px' });
  const benchList = h('div', { class: 'col', style: 'gap:6px' });
  const queued = m.subQueue.filter((q) => q.side === side);
  const info = h('div', { class: 'muted' }, `${left} substitution${left === 1 ? '' : 's'} left · ${m.cfg.subWindows - m.windowsUsedFor(side)} windows${queued.length ? ` · ${queued.length} queued` : ''}`);
  const renderBench = (): void => {
    clear(benchList);
    for (const b of t.bench) {
      benchList.appendChild(h('div', {
        class: 'bench-row', onclick: (): void => {
          if (!off) { toast('Select a player to replace first'); return; }
          if (m.phase === 'play') { m.queueSub(side, off, b); toast(`${b.shortName} will come on at the next stoppage`); }
          else if (!m.substitute(side, off, b)) { toast('No substitutions available'); return; }
          audio.ui('confirm'); onDone();
        },
      }, posTag(b.positions[0]!), h('div', { class: 'grow' }, h('div', { class: 'nm' }, `${b.number} ${b.name}`), h('div', { class: 'sub' }, `${b.age}y · fitness ${Math.round(b.fitness)}%`)), ovrBadge(b.overall)));
    }
  };
  const renderOn = (): void => {
    clear(list);
    for (const p of t.players.filter((q) => q.active())) {
      const tired = Math.round(p.stamina * 100);
      list.appendChild(h('div', { class: 'bench-row' + (off === p ? ' sel' : ''), onclick: (): void => { off = p; renderOn(); } },
        posTag(p.slotPos), h('div', { class: 'grow' }, h('div', { class: 'nm' }, `${p.data.number} ${p.data.name}`), h('div', { class: 'bar thin', style: 'margin-top:5px' }, h('i', { style: `width:${tired}%;background:${tired < 40 ? 'var(--danger)' : tired < 65 ? 'var(--warn)' : 'var(--accent)'}` }))), ovrBadge(p.data.overall)));
    }
  };
  renderOn(); renderBench();
  return h('div', { class: 'col' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', null, forced ? `${forced.data.shortName} is injured — choose a replacement` : 'Substitutions'), info),
    h('div', { class: 'split' }, h('div', { class: 'col', style: 'gap:10px' }, h('h3', null, 'On the pitch'), list), h('div', { class: 'col', style: 'gap:10px' }, h('h3', null, 'Bench'), benchList)),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: onDone }, 'Back')));
}

/** Live tactics: change formation and instructions while the match runs. */
export function tacticsPanel(m: Match, side: Side, onDone: () => void): HTMLElement {
  const t = m.teams[side];
  const root = h('div', { class: 'col', style: 'gap:22px' });
  root.append(
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'row' }, crest(t.kit, 32), h('h2', null, `${t.name} — tactics`)), h('button', { class: 'btn primary', onclick: onDone }, icon('check'), 'Apply & resume')),
    h('div', { class: 'col', style: 'gap:10px' }, h('h3', null, 'Formation'), formationPicker(t.formation.id, (id) => m.setFormation(side, id))),
    tacticsEditor(t.tactics, () => undefined));
  return root;
}
