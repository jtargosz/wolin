import { afterEach, describe, expect, it } from 'vitest';
import { setWaveAmplitude, waveHeight, waveNormal } from '../render/water.ts';

afterEach(() => setWaveAmplitude(1));

describe('waves', () => {
  it('height is finite and normal is unit length with up direction', () => {
    for (const t of [0, 0.7, 5.3]) {
      for (let x = -100; x <= 100; x += 17) {
        for (let z = -100; z <= 100; z += 23) {
          const h = waveHeight(x, z, t);
          expect(Number.isFinite(h), `height ${x},${z},${t}`).toBe(true);
          const [nx, ny, nz] = waveNormal(x, z, t);
          expect(Number.isFinite(nx + ny + nz), `normal ${x},${z},${t}`).toBe(true);
          expect(Math.abs(nx * nx + ny * ny + nz * nz - 1), `unit ${x},${z},${t}`).toBeLessThan(1e-6);
          expect(ny, `up ${x},${z},${t}`).toBeGreaterThan(0.9);
        }
      }
    }
  });

  it('zero amplitude means flat water', () => {
    setWaveAmplitude(0);
    expect(waveHeight(3, 7, 1.2)).toBe(0);
    expect(waveNormal(3, 7, 1.2)).toEqual([0, 1, 0]);
  });
});

describe('shore distance', () => {
  it('is 0 on a rock islet and grows around it', async () => {
    const { parseMap } = await import('../core/map.ts');
    const { shoreDistance } = await import('../render/water.ts');
    const map = parseMap(['~~~~~~~~', '~~~~~~~~', '~~~x~~~~', '~~~~~~~~', '~~~~~~~~'], ['00000000', '00000000', '00010000', '00000000', '00000000']);
    const sd = shoreDistance(map);
    const at = (cx: number, cy: number) => sd.data[(cy * 4 + 2) * sd.w + cx * 4 + 2];
    expect(at(3, 2)).toBe(0);
    expect(at(4, 2)).toBeGreaterThan(0);
    expect(at(7, 2)).toBeGreaterThan(at(4, 2));
  });

  it('is 0 on land and grows out to sea', async () => {
    const { parseMap } = await import('../core/map.ts');
    const { shoreDistance } = await import('../render/water.ts');
    const map = parseMap(['~~~~~~~~', '~~~~~~~~', '~~~__~~~', '~~~~~~~~', '~~~~~~~~']);
    const sd = shoreDistance(map);
    const at = (cx: number, cy: number) => sd.data[(cy * 4 + 2) * sd.w + cx * 4 + 2];
    expect(at(3, 2)).toBe(0);
    expect(at(5, 2)).toBeGreaterThan(0);
    expect(at(7, 2)).toBeGreaterThan(at(5, 2));
    expect(Math.max(...sd.data)).toBeLessThanOrEqual(1);
  });
});
