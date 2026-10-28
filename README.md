# Football Simulator

A browser football (soccer) game: real-time top-down 2D matches, a manager/player career, tournaments and training drills. It runs entirely client-side (static files, saves in IndexedDB) and deploys to GitHub Pages.

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

Debug pages: `/?debug=pose` (contact sheet of every figure animation), `/?debug=match&tod=night&weather=rain&stadium=3&q=High&cam=tele` (AI vs AI with a chosen look; add `&fx=60&fy=-30&fw=50` to pin the camera).

## Deploy to GitHub Pages

`.github/workflows/deploy.yml` typechecks, tests, builds with `VITE_BASE=/<repo>/` and publishes `dist/` on every push to `main`. Enable *Settings → Pages → Source: GitHub Actions*. For other hosts set `VITE_BASE` (default `/`, or `/<repo>/` when `GITHUB_REPOSITORY` is set).

## What is in it

| Area | Notes |
|---|---|
| Match engine (`src/match`) | Custom ball physics (drag, Magnus curl, spin bounce, posts/bar/net), fixed 60 Hz step, rules (offside, fouls, advantage, cards, penalties, set pieces, injuries, subs, added time, extra time, shootouts, optional VAR), formation-based team AI with roles/tactics, keeper AI, 45 skill moves, replay buffer |
| Rendering (`src/render`) | Canvas 2D, top-down. Procedurally animated figures (run cycle, kicks with wind-up/strike/follow-through, tackles, slides, headers, keeper dives, 12 skill-move animations whose feet track the ball, celebrations), foot-swoosh trails, a ball whose panels follow its real spin, baked mowing-pattern pitch with wear and skid marks, net ripples, 8 stadium styles (stands with ~20k individual fans that bounce when excited, roofs, ad boards with a live LED score, dugouts, floodlight masts), rain/snow/fog, day/dusk/night lighting (no bloom), particles, camera punch/shake and hit-stop for weight, quality presets |
| Input (`src/input`) | Keyboard + mouse, gamepad, multi-touch (floating stick, contextual buttons, flick/skill pad, layout editor), auto device switching, rebinding with conflict detection and profiles, skill-gesture rebinding |
| Modes | Quick match, Career (manager or "be a pro"), Tournament (group + knockout or cup), Skill games & training, Local versus / co-op |
| Career (`src/manager`) | 5 leagues × 2 divisions, fixtures, tables, cups, promotion/relegation, transfers with AI market, scouting, finances & facilities, youth, board objectives, job offers, save/export/import. Simulation runs in a Web Worker |

See [CONTROLS.md](CONTROLS.md), [DECISIONS.md](DECISIONS.md) and [CREDITS.md](CREDITS.md).
