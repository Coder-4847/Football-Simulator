import type { Formation, FormationSlot, Pos, Role, Tactics } from './types';

const s = (pos: Pos, x: number, y: number, role: Role): FormationSlot => ({ pos, x, y, role });
const GK = s('GK', 0.03, 0.5, 'goalkeeper');

export const FORMATIONS: Formation[] = [
  { id: '4-4-2', name: '4-4-2', slots: [GK,
    s('LB', 0.2, 0.1, 'fullBack'), s('CB', 0.17, 0.35, 'centreBack'), s('CB', 0.17, 0.65, 'centreBack'), s('RB', 0.2, 0.9, 'fullBack'),
    s('LM', 0.45, 0.1, 'winger'), s('CM', 0.42, 0.37, 'boxToBox'), s('CM', 0.42, 0.63, 'anchor'), s('RM', 0.45, 0.9, 'winger'),
    s('ST', 0.7, 0.38, 'targetMan'), s('ST', 0.7, 0.62, 'poacher')] },
  { id: '4-3-3', name: '4-3-3', slots: [GK,
    s('LB', 0.2, 0.1, 'fullBack'), s('CB', 0.17, 0.35, 'centreBack'), s('CB', 0.17, 0.65, 'ballPlayingDefender'), s('RB', 0.2, 0.9, 'fullBack'),
    s('CM', 0.42, 0.3, 'boxToBox'), s('CDM', 0.35, 0.5, 'anchor'), s('CM', 0.42, 0.7, 'playmaker'),
    s('LW', 0.68, 0.12, 'invertedWinger'), s('ST', 0.76, 0.5, 'advancedForward'), s('RW', 0.68, 0.88, 'winger')] },
  { id: '4-2-3-1', name: '4-2-3-1', slots: [GK,
    s('LB', 0.2, 0.1, 'fullBack'), s('CB', 0.17, 0.35, 'centreBack'), s('CB', 0.17, 0.65, 'centreBack'), s('RB', 0.2, 0.9, 'fullBack'),
    s('CDM', 0.35, 0.36, 'anchor'), s('CDM', 0.35, 0.64, 'boxToBox'),
    s('LW', 0.6, 0.12, 'invertedWinger'), s('CAM', 0.57, 0.5, 'playmaker'), s('RW', 0.6, 0.88, 'winger'),
    s('ST', 0.78, 0.5, 'targetMan')] },
  { id: '3-5-2', name: '3-5-2', slots: [GK,
    s('CB', 0.17, 0.25, 'centreBack'), s('CB', 0.15, 0.5, 'ballPlayingDefender'), s('CB', 0.17, 0.75, 'centreBack'),
    s('LWB', 0.42, 0.06, 'wingBack'), s('CM', 0.4, 0.33, 'boxToBox'), s('CDM', 0.34, 0.5, 'anchor'), s('CM', 0.4, 0.67, 'playmaker'), s('RWB', 0.42, 0.94, 'wingBack'),
    s('ST', 0.72, 0.38, 'targetMan'), s('ST', 0.72, 0.62, 'poacher')] },
  { id: '4-1-4-1', name: '4-1-4-1', slots: [GK,
    s('LB', 0.2, 0.1, 'fullBack'), s('CB', 0.17, 0.35, 'centreBack'), s('CB', 0.17, 0.65, 'centreBack'), s('RB', 0.2, 0.9, 'fullBack'),
    s('CDM', 0.32, 0.5, 'anchor'),
    s('LM', 0.5, 0.1, 'winger'), s('CM', 0.47, 0.37, 'boxToBox'), s('CM', 0.47, 0.63, 'playmaker'), s('RM', 0.5, 0.9, 'winger'),
    s('ST', 0.77, 0.5, 'targetMan')] },
  { id: '5-3-2', name: '5-3-2', slots: [GK,
    s('LWB', 0.26, 0.06, 'wingBack'), s('CB', 0.16, 0.27, 'centreBack'), s('CB', 0.14, 0.5, 'ballPlayingDefender'), s('CB', 0.16, 0.73, 'centreBack'), s('RWB', 0.26, 0.94, 'wingBack'),
    s('CM', 0.42, 0.3, 'boxToBox'), s('CDM', 0.36, 0.5, 'anchor'), s('CM', 0.42, 0.7, 'playmaker'),
    s('ST', 0.72, 0.38, 'targetMan'), s('ST', 0.72, 0.62, 'poacher')] },
  { id: '4-3-2-1', name: '4-3-2-1', slots: [GK,
    s('LB', 0.2, 0.1, 'fullBack'), s('CB', 0.17, 0.35, 'centreBack'), s('CB', 0.17, 0.65, 'centreBack'), s('RB', 0.2, 0.9, 'fullBack'),
    s('CM', 0.4, 0.28, 'boxToBox'), s('CDM', 0.34, 0.5, 'anchor'), s('CM', 0.4, 0.72, 'boxToBox'),
    s('CAM', 0.6, 0.33, 'shadowStriker'), s('CAM', 0.6, 0.67, 'shadowStriker'), s('ST', 0.78, 0.5, 'advancedForward')] },
  { id: '3-4-3', name: '3-4-3', slots: [GK,
    s('CB', 0.17, 0.25, 'centreBack'), s('CB', 0.15, 0.5, 'ballPlayingDefender'), s('CB', 0.17, 0.75, 'centreBack'),
    s('LM', 0.42, 0.1, 'wingBack'), s('CM', 0.4, 0.38, 'boxToBox'), s('CM', 0.4, 0.62, 'playmaker'), s('RM', 0.42, 0.9, 'wingBack'),
    s('LW', 0.7, 0.15, 'invertedWinger'), s('ST', 0.76, 0.5, 'advancedForward'), s('RW', 0.7, 0.85, 'winger')] },
  { id: '4-4-2d', name: '4-4-2 Diamond', slots: [GK,
    s('LB', 0.2, 0.1, 'fullBack'), s('CB', 0.17, 0.35, 'centreBack'), s('CB', 0.17, 0.65, 'centreBack'), s('RB', 0.2, 0.9, 'fullBack'),
    s('CDM', 0.34, 0.5, 'anchor'), s('CM', 0.45, 0.27, 'boxToBox'), s('CM', 0.45, 0.73, 'boxToBox'), s('CAM', 0.58, 0.5, 'playmaker'),
    s('ST', 0.74, 0.38, 'targetMan'), s('ST', 0.74, 0.62, 'poacher')] },
  { id: '5-4-1', name: '5-4-1', slots: [GK,
    s('LWB', 0.26, 0.06, 'wingBack'), s('CB', 0.16, 0.27, 'centreBack'), s('CB', 0.14, 0.5, 'centreBack'), s('CB', 0.16, 0.73, 'centreBack'), s('RWB', 0.26, 0.94, 'wingBack'),
    s('LM', 0.45, 0.15, 'winger'), s('CM', 0.4, 0.38, 'anchor'), s('CM', 0.4, 0.62, 'boxToBox'), s('RM', 0.45, 0.85, 'winger'),
    s('ST', 0.72, 0.5, 'targetMan')] },
];

export const formationById = (id: string): Formation => FORMATIONS.find((f) => f.id === id) ?? (FORMATIONS[0] as Formation);

export const STYLE_TACTICS: Record<Tactics['style'], Omit<Tactics, 'style' | 'marking'>> = {
  balanced: { lineHeight: 50, compactness: 55, width: 50, pressing: 50, tempo: 50, directness: 50, offsideTrap: false },
  possession: { lineHeight: 62, compactness: 60, width: 55, pressing: 55, tempo: 40, directness: 25, offsideTrap: false },
  counter: { lineHeight: 35, compactness: 65, width: 45, pressing: 35, tempo: 70, directness: 75, offsideTrap: false },
  highPress: { lineHeight: 75, compactness: 70, width: 55, pressing: 85, tempo: 70, directness: 55, offsideTrap: true },
  longBall: { lineHeight: 50, compactness: 55, width: 45, pressing: 45, tempo: 60, directness: 90, offsideTrap: false },
  park: { lineHeight: 20, compactness: 80, width: 35, pressing: 25, tempo: 45, directness: 70, offsideTrap: false },
};

export function makeTactics(style: Tactics['style'] = 'balanced'): Tactics {
  return { ...STYLE_TACTICS[style], style, marking: 'mixed' };
}

export const KEY_ATTR_NOTE = 'Formation x: 0 = own goal line, 1 = opponent goal line. y: 0 = left (attacking view), 1 = right.';
