/** Colour grade applied as a cheap CSS filter on the canvas. No bloom or glow of any kind. */
export type GradePreset = 'broadcast' | 'cinematic' | 'natural';

export const GRADES: Record<GradePreset, { contrast: number; saturation: number; brightness: number; vignette: number }> = {
  broadcast: { contrast: 1.05, saturation: 1.1, brightness: 1.0, vignette: 0.32 },
  cinematic: { contrast: 1.12, saturation: 0.9, brightness: 0.97, vignette: 0.48 },
  natural: { contrast: 1.0, saturation: 1.0, brightness: 1.0, vignette: 0.16 },
};

export function gradeFilter(g: GradePreset): string {
  const p = GRADES[g];
  return `contrast(${p.contrast}) saturate(${p.saturation}) brightness(${p.brightness})`;
}
