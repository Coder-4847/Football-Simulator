import { generateWorld } from '../data/generate';
import { Match } from '../match/match';
import { worldSetup } from '../match/setup';
import { defaultMatchConfig, type MatchConfig } from '../match/types';

export function makeMatch(seed: string, over: Partial<MatchConfig> = {}, homeIdx = 0, awayIdx = 1): Match {
  const world = generateWorld({ seed: 'headless' });
  const league = Object.values(world.leagues).find((l) => l.tier === 1)!;
  const [h, a] = worldSetup(world, league.clubs[homeIdx]!, league.clubs[awayIdx]!);
  const cfg: MatchConfig = { ...defaultMatchConfig(), seed, headless: true, halfLength: 5, ...over };
  return new Match(cfg, h, a);
}

/** Run until full-time (or maxSeconds of sim time). */
export function runMatch(m: Match, maxSeconds = 1500): void {
  m.startMatch();
  const dt = 1 / 60;
  let t = 0;
  while (!m.ended && t < maxSeconds) {
    if (m.phase === 'halftime' || m.phase === 'extratimeBreak') m.startNextPeriod();
    m.step(dt);
    t += dt;
  }
}
