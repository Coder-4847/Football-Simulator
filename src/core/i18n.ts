/** Minimal translation layer: English is the source language; add a dictionary to `DICTS` to localise. */
const EN = {
  'menu.quick': 'Quick match', 'menu.career': 'Career', 'menu.tournament': 'Tournament', 'menu.training': 'Skill games & training',
  'menu.versus': 'Local versus', 'menu.settings': 'Settings', 'menu.credits': 'Credits', 'common.back': 'Back', 'common.resume': 'Resume',
} as const;
export type Key = keyof typeof EN;
const DICTS: Record<string, Partial<Record<Key, string>>> = { en: EN };
let lang = 'en';
export function setLanguage(l: string): void { lang = DICTS[l] ? l : 'en'; }
export const t = (k: Key): string => DICTS[lang]?.[k] ?? EN[k];
