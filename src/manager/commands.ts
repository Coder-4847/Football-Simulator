import { applyResult, endWeek, nextUserFixture, simFixture, simulateWeek, userFixtureThisWeek, type WeekReport } from './career';
import type { CareerState } from './state';

export type Command =
  | { cmd: 'simWeek' }                          // sims AI fixtures of this week; returns the user's fixture id (if any)
  | { cmd: 'finishWeek' }                       // economy, transfers, rollover etc.
  | { cmd: 'autoWeek' }                         // simWeek + sim user's match + finishWeek
  | { cmd: 'toNextMatch' }                      // auto weeks until the user has a fixture (does not play it)
  | { cmd: 'toSeasonEnd' };                     // everything auto until the season rolls over

export interface CommandResult { state: CareerState; report: { userFixtureId: string | null; seasonEnded: boolean; sacked: boolean; weeks: number } }

/** Pure command executor shared by the Web Worker and the in-thread fallback. */
export function execute(state: CareerState, c: Command): CommandResult {
  let seasonEnded = false, sacked = false, weeks = 0;
  let userFixtureId: string | null = null;
  const step = (autoUser: boolean): WeekReport => {
    const rep = simulateWeek(state);
    if (rep.userFixture && autoUser) applyResult(state, rep.userFixture, simFixture(state, rep.userFixture));
    return rep;
  };
  switch (c.cmd) {
    case 'simWeek': { const rep = step(false); userFixtureId = rep.userFixture?.id ?? null; break; }
    case 'finishWeek': { const r = endWeek(state); seasonEnded = r.seasonEnded; sacked = r.sacked; weeks = 1; break; }
    case 'autoWeek': { step(true); const r = endWeek(state); seasonEnded = r.seasonEnded; sacked = r.sacked; weeks = 1; break; }
    case 'toNextMatch': {
      for (let i = 0; i < 60; i++) {
        if (userFixtureThisWeek(state)) { userFixtureId = userFixtureThisWeek(state)!.id; break; }
        step(false); const r = endWeek(state); weeks++; seasonEnded ||= r.seasonEnded; if (r.sacked) { sacked = true; break; }
      }
      if (!userFixtureId && nextUserFixture(state)) userFixtureId = null;
      break;
    }
    case 'toSeasonEnd': {
      const start = state.season;
      while (state.season === start) { step(true); const r = endWeek(state); weeks++; if (r.sacked) { sacked = true; break; } }
      seasonEnded = state.season !== start;
      break;
    }
  }
  return { state, report: { userFixtureId, seasonEnded, sacked, weeks } };
}
