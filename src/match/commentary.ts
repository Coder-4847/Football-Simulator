import { RNG } from '../core/rng';
import type { Match } from './match';
import type { MPlayer } from './entities';

const pick = <T>(r: RNG, a: T[]): T => a[r.int(0, a.length - 1)] as T;

/** Subscribes to match events and emits varied text-only commentary lines. Uses its own RNG so it never perturbs the simulation. */
export function commentate(m: Match): void {
  const r = new RNG(`commentary:${m.cfg.seed}`);
  const say = (text: string): void => { m.bus.emit('commentary', { text, minute: m.minute() }); };
  const nm = (p: MPlayer): string => p.data.shortName;
  const tm = (p: MPlayer): string => m.teams[p.side].name;

  m.bus.on('goal', ({ scorer, assist, side, ownGoal, penalty }) => {
    const team = m.teams[side].name;
    if (ownGoal) say(pick(r, [`Own goal! ${nm(scorer)} turns it into his own net.`, `Disaster for ${nm(scorer)} — an unfortunate own goal.`]).replace('his', 'their'));
    else if (penalty) say(pick(r, [`${nm(scorer)} sends the keeper the wrong way. Penalty scored!`, `Cool as you like — ${nm(scorer)} converts from the spot.`]));
    else say(pick(r, [`GOAL! ${nm(scorer)} finishes for ${team}!`, `It's in! ${nm(scorer)} puts ${team} ${m.teams[side].score > m.teams[side === 0 ? 1 : 0].score ? 'ahead' : 'on the board'}!`, `${nm(scorer)} with a superb finish!`]) + (assist ? ` Great work from ${nm(assist)}.` : ''));
  });
  m.bus.on('shot', ({ player, xg, onTarget, kind }) => {
    if (xg > 0.25 && !onTarget) say(pick(r, [`${nm(player)} should have scored there!`, `A huge chance goes begging for ${nm(player)}.`, `${nm(player)} drags it wide from a great position.`]));
    else if (kind === 'freeKick') say(`${nm(player)} steps up to take the free kick…`);
  });
  m.bus.on('save', ({ keeper, caught }) => say(caught ? pick(r, [`${nm(keeper)} gathers it safely.`, `Comfortable catch for ${nm(keeper)}.`]) : pick(r, [`${nm(keeper)} pushes it away!`, `Strong hands from ${nm(keeper)}!`, `${nm(keeper)} gets a fingertip to it!`])));
  m.bus.on('post', ({ hit }) => say(hit === 'post' ? pick(r, ['Off the post!', 'It rattles the upright!']) : pick(r, ['Off the crossbar!', 'It smashes the bar!'])));
  m.bus.on('foul', ({ offender, victim }) => { if (r.chance(0.6)) say(`${nm(offender)} brings down ${nm(victim)}.`); });
  m.bus.on('card', ({ player, color, second }) => say(color === 'yellow' ? `Yellow card for ${nm(player)}.` : second ? `A second yellow — ${nm(player)} is sent off!` : `Straight red! ${nm(player)} has to go.`));
  m.bus.on('offside', ({ player }) => say(`${nm(player)} is flagged offside.`));
  m.bus.on('corner', ({ side }) => say(`Corner to ${m.teams[side].name}.`));
  m.bus.on('penalty', ({ side }) => say(`Penalty to ${m.teams[side].name}!`));
  m.bus.on('advantage', () => say('The referee plays advantage.'));
  m.bus.on('sub', ({ side, off, on, injury }) => say(`${m.teams[side].name} substitution: ${on} replaces ${nm(off)}${injury ? ' (injury)' : ''}.`));
  m.bus.on('injury', ({ player }) => say(`${nm(player)} is down injured and needs treatment.`));
  m.bus.on('halfTime', ({ score }) => say(`Half-time: ${m.teams[0].name} ${score[0]}–${score[1]} ${m.teams[1].name}.`));
  m.bus.on('fullTime', ({ score }) => say(`Full-time: ${m.teams[0].name} ${score[0]}–${score[1]} ${m.teams[1].name}.`));
  m.bus.on('skill', ({ player, success }) => { if (success && r.chance(0.5)) say(`${nm(player)} with a bit of skill to beat the challenge.`); });
  m.bus.on('tackle', ({ player, success, slide }) => { if (success && slide && r.chance(0.5)) say(`Crunching slide tackle from ${nm(player)}.`); });
  void tm;
}
