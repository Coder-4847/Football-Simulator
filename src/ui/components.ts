import { h, clear } from './dom';
import type { Formation, Player, Pos, Tactics } from '../data/types';
import { FORMATIONS, STYLE_TACTICS } from '../data/formations';
import { ratingAt, POS_GROUP } from '../data/rating';
import { audio } from '../audio/engine';

// ------------------------------------------------------------------ icons
const P = (d: string): string => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const ICONS: Record<string, string> = {
  home: P('M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10'),
  squad: P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8'),
  tactics: P('M4 4h16v16H4zM12 4v16M4 12h16M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0'),
  transfer: P('M7 7h13l-4-4M17 17H4l4 4M20 7l-4 4M4 17l4-4'),
  scout: P('M21 21l-4.3-4.3M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0'),
  finance: P('M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'),
  youth: P('M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.8 5.5 21l2-7.5L2 9h7z'),
  calendar: P('M3 9h18M7 3v4M17 3v4M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2'),
  table: P('M3 5h18M3 12h18M3 19h18M8 3v18'),
  board: P('M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z'),
  news: P('M4 4h16v16H4zM8 9h8M8 13h8M8 17h5'),
  play: P('M7 4l13 8-13 8z'), pause: P('M8 5v14M16 5v14'), ff: P('M3 5l8 7-8 7zM13 5l8 7-8 7z'), skip: P('M4 5l10 7-10 7zM18 5v14'),
  settings: P('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1'),
  trophy: P('M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3'),
  bolt: P('M13 2L4 14h7l-1 8 9-12h-7z'), info: P('M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'),
  career: P('M2 7h20v13H2zM8 7V4h8v3M2 13h20'), cup: P('M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z'), versus: P('M4 4l7 7M20 4l-7 7M4 20l7-7M20 20l-7-7'),
  save: P('M5 3h11l4 4v14H5zM8 3v5h7M8 21v-7h8v7'), exit: P('M9 21H5V3h4M16 17l5-5-5-5M21 12H9'), check: P('M5 12l5 5 9-10'), x: P('M6 6l12 12M18 6L6 18'), plus: P('M12 5v14M5 12h14'),
  chevron: P('M9 6l6 6-6 6'), stats: P('M4 20V10M10 20V4M16 20v-8M22 20H2'), sub: P('M7 7h13l-4-4M17 17H4l4 4'), users: P('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'),
};
export function icon(name: string, cls = ''): HTMLElement {
  const e = h('span', { class: `ico ${cls}`.trim() }); e.innerHTML = ICONS[name] ?? ''; return e;
}

// ------------------------------------------------------------------ crest
interface KitLike { primary: string; secondary: string; pattern?: string }
let crestId = 0;
export function crestSvg(k: KitLike): string {
  const id = `cr${crestId++}`;
  const p = k.primary, s = k.secondary;
  let pat = '';
  switch (k.pattern) {
    case 'stripes': pat = [0, 1, 2, 3, 4].map((i) => `<rect x="${4 + i * 8.4}" y="0" width="4.2" height="60" fill="${s}"/>`).join(''); break;
    case 'hoops': pat = [0, 1, 2, 3].map((i) => `<rect x="0" y="${8 + i * 12}" width="50" height="6" fill="${s}"/>`).join(''); break;
    case 'halves': pat = `<rect x="25" y="0" width="25" height="60" fill="${s}"/>`; break;
    case 'sash': pat = `<path d="M0 10L12 0H26L0 32zM50 28L50 50L28 60L18 60z" fill="${s}" opacity="0"/><path d="M0 14L50 46V34L0 2z" fill="${s}"/>`; break;
    case 'checks': pat = [0, 1, 2, 3, 4].flatMap((i) => [0, 1, 2, 3, 4].filter((j) => (i + j) % 2 === 0).map((j) => `<rect x="${i * 10}" y="${j * 12}" width="10" height="12" fill="${s}"/>`)).join(''); break;
    case 'chevron': pat = `<path d="M0 22L25 38L50 22V32L25 48L0 32z" fill="${s}"/>`; break;
    default: pat = `<rect x="0" y="40" width="50" height="8" fill="${s}" opacity=".9"/>`;
  }
  return `<svg viewBox="0 0 50 58" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="${id}"><path d="M25 2L46 8V30C46 44 36 52 25 56C14 52 4 44 4 30V8Z"/></clipPath><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient></defs><g clip-path="url(#${id})"><rect width="50" height="58" fill="${p}"/>${pat}<rect width="50" height="58" fill="url(#${id}g)"/></g><path d="M25 2L46 8V30C46 44 36 52 25 56C14 52 4 44 4 30V8Z" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
}
export function crest(k: KitLike, size = 0): HTMLElement {
  const e = h('span', { class: 'crest', style: size ? `width:${size}px;height:${Math.round(size * 1.16)}px` : undefined }); e.innerHTML = crestSvg(k); return e;
}

/** The product mark: a shield with pitch lines. */
export function logoMark(): HTMLElement {
  const e = h('span');
  e.innerHTML = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2ee6a6"/><stop offset="1" stop-color="#2aa8ff"/></linearGradient></defs><path d="M32 3L58 11V34C58 49 46 58 32 62C18 58 6 49 6 34V11Z" fill="url(#lg)"/><path d="M32 3L58 11V34C58 49 46 58 32 62C18 58 6 49 6 34V11Z" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1.5"/><g fill="none" stroke="#03231a" stroke-width="2.4" stroke-linecap="round"><path d="M14 22H50M14 44H50"/><circle cx="32" cy="33" r="7.5"/><path d="M32 22V44"/></g><circle cx="32" cy="33" r="2.6" fill="#03231a"/></svg>`;
  return e;
}
export function logo(): HTMLElement {
  return h('div', { class: 'logo' }, logoMark(), h('div', { class: 'word' }, 'Football', h('b', null, 'Simulator'), h('small', null, 'MANAGER')));
}

// ------------------------------------------------------------------ small bits
export const tierOf = (ovr: number): number => (ovr >= 82 ? 4 : ovr >= 74 ? 3 : ovr >= 66 ? 2 : ovr >= 58 ? 1 : 0);
export function ovrBadge(ovr: number): HTMLElement { return h('span', { class: `ovr-badge t${tierOf(ovr)}` }, ovr); }
export function posTag(pos: Pos | string): HTMLElement { return h('span', { class: `pos-tag ${pos === 'GK' ? 'GK' : (POS_GROUP as Record<string, string>)[pos] ?? ''}` }, pos); }

export function formationDiagram(f: Formation): HTMLElement {
  const d = h('div', { class: 'fd' });
  for (const s of f.slots) d.appendChild(h('i', { style: `left:${s.y * 100}%;top:${(1 - s.x) * 100}%${s.pos === 'GK' ? ';background:#ffc857' : ''}` }));
  return d;
}

export function formationPicker(current: string, onPick: (id: string) => void): HTMLElement {
  const grid = h('div', { class: 'fgrid' });
  const draw = (cur: string): void => {
    clear(grid);
    for (const f of FORMATIONS) grid.appendChild(h('div', { class: 'fcard' + (f.id === cur ? ' on' : ''), onclick: (): void => { audio.ui('click'); onPick(f.id); draw(f.id); } }, formationDiagram(f), h('div', { class: 'nm' }, f.name)));
  };
  draw(current);
  return grid;
}

export function playerCardEl(p: Player, o: { onClick?: () => void; club?: string; extra?: Array<HTMLElement | null>; ovr?: string | number; color?: string } = {}): HTMLElement {
  const tier = p.overall >= 78 ? 'gold-tier' : p.overall >= 68 ? 'silver-tier' : 'bronze-tier';
  const flags: Array<HTMLElement | null> = [p.injuredUntil ? h('span', { class: 'pill bad' }, `✚ ${p.injuredUntil}w`) : null, p.suspended ? h('span', { class: 'pill warn' }, 'Susp') : null];
  return h('div', { class: `pc ${tier}`, style: `--c1:${o.color ?? 'var(--accent)'}`, onclick: o.onClick },
    h('div', { class: 'band' }),
    h('div', { class: 'top' }, h('div', { class: 'ovr' }, o.ovr ?? p.overall), h('div', null, posTag(p.positions[0]!), h('div', { class: 'pos', style: 'margin-top:3px' }, `#${p.number} · ${p.age}y`))),
    h('div', { class: 'nm' }, p.name),
    h('div', { class: 'meta' }, ...flags, ...(o.extra ?? []), o.club ? h('span', { class: 'pill' }, o.club) : null));
}

// ------------------------------------------------------------------ tactics
const STYLE_INFO: Record<string, string> = {
  balanced: 'An even approach with no real weakness.', possession: 'Patient passing, high line, control the game.', counter: 'Sit deep, win it, strike fast on the break.',
  highPress: 'Squeeze them high and win it back instantly.', longBall: 'Go direct to the forwards and fight for second balls.', park: 'Defend deep and protect what you have.',
};
const SLIDERS: Array<{ k: 'lineHeight' | 'compactness' | 'width' | 'pressing' | 'tempo' | 'directness'; label: string; lo: string; hi: string }> = [
  { k: 'lineHeight', label: 'Defensive line', lo: 'Deep', hi: 'High' }, { k: 'compactness', label: 'Compactness', lo: 'Spread', hi: 'Tight' }, { k: 'width', label: 'Width', lo: 'Narrow', hi: 'Wide' },
  { k: 'pressing', label: 'Pressing', lo: 'Passive', hi: 'Aggressive' }, { k: 'tempo', label: 'Tempo', lo: 'Patient', hi: 'Fast' }, { k: 'directness', label: 'Passing', lo: 'Short', hi: 'Direct' },
];

export function tacticsEditor(t: Tactics, onChange: () => void): HTMLElement {
  const root = h('div', { class: 'col' });
  const draw = (): void => {
    clear(root);
    root.append(
      h('div', { class: 'col', style: 'gap:8px' }, h('h3', null, 'Style'),
        h('div', { class: 'grid-3', style: 'gap:8px' }, (Object.keys(STYLE_TACTICS) as Array<Tactics['style']>).map((k) => h('div', { class: 'style-card' + (t.style === k ? ' on' : ''), onclick: (): void => { Object.assign(t, STYLE_TACTICS[k], { style: k }); audio.ui('click'); onChange(); draw(); } }, h('div', { class: 'nm' }, k === 'highPress' ? 'High press' : k === 'longBall' ? 'Long ball' : k === 'park' ? 'Park the bus' : k), h('div', { class: 'ds' }, STYLE_INFO[k]))))),
      h('div', { class: 'col', style: 'gap:10px' }, h('h3', null, 'Instructions'),
        h('div', { class: 'split', style: 'gap:14px 26px' }, SLIDERS.map((s) => {
          const val = h('span', null, String(t[s.k]));
          return h('div', { class: 'slider-row' }, h('div', { class: 'lbl' }, s.label, val),
            h('input', { type: 'range', min: 0, max: 100, value: t[s.k], oninput: (e: Event): void => { t[s.k] = Number((e.target as HTMLInputElement).value); val.textContent = String(t[s.k]); onChange(); } }),
            h('div', { class: 'ends' }, h('span', null, s.lo), h('span', null, s.hi)));
        }))),
      h('div', { class: 'row wrap', style: 'gap:22px' },
        h('label', { class: 'row', style: 'gap:10px' }, h('input', { class: 'toggle', type: 'checkbox', checked: t.offsideTrap, onchange: (e: Event): void => { t.offsideTrap = (e.target as HTMLInputElement).checked; onChange(); } }), 'Offside trap'),
        h('div', { class: 'seg' }, (['zonal', 'mixed', 'man'] as const).map((k) => h('button', { class: t.marking === k ? 'on' : '', onclick: (): void => { t.marking = k; onChange(); draw(); } }, `${k[0]!.toUpperCase()}${k.slice(1)} marking`)))));
  };
  draw();
  return root;
}

// ------------------------------------------------------------------ lineup editor
export interface LineupEditorOpts {
  squad: Player[];
  formation: Formation;
  starters: string[];
  kit: { primary: string; secondary: string };
  onChange: (starters: string[]) => void;
  /** optional cap for bench list */
  benchLimit?: number;
}

const GROUPS: Array<[string, string]> = [['ALL', 'All'], ['GK', 'GK'], ['DEF', 'DEF'], ['MID', 'MID'], ['ATT', 'ATT']];
const groupOf = (p: Player): string => (p.positions[0] === 'GK' ? 'GK' : ((POS_GROUP as Record<string, string>)[p.positions[0]!] ?? 'MID'));
function lum(hex: string): number { const n = parseInt(hex.slice(1), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; }

/** Pitch with tokens: click or drag to swap players, click a reserve to bring them on. */
export function lineupEditor(o: LineupEditorOpts): HTMLElement {
  const root = h('div', { class: 'ed' });
  let selSlot: number | null = null;
  let selBench: string | null = null;
  let filter = 'ALL';
  const byId = new Map(o.squad.map((p) => [p.id, p]));
  const starters = [...o.starters];

  const commit = (): void => { o.starters.splice(0, o.starters.length, ...starters); o.onChange([...starters]); };
  const swapSlots = (a: number, b: number): void => { const t = starters[a]!; starters[a] = starters[b]!; starters[b] = t; selSlot = null; selBench = null; audio.ui('click'); commit(); draw(); };
  const bringOn = (slot: number, id: string): void => { starters[slot] = id; selSlot = null; selBench = null; audio.ui('confirm'); commit(); draw(); };

  const lines = h('div'); lines.innerHTML = `<svg class="lines" viewBox="0 0 68 100" preserveAspectRatio="none"><rect x="1" y="1" width="66" height="98"/><path d="M1 50H67"/><circle cx="34" cy="50" r="9.15"/><rect x="13.8" y="1" width="40.3" height="16.5"/><rect x="24.8" y="1" width="18.3" height="5.5"/><rect x="13.8" y="82.5" width="40.3" height="16.5"/><rect x="24.8" y="93.5" width="18.3" height="5.5"/><path d="M26.5 17.5A9.15 9.15 0 0 0 41.5 17.5"/><path d="M26.5 82.5A9.15 9.15 0 0 1 41.5 82.5"/></svg>`;
  const pitch = h('div', { class: 'pitch-ed' }, lines.firstChild as Node);
  const side = h('div', { class: 'col', style: 'gap:12px' });
  root.append(pitch, side);

  function startDrag(ev: PointerEvent, slot: number, el: HTMLElement): void {
    if (ev.button !== 0) return;
    const sx = ev.clientX, sy = ev.clientY;
    let dragging = false;
    const move = (e: PointerEvent): void => {
      if (!dragging && Math.hypot(e.clientX - sx, e.clientY - sy) > 6) { dragging = true; el.classList.add('drag'); }
      if (!dragging) return;
      el.style.translate = `${e.clientX - sx}px ${e.clientY - sy}px`;
      pitch.querySelectorAll('.tok.over').forEach((n) => n.classList.remove('over'));
      const under = document.elementsFromPoint(e.clientX, e.clientY).find((n) => (n as HTMLElement).dataset?.slot !== undefined && n !== el) as HTMLElement | undefined;
      under?.classList.add('over');
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!dragging) { onTokenClick(slot); return; }
      el.classList.remove('drag'); el.style.translate = '';
      const hit = document.elementsFromPoint(e.clientX, e.clientY);
      const tok = hit.find((n) => (n as HTMLElement).dataset?.slot !== undefined && n !== el) as HTMLElement | undefined;
      const row = hit.find((n) => (n as HTMLElement).dataset?.bench !== undefined) as HTMLElement | undefined;
      if (tok) swapSlots(slot, Number(tok.dataset.slot));
      else if (row) bringOn(slot, row.dataset.bench!);
      else draw();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function onTokenClick(slot: number): void {
    if (selBench) { bringOn(slot, selBench); return; }
    if (selSlot === null) { selSlot = slot; audio.ui('click'); draw(); return; }
    if (selSlot === slot) { selSlot = null; draw(); return; }
    swapSlots(selSlot, slot);
  }

  function draw(): void {
    pitch.querySelectorAll('.tok').forEach((n) => n.remove());
    o.formation.slots.forEach((slot, i) => {
      const p = byId.get(starters[i]!);
      if (!p) return;
      const fit = ratingAt(p, slot.pos);
      const out = p.injuredUntil > 0 || p.suspended > 0;
      const gk = slot.pos === 'GK';
      const col = gk ? '#f2b705' : o.kit.primary;
      const tok = h('div', { class: 'tok' + (selSlot === i ? ' sel' : '') + (out ? ' bad' : ''), 'data-slot': i, style: `left:${slot.y * 100}%;top:${(1 - slot.x) * 100}%` },
        h('div', { class: 'disc', style: `background:${col};color:${lum(col) > 0.55 ? '#06101a' : '#fff'}` }, String(p.number), h('span', { class: 'rt', style: `color:${fit >= 75 ? '#2ee6a6' : fit >= 62 ? '#ffc857' : '#ff5d73'}` }, fit), out ? h('span', { class: 'flag' }, p.injuredUntil ? '✚' : '⛔') : null),
        h('div', { class: 'nm' }, p.shortName), h('div', { class: 'ps' }, slot.pos));
      tok.addEventListener('pointerdown', (e) => startDrag(e, i, tok));
      pitch.appendChild(tok);
    });
    // reserves
    clear(side);
    const bench = o.squad.filter((p) => !starters.includes(p.id)).filter((p) => filter === 'ALL' || groupOf(p) === filter).sort((a, b) => (a.injuredUntil > 0 ? 1 : 0) - (b.injuredUntil > 0 ? 1 : 0) || b.overall - a.overall);
    const slotPos = selSlot !== null ? o.formation.slots[selSlot]!.pos : null;
    side.append(
      h('div', { class: 'row wrap', style: 'justify-content:space-between' }, h('h3', null, selSlot !== null ? `Replace ${byId.get(starters[selSlot]!)?.shortName ?? ''}` : selBench ? 'Choose who they replace' : 'Reserves'),
        h('div', { class: 'seg' }, GROUPS.map(([k, l]) => h('button', { class: filter === k ? 'on' : '', onclick: (): void => { filter = k; draw(); } }, l)))),
      h('div', { class: 'muted', style: 'font-size:12.5px' }, 'Tap a player then another to swap. Drag tokens, or tap a reserve then a token to bring them on. The small number is how well the player fits the position.'),
      h('div', { class: 'col', style: 'gap:6px;max-height:520px;overflow:auto;padding-right:4px' }, bench.slice(0, o.benchLimit ?? 40).map((p) => {
        const fit = slotPos ? ratingAt(p, slotPos) : p.overall;
        const out = p.injuredUntil > 0 || p.suspended > 0;
        const row = h('div', { class: 'bench-row' + (selBench === p.id ? ' sel' : '') + (out ? ' out' : ''), 'data-bench': p.id, onclick: (): void => { if (selSlot !== null) { bringOn(selSlot, p.id); return; } selBench = selBench === p.id ? null : p.id; audio.ui('click'); draw(); } },
          posTag(p.positions[0]!), h('div', { class: 'grow' }, h('div', { class: 'nm' }, p.name), h('div', { class: 'sub' }, `${p.age}y · fit ${Math.round(p.fitness)}%${p.injuredUntil ? ` · injured ${p.injuredUntil}w` : ''}${p.suspended ? ' · suspended' : ''}${p.positions.length > 1 ? ` · also ${p.positions.slice(1, 3).join('/')}` : ''}`)), ovrBadge(fit));
        return row;
      })));
  }
  draw();
  return root;
}

// ------------------------------------------------------------------ comparison bars
export function compareBlock(a: { name: string; ovr: number; att: number; mid: number; def: number; gk: number }, b: { name: string; ovr: number; att: number; mid: number; def: number; gk: number }, ca: string, cb: string): HTMLElement {
  const rows: Array<[string, number, number]> = [['ATT', a.att, b.att], ['MID', a.mid, b.mid], ['DEF', a.def, b.def], ['GK', a.gk, b.gk], ['OVR', a.ovr, b.ovr]];
  const g = h('div', { class: 'compare' });
  for (const [k, x, y] of rows) g.append(
    h('div', { class: 'a' }, h('b', null, x), h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, x)}%;background:${x >= y ? ca : 'rgba(255,255,255,.28)'}` }))), h('div', { class: 'k' }, k),
    h('div', { class: 'b' }, h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, y)}%;background:${y >= x ? cb : 'rgba(255,255,255,.28)'}` })), h('b', null, y)));
  return g;
}

export function formDots(form: Array<'W' | 'D' | 'L'>): HTMLElement { return h('div', { class: 'row', style: 'gap:5px' }, form.length ? form.map((r) => h('span', { class: `form-dot ${r}` }, r)) : h('span', { class: 'muted' }, '—')); }
