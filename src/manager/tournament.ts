import { RNG } from '../core/rng';
import { NATION_DEFS } from '../data/names';
import { generateNationalTeam } from '../data/generate';
import type { Club, Nation, Player } from '../data/types';
import { simulateMatch, simTeamFor } from '../sim/engine';

export interface TFix { id: string; stage: string; a: string; b: string; played: boolean; ga?: number; gb?: number; pens?: [number, number] }
export interface Tournament {
  seed: string; type: 'knockout' | 'groups'; ids: string[]; user: string; groups: string[][]; fixtures: TFix[];
  phase: 'group' | 'ko' | 'done'; koRound: number; champion?: string; nations: Record<string, Nation>;
}

export const KO_NAMES: Record<number, string> = { 2: 'Final', 4: 'Semi-final', 8: 'Quarter-final', 16: 'Round of 16', 32: 'Round of 32' };

export function nationsFor(seed: string): Record<string, Nation> {
  const rng = new RNG(`nations:${seed}`);
  return Object.fromEntries(NATION_DEFS.map((n) => [n.id, { ...n, strength: Math.max(38, Math.min(86, Math.round(rng.gauss(62, 10)))) }]));
}

const teamCache = new Map<string, { club: Club; players: Player[] }>();
export function teamOf(t: Tournament, id: string): { club: Club; players: Player[] } {
  const k = `${t.seed}:${id}`;
  let v = teamCache.get(k);
  if (!v) { v = generateNationalTeam(t.seed, t.nations[id]!); teamCache.set(k, v); }
  return v;
}
export function playersMap(t: Tournament, ids: string[]): Record<string, Player> {
  const out: Record<string, Player> = {};
  for (const id of ids) for (const p of teamOf(t, id).players) out[p.id] = p;
  return out;
}

export function createTournament(o: { seed?: string; type: 'knockout' | 'groups'; size: number; user: string }): Tournament {
  const seed = o.seed ?? `t${Date.now()}`;
  const nations = nationsFor(seed);
  const rng = new RNG(`tour:${seed}`);
  const all = Object.keys(nations);
  const chosen = new Set<string>([o.user]);
  for (const id of rng.shuffle([...all])) { if (chosen.size >= o.size) break; chosen.add(id); }
  const ids = rng.shuffle([...chosen]);
  const t: Tournament = { seed, type: o.type, ids, user: o.user, groups: [], fixtures: [], phase: o.type === 'groups' ? 'group' : 'ko', koRound: 0, nations };
  if (o.type === 'groups') {
    const g = Math.max(1, Math.round(ids.length / 4));
    t.groups = Array.from({ length: g }, () => []);
    ids.forEach((id, i) => t.groups[i % g]!.push(id));
    t.groups.forEach((grp, gi) => { for (let i = 0; i < grp.length; i++) for (let j = i + 1; j < grp.length; j++) t.fixtures.push({ id: `g${gi}-${i}-${j}`, stage: `Group ${String.fromCharCode(65 + gi)}`, a: grp[i]!, b: grp[j]!, played: false }); });
  } else drawKnockout(t, ids);
  return t;
}

function drawKnockout(t: Tournament, ids: string[]): void {
  let n = 2; while (n < ids.length) n *= 2;
  const byStrength = [...ids].sort((a, b) => t.nations[b]!.strength - t.nations[a]!.strength);
  const slots: Array<string | null> = new Array(n).fill(null);
  // seeds get byes; pair strongest vs weakest
  const order: string[] = [];
  const lo = [...byStrength];
  while (lo.length) { order.push(lo.shift()!); if (lo.length) order.push(lo.pop()!); }
  const byes = n - ids.length;
  const top = byStrength.slice(0, byes);
  const rest = new RNG(`draw:${t.seed}`).shuffle(byStrength.slice(byes));
  const stage = KO_NAMES[n] ?? `Round of ${n}`;
  const next: string[] = [...top];
  for (let i = 0; i + 1 < rest.length; i += 2) t.fixtures.push({ id: `ko${n}-${i / 2}`, stage, a: rest[i]!, b: rest[i + 1]!, played: false });
  t.koRound = n;
  void slots; void order; void next;
  (t as Tournament & { byes?: string[] }).byes = top;
}

export function groupTable(t: Tournament, gi: number): Array<{ id: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }> {
  const grp = t.groups[gi]!;
  const rows = new Map(grp.map((id) => [id, { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const f of t.fixtures) {
    if (!f.played || !f.stage.startsWith('Group') || !grp.includes(f.a)) continue;
    const a = rows.get(f.a)!, b = rows.get(f.b)!;
    a.p++; b.p++; a.gf += f.ga!; a.ga += f.gb!; b.gf += f.gb!; b.ga += f.ga!;
    if (f.ga! > f.gb!) { a.w++; b.l++; a.pts += 3; } else if (f.ga! < f.gb!) { b.w++; a.l++; b.pts += 3; } else { a.d++; b.d++; a.pts++; b.pts++; }
  }
  return [...rows.values()].sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
}

export const pending = (t: Tournament): TFix[] => t.fixtures.filter((f) => !f.played);
export const userPending = (t: Tournament): TFix | null => pending(t).find((f) => f.a === t.user || f.b === t.user) ?? null;

export function simTournamentFixture(t: Tournament, f: TFix): void {
  const rng = new RNG(`tfix:${t.seed}:${f.id}`);
  const A = teamOf(t, f.a), B = teamOf(t, f.b);
  const pm = playersMap(t, [f.a, f.b]);
  const knock = !f.stage.startsWith('Group');
  const r = simulateMatch(simTeamFor(A.club, pm), simTeamFor(B.club, pm), rng, { neutral: true, knockout: knock });
  setResult(t, f, r.score[0], r.score[1], r.shootout);
}

export function setResult(t: Tournament, f: TFix, ga: number, gb: number, pens?: [number, number]): void {
  f.played = true; f.ga = ga; f.gb = gb; f.pens = pens;
  advanceIfRoundDone(t);
}

export function winnerOf(f: TFix, rng?: RNG): string {
  if (f.ga! > f.gb!) return f.a; if (f.gb! > f.ga!) return f.b;
  if (f.pens) return f.pens[0] > f.pens[1] ? f.a : f.b;
  return (rng ?? new RNG(f.id)).chance(0.5) ? f.a : f.b;
}

function advanceIfRoundDone(t: Tournament): void {
  if (pending(t).length) return;
  if (t.phase === 'group') {
    const adv: string[] = [];
    const tabs = t.groups.map((_, gi) => groupTable(t, gi));
    const g = t.groups.length;
    if (g === 1) { t.champion = tabs[0]![0]!.id; t.phase = 'done'; return; }
    for (let i = 0; i < g; i += 2) {
      const a = tabs[i]!, b = tabs[i + 1];
      if (b) { adv.push(a[0]!.id, b[1]?.id ?? b[0]!.id, b[0]!.id, a[1]?.id ?? a[0]!.id); } else adv.push(a[0]!.id, a[1]!.id);
    }
    t.phase = 'ko';
    let n = 2; while (n < adv.length) n *= 2;
    t.koRound = n;
    const stage = KO_NAMES[n] ?? `Round of ${n}`;
    for (let i = 0; i + 1 < adv.length; i += 2) t.fixtures.push({ id: `ko${n}-${i / 2}`, stage, a: adv[i]!, b: adv[i + 1]!, played: false });
    return;
  }
  if (t.phase === 'ko') {
    const round = t.fixtures.filter((f) => f.id.startsWith(`ko${t.koRound}-`));
    const winners = round.map((f) => winnerOf(f));
    const byes = (t as Tournament & { byes?: string[] }).byes ?? [];
    const pool = t.koRound === (Math.pow(2, Math.ceil(Math.log2(t.ids.length)))) && t.type === 'knockout' ? [...byes, ...winners] : winners;
    (t as Tournament & { byes?: string[] }).byes = [];
    if (pool.length === 1) { t.champion = pool[0]; t.phase = 'done'; return; }
    const n = pool.length;
    const nextN = n;
    t.koRound = nextN;
    const stage = KO_NAMES[nextN] ?? `Round of ${nextN}`;
    for (let i = 0; i + 1 < pool.length; i += 2) t.fixtures.push({ id: `ko${nextN}-${i / 2}`, stage, a: pool[i]!, b: pool[i + 1]!, played: false });
  }
}
