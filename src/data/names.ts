import { RNG } from '../core/rng';
import type { Nation } from './types';

/** Fictional nations. None map to a real country. `style` selects a name phonology. */
export const NATION_DEFS: Array<Omit<Nation, 'strength'>> = [
  { id: 'ALD', name: 'Aldoria', demonym: 'Aldorian', style: 0, primary: '#1d4ed8', secondary: '#f8fafc' },
  { id: 'BRV', name: 'Brevonia', demonym: 'Brevonian', style: 1, primary: '#b91c1c', secondary: '#fde68a' },
  { id: 'CAL', name: 'Calvaria', demonym: 'Calvarian', style: 2, primary: '#15803d', secondary: '#f8fafc' },
  { id: 'DRV', name: 'Dravenia', demonym: 'Dravenian', style: 3, primary: '#7c3aed', secondary: '#e5e7eb' },
  { id: 'ESK', name: 'Eskarland', demonym: 'Eskarlander', style: 4, primary: '#0e7490', secondary: '#f8fafc' },
  { id: 'FAL', name: 'Faldora', demonym: 'Faldoran', style: 0, primary: '#ea580c', secondary: '#111827' },
  { id: 'GOR', name: 'Gorvania', demonym: 'Gorvanian', style: 1, primary: '#be123c', secondary: '#f8fafc' },
  { id: 'ILV', name: 'Ilvaria', demonym: 'Ilvarian', style: 2, primary: '#0f766e', secondary: '#fbbf24' },
  { id: 'KAL', name: 'Kaltoria', demonym: 'Kaltorian', style: 3, primary: '#374151', secondary: '#f59e0b' },
  { id: 'LUN', name: 'Lunveria', demonym: 'Lunverian', style: 4, primary: '#2563eb', secondary: '#fbbf24' },
  { id: 'MAR', name: 'Marovia', demonym: 'Marovian', style: 5, primary: '#dc2626', secondary: '#111827' },
  { id: 'NOR', name: 'Norvaine', demonym: 'Norvainer', style: 4, primary: '#1e3a8a', secondary: '#fecaca' },
  { id: 'OST', name: 'Ostravane', demonym: 'Ostravan', style: 3, primary: '#a16207', secondary: '#f8fafc' },
  { id: 'PEL', name: 'Pelvoria', demonym: 'Pelvorian', style: 2, primary: '#059669', secondary: '#f8fafc' },
  { id: 'QUE', name: 'Quenland', demonym: 'Quenlander', style: 4, primary: '#4338ca', secondary: '#f8fafc' },
  { id: 'RAV', name: 'Ravenmark', demonym: 'Ravenmarker', style: 1, primary: '#111827', secondary: '#dc2626' },
  { id: 'SOR', name: 'Sorvania', demonym: 'Sorvanian', style: 5, primary: '#c2410c', secondary: '#f8fafc' },
  { id: 'TAR', name: 'Tarsonia', demonym: 'Tarsonian', style: 0, primary: '#0369a1', secondary: '#f8fafc' },
  { id: 'ULM', name: 'Ulmeria', demonym: 'Ulmerian', style: 2, primary: '#9d174d', secondary: '#fde68a' },
  { id: 'VAL', name: 'Valdoria', demonym: 'Valdorian', style: 0, primary: '#facc15', secondary: '#1d4ed8' },
  { id: 'WES', name: 'Westmarch', demonym: 'Westmarcher', style: 4, primary: '#166534', secondary: '#fef3c7' },
  { id: 'XAN', name: 'Xanvere', demonym: 'Xanverian', style: 5, primary: '#6d28d9', secondary: '#fcd34d' },
  { id: 'YOR', name: 'Yorvane', demonym: 'Yorvanian', style: 3, primary: '#334155', secondary: '#fb923c' },
  { id: 'ZEL', name: 'Zelmar', demonym: 'Zelmari', style: 1, primary: '#e11d48', secondary: '#f8fafc' },
];

interface Phonology { first: string[][]; last: string[][]; }
// Each phonology: syllable bags [onsets, vowels/nuclei, codas/endings]
const PHON: Phonology[] = [
  { first: [['Ka', 'Ma', 'Ro', 'Ve', 'Da', 'Lu', 'Se', 'Ti', 'Bo', 'Fa', 'Ni', 'Al'], ['ri', 'to', 'ven', 'lo', 'mi', 'dan', 'ran', 'sel'], ['o', 'an', 'is', 'el', 'us', 'ar', 'in', 'e']],
    last: [['Vel', 'Mor', 'Kas', 'Dur', 'Bal', 'Cor', 'Fen', 'Hal', 'Tor', 'Sal'], ['an', 'ov', 'er', 'ad', 'in', 'ur', 'ek'], ['ti', 'ez', 'ini', 'oni', 'esco', 'ardo', 'ero', 'ano']] },
  { first: [['Ja', 'Mi', 'Ste', 'Vla', 'Dra', 'Zo', 'Bra', 'Ko', 'Pe', 'Ra'], ['n', 'ro', 'lan', 'mir', 'ko', 'sav', 'dan'], ['ko', 'mir', 'an', 'slav', 'ek', 'is', 'im']],
    last: [['Novi', 'Petro', 'Hrad', 'Kova', 'Bori', 'Jelen', 'Mark', 'Stan', 'Vuk', 'Zdra'], ['ko', 've', 'si', 'ra', 'li', 'no'], ['vić', 'nik', 'ski', 'cek', 'lov', 'rin', 'dar', 'sek']] },
  { first: [['Ib', 'Am', 'Kof', 'Se', 'Ous', 'Ade', 'Che', 'Ba', 'Mo', 'Yu'], ['ra', 'ma', 'bi', 'ke', 'su', 'di', 'ou'], ['him', 'dou', 'si', 'ne', 'mo', 'ba', 'ya', 'tu']],
    last: [['Dia', 'Ndi', 'Oko', 'Ba', 'Tou', 'Man', 'Kei', 'Sa', 'Ade', 'Mba'], ['ba', 'ka', 'ye', 'ra', 'ne', 'so'], ['ye', 'ngo', 'ssa', 'lu', 'ma', 'ke', 'ba', 'tou']] },
  { first: [['Ka', 'Mal', 'Ha', 'Ta', 'Ra', 'Sa', 'Na', 'Za', 'Fa', 'Il'], ['mi', 'rim', 'rim', 'ri', 'did', 'hir', 'sim', 'ban'], ['r', 'd', 'l', 'm', 'z', 'n', 'ir', 'an']],
    last: [['Al', 'Be', 'Ha', 'Sha', 'Kha', 'Ra', 'Za', 'Mu', 'Na', 'Ju'], ['mad', 'sir', 'kim', 'lid', 'rid', 'zim', 'nas'], ['i', 'ov', 'oglu', 'ani', 'zade', 'ar', 'oun', 'ir']] },
  { first: [['Ol', 'Er', 'Mag', 'Han', 'Ni', 'Jo', 'Lars', 'Ei', 'Tor', 'Ste'], ['af', 'ik', 'nus', 'ri', 'kol', 'ar', 'in', 'ven'], ['', 'e', 'a', 'us', 'ar', 'is']],
    last: [['Berg', 'Lind', 'Hol', 'Sand', 'Ek', 'Strand', 'Dahl', 'Vik', 'Nord', 'Fjell'], ['gren', 'quist', 'mark', 'heim', 'sen', 'dal', 'stad'], ['', 'sson', 'sen', 'berg', 'lund', 'vold', 'by']] },
  { first: [['Hi', 'Ta', 'Ke', 'Yo', 'Ma', 'So', 'Ru', 'Sh', 'Ai', 'Ha'], ['ro', 'ka', 'ji', 'ta', 'ma', 'ki', 'su', 'to'], ['shi', 'ya', 'ru', 'mi', 'to', 'ji', 'ko', 'no']],
    last: [['Mori', 'Taka', 'Naka', 'Kobu', 'Haya', 'Ishi', 'Shino', 'Oka', 'Fuji', 'Ami'], ['ha', 'mu', 'ga', 'wa', 'sa', 'ki', 'ta'], ['shi', 'ra', 'moto', 'zawa', 'saki', 'da', 'no', 'ke']] },
];

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function build(rng: RNG, bags: string[][]): string {
  const [a, b, c] = bags as [string[], string[], string[]];
  const n = rng.chance(0.35) ? 2 : 3;
  let s = rng.pick(a);
  if (n === 3) s += rng.pick(b);
  s += rng.pick(c);
  // collapse triple repeats and tidy
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  return cap(s);
}

export function makeName(rng: RNG, style: number): { name: string; shortName: string } {
  const ph = PHON[style % PHON.length] as Phonology;
  const first = build(rng, ph.first);
  const last = build(rng, ph.last);
  return { name: `${first} ${last}`, shortName: last };
}

const CITY_A = ['Kel', 'Dra', 'Ash', 'North', 'Vern', 'Mar', 'Bel', 'Storm', 'Fen', 'Har', 'Tor', 'Wex', 'Cor', 'Lin', 'Pen', 'Sil', 'Oak', 'Rav', 'Hol', 'Brim', 'Ard', 'Cal', 'Dun', 'Elm', 'Gran', 'Ironc', 'Jas', 'Kirk', 'Lor', 'Mere'];
const CITY_B = ['mouth', 'port', 'ford', 'wick', 'haven', 'bridge', 'dale', 'gate', 'field', 'burn', 'minster', 'stead', 'crest', 'vale', 'mere', 'holm', 'ton', 'shire', 'by', 'cliff'];
const SUFFIX = ['Rovers', 'United', 'Athletic', 'Wanderers', 'City', 'Town', 'Albion', 'Rangers', 'Vanguard', 'Olympic', 'Sporting', 'Dynamo', 'Union', 'Harriers', 'Argyle', 'Borough', 'Victoria', 'Orient', 'Celtic Park', 'Academicals'];
const NICK = ['Lions', 'Foxes', 'Hawks', 'Wolves', 'Stags', 'Falcons', 'Bears', 'Ravens', 'Owls', 'Eagles', 'Tigers', 'Knights', 'Mariners', 'Miners', 'Smiths', 'Saints', 'Herons', 'Otters', 'Bulls', 'Badgers'];

export function makeCityName(rng: RNG): string { return cap(rng.pick(CITY_A) + rng.pick(CITY_B)); }
export function makeClubName(rng: RNG, city: string, used: Set<string>): { name: string; nickname: string } {
  for (let i = 0; i < 40; i++) {
    const suffix = rng.pick(SUFFIX);
    const name = suffix === 'Celtic Park' ? `${city} Park` : `${city} ${suffix}`;
    if (!used.has(name)) { used.add(name); return { name, nickname: rng.pick(NICK) }; }
  }
  const name = `${city} ${used.size}`;
  used.add(name);
  return { name, nickname: rng.pick(NICK) };
}
export function makeStadiumName(rng: RNG, city: string): string {
  const forms = [`${city} Arena`, `${city} Park`, `The ${rng.pick(['Meadow', 'Anvil', 'Citadel', 'Foundry', 'Orchard', 'Lantern', 'Harbour'])}`, `${cap(rng.pick(CITY_A))} Road`, `${city} Stadium`, `${rng.pick(['Northern', 'Eastern', 'Grand', 'Old', 'Victory'])} Ground`];
  return rng.pick(forms);
}
export function shortCode(name: string, used: Set<string>): string {
  const letters = name.replace(/[^A-Za-z ]/g, '').toUpperCase().split(' ');
  const cands = [
    (letters[0] ?? 'XXX').slice(0, 3),
    ((letters[0] ?? 'X').slice(0, 2) + (letters[1] ?? 'X').slice(0, 1)),
    ((letters[0] ?? 'X').slice(0, 1) + (letters[0] ?? 'XX').slice(-2)),
  ];
  for (const c of cands) if (c.length === 3 && !used.has(c)) { used.add(c); return c; }
  for (let i = 0; i < 100; i++) { const c = (letters[0] ?? 'XXX').slice(0, 2) + String.fromCharCode(65 + (i % 26)); if (!used.has(c)) { used.add(c); return c; } }
  return 'XXX';
}
