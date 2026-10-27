# Design decisions

The original brief was cut off mid-way (after the Settings section); sections 7+ (including the manager-mode details) were not available, so the career mode follows the feature list in the brief's goals plus common manager-game conventions.

## Scope honesty — what is simplified or not done
- **Online play (optional, last priority): not built.**
- **WebGPU**: not used. All rendering uses WebGL2 (post-processing and shaders depend on it).
- **Animation** is a procedural humanoid (articulated skinned meshes, state machine + IK), not mocap/blend-tree clips — no restrictive-licence assets (e.g. Mixamo) are used. Cloth: hair spring only; shirts do not flutter. Skill-move animations are stylised approximations.
- **Intro**: a line-up screen over a camera shot instead of a full tunnel walk-out; no anthem stinger beyond the generated whistle/music.
- **Volumetric light shafts, SSAO and depth of field** are listed in the quality presets but not implemented; presets only toggle what exists (bloom, SMAA/FXAA, vignette, grain, afterimage "motion blur", shadows, grass blades, crowd, weather).
- Commentary is text-only (optional browser TTS).
- Captain's armband, tifos/flares and ball boys that move are not modelled (static ball boys, camera crews, bench/dugouts are).
- Tournaments have at most 24 nations (24 fictional nations exist).
- Per-player celebration choice exists (6 celebrations); goal-celebration camera orbits the scorer.

## Technical choices
- **Coordinates**: pitch metres, x along length, y across, z up (maps to Three X, Z, Y). Match logic never imports Three, so the whole match runs headless in Vitest.
- **Determinism**: every random decision uses a seeded RNG (`core/rng.ts`); matches, world generation, the career sim and tournaments are reproducible and tested.
- **Dribbling** is a soft spring between player and ball with stride-based touch oscillation; the ball is free-physics otherwise. Kicks hold the ball for 60–90 ms so the leg animation reaches it first.
- **Difficulty** changes AI reaction time, decision quality, pressing and keeper reaction — never physics.
- **Career in a worker**: the authoritative state lives on the main thread; heavy commands (`simWeek`, `toSeasonEnd`, …) are structured-cloned to a Web Worker and the new state is cloned back (falls back to the main thread if workers are unavailable). Played matches (3D) are converted into the same result shape as simulated ones.
- **Injuries** in career are stored as weeks remaining (`injuredUntil`).
- **Saves**: IndexedDB with localStorage fallback; career saves and settings can be exported/imported as JSON.
- **Quality auto-detect**: heuristics (GPU string, mobile, cores/memory) refined by a ~0.4 s GPU micro-benchmark on first launch; software renderers and phones default to Low/Medium.

## Controls deviations
- Keyboard **shoot = I** (not Space): Space is the "run / second press" modifier (listed in the table too) and cannot be both.
- **Low cross = Q + L** (the brief's Shift+L conflicts with Shift = sprint, so every sprinting cross would be low). Rebindable.
- Arrow keys are the right stick (skill flicks / switch direction); WASD moves. Number keys 1–4 trigger skill slots; Alt or middle-mouse + mouse movement flicks.
- Skill-move names are descriptive, not trademarked move names.

## Rules simplifications
- Offside is judged at the moment of the pass with the receiver's touch; marginal offsides can be missed by the assistant (and caught by VAR if enabled). Only direct play involvement counts (no "interfering with the keeper").
- VAR (optional): goals can be chalked off for a missed offside/foul in the build-up, penalties can be overturned, red cards downgraded.
- Wet pitch = faster ball, lower grip (occasional slips); snow = slower ball and bounce.

## Two-handed keyboard layout, pad hot-plug, smoothing (v2 settings)
- Keyboard defaults moved to a strict two-hand split: left hand WASD + Shift + Space + Q/E, right hand J/K/L/I with U/O/M/. skill slots. Arrow keys and 1–4 remain alternates. Settings `version: 2` resets saved keyboard bindings once so existing players get the new layout.
- Gamepads are only exposed by browsers after the first button press, so the pad slot is now assigned unconditionally (and re-resolved every frame) instead of at match start; a connect/disconnect toast and a pad test card in Settings → Controls were added.
- Player marker rings dimmed (thin, ~40% opacity). Motion smoothing: AI intent low-pass, interpolated stride/speed/state time for rendering, smoothed ball lookahead in the camera, paced FPS cap, MSAA by default on Medium+, radar throttled to ~30 Hz.
