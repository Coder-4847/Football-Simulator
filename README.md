# Football Simulator

A football (soccer) **manager** game that runs entirely in your browser. Pick a club, set the formation, lineup and tactics, buy and sell players, then watch the match play out on a goal-to-goal top-down pitch — in about a minute. There is no player control: you manage, the squad plays.

**Everything in the game is fictional and procedurally generated** — clubs, leagues, nations, players, kits, stadiums and sponsors. There are no real names, trademarks or licensed assets, and no third-party media files (audio is synthesised in the browser).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/
npm test             # vitest unit/sim tests
npm run test:e2e     # Playwright smoke tests (builds + previews first)
```

If Playwright's browser download is unavailable, point it at any Chromium: `PW_CHROMIUM=/path/to/chrome npm run test:e2e`.

Debug pages: `/?debug=pose` (contact sheet of every figure animation), `/?debug=match&tod=night&weather=rain&stadium=3&q=High&cam=drone` (AI vs AI with a chosen look).

## Deploy to GitHub Pages

`.github/workflows/deploy.yml` typechecks, tests, builds with `VITE_BASE=/<repo>/` and publishes `dist/` on every push to `main`. Enable *Settings → Pages → Source: GitHub Actions*. For other hosts set `VITE_BASE` (default `/`, or `/<repo>/` when `GITHUB_REPOSITORY` is set).

## What is in it

| Area | Notes |
|---|---|
| Landing page (`src/ui/app.ts`, `backdrop.ts`) | A live AI-vs-AI match plays behind the menu; continue-career card, exhibition, tournament, settings |
| Career (`src/manager`, `src/ui/career.ts`) | 5 leagues × 2 divisions, fixtures, tables, cups, promotion/relegation, transfers with an AI market, scouting, finances and facilities, youth, board objectives, job offers, save/export/import. Simulation runs in a Web Worker |
| Manager tools (`src/ui/components.ts`) | Formation picker, drag-to-swap pitch lineup editor, tactics sliders and style presets, opposition report, head-to-head compare, player cards, training focus |
| Match engine (`src/match`) | Custom ball physics, fixed 60 Hz step, rules (offside, fouls, advantage, cards, penalties, set pieces, injuries, subs, added time, extra time, shootouts, optional VAR), formation-based team AI with roles/tactics, keeper AI. Runs headless |
| Match viewer (`src/render`, `src/ui/session.ts`) | Canvas 2D goal-to-goal camera (plus two follow cameras), procedural figures, 8 stadium styles, weather, day/dusk/night, speed control, fast-forward, live tactics and substitutions, half-time and full-time reports |
| Modes | Career, Exhibition match (any two clubs), Tournament (group + knockout or cup) |

## Match pacing

The engine simulates a full match, but it runs time-compressed (4× base). Match length is a setting:

| Length | Simulated halves | Real time at 1× |
|---|---|---|
| Blitz | 2 × 1.5 min | ~45 s |
| Standard (default) | 2 × 2.5 min | ~75 s |
| Extended | 2 × 4 min | ~2 min |

Playback speed (0.5×, 1×, 2×, 4×) can be set in Settings → Match and changed live; **Finish** fast-forwards to the end of the period.

See [CONTROLS.md](CONTROLS.md), [DECISIONS.md](DECISIONS.md) and [CREDITS.md](CREDITS.md).
