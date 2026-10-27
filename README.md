# Football Simulator

A browser football (soccer) game: real-time 3D matches, a manager/player career, tournaments and training drills. It runs entirely client-side (static files, saves in IndexedDB) and deploys to GitHub Pages.

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

Debug pages: `/?debug=pose` (animation grid), `/?debug=match&tod=night&weather=rain&stadium=3&q=High&cam=tele` (AI vs AI with a chosen look).

## Deploy to GitHub Pages

`.github/workflows/deploy.yml` typechecks, tests, builds with `VITE_BASE=/<repo>/` and publishes `dist/` on every push to `main`. Enable *Settings → Pages → Source: GitHub Actions*. For other hosts set `VITE_BASE` (default `/`, or `/<repo>/` when `GITHUB_REPOSITORY` is set).

## What is in it

| Area | Notes |
|---|---|
| Match engine (`src/match`) | Custom ball physics (drag, Magnus curl, spin bounce, posts/bar/net), fixed 60 Hz step, rules (offside, fouls, advantage, cards, penalties, set pieces, injuries, subs, added time, extra time, shootouts, optional VAR), formation-based team AI with roles/tactics, keeper AI, 45 skill moves, replay buffer |
| Rendering (`src/render`, `src/animation`) | Three.js (WebGL2). Procedural skinned humanoid rig with state-machine pose solver, two-bone leg IK for ball contact, look-at, hair spring, kit textures/number plates, dirt/sweat; 8 stadium styles with instanced animated crowd, floodlights, weather, sky, post-processing and quality presets |
| Input (`src/input`) | Keyboard + mouse, gamepad, multi-touch (floating stick, contextual buttons, flick/skill pad, layout editor), auto device switching, rebinding with conflict detection and profiles, skill-gesture rebinding |
| Modes | Quick match, Career (manager or "be a pro"), Tournament (group + knockout or cup), Skill games & training, Local versus / co-op |
| Career (`src/manager`) | 5 leagues × 2 divisions, fixtures, tables, cups, promotion/relegation, transfers with AI market, scouting, finances & facilities, youth, board objectives, job offers, save/export/import. Simulation runs in a Web Worker |

See [CONTROLS.md](CONTROLS.md), [DECISIONS.md](DECISIONS.md) and [CREDITS.md](CREDITS.md).
