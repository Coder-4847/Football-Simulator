import type { Player, World, Tactics } from '../data/types';

export interface Fixture {
  id: string; comp: string; round: number; week: number; home: string; away: string;
  played: boolean; hg?: number; ag?: number; pens?: [number, number];
  scorers?: Array<{ side: 0 | 1; minute: number; player: string; text: string }>;
}

export interface TableRow { club: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }

export interface Objective { id: string; text: string; kind: 'league' | 'cup' | 'finance' | 'youth'; target: number; done: boolean; failed: boolean }

export interface Scout { id: string; name: string; nation: string; group: 'ANY' | 'GK' | 'DEF' | 'MID' | 'ATT'; quality: number; assigned: boolean }

export interface Offer {
  id: string; kind: 'buy' | 'sell' | 'job' | 'loan'; playerId?: string; from: string; to: string; fee: number; wage: number; years: number; week: number; season: number; expires: number; status: 'open' | 'accepted' | 'rejected' | 'expired';
  note?: string;
}

export interface NewsItem { week: number; season: number; text: string; kind: 'match' | 'transfer' | 'board' | 'injury' | 'info' }

export interface SeasonSummary { season: number; leagueId: string; position: number; points: number; cupRound: string; profit: number; champion: string; topScorer: string; promoted: boolean; relegated: boolean }

export interface Lineup { formation: string; starters: string[]; tactics: Tactics }

export interface CareerState {
  version: 1;
  seed: string;
  mode: 'manager' | 'player';
  managerName: string;
  userClubId: string;
  userPlayerId?: string;
  season: number;
  week: number;
  world: World;
  fixtures: Fixture[];
  /** domestic cup entrants still alive per nation */
  cupAlive: Record<string, string[]>;
  history: SeasonSummary[];
  lineup: Lineup;
  board: { confidence: number; objectives: Objective[]; managerRep: number; sacked: boolean };
  finance: Record<string, { income: number; expenses: number; cash: number }>;
  seasonFinance: { income: number; wages: number; transfersIn: number; transfersOut: number; other: number };
  offers: Offer[];
  scouting: { scouts: Scout[]; known: Record<string, number>; shortlist: string[] };
  youth: Player[];
  news: NewsItem[];
  trainingFocus: 'balanced' | 'attacking' | 'defending' | 'passing' | 'physical';
  listed: string[];
  facilities: { training: number; youth: number; stadium: number };
  jobOffers: Offer[];
  lastResult?: { fixtureId: string; summary: string };
  stats: { seasonsPlayed: number; trophies: string[] };
}

export const WEEKS = 52;
export const isWindowOpen = (week: number): boolean => week <= 6 || (week >= 27 && week <= 30);
export const LEAGUE_ROUNDS = 30;
export const CUP_WEEKS = [8, 15, 24, 33, 42];
export const CUP_ROUND_NAMES = ['Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final'];
