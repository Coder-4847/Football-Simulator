import { generateWorld } from '../data/generate';
import { Match } from '../match/match';
import { worldSetup } from '../match/setup';
import { defaultMatchConfig } from '../match/types';
import { MatchView } from '../render/matchview';
import { qualityFor, type QualityName } from '../render/quality';
import { GameLoop } from '../core/loop';

/** Debug page: AI-vs-AI match rendered with URL-configurable look (?tod=night&weather=rain&stadium=3&q=High&cam=tele). */
export function matchPreview(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  canvas.parentElement!.style.cssText = 'position:fixed;inset:0';
  const world = generateWorld({ seed: 'preview' });
  const lg = Object.values(world.leagues).find((l) => l.tier === 1)!;
  const [h, a] = worldSetup(world, lg.clubs[0]!, lg.clubs[1]!);
  const cfg = { ...defaultMatchConfig(), seed: 'preview', halfLength: 5, headless: true, timeOfDay: (params.get('tod') ?? 'day') as 'day', weather: (params.get('weather') ?? 'clear') as 'clear', stadiumStyle: Number(params.get('stadium') ?? 0) };
  const match = new Match(cfg, h, a);
  const view = new MatchView(canvas, match, { quality: qualityFor((params.get('q') ?? 'Medium') as QualityName), grade: 'broadcast', cameraMode: (params.get('cam') ?? 'broadcast') as 'broadcast', cameraHeight: 1, cameraZoom: Number(params.get('zoom') ?? 1), showFps: true, fpsCap: 0, celebrationSeed: 1, trail: true });
  if (params.get('fx')) view.director.debugFocus = { x: Number(params.get('fx')), y: Number(params.get('fy') ?? 0), width: Number(params.get('fw') ?? 40) };
  match.startMatch();
  const warm = Number(params.get('warm') ?? 0);
  for (let i = 0; i < warm * 60; i++) { if (match.phase === 'halftime') match.startNextPeriod(); match.step(1 / 60); }
  const loop = new GameLoop({ update: (dt) => { if (match.phase === 'halftime') match.startNextPeriod(); match.step(dt); }, render: (al, dt) => view.update(al, dt, null) });
  loop.start();
  window.addEventListener('resize', () => view.resize());
  (window as unknown as { __fs: unknown }).__fs = { match, view, loop };
}
