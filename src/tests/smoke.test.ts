import { describe, expect, it } from 'vitest';
import { wolinMap } from '../core/map.ts';
import { ringPush, smokePose, smokeSpots } from '../render/effects.ts';

describe('battle stains pool', () => {
  it('keeps the newest entries up to the cap', () => {
    const l: number[] = [];
    for (let i = 0; i < 10; i++) ringPush(l, i, 4);
    expect(l).toEqual([6, 7, 8, 9]);
  });
});

describe('chimney smoke', () => {
  it('puff grows from nothing, rises, and dissolves to nothing (no visible loop)', () => {
    const start = smokePose(0);
    expect(start.dy).toBe(0);
    expect(start.s).toBe(0);
    expect(start.fade).toBe(0);
    const mid = smokePose(3);
    expect(mid.dy).toBeGreaterThan(0);
    expect(mid.s).toBeGreaterThan(0.5);
    expect(mid.fade).toBeCloseTo(0.5, 6);
    const end = smokePose(6);
    expect(end.s).toBe(0);
    expect(end.fade).toBe(1);
    // clamped past the end and before the start
    expect(smokePose(99).fade).toBe(1);
    expect(smokePose(99).s).toBe(0);
    expect(smokePose(-1).fade).toBe(0);
    expect(smokePose(-1).s).toBe(0);
  });

  it('hand-made Wolin has hut and building emitters', () => {
    const spots = smokeSpots(wolinMap(), () => 0.5);
    const huts = spots.filter((s) => s.building < 0);
    const halls = spots.filter((s) => s.building >= 0);
    expect(huts.length).toBeGreaterThan(0);
    expect(halls.length).toBe(3);
    expect(spots.every((s) => Number.isFinite(s.x + s.y + s.z))).toBe(true);
  });
});
