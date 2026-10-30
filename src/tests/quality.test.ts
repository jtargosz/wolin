import { describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY, isQuality, QUALITIES, QUALITY_PROFILES, qualityFromUrl } from '../render/quality.ts';
import { defaultSettings, loadSettings, SETTINGS_KEY } from '../ui/settings.ts';

describe('Quality profiles', () => {
  it('cost never drops from low to medium to high', () => {
    const p = QUALITIES.map((q) => QUALITY_PROFILES[q]);
    for (let i = 1; i < p.length; i++) {
      expect(p[i].pixelRatioCap).toBeGreaterThanOrEqual(p[i - 1].pixelRatioCap);
      expect(p[i].shadowSize).toBeGreaterThanOrEqual(p[i - 1].shadowSize);
      expect(p[i].ao).toBeGreaterThanOrEqual(p[i - 1].ao);
      expect(p[i].terrainSub).toBeGreaterThanOrEqual(p[i - 1].terrainSub);
      expect(p[i].waterSegments).toBeGreaterThanOrEqual(p[i - 1].waterSegments);
      expect(Number(p[i].dof)).toBeGreaterThanOrEqual(Number(p[i - 1].dof));
      expect(Number(p[i].bloom)).toBeGreaterThanOrEqual(Number(p[i - 1].bloom));
      expect(Number(p[i].shadowSmall)).toBeGreaterThanOrEqual(Number(p[i - 1].shadowSmall));
    }
  });

  it('high keeps the full look', () => {
    const h = QUALITY_PROFILES.high;
    expect(h).toMatchObject({ pixelRatioCap: 2, shadowSize: 4096, ao: 0.5, dof: true, bloom: true, shadowSmall: true, terrainSub: 8, waterSegments: 200 });
  });

  it('shadow sizes are powers of two', () => {
    for (const q of QUALITIES) expect(Math.log2(QUALITY_PROFILES[q].shadowSize) % 1).toBe(0);
  });

  it('isQuality and the URL parameter accept only known levels', () => {
    expect(isQuality('low') && isQuality('medium') && isQuality('high')).toBe(true);
    expect(isQuality('ultra')).toBe(false);
    expect(isQuality(undefined)).toBe(false);
    expect(qualityFromUrl('?quality=low')).toBe('low');
    expect(qualityFromUrl('?seed=a&quality=high')).toBe('high');
    expect(qualityFromUrl('?quality=ultra')).toBeNull();
    expect(qualityFromUrl('')).toBeNull();
  });

  it('settings store a valid level and fall back to the default', () => {
    expect(defaultSettings().quality).toBe(DEFAULT_QUALITY);
    const st = { getItem: () => JSON.stringify({ quality: 'low' }), setItem: () => undefined };
    expect(loadSettings(st).quality).toBe('low');
    const bad = { getItem: (k: string) => (k === SETTINGS_KEY ? JSON.stringify({ quality: 'ultra' }) : null), setItem: () => undefined };
    expect(loadSettings(bad).quality).toBe(DEFAULT_QUALITY);
  });
});
