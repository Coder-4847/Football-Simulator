import { RNG } from '../core/rng';
import { clamp } from '../core/math';
import { makeCityName, makeClubName, makeName, makeStadiumName, NATION_DEFS, shortCode } from './names';
import { makeTactics, FORMATIONS } from './formations';
import { overallFor, playerValue, POS_WEIGHTS, RELATED, wageFor } from './rating';
import { ATTR_KEYS, TRAITS } from './types';
import type { AttrKey, Attrs, Club, Kit, KitPattern, League, Nation, Player, Pos, Trait, WorkRate, World } from './types';

export const START_YEAR = 2026;

const PATTERNS: KitPattern[] = ['solid', 'stripes', 'hoops', 'halves', 'sash', 'checks', 'pinstripe', 'chevron'];

function hsl(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${x(f(0))}${x(f(8))}${x(f(4))}`;
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function generateKits(rng: RNG): { home: Kit; away: Kit } {
  const hue = rng.int(0, 359);
  const primary = hsl(hue, rng.int(55, 85), rng.int(28, 50));
  const accentPool = [hsl((hue + 180) % 360, 70, 55), '#f8fafc', '#111827', hsl((hue + 40) % 360, 80, 60)];
  const secondary = rng.pick(accentPool);
  const pattern = rng.weighted(PATTERNS, (p) => (p === 'solid' ? 3 : p === 'stripes' || p === 'hoops' ? 2.2 : 1));
  const shorts = rng.chance(0.5) ? '#f8fafc' : rng.chance(0.5) ? '#111827' : primary;
  const home: Kit = { primary, secondary, shorts, socks: rng.chance(0.6) ? primary : secondary, pattern };
  const light = luminance(primary) > 0.5;
  const aHue = (hue + rng.int(90, 270)) % 360;
  const aPrimary = light ? hsl(aHue, 60, 24) : rng.chance(0.6) ? '#f1f5f9' : hsl(aHue, 70, 62);
  const away: Kit = {
    primary: aPrimary, secondary: luminance(aPrimary) > 0.5 ? '#111827' : '#f8fafc',
    shorts: luminance(aPrimary) > 0.5 ? '#111827' : '#f8fafc', socks: aPrimary,
    pattern: rng.chance(0.5) ? 'solid' : rng.pick(PATTERNS),
  };
  return { home, away };
}

const HEIGHT: Record<string, [number, number]> = { GK: [186, 6], CB: [186, 5], ST: [182, 6], CF: [180, 6], CDM: [180, 6], CM: [177, 6], CAM: [176, 6], LB: [176, 5], RB: [176, 5], LWB: [175, 5], RWB: [175, 5], LM: [174, 6], RM: [174, 6], LW: [174, 6], RW: [174, 6] };

const FLAIR_POS = new Set<Pos>(['LW', 'RW', 'CAM', 'LM', 'RM', 'CF']);

export function weightedPlayerPositionsSlots(): Pos[] {
  // 26-man senior squad composition
  return ['GK', 'GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'LB', 'LB', 'RB', 'RB', 'CDM', 'CDM', 'CM', 'CM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'LW', 'RW', 'RW', 'ST', 'ST', 'ST'];
}

export function generatePlayer(rng: RNG, nation: Nation, pos: Pos, target: number, opts: { age?: number; id: string; clubId?: string | null; season?: number }): Player {
  const age = opts.age ?? clamp(Math.round(rng.gauss(26, 4.2)), 16, 38);
  const nm = makeName(rng, nation.style);
  const key = POS_WEIGHTS[pos];
  const attrs = {} as Attrs;
  for (const k of ATTR_KEYS) {
    const isKey = key[k as AttrKey] !== undefined;
    const isGkAttr = k.startsWith('gk');
    let v: number;
    if (isGkAttr) v = pos === 'GK' ? target + rng.gauss(0, 4) : rng.int(8, 22);
    else if (pos === 'GK') v = rng.int(18, 48);
    else if (isKey) v = target + rng.gauss(0, 5);
    else v = target - rng.float(8, 30) + rng.gauss(0, 4);
    attrs[k] = clamp(Math.round(v), 5, 97);
  }
  // age effects: young players are less strong/more agile; old players slower
  if (age < 20) { attrs.strength = clamp(attrs.strength - 8, 5, 97); attrs.stamina = clamp(attrs.stamina - 4, 5, 97); }
  if (age > 31) { const d = (age - 31) * 2; attrs.acceleration = clamp(attrs.acceleration - d, 5, 97); attrs.sprintSpeed = clamp(attrs.sprintSpeed - d, 5, 97); }
  // calibrate so overall at primary position hits target
  for (let i = 0; i < 6; i++) {
    const delta = target - overallFor(attrs, pos);
    if (Math.abs(delta) < 1) break;
    for (const k in key) attrs[k as AttrKey] = clamp(Math.round(attrs[k as AttrKey] + delta), 5, 97);
  }
  const overall = overallFor(attrs, pos);
  const positions: Pos[] = [pos];
  const rel = RELATED[pos];
  if (rel.length && rng.chance(0.45)) positions.push(rng.pick(rel));
  const [hMean, hSd] = HEIGHT[pos] as [number, number];
  const heightCm = clamp(Math.round(rng.gauss(hMean, hSd)), 164, 203);
  const bmi = rng.gauss(22.8, 1.2) + (attrs.strength - 60) * 0.02;
  const weightKg = Math.round(bmi * Math.pow(heightCm / 100, 2));
  const bodyType = heightCm >= 188 ? 'tall' : bmi > 24 ? 'stocky' : bmi < 21.8 ? 'lean' : 'normal';
  const foot = rng.chance(0.27) ? 'L' : 'R';
  const dribbleBias = (attrs.dribbling + attrs.agility) / 2;
  const skillMoves = clamp(Math.round(1 + (dribbleBias - 40) / 12 + rng.gauss(0, 0.6) + (FLAIR_POS.has(pos) ? 0.5 : 0) - (pos === 'GK' || pos === 'CB' ? 1 : 0)), 1, 5);
  const weakFoot = clamp(Math.round(rng.gauss(3, 0.8) + (attrs.ballControl - 60) / 40), 1, 5);
  const workRate = (): WorkRate => rng.weighted<WorkRate>(['low', 'med', 'high'], (w) => (w === 'med' ? 3 : 1.5));
  const workAtt = pos === 'ST' || pos === 'LW' || pos === 'RW' ? rng.weighted<WorkRate>(['low', 'med', 'high'], (w) => (w === 'high' ? 3 : 2)) : workRate();
  const workDef = pos === 'CB' || pos === 'CDM' || pos === 'LB' || pos === 'RB' ? rng.weighted<WorkRate>(['low', 'med', 'high'], (w) => (w === 'high' ? 3 : 2)) : workRate();

  const traits: Trait[] = [];
  const addT = (t: Trait, cond: boolean, p = 0.7): void => { if (cond && traits.length < 3 && rng.chance(p)) traits.push(t); };
  addT('Finesse Shot', attrs.curve > 70 && attrs.finishing > 65);
  addT('Long Passer', attrs.longPass > 76);
  addT('Speed Dribbler', attrs.sprintSpeed > 82 && attrs.dribbling > 74);
  addT('Tackler', attrs.standingTackle > 78 && attrs.aggression > 65);
  addT('Aerial Threat', attrs.heading > 76 && attrs.jumping > 70);
  addT('Power Header', attrs.heading > 80 && attrs.strength > 74);
  addT('Long Shot Taker', attrs.longShots > 78);
  addT('Playmaker', attrs.vision > 80 && attrs.shortPass > 78);
  addT('Dead Ball Specialist', attrs.freeKick > 78);
  addT('Long Throw', pos !== 'GK' && attrs.strength > 74 && rng.chance(0.3));
  addT('Poacher', pos === 'ST' && attrs.finishing > 78);
  addT('Trivela', attrs.curve > 76 && attrs.crossing > 70);
  addT('Flair', skillMoves >= 4 && attrs.agility > 78);
  addT('Acrobatic', attrs.volleys > 78 && attrs.agility > 70);
  addT('Clinical Finisher', pos !== 'GK' && attrs.finishing > 84);
  addT('Rapid', attrs.sprintSpeed > 88);
  addT('Engine', attrs.stamina > 86);
  addT('Press Proven', attrs.ballControl > 78 && attrs.strength > 68);
  addT('Sweeper Keeper', pos === 'GK' && attrs.gkKicking > 70 && attrs.gkPositioning > 72);
  addT('Cross Claimer', pos === 'GK' && attrs.gkHandling > 78);
  addT('Penalty Saver', pos === 'GK' && attrs.gkDiving > 78);
  void TRAITS;

  const potential = clamp(Math.round(overall + (age < 24 ? Math.max(0, (24 - age) * rng.gauss(2.4, 1)) : rng.float(0, 2))), overall, 96);
  const value = playerValue(overall, age, potential);
  const season = opts.season ?? START_YEAR;
  const beard = rng.weighted([0, 1, 2], (b) => (b === 0 ? 5 : b === 1 ? 2 : 1.2));
  return {
    id: opts.id, name: nm.name, shortName: nm.shortName, nation: nation.id, age, heightCm, weightKg, bodyType, foot,
    weakFoot, skillMoves, workAtt, workDef, traits, positions, attrs, overall, potential, value, wage: wageFor(value, overall),
    contractEnd: season + rng.int(1, 5), number: 0,
    look: {
      skin: rng.weighted([0, 1, 2, 3, 4, 5], (i) => [3, 3, 2.5, 2, 1.5, 1.2][i] ?? 1),
      hairStyle: rng.weighted([0, 1, 2, 3, 4, 5, 6], (i) => [0.6, 5, 2.5, 1.2, 1, 1, 0.4][i] ?? 1),
      hairColor: rng.int(0, 5), beard, bootColor: rng.int(0, 5), tattoo: rng.chance(0.3), sleeves: rng.chance(0.08),
    },
    clubId: opts.clubId ?? null, morale: 70, fitness: 100, injuredUntil: 0, form: 0,
    goals: 0, assists: 0, apps: 0, yellow: 0, red: 0, suspended: 0,
  };
}

export function assignShirtNumbers(players: Player[]): void {
  const prefs: Record<Pos, number[]> = {
    GK: [1, 13, 12, 25], CB: [4, 5, 15, 6, 14], LB: [3, 16, 21], RB: [2, 12, 22], LWB: [3, 16], RWB: [2, 22], CDM: [6, 8, 18], CM: [8, 10, 14, 20, 23], CAM: [10, 8, 17],
    LM: [11, 19, 24], RM: [7, 17, 26], LW: [11, 19, 24], RW: [7, 17, 26], CF: [9, 10, 18], ST: [9, 19, 20, 27],
  };
  const used = new Set<number>();
  const sorted = [...players].sort((a, b) => b.overall - a.overall);
  for (const p of sorted) {
    const pos = p.positions[0] as Pos;
    let n = (prefs[pos] ?? []).find((x) => !used.has(x)) ?? 0;
    if (!n) { n = 30; while (used.has(n)) n++; }
    used.add(n);
    p.number = n;
  }
}

export function generateSquad(rng: RNG, nation: (rng: RNG) => Nation, clubId: string, quality: number, idStart: number, season = START_YEAR): Player[] {
  const slots = weightedPlayerPositionsSlots();
  const counts: Record<string, number> = {};
  const out: Player[] = [];
  slots.forEach((pos, i) => {
    const depth = counts[pos] ?? 0;
    counts[pos] = depth + 1;
    const target = clamp(Math.round(quality - depth * 4 - (i > 18 ? 2 : 0) + rng.gauss(0, 3)), 35, 93);
    out.push(generatePlayer(rng, nation(rng), pos, target, { id: `p${idStart + i}`, clubId, season }));
  });
  assignShirtNumbers(out);
  return out;
}

export interface WorldOptions { seed?: string; clubNations?: number; clubsPerLeague?: number; tiers?: number }

/** Generates a complete fictional world. Deterministic for a given seed. */
export function generateWorld(opts: WorldOptions = {}): World {
  const seed = opts.seed ?? 'football-simulator';
  const rng = new RNG(`world:${seed}`);
  const clubNationCount = opts.clubNations ?? 5;
  const perLeague = opts.clubsPerLeague ?? 16;
  const tiers = opts.tiers ?? 2;

  const nations: Record<string, Nation> = {};
  for (const n of NATION_DEFS) nations[n.id] = { ...n, strength: clamp(Math.round(rng.gauss(62, 10)), 38, 85) };
  const nationIds = Object.keys(nations);
  const clubNationIds = rng.shuffle([...nationIds]).slice(0, clubNationCount);

  const leagues: Record<string, League> = {};
  const clubs: Record<string, Club> = {};
  const players: Record<string, Player> = {};
  const usedNames = new Set<string>();
  const usedCodes = new Set<string>();
  let pid = 0;
  let cid = 0;

  for (const nid of clubNationIds) {
    const nation = nations[nid] as Nation;
    const domestic = (r: RNG): Nation => (r.chance(0.68) ? nation : (nations[r.pick(nationIds)] as Nation));
    for (let tier = 1; tier <= tiers; tier++) {
      const leagueId = `${nid}-${tier}`;
      const names = ['First Division', 'Second Division', 'Third Division'];
      const league: League = {
        id: leagueId, name: `${nation.demonym} ${names[tier - 1] ?? 'Division ' + tier}`, nation: nid, tier, clubs: [],
        promotionSpots: tier > 1 ? 3 : 0, relegationSpots: tier < tiers ? 3 : 0,
      };
      for (let i = 0; i < perLeague; i++) {
        const city = makeCityName(rng);
        const nm = makeClubName(rng, city, usedNames);
        const reputation = clamp(Math.round((tier === 1 ? 72 : 48) - (i / perLeague) * (tier === 1 ? 38 : 28) + rng.gauss(0, 6)), 8, 98);
        const kits = generateKits(rng);
        const quality = clamp(54 + reputation * 0.3 + (tier === 1 ? 2 : 0), 45, 86);
        const id = `c${cid++}`;
        const styleKey = rng.weighted(['balanced', 'possession', 'counter', 'highPress', 'longBall', 'balanced'] as const, () => 1);
        const formation = rng.pick(FORMATIONS.slice(0, 7)).id;
        const squad = generateSquad(rng, domestic, id, quality, pid);
        pid += squad.length;
        for (const p of squad) players[p.id] = p;
        const budget = Math.round((Math.pow(reputation / 100, 2.4) * 180_000_000 + 2_000_000) / 100_000) * 100_000;
        clubs[id] = {
          id, name: nm.name, short: shortCode(city, usedCodes), nickname: nm.nickname, nation: nid, leagueId, city,
          stadium: { name: makeStadiumName(rng, city), style: rng.int(0, 7), capacity: Math.round((6000 + reputation * 650 + rng.int(0, 4000)) / 100) * 100 },
          reputation, budget, wageBudget: Math.round(squad.reduce((s, p) => s + p.wage, 0) * 1.12),
          kits, squad: squad.map((p) => p.id), formation, tactics: makeTactics(styleKey),
          founded: rng.int(1860, 1995), youthRating: clamp(Math.round(reputation * 0.7 + rng.int(0, 30)), 10, 99), facilities: clamp(Math.round(reputation * 0.8 + rng.int(0, 20)), 10, 99),
        };
        league.clubs.push(id);
      }
      leagues[leagueId] = league;
    }
  }

  // free agents
  for (let i = 0; i < 160; i++) {
    const pos = rng.pick(weightedPlayerPositionsSlots());
    const nation = nations[rng.pick(nationIds)] as Nation;
    const p = generatePlayer(rng, nation, pos, clamp(Math.round(rng.gauss(58, 8)), 38, 78), { id: `p${pid++}`, clubId: null });
    p.number = 0;
    players[p.id] = p;
  }
  return { seed, nations, leagues, clubs, players };
}

/** National team squad for Tournament mode: deterministic from nation + world seed. */
export function generateNationalTeam(seed: string, nation: Nation): { club: Club; players: Player[] } {
  const rng = new RNG(`nat:${seed}:${nation.id}`);
  const id = `nat-${nation.id}`;
  const quality = clamp(nation.strength + 6, 50, 88);
  const squad = generateSquad(rng, () => nation, id, quality, 0).map((p, i) => ({ ...p, id: `${id}-${i}`, clubId: id }));
  const kits = generateKits(rng);
  kits.home.primary = nation.primary; kits.home.secondary = nation.secondary; kits.home.pattern = 'solid'; kits.home.socks = nation.primary;
  const club: Club = {
    id, name: nation.name, short: nation.id, nickname: nation.demonym, nation: nation.id, leagueId: 'intl', city: nation.name,
    stadium: { name: `${nation.name} National Stadium`, style: rng.int(0, 7), capacity: 60000 },
    reputation: nation.strength, budget: 0, wageBudget: 0, kits, squad: squad.map((p) => p.id), formation: rng.pick(FORMATIONS.slice(0, 5)).id,
    tactics: makeTactics('balanced'), founded: 1900, youthRating: 50, facilities: 50,
  };
  return { club, players: squad };
}
