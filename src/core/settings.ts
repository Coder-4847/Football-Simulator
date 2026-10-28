import { storage } from './storage';
import type { Btn } from '../input/actions';
import type { QualityName, Quality } from '../render/quality';
import type { CameraMode } from '../render/camera';
import type { GradePreset } from '../render/post';
import type { Difficulty } from '../match/types';
import { DEFAULT_LOADOUT, DEFAULT_LOADOUT_ALT } from '../match/skills';

export type KeyBindings = Record<Btn | 'up' | 'down' | 'left' | 'right' | 'rUp' | 'rDown' | 'rLeft' | 'rRight', string[]>;
export type PadBindings = Record<Btn, number[]>;

export interface TouchButtonLayout { x: number; y: number; s: number }

export interface Settings {
  version: number;
  graphics: {
    preset: QualityName; custom: Partial<Quality>; fpsCap: 0 | 30 | 60 | 120; showFps: boolean; grade: GradePreset; autoDetected: boolean;
    resolutionScale: number; ballTrail: boolean; weatherEffects: boolean;
  };
  audio: { master: number; music: number; crowd: number; sfx: number; menuMusic: boolean; muteOnBlur: boolean; dynamicCrowd: boolean; ticker: boolean; tts: boolean };
  controls: {
    device: 'auto' | 'keyboard' | 'gamepad' | 'touch';
    keyboard: KeyBindings; keyboardP2: KeyBindings; gamepad: PadBindings;
    profile: string; profiles: Record<string, { keyboard: KeyBindings; gamepad: PadBindings }>;
    sensitivity: number; deadzone: number; vibration: boolean; mouseAim: boolean;
    touch: { layout: Record<string, TouchButtonLayout>; opacity: number; joystickSize: number; joystickSensitivity: number; skillMode: 'flick' | 'buttons'; autoAssist: number; haptics: boolean; presets: Record<string, Record<string, TouchButtonLayout>> };
    assist: { pass: number; shot: number; cross: number; keeper: number; aim: number; autoSwitch: boolean };
    skillLoadout: string[]; skillLoadoutAlt: string[]; skillOverrides: Record<string, string[]>; skillBindings: Record<string, string>;
  };
  gameplay: {
    difficulty: Difficulty; halfLength: number; gameSpeed: 'slow' | 'normal' | 'fast'; refStrictness: number; offside: boolean; foulFrequency: number; injuries: boolean; fatigue: boolean;
    camera: CameraMode; cameraHeight: number; cameraZoom: number; radar: boolean; playerNames: boolean; staminaBars: boolean; ticker: boolean; dynamicDifficulty: boolean; var: boolean;
    language: string; celebrations: Record<string, number>; extraTimeAndPens: boolean; weather: 'clear' | 'rain' | 'fog' | 'snow' | 'random'; timeOfDay: 'day' | 'dusk' | 'night' | 'random'; stadium: number | 'random';
  };
}

/**
 * Two-handed layout. Left hand: WASD + Shift (sprint) + Space (precision/shield, thumb) + Q/E (modifiers).
 * Right hand rests on J K L with I above: pass, through, lob, shoot; U O M . are the four skill slots.
 * Arrow keys / 1-4 still work as alternates for skill moves.
 */
export const DEFAULT_KEYBOARD: KeyBindings = {
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  rUp: ['ArrowUp'], rDown: ['ArrowDown'], rLeft: ['ArrowLeft'], rRight: ['ArrowRight'],
  b1: ['KeyJ'], b2: ['KeyK'], b3: ['KeyL'], b4: ['KeyI'],
  sprint: ['ShiftLeft', 'ShiftRight'], precise: ['Space', 'ControlLeft'], modA: ['KeyQ'], modB: ['KeyE'], skillBtn: ['KeyR'],
  skill1: ['KeyU', 'Digit1'], skill2: ['KeyO', 'Digit2'], skill3: ['KeyM', 'Digit3'], skill4: ['Period', 'Digit4'], pause: ['Escape', 'KeyP'],
};
export const DEFAULT_KEYBOARD_P2: KeyBindings = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  rUp: ['Numpad8'], rDown: ['Numpad5'], rLeft: ['Numpad4'], rRight: ['Numpad6'],
  b1: ['Numpad1', 'Comma'], b2: ['Numpad2', 'Period'], b3: ['Numpad3', 'Slash'], b4: ['Numpad0', 'Semicolon'],
  sprint: ['NumpadAdd', 'Quote'], precise: ['NumpadEnter'], modA: ['Numpad7'], modB: ['Numpad9'], skillBtn: ['NumpadDecimal'],
  skill1: ['Numpad4'], skill2: ['Numpad6'], skill3: ['Numpad5'], skill4: ['Numpad8'], pause: ['Escape'],
};
export const DEFAULT_PAD: PadBindings = {
  b1: [0], b2: [3], b3: [2], b4: [1], sprint: [7], precise: [6], modA: [4], modB: [5], skillBtn: [11], skill1: [], skill2: [], skill3: [], skill4: [], pause: [9],
};

export const TOUCH_DEFAULT_LAYOUT: Record<string, TouchButtonLayout> = {
  b1: { x: 0.86, y: 0.72, s: 1.15 }, b2: { x: 0.74, y: 0.56, s: 0.95 }, b3: { x: 0.92, y: 0.46, s: 0.95 }, b4: { x: 0.76, y: 0.82, s: 1.0 },
  sprint: { x: 0.62, y: 0.78, s: 0.85 }, skillBtn: { x: 0.58, y: 0.6, s: 0.8 }, precise: { x: 0.46, y: 0.84, s: 0.7 }, modB: { x: 0.62, y: 0.4, s: 0.7 }, modA: { x: 0.5, y: 0.7, s: 0.7 },
  skill1: { x: 0.34, y: 0.38, s: 0.62 }, skill2: { x: 0.42, y: 0.3, s: 0.62 }, skill3: { x: 0.5, y: 0.38, s: 0.62 }, skill4: { x: 0.42, y: 0.46, s: 0.62 },
  pause: { x: 0.5, y: 0.06, s: 0.5 }, joystick: { x: 0.14, y: 0.7, s: 1 },
};

export function defaultSettings(mobile: boolean): Settings {
  return {
    version: 4,
    graphics: { preset: mobile ? 'Low' : 'Medium', custom: {}, fpsCap: mobile ? 60 : 0, showFps: false, grade: 'broadcast', autoDetected: false, resolutionScale: 1, ballTrail: true, weatherEffects: true },
    audio: { master: 0.8, music: 0.5, crowd: 0.8, sfx: 0.9, menuMusic: true, muteOnBlur: true, dynamicCrowd: true, ticker: true, tts: false },
    controls: {
      device: 'auto', keyboard: structuredClone(DEFAULT_KEYBOARD), keyboardP2: structuredClone(DEFAULT_KEYBOARD_P2), gamepad: structuredClone(DEFAULT_PAD),
      profile: 'Default', profiles: {}, sensitivity: 1, deadzone: 0.18, vibration: true, mouseAim: true,
      touch: { layout: structuredClone(TOUCH_DEFAULT_LAYOUT), opacity: 0.7, joystickSize: 1, joystickSensitivity: 1, skillMode: 'flick', autoAssist: 0.6, haptics: true, presets: {} },
      assist: { pass: 0.85, shot: 0.75, cross: 0.8, keeper: 0.6, aim: 0.65, autoSwitch: true },
      skillLoadout: [...DEFAULT_LOADOUT], skillLoadoutAlt: [...DEFAULT_LOADOUT_ALT], skillOverrides: {}, skillBindings: {},
    },
    gameplay: {
      difficulty: 'Professional', halfLength: 5, gameSpeed: 'normal', refStrictness: 0.5, offside: true, foulFrequency: 1, injuries: true, fatigue: true, camera: mobile ? 'mobile' : 'broadcast',
      cameraHeight: 1, cameraZoom: 1, radar: true, playerNames: true, staminaBars: true, ticker: true, dynamicDifficulty: false, var: false, language: 'en', celebrations: {}, extraTimeAndPens: true,
      weather: 'clear', timeOfDay: 'day', stadium: 'random',
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
      this.value = deepMerge(defaultSettings(this.mobile), stored);
      if (prev < 2) {
        // v2: new two-handed keyboard layout, uncapped frame pacing on desktop, softer defaults
        const d = defaultSettings(this.mobile);
        this.value.controls.keyboard = d.controls.keyboard;
        this.value.graphics.fpsCap = d.graphics.fpsCap;
        this.value.version = 2;
      }
      if (prev < 4) {
        // v4: even stronger default passing/shooting assists
        this.value.controls.assist = { ...defaultSettings(this.mobile).controls.assist };
        this.value.version = 4;
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
