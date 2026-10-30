// Fixed-step loop. The accumulator is kept in tick units to avoid 0.05 * n rounding errors.

import { MAX_FRAME_DT, MAX_STEPS_PER_FRAME, TICK_RATE } from './config.ts';

export interface Clock {
  acc: number; // fraction of a tick waiting to be run
  paused: boolean;
  speed: number; // 0.5 / 1 / 2
}

export function createClock(): Clock {
  return { acc: 0, paused: false, speed: 1 };
}

/** Returns the number of simulation steps to run now and alpha for render interpolation. */
export function advance(clock: Clock, realDt: number): { steps: number; alpha: number } {
  if (clock.paused) return { steps: 0, alpha: clock.acc };
  const dt = Math.min(Math.max(realDt, 0), MAX_FRAME_DT);
  clock.acc += dt * clock.speed * TICK_RATE;
  let steps = Math.floor(clock.acc);
  clock.acc -= steps;
  if (steps > MAX_STEPS_PER_FRAME) {
    steps = MAX_STEPS_PER_FRAME;
    clock.acc = 0;
  }
  return { steps, alpha: clock.acc };
}
