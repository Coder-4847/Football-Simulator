/** Skill-move library (45 moves). Names are original/descriptive; no trademarked move names. */
export type Dir4 = 'U' | 'R' | 'D' | 'L';
export type Anim = 'feint' | 'dragBack' | 'stepOver' | 'spin' | 'flick' | 'lift' | 'hop' | 'roll' | 'stop' | 'burst' | 'shuffle' | 'fakeKick';

export interface SkillMove {
  id: string;
  name: string;
  stars: 1 | 2 | 3 | 4 | 5;
  anim: Anim;
  dur: number;
  /** ball displacement in the player's frame: forward (m) and lateral (m, +right) */
  fwd: number; lat: number;
  /** change in facing (rad, +clockwise on screen) */
  turn: number;
  /** speed multiplier burst after finishing (1 = none) */
  burst: number;
  /** seconds the nearest defender is wrong-footed on success */
  fool: number;
  /** extra chance (0..1) of losing the ball when it fails */
  risk: number;
  /** default gesture sequence for display / Skill Lab (right-stick flicks) */
  pattern: Dir4[];
  desc: string;
}

type Row = [string, string, SkillMove['stars'], Anim, number, number, number, number, number, number, number, string];
const rows: Row[] = [
  // id, name, stars, anim, dur, fwd, lat, turn, burst, fool, risk, desc
  ['body-feint', 'Body Feint', 1, 'feint', 0.4, 0.5, 0.0, 0, 1.1, 0.25, 0.1, 'Drop a shoulder to unbalance a defender, then push on.'],
  ['drag-back', 'Drag Back', 1, 'dragBack', 0.5, -0.9, 0, 0, 1.0, 0.3, 0.1, 'Pull the ball back under the sole.'],
  ['ball-roll', 'Ball Roll', 1, 'roll', 0.45, 0.2, 0.9, 0, 1.0, 0.25, 0.1, 'Roll the ball across the body with the sole.'],
  ['quick-stop', 'Quick Stop', 1, 'stop', 0.4, 0.0, 0, 0, 1.15, 0.3, 0.12, 'Kill the ball dead, then accelerate away.'],
  ['shoulder-drop', 'Shoulder Drop', 1, 'feint', 0.45, 0.8, 0.5, 0.2, 1.08, 0.3, 0.1, 'Sell a direction with the shoulders and go the other way.'],
  ['fake-shot', 'Fake Shot', 1, 'fakeKick', 0.5, 0.6, 0, 0, 1.05, 0.5, 0.1, 'Swing the leg as if to shoot, then keep the ball.'],
  ['knock-on-burst', 'Knock-On Burst', 1, 'burst', 0.35, 3.0, 0, 0, 1.3, 0.0, 0.2, 'Push the ball past the defender and sprint after it.'],
  ['shield-turn', 'Shield Turn', 1, 'spin', 0.6, 0.3, 0, 3.14, 1.0, 0.3, 0.1, 'Turn with the body between ball and defender.'],

  ['step-over', 'Step Over', 2, 'stepOver', 0.55, 0.9, 0.0, 0, 1.12, 0.45, 0.14, 'Swing a foot over the ball to sell the opposite direction.'],
  ['heel-drag', 'Heel Drag Turn', 2, 'dragBack', 0.55, -0.7, 0.5, 2.3, 1.05, 0.4, 0.14, 'Drag the ball back with the heel and turn out.'],
  ['inside-cut', 'Inside Cut', 2, 'shuffle', 0.45, 0.4, 1.2, 0.9, 1.1, 0.4, 0.12, 'Cut sharply across the defender.'],
  ['hop-over', 'Hop Over', 2, 'hop', 0.55, 0.5, 0, 0, 1.0, 0.35, 0.15, 'Hop over the ball while keeping it tight.'],
  ['stutter-step', 'Stutter Step', 2, 'feint', 0.55, 0.5, 0, 0, 1.2, 0.45, 0.12, 'Change pace repeatedly to freeze the defender.'],
  ['double-touch', 'Double Touch', 2, 'shuffle', 0.45, 1.0, 0.6, 0, 1.1, 0.35, 0.12, 'Two quick touches to switch the ball past a challenger.'],
  ['fake-pass', 'Fake Pass', 2, 'fakeKick', 0.5, 0.7, 0, 0, 1.08, 0.5, 0.12, 'Show a pass, then take the ball on.'],
  ['stop-and-go', 'Stop and Go', 2, 'stop', 0.55, 0.0, 0, 0, 1.3, 0.45, 0.14, 'Pause and explode away.'],
  ['back-foot-roll', 'Back-Foot Roll', 2, 'roll', 0.5, -0.3, -1.0, -0.8, 1.05, 0.35, 0.14, 'Roll the ball backward and sideways to escape.'],
  ['lane-change', 'Lane Change', 2, 'shuffle', 0.5, 0.9, -1.4, -0.6, 1.1, 0.4, 0.13, 'Slide the ball laterally into a new running lane.'],

  ['flip-flap', 'Flip Flap', 3, 'flick', 0.6, 1.2, 1.1, 0, 1.12, 0.6, 0.2, 'Outside-inside flick that drags the ball across.'],
  ['snap-cut', 'Snap Cut', 3, 'shuffle', 0.5, 0.8, 1.6, 1.1, 1.15, 0.55, 0.18, 'Outside-foot snap that sharply changes direction.'],
  ['spin-turn', 'Spin Turn', 3, 'spin', 0.65, 0.9, 0, 3.14, 1.1, 0.6, 0.18, 'Spin off a defender with the ball tight.'],
  ['double-step-over', 'Double Step Over', 3, 'stepOver', 0.7, 1.3, 0.0, 0, 1.15, 0.6, 0.2, 'Two consecutive step overs.'],
  ['drag-to-drag', 'Drag-to-Drag', 3, 'dragBack', 0.65, -0.4, 1.4, 0, 1.1, 0.55, 0.2, 'Drag the ball one way and then the other.'],
  ['ball-hop', 'Ball Hop', 3, 'hop', 0.6, 0.9, 0, 0, 1.1, 0.5, 0.2, 'Flick the ball up and over the challenge into stride.'],
  ['heel-flick-forward', 'Heel Flick Forward', 3, 'flick', 0.55, 2.0, 0, 0, 1.15, 0.5, 0.22, 'Flick the ball forward off the back heel.'],
  ['roll-cut-combo', 'Roll-Cut Combo', 3, 'roll', 0.65, 0.9, 1.3, 1.0, 1.12, 0.55, 0.2, 'Ball roll straight into an inside cut.'],
  ['pull-push-slide', 'Pull-Push Slide', 3, 'dragBack', 0.65, 0.5, -1.5, -0.7, 1.12, 0.55, 0.2, 'Pull back and push the ball sideways.'],
  ['cross-over-shuffle', 'Cross-Over Shuffle', 3, 'shuffle', 0.6, 1.0, 1.2, 0.6, 1.1, 0.5, 0.2, 'Quick feet crossing the ball over the stride line.'],

  ['reverse-flick', 'Reverse Flick', 4, 'flick', 0.7, 1.6, -1.2, 0, 1.18, 0.7, 0.26, 'Heel-to-heel flick that reverses the direction of attack.'],
  ['triple-step-over', 'Triple Step Over', 4, 'stepOver', 0.85, 1.6, 0.0, 0, 1.18, 0.75, 0.26, 'Three rapid step overs.'],
  ['spin-roll-escape', 'Spin Roll Escape', 4, 'spin', 0.75, 1.2, 1.0, 3.8, 1.15, 0.7, 0.26, 'A rolling spin that leaves defenders behind.'],
  ['rainbow-lift', 'Rainbow Lift', 4, 'lift', 0.8, 3.4, 0.0, 0, 1.2, 0.8, 0.3, 'Flick the ball up and over the defender’s head.'],
  ['toe-tap-chain', 'Toe Tap Chain', 4, 'hop', 0.8, 0.9, 0.0, 0, 1.1, 0.7, 0.26, 'Rapid toe taps to freeze the defender.'],
  ['fake-spin-exit', 'Fake Spin Exit', 4, 'spin', 0.7, 1.4, -1.4, -2.2, 1.18, 0.75, 0.26, 'Show a spin one way, exit the other.'],
  ['hesitation-burst', 'Hesitation Burst', 4, 'burst', 0.7, 2.2, 0.0, 0, 1.35, 0.7, 0.24, 'A dead stop that draws the tackle, then a burst.'],
  ['step-over-snap', 'Step Over Snap', 4, 'stepOver', 0.7, 1.3, 1.6, 1.0, 1.2, 0.75, 0.26, 'Step over into an outside snap.'],

  ['overhead-flick', 'Overhead Flick', 5, 'lift', 0.95, 5.0, 0.0, 0, 1.25, 1.0, 0.36, 'Lift the ball over the defender and run onto it.'],
  ['full-rotation', 'Full Rotation', 5, 'spin', 0.9, 1.6, 0.0, 6.28, 1.2, 0.9, 0.34, 'A full 360° turn with the ball tight.'],
  ['heel-to-heel-chain', 'Heel-to-Heel Chain', 5, 'flick', 0.9, 2.2, 0.0, 0, 1.22, 0.9, 0.34, 'Chained heel flicks past a defender.'],
  ['double-snap-change', 'Double Snap Change', 5, 'shuffle', 0.75, 1.5, 2.0, 1.2, 1.25, 0.9, 0.32, 'Two snap touches changing direction twice.'],
  ['roll-flick-reverse', 'Roll-Flick Reverse', 5, 'flick', 0.9, 1.8, -1.8, -1.6, 1.22, 0.9, 0.34, 'Roll then flick to reverse the attack line.'],
  ['rhythm-combo', 'Rhythm Feint Combo', 5, 'stepOver', 1.0, 2.0, 1.2, 0.8, 1.25, 1.0, 0.36, 'Step overs into a snap cut and burst.'],
  ['ground-lift-spin', 'Ground Lift Spin', 5, 'lift', 1.0, 3.0, 1.0, 3.14, 1.25, 1.0, 0.38, 'Lift the ball from the ground with a spin.'],
  ['phantom-touch', 'Phantom Touch', 5, 'feint', 0.8, 1.2, 0.0, 0, 1.3, 1.0, 0.3, 'Pretend to receive, let the ball run through.'],
  ['showboat-escape', 'Showboat Escape', 5, 'lift', 1.1, 3.5, 0.0, 3.14, 1.25, 1.0, 0.4, 'Juggle the ball clear and spin away.'],
];

const DIRS: Dir4[] = ['U', 'R', 'D', 'L'];
function pattern(i: number): Dir4[] {
  // deterministic unique gesture per move: 1,2,3-flick sequences
  const a = DIRS[i % 4] as Dir4;
  if (i < 8) return [a];
  if (i < 24) return [a, DIRS[(Math.floor(i / 4) + 1) % 4] as Dir4];
  return [a, DIRS[(Math.floor(i / 4)) % 4] as Dir4, DIRS[(Math.floor(i / 16) + 2) % 4] as Dir4];
}

export const SKILL_MOVES: SkillMove[] = rows.map((r, i) => ({
  id: r[0], name: r[1], stars: r[2], anim: r[3], dur: r[4], fwd: r[5], lat: r[6], turn: r[7], burst: r[8], fool: r[9], risk: r[10], desc: r[11], pattern: pattern(i),
}));

export const skillById = (id: string): SkillMove | undefined => SKILL_MOVES.find((m) => m.id === id);
export const skillsForStars = (stars: number): SkillMove[] => SKILL_MOVES.filter((m) => m.stars <= stars);

export const DEFAULT_LOADOUT: string[] = ['body-feint', 'step-over', 'flip-flap', 'spin-turn'];
/** Second set, used while the left shoulder / modifier is held during a right-stick flick. */
export const DEFAULT_LOADOUT_ALT: string[] = ['ball-roll', 'drag-back', 'hop-over', 'fake-shot'];

/** Resolve a player's loadout: per-player override, else global; moves above the player's star rating are replaced by the best allowed fallback. */
export function resolveLoadout(global: string[], override: string[] | undefined, playerStars: number): Array<SkillMove | null> {
  const src = override && override.length ? override : global;
  return [0, 1, 2, 3].map((i) => {
    const m = skillById(src[i] ?? '');
    if (!m) return null;
    if (m.stars <= playerStars) return m;
    // the player is not skilled enough for this move: fall back to the best move of the same family they can do
    const pool = SKILL_MOVES.filter((x) => x.stars <= playerStars);
    const same = pool.filter((x) => x.anim === m.anim).sort((a, b) => b.stars - a.stars)[0];
    return same ?? pool.sort((a, b) => b.stars - a.stars)[0] ?? null;
  });
}

/** Success probability of a skill move vs a defender. */
export function skillSuccess(move: SkillMove, att: { dribbling: number; agility: number; ballControl: number; skillMoves: number; balance: number }, def: { reactions: number; agility: number; standingTackle: number } | null, pressure: number): number {
  const a = (att.dribbling * 0.4 + att.agility * 0.3 + att.ballControl * 0.3) / 100;
  const d = def ? (def.reactions * 0.4 + def.agility * 0.3 + def.standingTackle * 0.3) / 100 : 0.3;
  const starGap = att.skillMoves - move.stars; // 0 => at limit
  let p = 0.62 + (a - d) * 0.9 + starGap * 0.05 - move.risk * 0.5 - pressure * 0.1;
  if (!def) p += 0.2;
  return Math.max(0.1, Math.min(0.97, p));
}
