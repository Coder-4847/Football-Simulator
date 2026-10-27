import type { App } from './app';
import { registerCareer } from './career';
import { registerTournament } from './tournament';
import { registerTraining } from './training';

/** Registers the larger game modes. */
export function registerExtras(app: App): void { registerCareer(app); registerTournament(app); registerTraining(app); }
