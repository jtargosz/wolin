import { describe, expect, it } from 'vitest';
import { karplusStrong, mulberry32, reverbImpulse } from '../audio/synth.ts';

const SR = 44100;

const energy = (a: Float32Array, from: number, to: number): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return s / (to - from);
};

/** Lag with the strongest autocorrelation between `lo` and `hi` samples. */
function bestLag(a: Float32Array, lo: number, hi: number): number {
  let best = lo;
  let bestV = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i < 20000; i++) s += a[i] * a[i + lag];
    if (s > bestV) {
      bestV = s;
      best = lag;
    }
  }
  return best;
}

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v >= 0 && v < 1).toBe(true);
    }
    expect(mulberry32(6)()).not.toBe(mulberry32(5)());
  });
});

describe('karplusStrong', () => {
  it('is finite, normalized, the right length, and decays', () => {
    const b = karplusStrong(SR, 440, 2, mulberry32(1));
    expect(b.length).toBe(SR * 2);
    let peak = 0;
    for (const v of b) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeCloseTo(1, 5);
    expect(energy(b, 0, 8000)).toBeGreaterThan(energy(b, SR, SR + 8000) * 3);
    expect(Math.abs(b[b.length - 1])).toBeLessThan(0.01); // faded, no click at the end
  });

  it('is deterministic for the same random source', () => {
    const a = karplusStrong(SR, 330, 0.5, mulberry32(9));
    const b = karplusStrong(SR, 330, 0.5, mulberry32(9));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('plays the requested pitch, also high up (fractional delay)', () => {
    for (const hz of [220, 587.33, 1174.66]) {
      const b = karplusStrong(SR, hz, 1, mulberry32(3));
      const period = SR / hz;
      const lag = bestLag(b, Math.floor(period * 0.8), Math.ceil(period * 1.2));
      expect(Math.abs(lag - period), `${hz} Hz`).toBeLessThan(1.01);
    }
  });
});

describe('reverbImpulse', () => {
  it('has two different decaying, finite channels', () => {
    const [l, r] = reverbImpulse(SR, 2.8, 6.5, mulberry32(1), mulberry32(2));
    expect(l.length).toBe(Math.floor(SR * 2.8));
    expect(r.length).toBe(l.length);
    for (const ch of [l, r]) {
      let peak = 0;
      for (const v of ch) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeLessThanOrEqual(1);
      expect(energy(ch, 0, SR / 2)).toBeGreaterThan(energy(ch, ch.length - SR / 2, ch.length) * 20);
    }
    expect(Array.from(l.slice(1000, 1010))).not.toEqual(Array.from(r.slice(1000, 1010)));
  });

  it('starts with a short ramp, not a click', () => {
    const [l] = reverbImpulse(SR, 1, 6, mulberry32(1), mulberry32(2));
    expect(l[0]).toBe(0);
  });
});
