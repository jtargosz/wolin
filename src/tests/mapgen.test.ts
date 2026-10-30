import { describe, expect, it } from 'vitest';
import { createGame, step } from '../core/game.ts';
import { generateIsland, validateIsland } from '../core/mapgen.ts';
import { cellCenter, isWalkable, levelAtCell, passable, wolinMap } from '../core/map.ts';
import { findPath } from '../core/path.ts';
import { T } from '../core/types.ts';

const seeds = Array.from({ length: 40 }, (_, i) => 'wyspa-' + i);

describe('Wolin variety', () => {
  const map = wolinMap();
  const code = (cx: number, cy: number) => map.terrain[cy * map.w + cx];

  it('has different coves: a gorge in the north, a wide beach in the west, a rock stack in the east, a wide bay in the south', () => {
    expect([8, 9].every((x) => code(x, 2) === T.BEACH)).toBe(true);
    expect([7, 10].every((x) => code(x, 2) === T.CLIFF)).toBe(true);
    expect(map.terrain.filter((c, i) => c === T.BEACH && i % map.w < 7 && Math.floor(i / map.w) >= 10 && Math.floor(i / map.w) <= 16).length).toBe(21);
    expect(code(37, 19)).toBe(T.CLIFF);
    expect(map.terrain.filter((c, i) => c === T.BEACH && Math.floor(i / map.w) >= 24).length).toBeGreaterThan(40);
  });

  it('has offshore rock islets that stand clear of every boat run', () => {
    for (const [cx, cy] of [
      [2, 8],
      [1, 21],
      [37, 9],
      [30, 29],
    ]) {
      expect(code(cx, cy), `${cx},${cy}`).toBe(T.CLIFF);
      expect(levelAtCell(map, cx, cy)).toBe(1);
    }
    // validateIsland rejects any rock on or right beside a straight boat run
    expect(validateIsland(map)).toBe(true);
  });

  it('the knoll is an optional archer post reached only over its own ramp', () => {
    expect(levelAtCell(map, 25, 21)).toBe(2);
    const from = cellCenter(map, 21, 21);
    const to = cellCenter(map, 25, 21);
    expect(findPath(map, from, to)).not.toBeNull();
    const cut = structuredClone(map);
    for (const cx of [22, 23]) cut.level[21 * cut.w + cx] = 1; // flatten the ramp: now a cliff
    expect(findPath(cut, from, to)).toBeNull();
  });

  it('the east ramp is a single cell wide and still walkable', () => {
    expect(levelAtCell(map, 31, 13)).toBe(1.5);
    expect(levelAtCell(map, 31, 12)).toBe(1);
    expect(levelAtCell(map, 31, 14)).toBe(1);
    expect(findPath(map, cellCenter(map, 33, 13), cellCenter(map, 28, 12))).not.toBeNull();
    const cut = structuredClone(map);
    for (const cx of [30, 31]) cut.level[13 * cut.w + cx] = 1;
    // without the ramp the plateau edge is a cliff here (the other ramps still connect the island)
    expect(passable(cut, cellCenter(cut, 32, 13), cellCenter(cut, 28, 13))).toBe(false);
  });
});

describe('Island generator', () => {
  it('the hand-made Wolin island passes the same validation', () => {
    expect(validateIsland(wolinMap())).toBe(true);
  });

  it('the same seed gives the same island', () => {
    expect(JSON.stringify(generateIsland('abc'))).toBe(JSON.stringify(generateIsland('abc')));
  });

  it('different seeds give different islands', () => {
    const maps = new Set(seeds.map((s) => JSON.stringify([generateIsland(s).terrain, generateIsland(s).level])));
    expect(maps.size).toBeGreaterThan(30);
  });

  it('generated islands are valid on their own (not the Wolin fallback) across a wide sweep', () => {
    const hand = JSON.stringify(wolinMap().terrain);
    const sweep = Array.from({ length: 300 }, (_, i) => 'sweep-' + i);
    let fallback = 0;
    for (const seed of sweep) {
      const map = generateIsland(seed);
      expect(validateIsland(map), seed).toBe(true);
      if (JSON.stringify(map.terrain) === hand) fallback++;
    }
    // the generator itself must almost always succeed
    expect(fallback).toBeLessThan(6);
    // 300 generated islands take several seconds, more on CI runners
  }, 30_000);

  it('every island has the town on the plateau and the lighthouse on the rock', () => {
    for (const seed of seeds) {
      const map = generateIsland(seed);
      expect(levelAtCell(map, 20, 11), seed).toBe(2);
      const lh = map.buildings.find((b) => b.key === 'lighthouse')!;
      const p = { x: (lh.min.x + lh.max.x) / 2, y: (lh.min.y + lh.max.y) / 2 };
      const cx = Math.floor((p.x + (map.w * map.cell) / 2) / map.cell);
      const cy = Math.floor((p.y + (map.h * map.cell) / 2) / map.cell);
      expect(levelAtCell(map, cx, cy), seed).toBe(3);
      expect(findPath(map, map.lanes.N[0].shore, lh.approach[0]), seed).not.toBeNull();
      // beaches are always level 0
      for (let i = 0; i < map.w * map.h; i++) if (map.terrain[i] === T.BEACH) expect(map.level[i], seed).toBe(0);
    }
  });

  it('generated islands vary: knolls, offshore islets, ramp widths and coves differ between seeds', () => {
    const maps = Array.from({ length: 60 }, (_, i) => generateIsland('vary-' + i));
    const knoll = (m: ReturnType<typeof generateIsland>) =>
      m.level.some((v, i) => v === 2 && (i % m.w < 11 || i % m.w > 29 || Math.floor(i / m.w) > 17));
    const islet = (m: ReturnType<typeof generateIsland>) =>
      m.terrain.some((c, i) => {
        if (c !== T.CLIFF) return false;
        const cx = i % m.w;
        const cy = Math.floor(i / m.w);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (cx + dx < 0 || cy + dy < 0 || cx + dx >= m.w || cy + dy >= m.h) continue;
            const n = m.terrain[(cy + dy) * m.w + cx + dx];
            if (n !== T.DEEP && n !== T.SHALLOW && n !== T.CLIFF) return false;
          }
        }
        return true;
      });
    expect(maps.filter(knoll).length).toBeGreaterThan(10);
    expect(maps.filter(knoll).length).toBeLessThan(60);
    expect(maps.filter(islet).length).toBeGreaterThan(10);
    expect(maps.filter((m) => !islet(m)).length).toBeGreaterThan(3);
    // different beach sizes: the number of beach cells is not the same everywhere
    const beaches = new Set(maps.map((m) => m.terrain.filter((c) => c === T.BEACH).length));
    expect(beaches.size).toBeGreaterThan(8);
  });

  it('a game on a generated island runs (no exceptions, squads on land)', () => {
    const s = createGame('gen', { map: generateIsland('gen') });
    for (const q of s.squads) expect(isWalkable(s.map, q.pos)).toBe(true);
    for (let i = 0; i < 400; i++) step(s);
    expect(s.tick).toBe(400);
  });
});
