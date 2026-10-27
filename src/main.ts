import { generateWorld } from './data/generate';
import { Match } from './match/match';
import { worldSetup } from './match/setup';
import { defaultMatchConfig } from './match/types';
import { MatchView } from './render/matchview';
import { qualityFor } from './render/quality';
import { GameLoop } from './core/loop';

const app = document.getElementById('app')!;
app.style.cssText = 'position:fixed;inset:0;background:#000';
const canvas = document.createElement('canvas');
const wrap = document.createElement('div'); wrap.style.cssText = 'position:absolute;inset:0'; wrap.appendChild(canvas); app.appendChild(wrap);
const params = new URLSearchParams(location.search);
if (params.get('debug') === 'pose') { import('./debug/posegrid').then((m) => m.poseGrid(canvas)); throw new Error('debug-pose-mode'); }
const world = generateWorld({ seed: 'preview' });
const lg = Object.values(world.leagues).find((l) => l.tier === 1)!;
const [h, a] = worldSetup(world, lg.clubs[0]!, lg.clubs[1]!);
const cfg = { ...defaultMatchConfig(), seed: 'preview', halfLength: 5, headless: true, timeOfDay: (params.get('tod') as 'day') ?? 'day', weather: (params.get('weather') as 'clear') ?? 'clear', stadiumStyle: Number(params.get('stadium') ?? 0) };
const match = new Match(cfg, h, a);
const q = qualityFor((params.get('q') as 'Medium') ?? 'Medium');
const view = new MatchView(canvas, match, { quality: q, grade: 'broadcast', cameraMode: (params.get('cam') as 'broadcast') ?? 'broadcast', cameraHeight: 1, cameraZoom: 1, showFps: true, fpsCap: 0, celebrationSeed: 1, trail: true });
match.startMatch();
let acc = 0;
const loop = new GameLoop({
  update: (dt) => { if (match.phase === 'halftime') match.startNextPeriod(); match.step(dt); },
  render: (alpha, dt) => { acc += dt; view.update(alpha, dt, null); },
});
loop.start();
(window as unknown as { __fs: unknown }).__fs = { match, view, loop };
window.addEventListener('resize', () => view.resize());
