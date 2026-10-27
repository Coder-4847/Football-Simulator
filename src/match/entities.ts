import type { Formation, Player, Role, Tactics } from '../data/types';
import type { Pos } from '../data/types';
import { clamp } from '../core/math';
import type { Side } from './constants';
import { newGkState, type GkState } from './keeper';
import type { TackleReq } from './rules';

export interface Intent {
  /** desired move direction in pitch coords, magnitude 0..1 */
  mx: number; my: number;
  sprint: boolean;
  /** slow, face ball/opponent (defensive containing) */
  jockey: boolean;
  /** precision dribble: slow, close control */
  precise: boolean;
  /** shield ball with body */
  shield: boolean;
  /** if set, face this angle instead of velocity direction */
  faceAngle: number | null;
}

export const newIntent = (): Intent => ({ mx: 0, my: 0, sprint: false, jockey: false, precise: false, shield: false, faceAngle: null });

export type PState =
  | 'normal' | 'kick' | 'tackle' | 'slide' | 'jump' | 'dive' | 'down' | 'celebrate' | 'throw' | 'skill' | 'stumble' | 'wait' | 'save';

export type SkillMoveId = string;

export interface PlayerStats {
  goals: number; assists: number; shots: number; shotsOnTarget: number; passes: number; passesCompleted: number;
  tackles: number; tacklesWon: number; fouls: number; fouled: number; yellow: number; red: number; offsides: number;
  saves: number; interceptions: number; distance: number; touches: number; keyPasses: number; minutes: number; xg: number;
  dribbles: number; dribblesWon: number; clearances: number; headers: number;
  ratingEvents: number;
}

export const newPlayerStats = (): PlayerStats => ({
  goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, passes: 0, passesCompleted: 0, tackles: 0, tacklesWon: 0, fouls: 0, fouled: 0,
  yellow: 0, red: 0, offsides: 0, saves: 0, interceptions: 0, distance: 0, touches: 0, keyPasses: 0, minutes: 0, xg: 0,
  dribbles: 0, dribblesWon: 0, clearances: 0, headers: 0, ratingEvents: 0,
});

export class MPlayer {
  x = 0; y = 0; vx = 0; vy = 0;
  px = 0; py = 0; pface = 0;
  face = 0;
  stamina = 1;
  state: PState = 'normal';
  stateT = 0;
  stateDur = 0;
  /** direction param for dives/slides/skills, height for jumps */
  sx = 0; sy = 0; sz = 0;
  stateName = '';
  intent: Intent = newIntent();
  noTouchUntil = 0;
  /** time until which this player cannot be re-fouled/tackle again */
  tackleCooldown = 0;
  /** human controller index controlling this player (-1 none) */
  human = -1;
  sentOff = false;
  injured = false;
  yellowCards = 0;
  stats: PlayerStats = newPlayerStats();
  slot: number;
  anchorX = 0; anchorY = 0; // formation anchor in pitch coords
  role: Role;
  slotPos: Pos;
  /** AI decision timer */
  thinkT = 0;
  /** current AI off-ball target */
  tx = 0; ty = 0;
  runTarget: { x: number; y: number; until: number } | null = null;
  markId = -1;
  /** stride phase for animation */
  stride = 0;
  ballSide: 'L' | 'R' = 'R';
  /** rating accumulators */
  rating = 6;
  celebrate = 0;
  /** active skill-move data */
  skill: { id: string; t: number; dur: number; dx: number; dy: number; ok: boolean } | null = null;
  /** queued strike executing at a time */
  pending: PendingStrike | null = null;
  subbedOff = false;
  tackleReq: TackleReq | null = null;
  gk: GkState = newGkState();
  setState(state: PState, dur = 0, name = ''): void {
    this.state = state; this.stateT = 0; this.stateDur = dur; this.stateName = name;
  }
  /** Fresh legs for animation: how tired (0..1) */
  get tired(): number { return clamp(1 - this.stamina, 0, 1); }

  constructor(public data: Player, public team: Team, slot: number, slotPos: Pos, role: Role) {
    this.slot = slot; this.slotPos = slotPos; this.role = role;
  }

  get side(): Side { return this.team.side; }
  get id(): number { return this.team.side * 100 + this.slot; }
  get speed(): number { return Math.hypot(this.vx, this.vy); }
  isGK(): boolean { return this.slotPos === 'GK'; }
  active(): boolean { return !this.sentOff; }
}

export interface PendingStrike { at: number; kind: string; spec: unknown; }

export interface SubRecord { minute: number; off: string; on: string; side: Side; injury: boolean }

export class Team {
  players: MPlayer[] = [];
  bench: Player[] = [];
  /** direction of attack along x: +1 or -1 */
  dir = 1;
  score = 0;
  subsMade = 0;
  subWindows = 0;
  windowOpenForSub = false;
  subs: SubRecord[] = [];
  /** human controllers on this team (indices into match.humans) */
  controlled: number[] = [];
  possessionTime = 0;
  stats = { shots: 0, onTarget: 0, passes: 0, passesCompleted: 0, tackles: 0, fouls: 0, corners: 0, offsides: 0, yellow: 0, red: 0, xg: 0, saves: 0, crosses: 0, freeKicks: 0, interceptions: 0, clearances: 0 };
  formation: Formation;
  tactics: Tactics;
  name: string; short: string;
  kit: { primary: string; secondary: string; shorts: string; socks: string; pattern: string };
  gkKit: { primary: string; secondary: string };
  clubId: string;
  aiLevel = 0.5;
  /** Players which have been sent off + subbed to compute numbers on pitch */
  constructor(public side: Side, setup: TeamSetup) {
    this.formation = setup.formation; this.tactics = setup.tactics; this.name = setup.name; this.short = setup.short;
    this.kit = setup.kit; this.gkKit = setup.gkKit; this.clubId = setup.clubId;
    this.bench = setup.bench;
  }
  onPitch(): MPlayer[] { return this.players.filter((p) => p.active()); }
}

export interface TeamSetup {
  clubId: string; name: string; short: string;
  formation: Formation; tactics: Tactics;
  /** 11 starters in formation slot order (index i fills formation.slots[i]) */
  starters: Player[];
  bench: Player[];
  kit: { primary: string; secondary: string; shorts: string; socks: string; pattern: string };
  gkKit: { primary: string; secondary: string };
  /** captain player id */
  captain?: string;
}
