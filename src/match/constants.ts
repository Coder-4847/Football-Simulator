/** Pitch coordinates (metres): x along the length, y across the width, z up. Centre spot is (0,0). */
export const PITCH_L = 105;
export const PITCH_W = 68;
export const HALF_L = PITCH_L / 2;
export const HALF_W = PITCH_W / 2;
export const GOAL_W = 7.32;
export const GOAL_H = 2.44;
export const HALF_GOAL = GOAL_W / 2;
export const GOAL_DEPTH = 2.2;
export const POST_R = 0.06;
export const BALL_R = 0.11;
export const BALL_MASS = 0.43;
export const BOX_L = 16.5;
export const BOX_W = 40.32;
export const SIX_L = 5.5;
export const SIX_W = 18.32;
export const PEN_SPOT = 11;
export const CENTER_R = 9.15;
export const GRAVITY = 9.81;
export const SIM_DT = 1 / 120;

export const PLAYER_R = 0.35;
export const BASE_JOG = 0.55;

export type Side = 0 | 1; // 0 = home, 1 = away
export const other = (s: Side): Side => (s === 0 ? 1 : 0);
