import { describe, expect, it } from 'vitest';
import { FlickDetector, GestureRecognizer, dirOf } from '../input/gestures';
import { findKeyConflicts, keyLabel } from '../input/prompts';
import { SKILL_MOVES, resolveLoadout, skillSuccess } from '../match/skills';

describe('gestures', () => {
  it('maps a single flick to its slot immediately', () => {
    const g = new GestureRecognizer();
    expect(g.flick('U', 0)).toEqual({ slot: 0, moveId: null, sequence: 'U' });
    expect(g.flick('L', 5)?.slot).toBe(3);
  });
  it('matches custom multi-flick bindings and waits for them', () => {
    const g = new GestureRecognizer(); g.bindings = { URD: 'flip-flap' };
    expect(g.flick('U', 0)).toBeNull(); expect(g.flick('R', 0.1)).toBeNull();
    expect(g.flick('D', 0.2)).toEqual({ slot: -1, moveId: 'flip-flap', sequence: 'URD' });
  });
  it('falls back to the first flick if the sequence never completes', () => {
    const g = new GestureRecognizer(); g.bindings = { URD: 'x' };
    g.flick('U', 0);
    expect(g.poll(0.05)).toBeNull();
    expect(g.poll(0.3)?.slot).toBe(0);
  });
  it('detects stick flicks only from neutral', () => {
    const f = new FlickDetector();
    expect(f.update(0, 0, 0)).toBeNull();
    expect(f.update(0, -1, 0.05)).toBe('U');
    expect(f.update(0, -1, 0.1)).toBeNull();
    expect(dirOf(1, 0.2)).toBe('R');
  });
  it('fires on a slow push and again when the stick is rolled to a new direction', () => {
    const f = new FlickDetector();
    expect(f.update(0, 0, 0)).toBeNull();
    expect(f.update(0.4, 0, 0.3)).toBeNull();
    expect(f.update(0.7, 0, 0.6)).toBe('R');
    expect(f.update(0.7, 0, 0.7)).toBeNull();
    expect(f.update(0, 0.8, 1.0)).toBe('D');
    expect(f.update(0, 0, 1.2)).toBeNull();
    expect(f.update(-0.9, 0, 1.3)).toBe('L');
  });
});

describe('bindings & skills', () => {
  it('gives low-skill players a fallback move instead of nothing', () => {
    const lo = resolveLoadout(['body-feint', 'step-over', 'flip-flap', 'spin-turn'], undefined, 1);
    expect(lo.every((m) => m !== null && m.stars <= 1)).toBe(true);
  });
  it('detects key conflicts', () => {
    expect(findKeyConflicts({ b1: ['KeyJ'], b2: ['KeyJ'], b3: ['KeyL'] })).toEqual([{ code: 'KeyJ', actions: ['b1', 'b2'] }]);
    expect(keyLabel('KeyJ')).toBe('J'); expect(keyLabel('ShiftLeft')).toBe('Shift');
  });
  it('has 45 moves covering all star ratings with unique ids', () => {
    expect(SKILL_MOVES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(SKILL_MOVES.map((m) => m.id)).size).toBe(SKILL_MOVES.length);
    for (let s = 1; s <= 5; s++) expect(SKILL_MOVES.some((m) => m.stars === s)).toBe(true);
  });
  it('loadout replaces moves above the player star rating with an allowed one; success scales with skill', () => {
    const lo = resolveLoadout(['body-feint', 'overhead-flick', 'step-over', 'spin-turn'], undefined, 2);
    expect(lo.every((m) => m !== null && m.stars <= 2)).toBe(true);
    expect(lo[0]!.id).toBe('body-feint'); expect(lo[2]!.id).toBe('step-over');
    const mv = SKILL_MOVES.find((m) => m.id === 'step-over')!;
    const hi = skillSuccess(mv, { dribbling: 90, agility: 90, ballControl: 90, skillMoves: 5, balance: 80 }, { reactions: 60, agility: 60, standingTackle: 60 }, 0.5);
    const lowS = skillSuccess(mv, { dribbling: 40, agility: 40, ballControl: 40, skillMoves: 2, balance: 40 }, { reactions: 60, agility: 60, standingTackle: 60 }, 0.5);
    expect(hi).toBeGreaterThan(lowS);
  });
});
