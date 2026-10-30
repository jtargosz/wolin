import { describe, expect, it } from 'vitest';
import {
  attackPhase,
  BOAT_REST_Z,
  buildingDamageStage,
  fallPose,
  FALL_DONE,
  keelHeight,
  restPose,
  smokeIntensity,
  strikePose,
  type StrikeKind,
} from '../render/anim.ts';
import { CHIP_CAP, PUFF_CAP, ringPush, STUCK_CAP } from '../render/effects.ts';

const kinds: StrikeKind[] = ['chop', 'thrust', 'draw'];

describe('attack cycle', () => {
  it('the phase stays in 0..1 and rises through the cooldown', () => {
    for (const cycle of [24, 30]) {
      let last = -1;
      for (let cd = cycle; cd >= 1; cd--) {
        const p = attackPhase(cd, cycle, 0);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(1);
        expect(p).toBeGreaterThan(last);
        last = p;
      }
    }
    // offsets wrap and clamp out-of-range cooldowns
    expect(attackPhase(-5, 24, 0.3)).toBeCloseTo(0.3, 9);
    expect(attackPhase(99, 24, 0)).toBe(0);
    for (const off of [0, 0.05, 0.12, 0.9]) {
      const p = attackPhase(10, 24, off);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });

  it('the blow peaks before the cycle ends and the pose loops without a jump', () => {
    for (const kind of kinds) {
      let best = -Infinity;
      let at = 0;
      for (let i = 0; i < 1000; i++) {
        const p = i / 1000;
        const w = strikePose(p, kind).weaponX;
        if (w > best) {
          best = w;
          at = p;
        }
      }
      expect(at, kind).toBeGreaterThan(0.6);
      expect(at, kind).toBeLessThan(0.95);
      const end = strikePose(0.999999, kind);
      const start = strikePose(0, kind);
      expect(Math.abs(end.weaponX - start.weaponX), kind).toBeLessThan(1e-3);
      expect(Math.abs(end.lunge - start.lunge), kind).toBeLessThan(1e-3);
      expect(Math.abs(end.lean - start.lean), kind).toBeLessThan(1e-3);
    }
  });

  it('chop and thrust raise the weapon first, the blow lunges forward, the bow leans back to draw', () => {
    expect(strikePose(0.6, 'chop').weaponX).toBeLessThan(strikePose(0.02, 'chop').weaponX);
    expect(strikePose(0.88, 'chop').weaponX).toBeGreaterThan(1);
    expect(strikePose(0.88, 'chop').lunge).toBeGreaterThan(0.1);
    expect(strikePose(0.88, 'thrust').lunge).toBeGreaterThan(0.3);
    expect(strikePose(0.8, 'draw').lean).toBeLessThan(-0.1);
    for (const kind of kinds) {
      for (let i = 0; i <= 100; i++) {
        const sp = strikePose(i / 100, kind);
        expect(sp.lunge).toBeGreaterThanOrEqual(0);
        expect(sp.lunge).toBeLessThanOrEqual(0.5);
      }
    }
  });
});

describe('the fall of the slain', () => {
  it('tips over in half a second, lies still, then shrinks away monotonically', () => {
    let tilt = -1;
    let scale = 2;
    for (let t = 0; t <= FALL_DONE + 0.5; t += 0.05) {
      const p = fallPose(t);
      expect(p.tilt).toBeGreaterThanOrEqual(tilt);
      expect(p.scale).toBeLessThanOrEqual(scale);
      tilt = p.tilt;
      scale = p.scale;
    }
    expect(fallPose(0).tilt).toBe(0);
    expect(fallPose(0.5).tilt).toBeCloseTo(Math.PI / 2, 9);
    expect(fallPose(2).scale).toBe(1);
    expect(fallPose(FALL_DONE).scale).toBe(0);
  });
});

describe('building damage', () => {
  it('stages follow the remaining health and never go back', () => {
    expect(buildingDamageStage(1)).toBe(0);
    expect(buildingDamageStage(0.66)).toBe(0);
    expect(buildingDamageStage(0.65)).toBe(1);
    expect(buildingDamageStage(0.33)).toBe(1);
    expect(buildingDamageStage(0.32)).toBe(2);
    expect(buildingDamageStage(0.001)).toBe(2);
    expect(buildingDamageStage(0)).toBe(3);
    expect(buildingDamageStage(-1)).toBe(3);
    let last = 0;
    for (let r = 1; r >= -0.01; r -= 0.01) {
      const st = buildingDamageStage(r);
      expect(st).toBeGreaterThanOrEqual(last);
      last = st;
    }
  });

  it('smoke gets thicker and darker with the damage and stops at a ruin', () => {
    expect(smokeIntensity(0)).toEqual({ size: 1, dark: 0 });
    expect(smokeIntensity(1).size).toBeGreaterThan(smokeIntensity(0).size);
    expect(smokeIntensity(2).size).toBeGreaterThan(smokeIntensity(1).size);
    expect(smokeIntensity(2).dark).toBeGreaterThan(smokeIntensity(1).dark);
    expect(smokeIntensity(3).size).toBe(0);
  });
});

describe('beached boat', () => {
  it('the keel never goes below the sand under the bow, middle or stern, and the pitch stays small', () => {
    const grounds = [-1, -0.55, -0.2, 0.1, 0.22, 0.6, 1.2];
    for (const waveY of [-0.2, 0, 0.2]) {
      for (const gb of grounds) {
        for (const gm of grounds) {
          for (const gs of grounds) {
            const { y, pitch } = restPose(waveY, gb, gm, gs);
            expect(pitch).toBeGreaterThanOrEqual(-0.1 - 1e-9);
            expect(pitch).toBeLessThanOrEqual(0.25 + 1e-9);
            expect(y).toBeGreaterThanOrEqual(waveY - 1e-9);
            for (const [g, z] of [
              [gb, BOAT_REST_Z],
              [gm, 0],
              [gs, -BOAT_REST_Z],
            ] as const) {
              expect(keelHeight(y, pitch, z)).toBeGreaterThanOrEqual(g - 0.03 - 1e-9);
            }
          }
        }
      }
    }
  });

  it('on a slope rising toward the shore the bow lifts', () => {
    expect(restPose(0, 0.6, 0.2, -0.2).pitch).toBeGreaterThan(0.1);
    expect(restPose(0, -0.5, -0.5, -0.5).pitch).toBeCloseTo(0, 9);
  });
});

describe('effect pools', () => {
  it('stay bounded however many particles are spawned', () => {
    const chips: number[] = [];
    for (let i = 0; i < CHIP_CAP * 5; i++) ringPush(chips, i, CHIP_CAP);
    expect(chips.length).toBe(CHIP_CAP);
    expect(chips[chips.length - 1]).toBe(CHIP_CAP * 5 - 1);
    const puffs: number[] = [];
    for (let i = 0; i < PUFF_CAP * 3; i++) ringPush(puffs, i, PUFF_CAP);
    expect(puffs.length).toBe(PUFF_CAP);
    expect(STUCK_CAP).toBeGreaterThan(0);
  });
});
