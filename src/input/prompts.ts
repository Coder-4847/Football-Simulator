import type { Btn, Context } from './actions';
import { CONTEXT_LABELS } from './actions';

export type Device = 'keyboard' | 'gamepad' | 'touch';

const PAD_LABEL: Record<number, string> = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'Back', 9: 'Start', 10: 'L3', 11: 'R3', 12: '↑', 13: '↓', 14: '←', 15: '→' };

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  const map: Record<string, string> = { ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', Space: 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", AltLeft: 'Alt', Tab: 'Tab' };
  return map[code] ?? code;
}
export function padLabel(i: number): string { return PAD_LABEL[i] ?? `Btn${i}`; }

export interface BindingView { keyboard: Record<string, string[]>; gamepad: Record<string, number[]> }

/** Human-readable label for a button, given the active device and context. */
export function promptFor(btn: Btn, ctx: Context, device: Device, b: BindingView): { key: string; action: string } {
  const action = CONTEXT_LABELS[ctx][btn] ?? '';
  let key = '';
  if (device === 'keyboard') key = (b.keyboard[btn] ?? []).slice(0, 1).map(keyLabel).join('/');
  else if (device === 'gamepad') key = (b.gamepad[btn] ?? []).slice(0, 1).map(padLabel).join('/');
  else key = action;
  return { key, action };
}

/** Finds conflicting bindings (same physical key bound to two different actions). */
export function findKeyConflicts(map: Record<string, string[]>): Array<{ code: string; actions: string[] }> {
  const seen = new Map<string, string[]>();
  for (const [action, codes] of Object.entries(map)) for (const c of codes) seen.set(c, [...(seen.get(c) ?? []), action]);
  return [...seen.entries()].filter(([, a]) => a.length > 1).map(([code, actions]) => ({ code, actions }));
}
export function findPadConflicts(map: Record<string, number[]>): Array<{ code: number; actions: string[] }> {
  const seen = new Map<number, string[]>();
  for (const [action, codes] of Object.entries(map)) for (const c of codes) seen.set(c, [...(seen.get(c) ?? []), action]);
  return [...seen.entries()].filter(([, a]) => a.length > 1).map(([code, actions]) => ({ code, actions }));
}
