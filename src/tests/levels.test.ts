import { describe, expect, it } from 'vitest';
import { inMelee, meleeStrike } from '../core/combat.ts';
import { issueCommand, step } from '../core/game.ts';
import { canStep, levelAtCell, parseMap, passable, worldToCell } from '../core/map.ts';
import { findPath, lineClear } from '../core/path.ts';
import { addEnemy, addPlayer, at, miniGame, run } from './helpers.ts';

// a terrace (level 1) in the east half, reachable only over the ramp in row 1
const rows = ['::::::::::::', ':__________:', ':__________:', ':__________:', ':__________:', '::::::::::::'];
const levels = ['000000000000', '00000a111110', '000000111110', '000000111110', '000000111110', '000000000000'];

describe('Terrace levels', () => {
  const map = parseMap(rows, levels);

  it('parses flat levels and ramps; missing layer means level 0', () => {
    expect(levelAtCell(map, 2, 2)).toBe(0);
    expect(levelAtCell(map, 5, 1)).toBe(0.5);
    expect(levelAtCell(map, 8, 3)).toBe(1);
    expect(parseMap(rows).level.every((v) => v === 0)).toBe(true);
    expect(() => parseMap(rows, levels.slice(1))).toThrow();
  });

  it('steps: flat and ramp pass, a cliff blocks, a diagonal cannot cut a cliff corner', () => {
    expect(canStep(map, 1, 2, 2, 2)).toBe(true);
    expect(canStep(map, 4, 1, 5, 1)).toBe(true); // up the ramp
    expect(canStep(map, 5, 1, 6, 1)).toBe(true); // onto the terrace
    expect(canStep(map, 5, 2, 6, 2)).toBe(false); // cliff
    expect(canStep(map, 6, 2, 5, 2)).toBe(false); // down the cliff
    expect(canStep(map, 4, 2, 5, 1)).toBe(true);
    expect(canStep(map, 5, 1, 6, 2)).toBe(false); // (5,2)->(6,2) is a cliff
  });

  it('straight walks and line of sight respect cliffs', () => {
    expect(passable(map, at0(map, 3, 3), at0(map, 8, 3))).toBe(false);
    expect(passable(map, at0(map, 3, 1), at0(map, 8, 1))).toBe(true);
    expect(lineClear(map, at0(map, 3, 3), at0(map, 8, 3))).toBe(false);
  });

  it('A* goes around over the ramp', () => {
    const p = findPath(map, at0(map, 3, 4), at0(map, 8, 4))!;
    expect(p).not.toBeNull();
    const rowsHit = new Set<number>();
    let prev = at0(map, 3, 4);
    for (const q of p) {
      for (let k = 0; k <= 20; k++) rowsHit.add(worldToCell(map, { x: prev.x + ((q.x - prev.x) * k) / 20, y: prev.y + ((q.y - prev.y) * k) / 20 }).cy);
      prev = q;
    }
    expect(rowsHit.has(1)).toBe(true);
  });
});

function at0(map: ReturnType<typeof parseMap>, cx: number, cy: number) {
  return { x: (cx + 0.5) * map.cell - (map.w * map.cell) / 2, y: (cy + 0.5) * map.cell - (map.h * map.cell) / 2 };
}

describe('Squads on terraces', () => {
  it('a squad climbs only over the ramp and arrives on the terrace', () => {
    const s = miniGame(rows, levels);
    const sq = addPlayer(s, 'guard', at(s, 3, 4));
    const goal = at(s, 8, 4);
    expect(issueCommand(s, { kind: 'move', squadId: sq.id, to: goal })).toBe(true);
    let maxLevelJump = 0;
    let prev = levelAtCell(s.map, worldToCell(s.map, sq.pos).cx, worldToCell(s.map, sq.pos).cy);
    for (let i = 0; i < 1200; i++) {
      step(s);
      const c = worldToCell(s.map, sq.pos);
      const lv = levelAtCell(s.map, c.cx, c.cy);
      maxLevelJump = Math.max(maxLevelJump, Math.abs(lv - prev));
      prev = lv;
    }
    expect(maxLevelJump).toBeLessThanOrEqual(0.5);
    expect(Math.hypot(sq.pos.x - goal.x, sq.pos.y - goal.y)).toBeLessThan(0.5);
  });

  it('no melee over a cliff edge; contact over the ramp works', () => {
    const s = miniGame(rows, levels);
    const top = addPlayer(s, 'guard', at(s, 6, 3));
    const below = addEnemy(s, at(s, 4, 3));
    expect(inMelee(s, top, below)).toBe(false);
    run(s, 200);
    expect(top.warriors.every((w) => w.hp === w.maxHp)).toBe(true);
    const s2 = miniGame(rows, levels);
    const a = addPlayer(s2, 'guard', at(s2, 6, 1));
    const b = addEnemy(s2, at(s2, 4, 1));
    expect(inMelee(s2, a, b)).toBe(true);
    expect(meleeStrike(s2, b, a).dmg).toBeGreaterThan(0);
  });
});
