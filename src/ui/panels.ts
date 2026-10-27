import { h, clear, toast } from './dom';
import type { Match } from '../match/match';
import { summarize, playerResults, type PlayerResult } from '../match/stats';
import { FORMATIONS } from '../data/formations';
import { PITCH_L } from '../match/constants';
import type { Side } from '../match/constants';
import type { MPlayer } from '../match/entities';
import { audio } from '../audio/engine';

export function modal(content: HTMLElement, onBg?: () => void): HTMLElement {
  const bg = h('div', { class: 'modal-bg ui-layer' }, h('div', { class: 'modal' }, content));
  bg.style.padding = '20px';
  if (onBg) bg.addEventListener('pointerdown', (e) => { if (e.target === bg) onBg(); });
  return bg;
}

export function statRow(label: string, a: string | number, b: string | number, pa: number, pb: number, colA: string, colB: string): HTMLElement {
  const tot = pa + pb || 1;
  return h('div', { class: 'statrow' }, h('div', { class: 'l' }, a), h('div', { class: 'c' }, label), h('div', null, b),
    h('div', { class: 'statbar' }, h('i', { style: `width:${(pa / tot) * 100}%;background:${colA}` }), h('i', { style: `width:${(pb / tot) * 100}%;background:${colB}` })));
}

export function heatCanvas(heat: Float32Array, color: string): HTMLCanvasElement {
  const c = h('canvas', { width: 300, height: 200, style: 'width:100%;border-radius:8px;background:#14301c' }) as HTMLCanvasElement;
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
  const c = h('canvas', { width: 300, height: 200, style: 'width:100%;border-radius:8px;background:#14301c' }) as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,.3)'; g.strokeRect(1, 1, 298, 198); g.beginPath(); g.moveTo(150, 0); g.lineTo(150, 200); g.stroke();
  const dir = m.teams[side].dir;
  g.strokeStyle = color; g.globalAlpha = 0.35; g.lineWidth = 1;
  for (const p of m.passMap) {
    if (p.side !== side) continue;
    // normalise by attacking direction of the half the pass was played in (approx using current dir)
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
    h('tr', null, h('td', null, r.name + (r.goals ? ` ⚽${r.goals}` : '')), h('td', { style: 'text-align:right' }, r.rating.toFixed(1))))));
  const shootout = m.shootout ? h('div', { class: 'muted', style: 'text-align:center' }, `Penalties ${m.shootout.score[0]} – ${m.shootout.score[1]}`) : null;
  const heats = h('div', { class: 'split' }, h('div', null, h('h3', null, `${A.short} heat map`), heatCanvas(m.heat[0], ca)), h('div', null, h('h3', null, `${B.short} heat map`), heatCanvas(m.heat[1], cb)));
  const maps = h('div', { class: 'split' }, h('div', null, h('h3', null, `${A.short} pass map`), passMapCanvas(m, 0, ca)), h('div', null, h('h3', null, `${B.short} pass map`), passMapCanvas(m, 1, cb)));
  return h('div', { class: 'col' },
    h('div', { class: 'row', style: 'justify-content:center;gap:28px' }, h('h2', null, A.name), h('div', { class: 'hero-title' }, `${A.goals} – ${B.goals}`), h('h2', null, B.name)),
    h('div', { class: 'muted', style: 'text-align:center' }, title), shootout,
    h('div', null, rows), mom ? h('div', { class: 'card' }, h('h3', null, 'Man of the match'), h('div', null, `${mom.name} — ${mom.rating.toFixed(1)}`)) : null,
    h('div', { class: 'split' }, h('div', null, h('h3', null, A.short), ratingTable(0)), h('div', null, h('h3', null, B.short), ratingTable(1))), heats, maps, ...(extra ?? []),
    h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'btn primary', onclick: onClose }, closeLabel)));
}

export function lineupPanel(m: Match): HTMLElement {
  const col = (side: Side): HTMLElement => {
    const t = m.teams[side];
    return h('div', { class: 'tm' }, h('h2', { style: `color:${t.kit.primary}` }, t.name), h('div', { class: 'muted' }, t.formation.name),
      t.players.map((p) => h('div', null, h('span', { class: 'no' }, p.data.number), p.data.name, h('span', { class: 'muted' }, `  ${p.data.overall}`))));
  };
  return h('div', { class: 'lineup' }, h('div', { class: 'col', style: 'align-items:center' }, h('div', { class: 'cols' }, col(0), h('div', { class: 'hero-title', style: 'align-self:center' }, 'VS'), col(1)), h('div', { class: 'muted' }, 'Press any button to start')));
}

export function subsPanel(m: Match, side: Side, onDone: () => void): HTMLElement {
  const t = m.teams[side];
  let off: MPlayer | null = null;
  const left = m.cfg.maxSubs - t.subsMade;
  const list = h('div', { class: 'col', style: 'gap:6px' });
  const benchList = h('div', { class: 'col', style: 'gap:6px' });
  const info = h('div', { class: 'muted' }, `${left} substitution${left === 1 ? '' : 's'} left · ${m.cfg.subWindows - m.windowsUsedFor(side)} windows`);
  const renderBench = (): void => {
    clear(benchList);
    for (const b of t.bench) {
      benchList.appendChild(h('button', {
        class: 'btn', onclick: (): void => {
          if (!off) { toast('Select a player to replace first'); return; }
          if (m.phase === 'play') { m.queueSub(side, off, b); toast(`${b.shortName} will come on at the next stoppage`); }
          else if (!m.substitute(side, off, b)) { toast('No substitutions available'); return; }
          audio.ui('confirm'); onDone();
        },
      }, `${b.number} ${b.shortName}`, h('span', { class: 'pill' }, `${b.positions[0]} · ${b.overall}`)));
    }
  };
  const renderOn = (): void => {
    clear(list);
    for (const p of t.players.filter((q) => q.active())) {
      list.appendChild(h('button', { class: 'btn' + (off === p ? ' primary' : ''), onclick: (): void => { off = p; renderOn(); } },
        `${p.data.number} ${p.data.shortName}`, h('span', { class: 'pill' }, p.slotPos), h('span', { class: p.stamina < 0.4 ? 'pill bad' : p.stamina < 0.65 ? 'pill warn' : 'pill accent' }, `${Math.round(p.stamina * 100)}%`)));
    }
  };
  renderOn(); renderBench();
  return h('div', { class: 'col' }, h('h2', null, 'Substitutions'), info, h('div', { class: 'split' }, h('div', { class: 'col' }, h('h3', null, 'On the pitch'), list), h('div', { class: 'col' }, h('h3', null, 'Bench'), benchList)),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: onDone }, 'Back')));
}

export function tacticsPanel(m: Match, side: Side, onDone: () => void): HTMLElement {
  const t = m.teams[side];
  const slider = (label: string, key: 'lineHeight' | 'compactness' | 'width' | 'pressing' | 'tempo' | 'directness'): HTMLElement =>
    h('div', { class: 'field' }, h('label', null, label), h('input', { type: 'range', min: 0, max: 100, value: t.tactics[key], oninput: (e: Event): void => { t.tactics[key] = Number((e.target as HTMLInputElement).value); } }));
  const formation = h('select', { onchange: (e: Event): void => m.setFormation(side, (e.target as HTMLSelectElement).value) }, FORMATIONS.map((f) => h('option', { value: f.id, selected: f.id === t.formation.id }, f.name)));
  return h('div', { class: 'col' }, h('h2', null, 'Tactics'),
    h('div', { class: 'field' }, h('label', null, 'Formation'), formation),
    h('div', { class: 'split' }, slider('Defensive line', 'lineHeight'), slider('Compactness', 'compactness'), slider('Width', 'width'), slider('Pressing', 'pressing'), slider('Tempo', 'tempo'), slider('Directness', 'directness')),
    h('div', { class: 'row' }, h('label', { class: 'row' }, h('input', { class: 'toggle', type: 'checkbox', checked: t.tactics.offsideTrap, onchange: (e: Event): void => { t.tactics.offsideTrap = (e.target as HTMLInputElement).checked; } }), 'Offside trap'),
      h('select', { onchange: (e: Event): void => { t.tactics.marking = (e.target as HTMLSelectElement).value as 'zonal'; } }, ['zonal', 'mixed', 'man'].map((k) => h('option', { value: k, selected: t.tactics.marking === k }, `${k} marking`)))),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: onDone }, 'Back')));
}
