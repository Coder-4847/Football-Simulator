import { goalScored } from './ball';
import { HALF_L, PEN_SPOT, type Side } from './constants';
import type { MPlayer } from './entities';
import type { Match } from './match';
import { startSetPiece, updateSetPiece } from './rules';

export interface ShootoutKick { side: Side; player: string; scored: boolean }

/** Penalty shootout controller (kicks always go at the +x goal; team directions are swapped per kick). */
export class Shootout {
  kicks: ShootoutKick[] = [];
  score: [number, number] = [0, 0];
  taken: [number, number] = [0, 0];
  current: Side = 0;
  state: 'start' | 'setup' | 'flight' | 'resolve' | 'done' = 'start';
  t = 0;
  private queues: [MPlayer[], MPlayer[]] = [[], []];
  private cursor: [number, number] = [0, 0];
  private takerPlayer: MPlayer | null = null;
  private resolveOutcome: boolean | null = null;
  winner: Side | null = null;

  constructor(m: Match) { this.current = m.rng.chance(0.5) ? 0 : 1; }

  begin(m: Match): void {
    for (const side of [0, 1] as const) {
      const t = m.teams[side];
      const field = t.players.filter((p) => p.active() && !p.isGK()).sort((a, b) => b.data.attrs.penalties - a.data.attrs.penalties);
      const gk = t.players.find((p) => p.active() && p.isGK());
      this.queues[side] = gk ? [...field, gk] : field;
    }
    m.owner = null;
    this.nextKick(m);
  }

  private nextKick(m: Match): void {
    const side = this.current;
    const q = this.queues[side];
    const taker = q[this.cursor[side] % q.length]!;
    this.cursor[side]++;
    this.takerPlayer = taker;
    m.teams[side].dir = 1; m.teams[1 - side as Side].dir = -1;
    this.resolveOutcome = null;
    this.state = 'setup'; this.t = 0;
    m.penaltyKick = null;
    startSetPiece(m, { type: 'penalty', side, x: HALF_L - PEN_SPOT, y: 0, shootout: true, taker });
    m.phase = 'shootout';
    // the keeper of the defending side stays; everyone else waits in the centre circle
  }

  update(m: Match, dt: number): void {
    this.t += dt;
    switch (this.state) {
      case 'setup': {
        updateSetPiece(m, dt);
        if (!m.sp && m.penaltyKick) { this.state = 'flight'; this.t = 0; }
        break;
      }
      case 'flight': {
        const b = m.ball;
        if (goalScored(b) !== null && this.resolveOutcome === null) this.finishKick(m, true);
        else if (this.resolveOutcome === null && this.t > 0.8) {
          const stopped = b.speedXY() < 1.2 && b.z < 0.3;
          const out = Math.abs(b.y) > 36 || Math.abs(b.x) > HALF_L + 3;
          const held = m.ballInGoalKeeperHands !== null;
          if (stopped || out || held || this.t > 4) this.finishKick(m, false);
        }
        break;
      }
      case 'resolve': {
        if (this.t > 2.2) this.advance(m);
        break;
      }
      default: break;
    }
  }

  private finishKick(m: Match, scored: boolean): void {
    this.resolveOutcome = scored;
    const side = this.current;
    this.taken[side]++;
    if (scored) this.score[side]++;
    this.kicks.push({ side, player: this.takerPlayer?.data.name ?? '', scored });
    m.bus.emit('shootoutKick', { side, scored, player: this.takerPlayer! });
    if (scored) m.bus.emit('whistle', { kind: 'goal' });
    this.state = 'resolve'; this.t = 0;
  }

  private decided(): Side | null {
    const [a, b] = this.score, [ta, tb] = this.taken;
    if (ta <= 5 && tb <= 5) {
      if (a > b + (5 - tb)) return 0;
      if (b > a + (5 - ta)) return 1;
      if (ta === 5 && tb === 5 && a !== b) return a > b ? 0 : 1;
    } else if (ta === tb && ta > 5 && a !== b) return a > b ? 0 : 1;
    return null;
  }

  private advance(m: Match): void {
    const w = this.decided();
    if (w !== null) {
      this.state = 'done'; this.winner = w;
      m.phase = 'fulltime'; m.ended = true; m.winner = w;
      m.bus.emit('shootoutEnd', { winner: w });
      m.bus.emit('fullTime', { score: [m.teams[0].score, m.teams[1].score] });
      return;
    }
    this.current = (1 - this.current) as Side;
    this.nextKick(m);
  }
}
