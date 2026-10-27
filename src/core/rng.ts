/** Deterministic seeded RNG (sfc32). Every random decision in the game goes through this. */
export function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export class RNG {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string | number = 1) {
    const h = hashSeed(seed);
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88 ^ h;
    this.c = 0xb7e15162 + h;
    this.d = 1;
    for (let i = 0; i < 15; i++) this.next();
  }

  /** float in [0,1) */
  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  float(min = 0, max = 1): number { return min + this.next() * (max - min); }
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('RNG.pick on empty array');
    return arr[Math.floor(this.next() * arr.length)] as T;
  }
  /** Standard normal (Box–Muller) scaled by sd around mean. */
  gauss(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i] as T; arr[i] = arr[j] as T; arr[j] = t;
    }
    return arr;
  }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1] as T;
  }
  /** Poisson-distributed integer (Knuth), fine for small lambda. */
  poisson(lambda: number): number {
    const L = Math.exp(-lambda);
    let k = 0; let p = 1;
    do { k++; p *= this.next(); } while (p > L && k < 50);
    return k - 1;
  }
  fork(label: string | number): RNG { return new RNG(`${this.int(0, 0x7fffffff)}:${label}`); }
}
