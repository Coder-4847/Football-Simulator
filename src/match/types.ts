import type { MPlayer } from './entities';
import type { Side } from './constants';
import type { FrameInput } from '../input/actions';

export const DIFFICULTIES = ['Beginner', 'Amateur', 'Semi-Pro', 'Professional', 'World Class', 'Legendary', 'Ultimate'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface DiffParams {
  /** AI reaction time to events (s) */
  reaction: number;
  /** probability the AI picks its best option instead of a random decent one */
  quality: number;
  /** pressing willingness multiplier */
  press: number;
  /** goalkeeper reaction delay (s) */
  gkReaction: number;
  /** how quickly AI regroups after losing the ball */
  transition: number;
  /** skill-move usage chance */
  flair: number;
}

export const DIFF_PARAMS: Record<Difficulty, DiffParams> = {
  Beginner: { reaction: 0.75, quality: 0.2, press: 0.45, gkReaction: 0.32, transition: 0.4, flair: 0.0 },
  Amateur: { reaction: 0.55, quality: 0.35, press: 0.6, gkReaction: 0.26, transition: 0.55, flair: 0.02 },
  'Semi-Pro': { reaction: 0.42, quality: 0.5, press: 0.75, gkReaction: 0.2, transition: 0.7, flair: 0.04 },
  Professional: { reaction: 0.32, quality: 0.65, press: 0.9, gkReaction: 0.16, transition: 0.8, flair: 0.06 },
  'World Class': { reaction: 0.24, quality: 0.78, press: 1.0, gkReaction: 0.12, transition: 0.9, flair: 0.08 },
  Legendary: { reaction: 0.18, quality: 0.88, press: 1.1, gkReaction: 0.09, transition: 1.0, flair: 0.1 },
  Ultimate: { reaction: 0.12, quality: 0.96, press: 1.2, gkReaction: 0.06, transition: 1.1, flair: 0.12 },
};

export type Weather = 'clear' | 'rain' | 'fog' | 'snow';
export type TimeOfDay = 'day' | 'dusk' | 'night';

export interface MatchConfig {
  seed: string;
  /** real-time minutes per half */
  halfLength: number;
  difficulty: Difficulty;
  weather: Weather;
  timeOfDay: TimeOfDay;
  stadiumStyle: number;
  /** 0 lenient .. 1 strict */
  refStrictness: number;
  offside: boolean;
  /** foul frequency multiplier */
  foulFrequency: number;
  injuries: boolean;
  fatigue: boolean;
  /** play extra time then penalties if level at 90 */
  knockout: boolean;
  extraTime: boolean;
  penalties: boolean;
  var: boolean;
  maxSubs: number;
  subWindows: number;
  /** dynamic difficulty adapts AI quality a bit to the scoreline */
  dynamicDifficulty: boolean;
  /** 0..1 assistance for human passing/shooting/crossing/keeper */
  assist: { pass: number; shot: number; cross: number; keeper: number; aim: number; autoSwitch: boolean };
  /** skill-move loadout (global) and per-player overrides */
  loadout: string[];
  loadoutOverrides: Record<string, string[]>;
  /** headless: no pauses, auto-handle UI prompts */
  headless: boolean;
  /** match speed multiplier (informational; loop applies it) */
  /** which camera-relative yaw to use when mapping input (rad) */
}

export const defaultMatchConfig = (): MatchConfig => ({
  seed: 'match', halfLength: 5, difficulty: 'Professional', weather: 'clear', timeOfDay: 'day', stadiumStyle: 0,
  refStrictness: 0.5, offside: true, foulFrequency: 1, injuries: true, fatigue: true, knockout: false, extraTime: true, penalties: true,
  var: false, maxSubs: 5, subWindows: 3, dynamicDifficulty: false,
  assist: { pass: 0.5, shot: 0.35, cross: 0.5, keeper: 0.5, aim: 0.3, autoSwitch: true },
  loadout: ['body-feint', 'step-over', 'flip-flap', 'spin-turn'], loadoutOverrides: {}, headless: false,
});

export type Phase =
  | 'intro' | 'setpiece' | 'play' | 'goal' | 'halftime' | 'fulltime' | 'extratimeBreak' | 'shootout' | 'var' | 'paused' | 'injury' | 'dead';

export type SetPieceType = 'kickoff' | 'throwIn' | 'goalKick' | 'corner' | 'freeKick' | 'indirectFreeKick' | 'penalty';

export type ShotKind = 'normal' | 'power' | 'finesse' | 'chip' | 'driven' | 'volley' | 'header' | 'bicycle' | 'outside' | 'penalty' | 'freeKick';
export type PassKind = 'ground' | 'through' | 'lob' | 'cross' | 'lowCross' | 'throughLob' | 'clear' | 'short' | 'keeperThrow' | 'keeperKick';

export interface MatchEvents extends Record<string, unknown> {
  whistle: { kind: 'start' | 'end' | 'foul' | 'halfTime' | 'fullTime' | 'offside' | 'goal' | 'restart' };
  kick: { player: MPlayer; power: number; kind: string };
  pass: { player: MPlayer; target: MPlayer | null; kind: PassKind };
  shot: { player: MPlayer; kind: ShotKind; xg: number; speed: number; onTarget: boolean };
  goal: { scorer: MPlayer; assist: MPlayer | null; side: Side; minute: number; ownGoal: boolean; penalty: boolean };
  save: { keeper: MPlayer; caught: boolean };
  post: { hit: 'post' | 'bar' };
  netHit: { speed: number };
  foul: { offender: MPlayer; victim: MPlayer; x: number; y: number; severity: number };
  card: { player: MPlayer; color: 'yellow' | 'red'; second: boolean };
  offside: { player: MPlayer };
  advantage: { side: Side };
  throwIn: { side: Side };
  corner: { side: Side };
  goalKick: { side: Side };
  freeKick: { side: Side; x: number; y: number };
  penalty: { side: Side };
  sub: { side: Side; off: MPlayer; on: string; injury: boolean };
  injury: { player: MPlayer };
  halfTime: { score: [number, number] };
  fullTime: { score: [number, number] };
  extraTime: Record<string, never>;
  tackle: { player: MPlayer; victim: MPlayer; success: boolean; slide: boolean };
  skill: { player: MPlayer; id: string; success: boolean };
  header: { player: MPlayer };
  restart: { type: string; side: Side };
  commentary: { text: string; minute: number };
  var: { kind: 'goal' | 'penalty' | 'red'; outcome: 'confirmed' | 'overturned'; reason: string };
  shootoutKick: { side: Side; scored: boolean; player: MPlayer };
  shootoutEnd: { winner: Side };
  celebrate: { player: MPlayer };
  possession: { side: Side | null };
  bounce: { speed: number };
  switchPlayer: { human: number; player: MPlayer };
  sentOffAllowed: Record<string, never>;
  needSub: { side: Side; player: MPlayer };
  keeperCatch: { keeper: MPlayer };
}

/** One human controller on a team. */
export interface HumanSlot {
  side: Side;
  /** the player currently controlled */
  player: MPlayer | null;
  input: FrameInput;
  /** seconds since the last manual switch (blocks auto-switch briefly) */
  manualSwitchT: number;
  /** is this slot controlling the goalkeeper only? */
  keeperOnly: boolean;
  /** buffered shot/pass for first-time actions */
  queued: { btn: string; t: number; hold: number; mods: string[] } | null;
  /** shot power charging */
  charge: { btn: string; t: number } | null;
}
