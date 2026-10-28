export type Dir4 = 'U' | 'R' | 'D' | 'L';
export const DIR_SLOT: Record<Dir4, number> = { U: 0, R: 1, D: 2, L: 3 };

/** Quantises a vector into 4 directions (screen-up = U). */
export function dirOf(x: number, y: number): Dir4 {
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'R' : 'L') : (y > 0 ? 'D' : 'U');
}

export interface GestureResult { slot: number; moveId: string | null; sequence: string }

/**
 * Turns a stream of flicks (right stick / arrow keys / touch pad) into skill triggers.
 * A single flick triggers its slot immediately unless a custom multi-flick binding could still match.
 */
export class GestureRecognizer {
  private seq: Dir4[] = [];
  private lastT = -10;
  private timeout = 0.38;
  /** custom bindings: sequence string ('URD') -> skill move id */
  bindings: Record<string, string> = {};

  private prefixPossible(s: string): boolean {
    for (const k of Object.keys(this.bindings)) if (k.length > s.length && k.startsWith(s)) return true;
    return false;
  }

  /** Register a flick at time `t` (seconds). Returns a result when the gesture resolves immediately. */
  flick(d: Dir4, t: number): GestureResult | null {
    if (t - this.lastT > this.timeout) this.seq = [];
    this.lastT = t;
    this.seq.push(d);
    if (this.seq.length > 4) this.seq.shift();
    const s = this.seq.join('');
    // custom bindings: match the longest suffix
    for (let i = 0; i < s.length; i++) {
      const suffix = s.slice(i);
      const id = this.bindings[suffix];
      if (id && !this.prefixPossible(suffix)) { this.seq = []; return { slot: -1, moveId: id, sequence: suffix }; }
    }
    if (this.seq.length === 1 && !this.prefixPossible(s)) return { slot: DIR_SLOT[d], moveId: null, sequence: s };
    return null;
  }

  /** Call every frame: resolves pending single flicks that waited for a longer sequence. */
  poll(t: number): GestureResult | null {
    if (this.seq.length === 0 || t - this.lastT < 0.14) return null;
    const s = this.seq.join('');
    const id = this.bindings[s];
    const first = this.seq[0]!;
    this.seq = [];
    if (id) return { slot: -1, moveId: id, sequence: s };
    return { slot: DIR_SLOT[first], moveId: null, sequence: s };
  }

  reset(): void { this.seq = []; }
}

/**
 * Detects pushes of an analog stick from neutral to a direction (right stick = skill flicks).
 * Any push past the threshold counts, slow or fast, and rolling the stick to a new direction while it stays
 * pushed fires again, so chained moves feel like they do on a console.
 */
export class FlickDetector {
  private wasNeutral = true;
  private lastDir: Dir4 | null = null;
  private lastT = -10;
  constructor(private hi = 0.58, private lo = 0.26, private rollGap = 0.22) {}

  update(x: number, y: number, t: number): Dir4 | null {
    const m = Math.hypot(x, y);
    if (m < this.lo) { this.wasNeutral = true; this.lastDir = null; return null; }
    if (m < this.hi) return null;
    const d = dirOf(x, y);
    if (this.wasNeutral) { this.wasNeutral = false; this.lastDir = d; this.lastT = t; return d; }
    if (this.lastDir !== null && d !== this.lastDir && t - this.lastT > this.rollGap) { this.lastDir = d; this.lastT = t; return d; }
    return null;
  }
}
