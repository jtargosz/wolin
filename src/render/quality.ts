// Render quality levels. Pure data (no three import) so profiles and parsing are unit-tested.
// High is the full look; Medium and Low trade resolution, shadows and post effects for speed.

export type Quality = 'low' | 'medium' | 'high';

export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

export const DEFAULT_QUALITY: Quality = 'medium';

export interface QualityProfile {
  /** Upper limit for the device pixel ratio of the canvas. */
  pixelRatioCap: number;
  /** Side of the square sun shadow map, pixels. */
  shadowSize: number;
  /** Ambient occlusion resolution scale, 0 = off. */
  ao: number;
  dof: boolean;
  bloom: boolean;
  /** Figures, bushes and boats cast shadows (terrain, buildings and trees always do). */
  shadowSmall: boolean;
  /** Terrain vertices per map cell edge (the ground mesh is drawn twice, with the shadow pass). */
  terrainSub: number;
  /** Water plane segments per side. */
  waterSegments: number;
}

export const QUALITY_PROFILES: Record<Quality, QualityProfile> = {
  low: { pixelRatioCap: 1, shadowSize: 1024, ao: 0, dof: false, bloom: false, shadowSmall: false, terrainSub: 4, waterSegments: 100 },
  medium: { pixelRatioCap: 1.5, shadowSize: 2048, ao: 0.35, dof: true, bloom: true, shadowSmall: false, terrainSub: 6, waterSegments: 140 },
  high: { pixelRatioCap: 2, shadowSize: 4096, ao: 0.5, dof: true, bloom: true, shadowSmall: true, terrainSub: 8, waterSegments: 200 },
};

export function isQuality(x: unknown): x is Quality {
  return x === 'low' || x === 'medium' || x === 'high';
}

/** The `?quality=` URL parameter (untrusted), or null when absent or invalid. */
export function qualityFromUrl(search: string): Quality | null {
  const v = new URLSearchParams(search).get('quality');
  return isQuality(v) ? v : null;
}
