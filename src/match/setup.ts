import type { Club, Player, World, Formation, Tactics } from '../data/types';
import { formationById } from '../data/formations';
import { ratingAt } from '../data/rating';
import type { TeamSetup } from './entities';

/** Picks the best XI for a formation (GK first, then greedy by slot) and a 9-man bench. */
export function pickLineup(players: Player[], formation: Formation): { starters: Player[]; bench: Player[] } {
  const avail = players.filter((p) => p.injuredUntil === 0 && p.suspended === 0);
  const used = new Set<string>();
  const starters: Player[] = new Array<Player>(formation.slots.length);
  // fill slots in order of "scarcity": GK first, then the rest by fewest natural candidates
  const order = formation.slots.map((s, i) => ({ s, i, nat: avail.filter((p) => p.positions.includes(s.pos)).length })).sort((a, b) => (a.s.pos === 'GK' ? -1 : b.s.pos === 'GK' ? 1 : a.nat - b.nat));
  for (const { s, i } of order) {
    let best: Player | null = null; let br = -1;
    for (const p of avail) {
      if (used.has(p.id)) continue;
      if (s.pos === 'GK' !== (p.positions[0] === 'GK')) continue;
      const r = ratingAt(p, s.pos) + p.form * 2 + (p.fitness - 100) * 0.1;
      if (r > br) { br = r; best = p; }
    }
    if (!best) best = avail.find((p) => !used.has(p.id)) ?? players.find((p) => !used.has(p.id))!;
    used.add(best.id);
    starters[i] = best;
  }
  const rest = avail.filter((p) => !used.has(p.id));
  const bench: Player[] = [];
  const gk = rest.filter((p) => p.positions[0] === 'GK').sort((a, b) => b.overall - a.overall)[0];
  if (gk) bench.push(gk);
  for (const p of rest.filter((q) => q !== gk).sort((a, b) => b.overall - a.overall)) { if (bench.length >= 9) break; bench.push(p); }
  return { starters, bench };
}

export function teamSetupFromClub(world: { clubs: Record<string, Club>; players: Record<string, Player> }, clubId: string, opts: { formation?: string; tactics?: Tactics; away?: boolean; lineup?: string[] } = {}): TeamSetup {
  const club = world.clubs[clubId]!;
  const players = club.squad.map((id) => world.players[id]!).filter(Boolean);
  const formation = formationById(opts.formation ?? club.formation);
  let starters: Player[]; let bench: Player[];
  if (opts.lineup && opts.lineup.length === 11) {
    const byId = new Map(players.map((p) => [p.id, p]));
    starters = opts.lineup.map((id) => byId.get(id)!);
    bench = players.filter((p) => !opts.lineup!.includes(p.id) && p.injuredUntil === 0).sort((a, b) => b.overall - a.overall).slice(0, 9);
  } else ({ starters, bench } = pickLineup(players, formation));
  const kit = opts.away ? club.kits.away : club.kits.home;
  return {
    clubId, name: club.name, short: club.short, formation, tactics: opts.tactics ?? club.tactics, starters, bench,
    kit: { primary: kit.primary, secondary: kit.secondary, shorts: kit.shorts, socks: kit.socks, pattern: kit.pattern },
    gkKit: { primary: opts.away ? '#16a34a' : '#f59e0b', secondary: '#111827' },
  };
}

export function worldSetup(world: World, homeId: string, awayId: string): [TeamSetup, TeamSetup] {
  const home = world.clubs[homeId]!, away = world.clubs[awayId]!;
  // away team switches kit if the home kit clashes
  const clash = Math.abs(parseInt(home.kits.home.primary.slice(1), 16) - parseInt(away.kits.home.primary.slice(1), 16)) < 0x300000;
  return [teamSetupFromClub(world, homeId), teamSetupFromClub(world, awayId, { away: clash })];
}
