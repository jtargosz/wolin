// 2D vectors. Arithmetic and sqrt only (exact per IEEE 754), no trigonometric functions.

import type { Vec } from './types.ts';

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec): number => Math.sqrt(a.x * a.x + a.y * a.y);
export const dist = (a: Vec, b: Vec): number => len(sub(a, b));
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });
export const copy = (a: Vec): Vec => ({ x: a.x, y: a.y });

/** Unit vector; returns the fallback for length ~0. */
export function normalize(a: Vec, fallback: Vec = { x: 0, y: 1 }): Vec {
  const l = len(a);
  if (l < 1e-9) return { x: fallback.x, y: fallback.y };
  return { x: a.x / l, y: a.y / l };
}

/** Shortens a vector to a maximum length. */
export function clampLen(a: Vec, max: number): Vec {
  const l = len(a);
  if (l <= max || l < 1e-12) return a;
  return scale(a, max / l);
}

/** Turns a direction toward a target via nlerp; opposite vectors are first turned by 90 degrees. */
export function turnToward(from: Vec, to: Vec, t: number): Vec {
  let target = to;
  if (dot(from, to) < -0.95) target = perp(from);
  return normalize({ x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t }, from);
}

/** Distance from a point to a rectangle (0 inside). */
export function distToRect(p: Vec, min: Vec, max: Vec): number {
  const dx = Math.max(min.x - p.x, 0, p.x - max.x);
  const dy = Math.max(min.y - p.y, 0, p.y - max.y);
  return Math.sqrt(dx * dx + dy * dy);
}
