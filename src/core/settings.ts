import { storage } from './storage';
import type { QualityName, Quality } from '../render/quality';
import type { CameraMode } from '../render/camera';
import type { GradePreset } from '../render/post';
import type { Difficulty } from '../match/types';

/** How long a match takes to watch at 1x speed: the half length simulated, in minutes of match time. */
export type MatchLength = 'blitz' | 'standard' | 'extended';
export const MATCH_LENGTHS: Record<MatchLength, { label: string; half: number; seconds: number }> = {
  blitz: { label: 'Blitz', half: 1.5, seconds: 45 },
  standard: { label: 'Standard', half: 2.5, seconds: 75 },
  extended: { label: 'Extended', half: 4, seconds: 120 },
};
/** Simulation seconds per real second at 1x (matches are played in fast-forward). */
export const BASE_SIM_SPEED = 4;
export const SPEEDS = [0.5, 1, 2, 4] as const;

export interface Settings {
  version: number;
  graphics: {
    preset: QualityName; custom: Partial<Quality>; fpsCap: 0 | 30 | 60 | 120; showFps: boolean; grade: GradePreset; autoDetected: boolean;
    resolutionScale: number; ballTrail: boolean; weatherEffects: boolean;
  };
  audio: { master: number; music: number; crowd: number; sfx: number; menuMusic: boolean; muteOnBlur: boolean; dynamicCrowd: boolean; ticker: boolean; tts: boolean };
  gameplay: {
    matchLength: MatchLength; matchSpeed: number; difficulty: Difficulty; refStrictness: number; offside: boolean; foulFrequency: number; injuries: boolean; fatigue: boolean;
    camera: CameraMode; cameraZoom: number; playerNames: boolean; ticker: boolean; var: boolean; goalReplays: boolean; autoPauseHalftime: boolean;
    extraTimeAndPens: boolean; weather: 'clear' | 'rain' | 'fog' | 'snow' | 'random'; timeOfDay: 'day' | 'dusk' | 'night' | 'random'; stadium: number | 'random';
  };
}

export function defaultSettings(mobile: boolean): Settings {
  return {
    version: 5,
    graphics: { preset: mobile ? 'Low' : 'High', custom: {}, fpsCap: mobile ? 60 : 0, showFps: false, grade: 'broadcast', autoDetected: false, resolutionScale: 1, ballTrail: true, weatherEffects: true },
    audio: { master: 0.8, music: 0.5, crowd: 0.8, sfx: 0.9, menuMusic: true, muteOnBlur: true, dynamicCrowd: true, ticker: true, tts: false },
    gameplay: {
      matchLength: 'standard', matchSpeed: 1, difficulty: 'Professional', refStrictness: 0.5, offside: true, foulFrequency: 1, injuries: true, fatigue: true, camera: 'drone', cameraZoom: 1,
      playerNames: true, ticker: true, var: false, goalReplays: false, autoPauseHalftime: true, extraTimeAndPens: true, weather: 'random', timeOfDay: 'random', stadium: 'random',
    },
  };
}

type Listener = (s: Settings) => void;

class SettingsStore {
  value: Settings;
  private listeners = new Set<Listener>();
  private saveT: ReturnType<typeof setTimeout> | null = null;
  constructor(private mobile: boolean) { this.value = defaultSettings(mobile); }

  async load(): Promise<void> {
    const stored = await storage.get<Partial<Settings>>('settings');
    if (stored) {
      const prev = (stored as { version?: number }).version ?? 1;
      const d = defaultSettings(this.mobile);
      this.value = deepMerge(d, stored);
      if (prev < 5) {
        // v5: manager game — no controls, fast matches, full-pitch camera
        delete (this.value as unknown as Record<string, unknown>).controls;
        this.value.gameplay.camera = d.gameplay.camera; this.value.gameplay.matchLength = d.gameplay.matchLength; this.value.gameplay.matchSpeed = d.gameplay.matchSpeed;
        this.value.gameplay.cameraZoom = 1;
        this.value.version = 5;
        void storage.set('settings', this.value);
      }
    }
    this.emit();
  }

  update(mut: (s: Settings) => void): void {
    mut(this.value);
    this.emit();
    if (this.saveT) clearTimeout(this.saveT);
    this.saveT = setTimeout(() => { void storage.set('settings', this.value); }, 250);
  }

  on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(): void { for (const l of this.listeners) l(this.value); }

  reset(): void { this.value = defaultSettings(this.mobile); void storage.set('settings', this.value); this.emit(); }
  exportJson(): string { return JSON.stringify(this.value); }
}

function deepMerge<T>(base: T, over: unknown): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (typeof over !== 'object' || over === null) return base;
  for (const k of Object.keys(over as Record<string, unknown>)) {
    const bv = (base as Record<string, unknown>)[k];
    const ov = (over as Record<string, unknown>)[k];
    out[k] = bv !== undefined && typeof bv === 'object' && bv !== null && !Array.isArray(bv) ? deepMerge(bv, ov) : ov;
  }
  return out as T;
}

const isMobileUA = typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches));
export const settings = new SettingsStore(isMobileUA);
