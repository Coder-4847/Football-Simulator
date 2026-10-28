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
- Player acceleration raised (9–14.5 m/s², brake ×1.6, softer turn penalty) and selection ring/arrow dimmed further (opacity 0.2, thinner).

## Feel pass (v3 settings)
- Kicks are released faster (frozen-ball delay 25–40 ms, power charge 0.7 s); taps use distance-weighted pass power and a firm shot; moving while kicking is only slowed 30 %. Default assists raised (pass 0.7, shot 0.55, cross 0.65) and stored settings migrate once (`version: 3`); assist now removes more aim error and pulls stick-aimed shots toward the corners.
- Defending: tackle fires on press, bigger human tackle range, +14 % win chance and fewer fouls for human tacklers. Jockey (hold the contain button) caps speed at 62 %, removes the turn penalty, adds +30 % acceleration and blends in auto goal-side positioning.
- Manual switch scores candidates by distance to the carrier / predicted ball, goal-side bonus and closing speed; the stick direction is a filter (from the current player), not the main criterion.
- Camera: default broadcast/mobile/tele cameras ~22 % closer.
- Kick-off: pre-kick everyone is clamped to their own half (defenders outside the circle); the kick-off pass is exact; for 3.2 s afterwards the receiving side's AI cannot advance across halfway, so the first touch always lands with the kicking team.

## Look + skip pass
- Root cause of the "too bright" look: PostStack reset `toneMappingExposure` to 1.0 whenever quality was applied, discarding the per-time-of-day exposure. Exposure is now stored in MatchView and re-applied after the post stack (day 0.66, dusk 0.8, night 1.0). Bloom threshold raised to 1.9 (HDR) with strength 0.16 so sunlit lines no longer glow; floodlight heads/lamps and intensity trimmed.
- Corner and goal-kick cameras previously sat inside the crowd; corners now use a raised far-side view inside the pitch, goal kicks a low view from just behind the goal line.
- Skip: `Match.canSkip()/skipWaiting()` fast-forward goal celebrations, injury stops and set-piece set-up (players snap to spots); the session wires gamepad ✕, L1+R1 (modA+modB), Enter and a HUD chip, and swallows the pressing button so it doesn't also pass.

## Top-down 2D pivot
- The 3D renderer (Three.js, skinned rig, post-processing) was replaced by a Canvas 2D top-down renderer behind the same `MatchView` API, so the match engine, HUD, session, replay buffer and input are unchanged. Three.js and `src/animation` were removed (smaller bundle, no WebGL needed).
- Figures are procedural: shirt sprites are pre-rendered per kit (pattern, shading, collar), legs/boots/arms/head are drawn per frame from a pose solver (`render/players.ts`). Foot targets for dribbling and skill moves come from the ball's position in the player's frame, so touches visibly connect. Animations are smoothed per limb (26-42 Hz) to avoid popping.
- Depth cues without a 3D camera: small upward parallax for the upper body, soft sun-offset shadows (long at dusk, faint at night), ball lift + scale with height, shadows detaching for jumps and dives.
- 'Bloom' is gone entirely. Night/dusk use a low-resolution darkness mask with cut-out light pools; the pitch stays lit while stands fall into shadow.
- Weight: acceleration lowered slightly again (7.6-12.2 m/s², brake x1.5, stronger turn penalty), kick animations have a wind-up and the ball is released at the strike frame (35-55 ms), strong shots/slides add camera punch, shake and 35-50 ms hit-stop.
- Performance: the pitch grass, stadium ground and crowd sections are baked once and blitted clipped to the visible rectangle; only players, ball, particles and markers are drawn per frame.
- Camera modes were renamed for the 2D view: Standard, Close, Wide, Player lock, Full pitch (legacy ids still load). Camera 'height' no longer exists.
