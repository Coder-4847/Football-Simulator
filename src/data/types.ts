export type Pos = 'GK' | 'CB' | 'LB' | 'RB' | 'LWB' | 'RWB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'CF' | 'ST';

export const ATTR_KEYS = [
  'acceleration', 'sprintSpeed',
  'finishing', 'shotPower', 'longShots', 'volleys', 'penalties',
  'vision', 'shortPass', 'longPass', 'crossing', 'curve', 'freeKick',
  'agility', 'balance', 'ballControl', 'dribbling', 'reactions',
  'interceptions', 'marking', 'standingTackle', 'slidingTackle', 'heading',
  'strength', 'stamina', 'jumping', 'aggression',
  'gkDiving', 'gkHandling', 'gkKicking', 'gkPositioning', 'gkReflexes',
] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];
export type Attrs = Record<AttrKey, number>;

export type WorkRate = 'low' | 'med' | 'high';
export type BodyType = 'lean' | 'normal' | 'stocky' | 'tall';

export const TRAITS = [
  'Finesse Shot', 'Long Passer', 'Speed Dribbler', 'Tackler', 'Aerial Threat', 'Power Header',
  'Long Shot Taker', 'Playmaker', 'Dead Ball Specialist', 'Long Throw', 'Poacher', 'Trivela',
  'Press Proven', 'Flair', 'Acrobatic', 'Clinical Finisher', 'Rapid', 'Sweeper Keeper',
  'Cross Claimer', 'Penalty Saver', 'Engine',
] as const;
export type Trait = (typeof TRAITS)[number];

export interface Appearance {
  skin: number;       // index into skin tone palette
  hairStyle: number;  // 0 bald, 1 short, 2 buzz, 3 afro, 4 long, 5 tied, 6 mohawk
  hairColor: number;  // index into hair palette
  beard: number;      // 0 none, 1 stubble, 2 full
  bootColor: number;
  tattoo: boolean;
  sleeves: boolean;   // long sleeves
}

export interface Player {
  id: string;
  name: string;
  shortName: string;
  nation: string;       // nation id
  age: number;
  heightCm: number;
  weightKg: number;
  bodyType: BodyType;
  foot: 'L' | 'R';
  weakFoot: number;     // 1..5
  skillMoves: number;   // 1..5
  workAtt: WorkRate;
  workDef: WorkRate;
  traits: Trait[];
  positions: Pos[];     // positions[0] is primary
  attrs: Attrs;
  overall: number;
  potential: number;
  value: number;        // market value
  wage: number;         // per week
  contractEnd: number;  // season year
  number: number;
  look: Appearance;
  // dynamic (career)
  clubId: string | null;
  morale: number;       // 0..100
  fitness: number;      // 0..100
  injuredUntil: number; // day index, 0 = healthy
  form: number;         // -1..1
  goals: number;
  assists: number;
  apps: number;
  yellow: number;
  red: number;
  suspended: number;    // matches remaining
}

export type KitPattern = 'solid' | 'stripes' | 'hoops' | 'halves' | 'sash' | 'checks' | 'pinstripe' | 'chevron';
export interface Kit { primary: string; secondary: string; shorts: string; socks: string; pattern: KitPattern; }

export interface Club {
  id: string;
  name: string;
  short: string;        // 3 letters
  nickname: string;
  nation: string;
  leagueId: string;
  city: string;
  stadium: { name: string; style: number; capacity: number };
  reputation: number;   // 1..100
  budget: number;
  wageBudget: number;
  kits: { home: Kit; away: Kit };
  squad: string[];      // player ids
  formation: string;
  tactics: Tactics;
  founded: number;
  youthRating: number;  // 1..100
  facilities: number;   // 1..100
}

export interface League {
  id: string;
  name: string;
  nation: string;
  tier: number;
  clubs: string[];
  promotionSpots: number;
  relegationSpots: number;
}

export interface Nation { id: string; name: string; demonym: string; style: number; primary: string; secondary: string; strength: number; }

export interface Tactics {
  /** 0..100 sliders */
  lineHeight: number;
  compactness: number;
  width: number;
  pressing: number;
  tempo: number;
  directness: number;
  offsideTrap: boolean;
  marking: 'zonal' | 'man' | 'mixed';
  style: 'balanced' | 'possession' | 'counter' | 'highPress' | 'longBall' | 'park';
}

export interface FormationSlot { pos: Pos; x: number; y: number; role: Role }
export type Role =
  | 'goalkeeper' | 'sweeperKeeper' | 'centreBack' | 'ballPlayingDefender' | 'fullBack' | 'wingBack'
  | 'anchor' | 'boxToBox' | 'playmaker' | 'winger' | 'invertedWinger' | 'shadowStriker' | 'targetMan' | 'poacher' | 'advancedForward';

export interface Formation { id: string; name: string; slots: FormationSlot[] }

export interface World {
  seed: string;
  nations: Record<string, Nation>;
  leagues: Record<string, League>;
  clubs: Record<string, Club>;
  players: Record<string, Player>;
}
