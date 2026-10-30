import { describe, expect, it } from 'vitest';
import { levelAtCell, parseMap, wolinMap } from '../core/map.ts';
import {
  cellHeights,
  grassCellAllowed,
  grassDensity,
  LEVEL_H,
  mossWeight,
  palisadeBounds,
  pathCellSet,
} from '../render/terrain.ts';

describe('terrace heights', () => {
  it('flat cells sit one step per level, a ramp climbs steadily between them', () => {
    const rows = ['::::::::', ':______:', '::::::::'];
    const levels = ['00000000', '0011b220', '00000000'];
    const m = parseMap(rows, levels);
    const h = cellHeights(m);
    const at = (cx: number) => h[1 * m.w + cx];
    expect(at(5) - at(3)).toBeCloseTo(LEVEL_H, 6);
    expect(at(4)).toBeCloseTo((at(3) + at(5)) / 2, 6);
  });

  it('a two-cell ramp is graded in thirds', () => {
    const m = wolinMap();
    const h = cellHeights(m);
    // south ramp (cols 19-20, rows 18-19) between the meadow (row 20) and the plateau (row 17)
    const low = h[20 * m.w + 19];
    const top = h[17 * m.w + 19];
    expect(h[19 * m.w + 19]).toBeCloseTo(low + (top - low) / 3, 6);
    expect(h[18 * m.w + 19]).toBeCloseTo(low + ((top - low) * 2) / 3, 6);
  });
});

describe('grass', () => {
  it('density is deterministic, within 0..1 and sparse (soft patches, bare ground between)', () => {
    let sum = 0;
    let n = 0;
    let max = 0;
    for (let x = -30; x < 30; x += 0.7) {
      for (let z = -24; z < 24; z += 0.7) {
        const d = grassDensity(x, z, 12345);
        expect(d).toBe(grassDensity(x, z, 12345));
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
        sum += d;
        max = Math.max(max, d);
        n++;
      }
    }
    expect(max).toBeGreaterThan(0.5);
    expect(sum / n).toBeLessThan(0.3);
  });

  it('no tufts on the plaza, on ramps, on the stone path, on beaches or on rock', () => {
    const m = wolinMap();
    const plaza = palisadeBounds(m);
    const path = pathCellSet(m);
    const ok = (cx: number, cy: number) => grassCellAllowed(m, cx, cy, plaza, path);
    expect(ok(20, 11)).toBe(false); // plaza
    expect(ok(19, 19)).toBe(false); // south ramp
    expect(ok(31, 13)).toBe(false); // narrow east ramp
    expect(ok(19, 16)).toBe(false); // path on the plateau
    expect(ok(5, 12)).toBe(false); // beach
    expect(ok(9, 14)).toBe(false); // boulder
    expect(ok(8, 6)).toBe(true); // open meadow
    expect(ok(12, 8)).toBe(true); // plateau outside the palisade
  });

  it('the stone path runs from the gate over the south ramp onto the meadow', () => {
    const m = wolinMap();
    const path = pathCellSet(m);
    for (const [cx, cy] of [
      [19, 16],
      [20, 17],
      [19, 18],
      [20, 19],
      [19, 20],
    ]) {
      expect(path.has(cy * m.w + cx), `${cx},${cy}`).toBe(true);
    }
    expect(path.has(11 * m.w + 20)).toBe(false);
    expect(levelAtCell(m, 19, 20)).toBe(1);
  });

  it('moss grows on flat ground right above a drop, not on slopes or flat low ground', () => {
    expect(mossWeight(0.2, 2)).toBeGreaterThan(0.9);
    expect(mossWeight(0.2, 0)).toBe(0);
    expect(mossWeight(1.5, 2)).toBe(0);
  });
});
