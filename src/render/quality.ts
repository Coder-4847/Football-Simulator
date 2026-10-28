export type QualityName = 'Low' | 'Medium' | 'High' | 'Ultra' | 'Custom';

/** Rendering options for the 2D top-down renderer. */
export interface Quality {
  name: QualityName;
  /** render resolution multiplier on top of the device pixel ratio (0.5..1.5) */
  resolutionScale: number;
  /** player/ball shadows */
  shadows: 'off' | 'low' | 'medium' | 'high';
  /** 0..1 crowd density and animation */
  crowd: number;
  /** 0..1 amount of particles (dust, grass, confetti) */
  particles: number;
  weatherParticles: number;
  vignette: boolean;
  /** limb animation + foot trails */
  footTrails: boolean;
  /** persistent wear/skid marks on the pitch */
  pitchWear: boolean;
  /** night/dusk lighting pools */
  lighting: boolean;
  /** pixels per metre used for pre-rendered stadium layers */
  stadiumDetail: number;
  maxPixelRatio: number;
  ballTrail: boolean;
}

export const PRESETS: Record<Exclude<QualityName, 'Custom'>, Quality> = {
  Low: { name: 'Low', resolutionScale: 0.75, shadows: 'low', crowd: 0.3, particles: 0.4, weatherParticles: 250, vignette: false, footTrails: false, pitchWear: false, lighting: false, stadiumDetail: 8, maxPixelRatio: 1, ballTrail: false },
  Medium: { name: 'Medium', resolutionScale: 1, shadows: 'medium', crowd: 0.65, particles: 0.7, weatherParticles: 600, vignette: true, footTrails: true, pitchWear: true, lighting: true, stadiumDetail: 12, maxPixelRatio: 1.5, ballTrail: true },
  High: { name: 'High', resolutionScale: 1, shadows: 'high', crowd: 0.9, particles: 1, weatherParticles: 1100, vignette: true, footTrails: true, pitchWear: true, lighting: true, stadiumDetail: 16, maxPixelRatio: 2, ballTrail: true },
  Ultra: { name: 'Ultra', resolutionScale: 1.15, shadows: 'high', crowd: 1, particles: 1.4, weatherParticles: 1800, vignette: true, footTrails: true, pitchWear: true, lighting: true, stadiumDetail: 20, maxPixelRatio: 2, ballTrail: true },
};

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function qualityFor(name: QualityName, custom?: Partial<Quality>): Quality {
  if (name === 'Custom') return { ...PRESETS.High, ...(custom ?? {}), name: 'Custom' };
  return { ...PRESETS[name] };
}

export function defaultQualityName(): QualityName { return isMobile() ? 'Low' : 'High'; }
