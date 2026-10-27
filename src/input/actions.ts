/**
 * Abstract, device-independent input. Physical devices map onto these; the match layer gives them
 * context-dependent meaning (e.g. b1 = pass when attacking, tackle when defending).
 */
export const BUTTONS = [
  'b1', 'b2', 'b3', 'b4',        // face roles: pass/tackle, through/keeper, lob/slide, shoot/switch
  'sprint', 'precise',           // RT/Shift, LT/Ctrl
  'modA', 'modB',                // LB (chip/low cross) , RB (finesse / run call / second press)
  'skillBtn',                    // touch "skill" modifier
  'skill1', 'skill2', 'skill3', 'skill4',
  'pause',
] as const;
export type Btn = (typeof BUTTONS)[number];

export interface FrameInput {
  /** left stick / WASD / virtual joystick, pitch-aligned (screen up = -y), magnitude 0..1 */
  mx: number; my: number;
  /** right stick / arrows / right pad (for skills) */
  rx: number; ry: number;
  down: Record<Btn, boolean>;
  pressed: Record<Btn, boolean>;
  released: Record<Btn, boolean>;
  /** seconds each button has been held */
  held: Record<Btn, number>;
  /** hold duration of the button at the moment it was released (valid on `released`) */
  heldAtRelease: Record<Btn, number>;
  /** skill slot 0..3 triggered this frame by a gesture, or -1 */
  skillSlot: number;
  /** a specific skill move id triggered by its own binding, or null */
  skillMoveId: string | null;
  /** which device produced the latest input */
  device: 'keyboard' | 'gamepad' | 'touch';
}

const rec = <T>(v: T): Record<Btn, T> => Object.fromEntries(BUTTONS.map((b) => [b, v])) as Record<Btn, T>;

export function emptyFrame(): FrameInput {
  return {
    mx: 0, my: 0, rx: 0, ry: 0,
    down: rec(false), pressed: rec(false), released: rec(false), held: rec(0), heldAtRelease: rec(0),
    skillSlot: -1, skillMoveId: null, device: 'keyboard',
  };
}

/** Human-readable meaning of each button per match context (for prompts and touch labels). */
export type Context = 'attack' | 'defend' | 'setpiece' | 'keeper' | 'penalty' | 'menu';
export const CONTEXT_LABELS: Record<Context, Partial<Record<Btn, string>>> = {
  attack: { b1: 'Pass', b2: 'Through', b3: 'Lob / Cross', b4: 'Shoot', sprint: 'Sprint', precise: 'Shield', modA: 'Chip / Low', modB: 'Finesse / Run', skillBtn: 'Skill' },
  defend: { b1: 'Tackle', b2: 'Keeper', b3: 'Slide', b4: 'Switch', sprint: 'Sprint', precise: 'Contain', modA: 'Switch', modB: '2nd Press' },
  setpiece: { b1: 'Short', b2: 'Through', b3: 'Cross', b4: 'Shoot', sprint: 'Run-up', precise: 'Fine aim', modA: 'Wall ←', modB: 'Wall →' },
  keeper: { b1: 'Throw', b2: 'Rush Out', b3: 'Kick', b4: 'Switch', sprint: 'Sprint', precise: 'Hold', modA: 'Dive L', modB: 'Dive R' },
  penalty: { b4: 'Shoot', b3: 'Chip', precise: 'Fine aim', b1: 'Low' },
  menu: {},
};
