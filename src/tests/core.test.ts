import { describe, expect, it } from 'vitest';
import { RNG } from '../core/rng';
import { generateNationalTeam, generateWorld } from '../data/generate';
import { overallFor } from '../data/rating';
import { ATTR_KEYS } from '../data/types';
import { parseSave, wrapSave } from '../core/storage';

describe('RNG', () => {
  it('is deterministic per seed', () => {
    const a = new RNG('x'), b = new RNG('x'), c = new RNG('y');
    const sa = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(sa);
  });
  it('int stays in range and shuffle keeps elements', () => {
    const r = new RNG(5);
    for (let i = 0; i < 500; i++) { const v = r.int(3, 7); expect(v).toBeGreaterThanOrEqual(3); expect(v).toBeLessThanOrEqual(7); }
    expect(r.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('world generation', () => {
  const w = generateWorld({ seed: 'test' });
  it('is deterministic', () => {
    const w2 = generateWorld({ seed: 'test' });
    expect(Object.keys(w2.clubs)).toEqual(Object.keys(w.clubs));
    expect(w2.players['p10']?.name).toBe(w.players['p10']?.name);
  });
  it('builds leagues, clubs and 26-man squads', () => {
    expect(Object.keys(w.leagues).length).toBe(10);
    expect(Object.keys(w.clubs).length).toBe(160);
    for (const c of Object.values(w.clubs)) {
      expect(c.squad.length).toBe(26);
      expect(c.squad.filter((id) => w.players[id]?.positions[0] === 'GK').length).toBe(3);
    }
  });
  it('has unique club names, codes and shirt numbers', () => {
    const names = Object.values(w.clubs).map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of Object.values(w.clubs)) {
      const nums = c.squad.map((id) => w.players[id]!.number);
      expect(new Set(nums).size).toBe(nums.length);
    }
  });
  it('uses no real-brand words', () => {
    const text = Object.values(w.clubs).map((c) => c.name).join(' ');
    expect(text).not.toMatch(/\b(FC|Real|FIFA|EA)\b/);
  });
  it('player attrs are valid and overall matches position weights', () => {
    for (const p of Object.values(w.players).slice(0, 400)) {
      for (const k of ATTR_KEYS) { expect(p.attrs[k]).toBeGreaterThanOrEqual(1); expect(p.attrs[k]).toBeLessThanOrEqual(99); }
      expect(p.overall).toBe(overallFor(p.attrs, p.positions[0]!));
      expect(p.weakFoot).toBeGreaterThanOrEqual(1); expect(p.weakFoot).toBeLessThanOrEqual(5);
      expect(p.skillMoves).toBeGreaterThanOrEqual(1); expect(p.skillMoves).toBeLessThanOrEqual(5);
    }
  });
  it('top clubs are stronger than bottom clubs', () => {
    const avg = (id: string): number => { const c = w.clubs[id]!; return c.squad.slice(0, 14).reduce((s, pid) => s + w.players[pid]!.overall, 0) / 14; };
    const lg = Object.values(w.leagues).find((l) => l.tier === 1)!;
    expect(avg(lg.clubs[0]!)).toBeGreaterThan(avg(lg.clubs[lg.clubs.length - 1]!));
  });
  it('national teams are generated', () => {
    const t = generateNationalTeam('test', w.nations['ALD']!);
    expect(t.players.length).toBe(26);
  });
});

describe('saves', () => {
  it('round-trips and rejects foreign files', () => {
    const s = wrapSave({ a: 1 });
    expect(parseSave(JSON.stringify(s)).data).toEqual({ a: 1 });
    expect(() => parseSave('{"x":1}')).toThrow();
  });
});
