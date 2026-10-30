import { describe, expect, it } from 'vitest';
import { MAX_STEPS_PER_FRAME } from '../core/config.ts';
import { createGame, step } from '../core/game.ts';
import { advance, createClock } from '../core/loop.ts';
import { hashSeed, rand, randInt } from '../core/rng.ts';

describe('RNG', () => {
  it('FNV-1a matches reference vectors', () => {
    expect(hashSeed('')).toBe(0x811c9dc5);
    expect(hashSeed('a')).toBe(0xe40c292c);
    expect(hashSeed('foobar')).toBe(0xbf9cf968);
  });

  it('the same seed gives the same sequence, a different seed a different one', () => {
    const a = { rng: hashSeed('wolin-x') };
    const b = { rng: hashSeed('wolin-x') };
    const c = { rng: hashSeed('wolin-y') };
    const sa = Array.from({ length: 20 }, () => rand(a));
    const sb = Array.from({ length: 20 }, () => rand(b));
    const sc = Array.from({ length: 20 }, () => rand(c));
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const x of sa) expect(x >= 0 && x < 1).toBe(true);
  });

  it('randInt stays in range and hits both ends', () => {
    const s = { rng: 1 };
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const k = randInt(s, 2, 5);
      expect(k >= 2 && k <= 5).toBe(true);
      seen.add(k);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('createGame with the same seed gives an identical state', () => {
    expect(JSON.stringify(createGame('abc'))).toBe(JSON.stringify(createGame('abc')));
    expect(JSON.stringify(createGame('abc'))).not.toBe(JSON.stringify(createGame('abd')));
  });
});

describe('Fixed-step loop', () => {
  it('1x: 20 steps per second', () => {
    const c = createClock();
    let steps = 0;
    for (let i = 0; i < 10; i++) steps += advance(c, 0.1).steps;
    expect(steps).toBe(20);
  });

  it('speed 2x and 0.5x scales the step count', () => {
    const fast = createClock();
    fast.speed = 2;
    const slow = createClock();
    slow.speed = 0.5;
    let f = 0;
    let s = 0;
    for (let i = 0; i < 10; i++) {
      f += advance(fast, 0.1).steps;
      s += advance(slow, 0.1).steps;
    }
    expect(f).toBe(40);
    expect(s).toBe(10);
  });

  it('pause: zero steps and the tick does not change', () => {
    const c = createClock();
    const g = createGame('pauza');
    c.paused = true;
    for (let i = 0; i < 100; i++) {
      const { steps } = advance(c, 0.05);
      for (let k = 0; k < steps; k++) step(g);
    }
    expect(g.tick).toBe(0);
    c.paused = false;
    const { steps } = advance(c, 0.1);
    for (let k = 0; k < steps; k++) step(g);
    expect(g.tick).toBe(2);
  });

  it('a big frame is clamped and limited', () => {
    const c = createClock();
    c.speed = 2;
    const r = advance(c, 5);
    expect(r.steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThan(1);
  });

  it('alpha grows between steps', () => {
    const c = createClock();
    const a = advance(c, 0.01);
    const b = advance(c, 0.01);
    expect(a.steps + b.steps).toBe(0);
    expect(b.alpha).toBeGreaterThan(a.alpha);
  });
});
