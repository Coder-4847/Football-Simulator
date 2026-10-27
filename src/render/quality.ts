export type QualityName = 'Low' | 'Medium' | 'High' | 'Ultra' | 'Custom';

export interface Quality {
  name: QualityName;
  /** render resolution scale (0.5..1.5) */
  resolutionScale: number;
  shadows: 'off' | 'low' | 'medium' | 'high';
  shadowMapSize: number;
  antialias: 'off' | 'fxaa' | 'smaa' | 'msaa';
  bloom: boolean;
  ssao: boolean;
  depthOfField: boolean;
  motionBlur: boolean;
  filmGrain: boolean;
  vignette: boolean;
  /** 0..1 crowd density */
  crowd: number;
  /** grass blade instances near the camera (0 = texture only) */
  grassBlades: number;
  weatherParticles: number;
  /** player animation LOD: 0 full, 1 reduced far-away, 2 minimal */
  animLod: 0 | 1 | 2;
  volumetric: boolean;
  anisotropy: number;
  maxPixelRatio: number;
  pitchTexture: number;
  netPhysics: boolean;
  ballTrail: boolean;
}

export const PRESETS: Record<Exclude<QualityName, 'Custom'>, Quality> = {
  Low: {
    name: 'Low', resolutionScale: 0.7, shadows: 'off', shadowMapSize: 512, antialias: 'off', bloom: false, ssao: false, depthOfField: false,
    motionBlur: false, filmGrain: false, vignette: false, crowd: 0.2, grassBlades: 0, weatherParticles: 600, animLod: 2, volumetric: false,
    anisotropy: 1, maxPixelRatio: 1, pitchTexture: 1024, netPhysics: false, ballTrail: false,
  },
  Medium: {
    name: 'Medium', resolutionScale: 1, shadows: 'low', shadowMapSize: 1024, antialias: 'msaa', bloom: false, ssao: false, depthOfField: false,
    motionBlur: false, filmGrain: false, vignette: true, crowd: 0.5, grassBlades: 0, weatherParticles: 2000, animLod: 1, volumetric: false,
    anisotropy: 4, maxPixelRatio: 1.5, pitchTexture: 2048, netPhysics: true, ballTrail: false,
  },
  High: {
    name: 'High', resolutionScale: 1, shadows: 'medium', shadowMapSize: 2048, antialias: 'msaa', bloom: true, ssao: false, depthOfField: true,
    motionBlur: false, filmGrain: false, vignette: true, crowd: 0.8, grassBlades: 14000, weatherParticles: 5000, animLod: 0, volumetric: false,
    anisotropy: 8, maxPixelRatio: 2, pitchTexture: 2048, netPhysics: true, ballTrail: true,
  },
  Ultra: {
    name: 'Ultra', resolutionScale: 1.15, shadows: 'high', shadowMapSize: 4096, antialias: 'msaa', bloom: true, ssao: true, depthOfField: true,
    motionBlur: true, filmGrain: true, vignette: true, crowd: 1, grassBlades: 40000, weatherParticles: 9000, animLod: 0, volumetric: true,
    anisotropy: 16, maxPixelRatio: 2, pitchTexture: 4096, netPhysics: true, ballTrail: true,
  },
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

export function defaultQualityName(): QualityName { return isMobile() ? 'Low' : 'Medium'; }

/** One-off micro-benchmark: draws a few thousand triangles for ~200 ms and measures frame times to pick a preset. */
export async function benchmark(renderer: { render: () => void }): Promise<QualityName> {
  const times: number[] = [];
  const start = performance.now();
  while (performance.now() - start < 350) {
    const t0 = performance.now();
    renderer.render();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)] ?? 16;
  if (isMobile()) return med < 9 ? 'Medium' : 'Low';
  if (med < 4) return 'High';
  if (med < 9) return 'Medium';
  return 'Low';
}
