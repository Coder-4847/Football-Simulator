import { FigurePainter, PlayerAnim, type BallLocal, type PlayerStyle, type RenderPlayer } from '../render/players';

const STYLE: PlayerStyle = {
  primary: '#d9432b', secondary: '#f4f1e8', shorts: '#1c2437', socks: '#d9432b', pattern: 'stripes', keeper: false, skin: '#c68642', hair: '#15110e', hairStyle: 1, beard: 1,
  boot: '#111827', longSleeves: false, gloves: null, number: 9, build: 1, celeb: 0, role: 'player',
};
const GK: PlayerStyle = { ...STYLE, primary: '#f2b705', secondary: '#1f2937', shorts: '#1f2937', socks: '#f2b705', pattern: 'solid', keeper: true, gloves: '#e5e7eb', number: 1 };

interface Cell { label: string; rp: Partial<RenderPlayer>; ball?: BallLocal; gk?: boolean; t?: number[] }

/** Debug page: a contact sheet of the figure in every state (`?debug=pose`). */
export function poseGrid(canvas: HTMLCanvasElement): void {
  const cells: Cell[] = [
    { label: 'idle', rp: { speed: 0 } }, { label: 'jog', rp: { speed: 4, stride: 0.2 } }, { label: 'sprint', rp: { speed: 8, stride: 0.45 } }, { label: 'carry', rp: { speed: 5, stride: 0.1, hasBall: true }, ball: { x: 0.55, y: 0.1, z: 0 } },
    { label: 'pass', rp: { state: 'kick', stateDur: 0.34, ballSide: 'R', kickPower: 0.4 }, t: [0.15, 0.4, 0.55, 0.85] }, { label: 'shot', rp: { state: 'kick', stateDur: 0.34, ballSide: 'R', kickPower: 1 }, t: [0.12, 0.4, 0.55, 0.85] },
    { label: 'tackle', rp: { state: 'tackle', stateDur: 0.5 }, t: [0.2, 0.4, 0.7, 0.95] }, { label: 'slide', rp: { state: 'slide', stateDur: 0.95 }, t: [0.1, 0.3, 0.5, 0.9] },
    { label: 'header', rp: { state: 'jump', stateDur: 0.7 }, t: [0.2, 0.5, 0.7, 0.9] }, { label: 'down', rp: { state: 'down', stateDur: 1.5 }, t: [0.2, 0.5, 0.7, 0.9] },
    { label: 'stumble', rp: { state: 'stumble', stateDur: 0.5 }, t: [0.1, 0.3, 0.5, 0.7] }, { label: 'throw-in', rp: { state: 'throw', stateDur: 0.6 }, t: [0.1, 0.4, 0.6, 0.9] },
    { label: 'step over', rp: { state: 'skill', stateDur: 0.55, skillAnim: 'stepOver' }, ball: { x: 0.5, y: 0.05, z: 0 }, t: [0.15, 0.4, 0.6, 0.85] }, { label: 'drag back', rp: { state: 'skill', stateDur: 0.5, skillAnim: 'dragBack' }, ball: { x: 0.5, y: 0.1, z: 0 }, t: [0.2, 0.45, 0.7, 0.9] },
    { label: 'flick', rp: { state: 'skill', stateDur: 0.6, skillAnim: 'flick' }, ball: { x: 0.5, y: 0, z: 0 }, t: [0.2, 0.4, 0.6, 0.9] }, { label: 'ball roll', rp: { state: 'skill', stateDur: 0.45, skillAnim: 'roll' }, ball: { x: 0.45, y: 0.1, z: 0 }, t: [0.1, 0.4, 0.7, 0.9] },
    { label: 'feint', rp: { state: 'skill', stateDur: 0.4, skillAnim: 'feint' }, ball: { x: 0.5, y: 0.1, z: 0 }, t: [0.15, 0.4, 0.7, 0.9] }, { label: 'celebrate', rp: { state: 'celebrate', stateDur: 3 }, t: [0.2, 0.7, 1.2, 1.9] },
    { label: 'gk dive', rp: { state: 'dive', stateDur: 1, diveSide: 1, diveH: 1 }, gk: true, t: [0.1, 0.35, 0.6, 0.9] }, { label: 'gk catch', rp: { state: 'save', stateDur: 0.5 }, gk: true, t: [0.1, 0.25, 0.4, 0.5] },
  ];
  const painter = new FigurePainter();
  const COLS = 4, SUB = 4, S = 74;
  const cw = 4 * 170;
  canvas.width = cw / 2 * 2 - 0; canvas.height = Math.ceil(cells.length / 2) * 170;
  const ctx = canvas.getContext('2d')!;
  canvas.style.cssText = 'display:block;background:#1d6b2c';
  ctx.fillStyle = '#2b8a3e'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  void COLS; void SUB;
  cells.forEach((c, idx) => {
    const col = idx % 2, row = Math.floor(idx / 2);
    const ox = col * 2 * 170, oy = row * 170;
    ctx.fillStyle = (row + col) % 2 ? '#2d8d42' : '#2a8540'; ctx.fillRect(ox, oy, 340, 170);
    ctx.fillStyle = '#fff'; ctx.font = '12px system-ui'; ctx.fillText(c.label, ox + 6, oy + 14);
    const times = c.t ?? [0, 0.25, 0.5, 0.75];
    times.forEach((tt, k) => {
      const anim = new PlayerAnim(); anim.seed = 12;
      const rp: RenderPlayer = {
        visible: true, x: 0, z: 0, face: 0, state: 'normal', stateName: '', stateT: tt * (c.rp.stateDur ?? 1), stateDur: 1, speed: 0, stride: 0.25 * k, hasBall: false, ballSide: 'R', dominantFoot: 'R', weakFoot: 3, tired: 0,
        keeper: !!c.gk, skillAnim: null, skillU: tt, skillSide: 1, diveSide: 1, diveH: 0, celebT: tt, kickPower: 0.7, ...c.rp,
      };
      for (let i = 0; i < 30; i++) painter.update(anim, rp, c.ball ?? null, null, 1 / 60, tt + i / 60, 'player');
      const cx = ox + 45 + k * 80, cy = oy + 100;
      if (c.ball) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx + c.ball.x * S, cy + c.ball.y * S, 5, 0, 6.3); ctx.fill(); }
      painter.drawLegs(ctx, anim, c.gk ? GK : STYLE, rp, cx, cy, S);
      painter.drawBody(ctx, anim, c.gk ? GK : STYLE, rp, cx, cy, S, true);
    });
  });
}
