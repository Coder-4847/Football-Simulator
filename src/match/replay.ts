import type { Match } from './match';
import type { PState } from './entities';
import { skillById } from './skills';

const STATES: PState[] = ['normal', 'kick', 'tackle', 'slide', 'jump', 'dive', 'down', 'celebrate', 'throw', 'skill', 'stumble', 'wait', 'save'];
export const stateCode = (s: PState): number => Math.max(0, STATES.indexOf(s));
export const stateFromCode = (c: number): PState => STATES[c] ?? 'normal';

/** Floats per player in a frame: x, y, face, state, stateT, stride, speed, extra(skill id hash / dive dir) */
export const PF = 11;
export const ANIM_LIST = ['feint', 'dragBack', 'stepOver', 'spin', 'flick', 'lift', 'hop', 'roll', 'stop', 'burst', 'shuffle', 'fakeKick'];
const HEAD = 12; // ball x,y,z, ball rx,ry,rz(unused), ref x,y,face, assistants x0 x1, time
export const FRAME_SIZE = HEAD + 22 * PF;

export interface ReplayClip { label: string; frames: Float32Array[]; fps: number; minute: number; kind: string }

/** Ring buffer of the last N seconds at 60 Hz plus saved highlight clips. */
export class ReplayBuffer {
  readonly fps = 60;
  private frames: Float32Array[] = [];
  private head = 0;
  private count = 0;
  readonly capacity = 60 * 24;
  clips: ReplayClip[] = [];
  private pending: Array<{ label: string; kind: string; minute: number; remaining: number; before: number }> = [];

  constructor() { this.frames = new Array<Float32Array>(this.capacity); }

  record(m: Match): void {
    let f = this.frames[this.head];
    if (!f) { f = new Float32Array(FRAME_SIZE); this.frames[this.head] = f; }
    const b = m.ball;
    f[0] = b.x; f[1] = b.y; f[2] = b.z; f[3] = b.wx; f[4] = b.wy; f[5] = b.wz;
    f[6] = m.ref.x; f[7] = m.ref.y; f[8] = m.ref.face; f[9] = m.assistants[0]!.x; f[10] = m.assistants[1]!.x; f[11] = m.time;
    let o = HEAD;
    for (const side of [0, 1] as const) {
      const t = m.teams[side];
      for (let i = 0; i < 11; i++) {
        const p = t.players[i];
        if (!p) { o += PF; continue; }
        f[o] = p.x; f[o + 1] = p.y; f[o + 2] = p.face; f[o + 3] = p.sentOff ? 99 : stateCode(p.state); f[o + 4] = p.stateT; f[o + 5] = p.stride;
        f[o + 6] = Math.hypot(p.vx, p.vy);
        const sk = p.skill ? skillById(p.skill.id) : undefined;
        f[o + 7] = sk ? 10 + Math.max(0, ANIM_LIST.indexOf(sk.anim)) : p.state === 'dive' ? p.sx : 0; f[o + 8] = p.sz;
        f[o + 9] = (m.owner === p ? 1 : 0) | (p.ballSide === 'R' ? 2 : 0); f[o + 10] = 1 - p.stamina;
        o += PF;
      }
    }
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
    for (const pd of this.pending) pd.remaining--;
    const done = this.pending.filter((pd) => pd.remaining <= 0);
    if (done.length) {
      this.pending = this.pending.filter((pd) => pd.remaining > 0);
      for (const pd of done) this.clips.push({ label: pd.label, kind: pd.kind, minute: pd.minute, fps: this.fps, frames: this.slice(pd.before + 3 * this.fps) });
      if (this.clips.length > 14) this.clips.splice(0, this.clips.length - 14);
    }
  }

  /** Copy the most recent `n` frames (oldest first). */
  slice(n: number): Float32Array[] {
    n = Math.min(n, this.count);
    const out: Float32Array[] = [];
    for (let i = n; i >= 1; i--) {
      const idx = (this.head - i + this.capacity * 2) % this.capacity;
      out.push(new Float32Array(this.frames[idx]!));
    }
    return out;
  }

  /** Mark a highlight: captures `back` seconds before and 3 s after. */
  mark(label: string, kind: string, minute: number, back = 7): void {
    if (this.pending.some((p) => p.kind === kind && p.remaining > 120)) return;
    this.pending.push({ label, kind, minute, remaining: 3 * this.fps, before: Math.floor(back * this.fps) });
  }

  /** Short instant replay: last `seconds` seconds of live play. */
  instant(seconds = 8): Float32Array[] { return this.slice(Math.floor(seconds * this.fps)); }
}

/** Linear sample of a frame sequence at fractional index. Returns a new interpolated frame in `out`. */
export function sampleFrames(frames: Float32Array[], index: number, out: Float32Array): void {
  const i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(index)));
  const i1 = Math.min(frames.length - 1, i0 + 1);
  const t = index - Math.floor(index);
  const a = frames[i0]!, b = frames[i1]!;
  for (let k = 0; k < FRAME_SIZE; k++) out[k] = a[k]! + (b[k]! - a[k]!) * t;
  // non-interpolated fields
  for (let pi = 0; pi < 22; pi++) { const o = HEAD + pi * PF; out[o + 3] = a[o + 3]!; out[o + 4] = a[o + 4]!; out[o + 7] = a[o + 7]!; out[o + 8] = a[o + 8]!; out[o + 9] = a[o + 9]!; const fa = a[o + 2]!, fb = b[o + 2]!; let d = fb - fa; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; out[o + 2] = fa + d * t; }
}
