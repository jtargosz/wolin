import { describe, expect, it } from 'vitest';
import { UNIT_STATS } from '../core/config.ts';
import { createGame, issueCommand, step } from '../core/game.ts';
import { codeAtCell, isWalkable, isWalkableCode, levelAtCell, worldToCell, wolinMap } from '../core/map.ts';
import { findPath } from '../core/path.ts';
import { T } from '../core/types.ts';
import { fastMult } from '../core/units.ts';
import { len } from '../core/vec.ts';
import { addEnemy, addPlayer, at, field, miniGame, run } from './helpers.ts';

describe('Wolin map', () => {
  const map = wolinMap();

  it('is 40x32 cells with 3 key buildings', () => {
    expect(map.w).toBe(40);
    expect(map.h).toBe(32);
    expect(map.buildings.map((b) => b.key).sort()).toEqual(['granary', 'lighthouse', 'workshop']);
    expect(map.starts.length).toBe(3);
  });

  it('the gate is walkable, the palisade is not', () => {
    expect(isWalkableCode(T.GATE)).toBe(true);
    expect(isWalkableCode(T.WALL)).toBe(false);
    expect(map.terrain.filter((c) => c === T.GATE).length).toBe(2);
  });

  it('every landing spot is reachable from the rally point', () => {
    for (const lanes of Object.values(map.lanes)) {
      expect(lanes.length).toBeGreaterThan(0);
      for (const l of lanes) {
        expect(isWalkable(map, l.landing)).toBe(true);
        expect(findPath(map, l.shore, map.rally)).not.toBeNull();
      }
    }
  });

  it('the east margin between the palisade and the plateau edge is 2 cells wide', () => {
    // row 10: palisade '#' at column 27, 2 plateau cells, then the cliff down to the meadow
    expect(codeAtCell(map, 27, 10)).toBe(T.WALL);
    expect(codeAtCell(map, 28, 10)).toBe(T.GRASS);
    expect(codeAtCell(map, 29, 10)).toBe(T.GRASS);
    expect(levelAtCell(map, 29, 10)).toBe(2);
    expect(levelAtCell(map, 30, 10)).toBe(1);
  });

  it('the path from the beach to town goes through the gate', () => {
    const p = findPath(map, map.lanes.S[0].shore, map.rally)!;
    expect(p).not.toBeNull();
    const cells = p.map((q) => worldToCell(map, q));
    // before the rally point the path must cross the palisade line (row 15) in the gate columns 19-20
    const sampled = [];
    let prev = map.lanes.S[0].shore;
    for (const q of p) {
      for (let k = 0; k <= 20; k++) sampled.push(worldToCell(map, { x: prev.x + ((q.x - prev.x) * k) / 20, y: prev.y + ((q.y - prev.y) * k) / 20 }));
      prev = q;
    }
    const crossing = sampled.filter((c) => c.cy === 15);
    expect(crossing.length).toBeGreaterThan(0);
    // the gate occupies columns 19-20; grazing a post corner is tolerated (line sampling)
    expect(codeAtCell(map, 19, 15)).toBe(T.GATE);
    expect(crossing.some((c) => c.cx === 19 || c.cx === 20)).toBe(true);
    for (const c of crossing) expect(c.cx).toBeGreaterThanOrEqual(18);
    for (const c of crossing) expect(c.cx).toBeLessThanOrEqual(21);
    expect(cells.length).toBeGreaterThan(0);
  });
});

describe('Squad movement', () => {
  it('accelerates, brakes, never exceeds max speed, and stops at the goal', () => {
    const s = miniGame(field());
    const sq = addPlayer(s, 'guard', at(s, 3, 10));
    const to = at(s, 24, 10);
    expect(issueCommand(s, { kind: 'move', squadId: sq.id, to })).toBe(true);
    const speeds: number[] = [];
    for (let i = 0; i < 600; i++) {
      step(s);
      speeds.push(len(sq.vel));
    }
    const vmax = UNIT_STATS.guard.speed * fastMult(sq);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(vmax + 1e-9);
    expect(speeds[5]).toBeLessThan(speeds[40]); // gentle start
    const peak = speeds.indexOf(Math.max(...speeds));
    // gradual braking: after the peak there are intermediate speeds before the squad stops
    expect(speeds.slice(peak).some((v) => v > 0.05 && v < speeds[peak] * 0.5)).toBe(true);
    expect(Math.hypot(sq.pos.x - to.x, sq.pos.y - to.y)).toBeLessThan(0.35);
    expect(sq.order.kind).toBe('hold');
  });

  it('an order while paused changes neither the tick nor the position', () => {
    const s = createGame('pauza');
    const sq = s.squads[0];
    const pos = { ...sq.pos };
    expect(issueCommand(s, { kind: 'move', squadId: sq.id, to: s.map.rally })).toBe(true);
    expect(s.tick).toBe(0);
    expect(sq.pos).toEqual(pos);
    run(s, 40);
    expect(sq.pos).not.toEqual(pos);
  });

  it('rejects orders for enemies and invalid coordinates', () => {
    const s = miniGame(field());
    const e = addEnemy(s, at(s, 10, 10));
    const p = addPlayer(s, 'guard', at(s, 3, 3));
    expect(issueCommand(s, { kind: 'move', squadId: e.id, to: at(s, 5, 5) })).toBe(false);
    expect(issueCommand(s, { kind: 'move', squadId: p.id, to: { x: NaN, y: 0 } })).toBe(false);
  });

  it('a squad in a narrow passage blocks the enemy', () => {
    const rows = [
      '::::::::::::::::',
      ':______________:',
      ':______________:',
      ':######__######:',
      ':######__######:',
      ':######__######:',
      ':______________:',
      ':______________:',
      '::::::::::::::::',
    ];
    const s = miniGame(rows);
    const gate = { x: (at(s, 7, 4).x + at(s, 8, 4).x) / 2, y: at(s, 7, 4).y };
    const guard = addPlayer(s, 'guard', gate, { x: 0, y: 1 });
    guard.morale = 100;
    const e = addEnemy(s, at(s, 7, 7));
    // the enemy wants to go north; the defender stands in the passage
    for (let i = 0; i < 200; i++) {
      e.goal = at(s, 7, 1);
      step(s);
    }
    expect(e.pos.y).toBeGreaterThan(guard.pos.y);
  });

  it('the roster from the seed is deterministic, names are unique', () => {
    const a = createGame('sklad');
    const b = createGame('sklad');
    expect(a.squads.map((q) => q.warriors.map((w) => w.name + w.trait))).toEqual(b.squads.map((q) => q.warriors.map((w) => w.name + w.trait)));
    const names = a.squads.flatMap((q) => q.warriors.map((w) => w.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('the "fast" trait speeds up a squad', () => {
    const s = miniGame(field());
    const sq = addPlayer(s, 'archers', at(s, 3, 10));
    for (const w of sq.warriors) w.trait = 'none';
    const slow = fastMult(sq);
    for (const w of sq.warriors) w.trait = 'fast';
    expect(fastMult(sq)).toBeGreaterThan(slow);
  });
});
