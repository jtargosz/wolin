import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three/webgpu';
import {
  buildBoulderGeometry,
  buildBroadGeometry,
  buildBushGeometry,
  buildPineGeometry,
  buildTrunkGeometry,
  TRIANGLE_BUDGET,
  triangleCount,
} from '../render/trees.ts';

function bounds(g: BufferGeometry) {
  g.computeBoundingBox();
  return g.boundingBox!;
}

/** Every attribute value is finite, normals are unit length, vertex colors are in 0..1. */
function expectSound(g: BufferGeometry, colored = true): void {
  for (const name of ['position', 'normal', ...(colored ? ['color'] : [])]) {
    const a = g.getAttribute(name);
    expect(a, name).toBeDefined();
    for (const v of a.array) expect(Number.isFinite(v)).toBe(true);
  }
  // the lathe trunk keeps three's own normals, which are not unit length (the shader normalizes them)
  const n = g.getAttribute('normal');
  if (colored) for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
  if (colored) for (const v of g.getAttribute('color').array) expect(v >= 0 && v <= 1).toBe(true);
}

describe('plant and rock geometry', () => {
  it('pine: within budget, about a tree tall, sound attributes', () => {
    const g = buildPineGeometry();
    expect(triangleCount(g)).toBeGreaterThan(300);
    expect(triangleCount(g)).toBeLessThanOrEqual(TRIANGLE_BUDGET.pine);
    const b = bounds(g);
    expect(b.max.y).toBeGreaterThan(3.5);
    expect(b.max.y).toBeLessThan(4.6);
    expect(b.min.y).toBeGreaterThan(0.5); // the trunk shows below the skirts
    expect(b.max.x).toBeLessThan(1.8);
    expectSound(g);
  });

  it('broadleaf: crown and cards within budget, cards hug the outline', () => {
    const { crown, cards } = buildBroadGeometry();
    expect(triangleCount(crown) + triangleCount(cards)).toBeLessThanOrEqual(TRIANGLE_BUDGET.broad);
    expect(triangleCount(cards)).toBeGreaterThan(20);
    const b = bounds(crown);
    expect(b.max.y).toBeGreaterThan(3.2);
    expect(b.max.y).toBeLessThan(4.6);
    expect(b.min.y).toBeGreaterThan(1.0); // clear space for the trunk
    const c = bounds(cards);
    expect(c.max.y).toBeLessThan(b.max.y + 1.0);
    expectSound(crown);
    expectSound(cards);
  });

  it('bush and boulder: within budget and sound', () => {
    const bush = buildBushGeometry();
    expect(triangleCount(bush)).toBeLessThanOrEqual(TRIANGLE_BUDGET.bush);
    expect(bounds(bush).max.y).toBeLessThan(1.2);
    expectSound(bush);
    const rock = buildBoulderGeometry();
    expect(triangleCount(rock)).toBeLessThanOrEqual(TRIANGLE_BUDGET.boulder);
    const b = bounds(rock);
    expect(b.max.x).toBeLessThan(1.4);
    expect(b.min.y).toBeGreaterThan(-1.2);
    expectSound(rock);
  });

  it('trunk is a tapered column with finite positions', () => {
    const g = buildTrunkGeometry();
    const b = bounds(g);
    expect(b.max.y).toBeGreaterThan(1.5);
    expect(b.max.x).toBeLessThan(0.4);
    expectSound(g, false);
  });

  it('geometry is deterministic', () => {
    const a = buildPineGeometry().getAttribute('position').array;
    const b = buildPineGeometry().getAttribute('position').array;
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = buildBroadGeometry().cards.getAttribute('position').array;
    const d = buildBroadGeometry().cards.getAttribute('position').array;
    expect(Array.from(c)).toEqual(Array.from(d));
  });
});
