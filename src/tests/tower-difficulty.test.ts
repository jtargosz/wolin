import { describe, expect, it } from 'vitest';
import {
  ARROW_RANGE,
  BUILDING_HP,
  DIFFICULTY_MULTS,
  HILL_ARROW_MULT,
  HILL_DEFENSE,
  HILL_RANGE_MULT,
  RAMP_SPEED,
  TOWER_ARROW_MULT,
  TOWER_RANGE_MULT,
  UNIT_STATS,
} from '../core/config.ts';
import { arrowRange, arrowStrike, meleeStrike } from '../core/combat.ts';
import { createGame } from '../core/game.ts';
import { cellCenter, codeAtCell, heightLevel, isWalkableCode, levelAtCell, parseMap, terrainCost, wolinMap } from '../core/map.ts';
import { findPath } from '../core/path.ts';
import { T } from '../core/types.ts';
import { createEnemySquad } from '../core/units.ts';
import { speedOf } from '../core/movement.ts';
import { startWave } from '../core/waves.ts';
import { addEnemy, addPlayer, at, field, miniGame } from './helpers.ts';

const towerRows = [':AAAAAA:', ':AAAAAA:', ':______:', ':______:', '::::::::'];
const hillRows = [':______:', ':______:', ':______:', ':______:', '::::::::'];
const hillLevels = ['01111110', '01111110', '00000000', '00000000', '00000000'];

describe('Tower (lighthouse platform)', () => {
  it('buildings are walkable with a high cost and stand one level above their terrace', () => {
    expect(isWalkableCode(T.BUILDING)).toBe(true);
    expect(terrainCost(T.BUILDING)).toBeGreaterThan(terrainCost(T.GRASS));
    const tower = parseMap(towerRows);
    const hill = parseMap(hillRows, hillLevels);
    expect(heightLevel(tower, cellCenter(tower, 1, 0))).toBe(1);
    expect(heightLevel(hill, cellCenter(hill, 1, 0))).toBe(1);
    expect(heightLevel(hill, cellCenter(hill, 1, 2))).toBe(0);
  });

  it('archers two levels above the target shoot like from a tower, one level like from a hill', () => {
    const rows = [':______:', ':______:', ':______:', ':______:', ':______:', '::::::::'];
    const levels = ['02222220', '01111110', '01111110', '00000000', '00000000', '00000000'];
    const s = miniGame(rows, levels);
    const top = addPlayer(s, 'archers', at(s, 2, 0));
    const mid = addPlayer(s, 'archers', at(s, 5, 1));
    const low = addPlayer(s, 'archers', at(s, 5, 4));
    for (const sq of [top, mid, low]) for (const w of sq.warriors) w.trait = 'none';
    const foe = addEnemy(s, at(s, 2, 4));
    expect(arrowRange(s, top, foe)).toBeCloseTo(ARROW_RANGE * TOWER_RANGE_MULT, 9);
    expect(arrowRange(s, mid, foe)).toBeCloseTo(ARROW_RANGE * HILL_RANGE_MULT, 9);
    expect(arrowRange(s, low, foe)).toBeCloseTo(ARROW_RANGE, 9);
    expect(arrowStrike(s, top, foe).dmg).toBeCloseTo(4 * 2.0 * TOWER_ARROW_MULT, 9);
    expect(arrowStrike(s, mid, foe).dmg).toBeCloseTo(4 * 2.0 * HILL_ARROW_MULT, 9);
  });

  it('shooting uphill gets no bonus', () => {
    const s = miniGame(hillRows, hillLevels);
    const low = addPlayer(s, 'archers', at(s, 2, 3));
    for (const w of low.warriors) w.trait = 'none';
    const foe = addEnemy(s, at(s, 2, 0), 4, { x: 0, y: 1 }); // facing the shooter: a front hit
    expect(arrowRange(s, low, foe)).toBeCloseTo(ARROW_RANGE, 9);
    expect(arrowStrike(s, low, foe).dmg).toBeCloseTo(4 * 2.0, 9);
  });

  it('a defender on the tower keeps the height defense bonus', () => {
    const tower = miniGame(towerRows);
    const atk = addEnemy(tower, at(tower, 2, 2), 4);
    const def = addPlayer(tower, 'guard', at(tower, 2, 1));
    for (const w of def.warriors) w.trait = 'none';
    const base = 4 * UNIT_STATS.raiders.dmg * DIFFICULTY_MULTS.normal.enemyDmg;
    expect(meleeStrike(tower, atk, def).dmg).toBeCloseTo(base * HILL_DEFENSE, 9);
  });
});

describe('Ramps', () => {
  const rows = ['::::::::::', ':________:', ':________:', ':________:', '::::::::::'];
  const levels = ['0000000000', '0000ab1110', '0000ab1110', '0000000000', '0000000000'];

  it('walking a ramp is slower than flat ground', () => {
    const s = miniGame(rows, levels);
    const flat = addPlayer(s, 'guard', at(s, 2, 3));
    const ramp = addPlayer(s, 'guard', at(s, 4, 1));
    for (const sq of [flat, ramp]) for (const w of sq.warriors) w.trait = 'none';
    expect(speedOf(s, flat)).toBeCloseTo(UNIT_STATS.guard.speed, 9);
    expect(speedOf(s, ramp)).toBeCloseTo(UNIT_STATS.guard.speed * RAMP_SPEED, 9);
  });

  it('ramp cells count as the lower terrace', () => {
    const m = parseMap(rows, levels);
    expect(heightLevel(m, cellCenter(m, 4, 1))).toBe(0);
    expect(heightLevel(m, cellCenter(m, 5, 1))).toBe(1);
    expect(heightLevel(m, cellCenter(m, 7, 1))).toBe(1);
  });
});

describe('Wolin terraces', () => {
  const map = wolinMap();

  it('the town stands on the plateau and the lighthouse on the rock above it', () => {
    expect(levelAtCell(map, 20, 11)).toBe(2);
    const lh = map.buildings.find((b) => b.key === 'lighthouse')!;
    const c = cellCenter(map, 0, 0);
    const cx = Math.round((lh.min.x - c.x) / map.cell);
    const cy = Math.round((lh.min.y - c.y) / map.cell);
    expect(levelAtCell(map, cx, cy)).toBe(3);
  });

  it('beaches are only in the coves, everything else meets the sea with a cliff', () => {
    for (let i = 0; i < map.w * map.h; i++) {
      if (map.terrain[i] === T.BEACH) expect(map.level[i]).toBe(0);
    }
    // north coast under the plateau is a cliff: shallows below, plateau above
    expect(codeAtCell(map, 20, 2)).toBe(T.SHALLOW);
    expect(levelAtCell(map, 20, 3)).toBe(2);
  });

  it('the lighthouse is reached from the plateau only over its ramp', () => {
    const lh = map.buildings.find((b) => b.key === 'lighthouse')!;
    const p = findPath(map, map.rally, lh.approach[0])!;
    expect(p).not.toBeNull();
    // the route passes the ramp cells (level 2.5)
    let onRamp = false;
    let prev = map.rally;
    for (const q of p) {
      for (let k = 0; k <= 20; k++) {
        const x = prev.x + ((q.x - prev.x) * k) / 20;
        const y = prev.y + ((q.y - prev.y) * k) / 20;
        const cx = Math.floor((x + (map.w * map.cell) / 2) / map.cell);
        const cy = Math.floor((y + (map.h * map.cell) / 2) / map.cell);
        if (levelAtCell(map, cx, cy) === 2.5) onRamp = true;
      }
      prev = q;
    }
    expect(onRamp).toBe(true);
  });
});

describe('Difficulty', () => {
  it('is stored, defaults to normal, and scales buildings and preparation time', () => {
    const normal = createGame('d-normal');
    expect(normal.difficulty).toBe('normal');
    expect(normal.buildings[0].maxHp).toBe(BUILDING_HP);
    for (const d of ['easy', 'hard', 'brutal'] as const) {
      const s = createGame('d-' + d, { difficulty: d });
      expect(s.difficulty).toBe(d);
      expect(s.buildings[0].maxHp).toBe(Math.round(BUILDING_HP * DIFFICULTY_MULTS[d].buildingHp));
      expect(s.rules.prepTicks).toBeGreaterThan(0);
      expect(s.rules.breakTicks).toBeGreaterThan(0);
    }
    expect(createGame('d-easy', { difficulty: 'easy' }).rules.prepTicks).toBeGreaterThan(normal.rules.prepTicks);
    expect(createGame('d-hard', { difficulty: 'hard' }).rules.prepTicks).toBeLessThan(normal.rules.prepTicks);
    expect(createGame('d-brutal', { difficulty: 'brutal' }).rules.prepTicks).toBeLessThan(createGame('d-hard', { difficulty: 'hard' }).rules.prepTicks);
    expect(createGame('d-nope', { difficulty: 'nope' as never }).difficulty).toBe('normal');
  });

  it('scales boat crews', () => {
    for (const d of ['easy', 'normal', 'hard', 'brutal'] as const) {
      const s = createGame('crew-' + d, {
        difficulty: d,
        waves: [{ boats: [{ dir: 'S', crew: 4, delay: 0 }] }],
      });
      startWave(s, []);
      expect(s.boats).toHaveLength(1);
      expect(s.boats[0].crew).toBe(Math.max(1, Math.round(4 * DIFFICULTY_MULTS[d].crew)));
    }
  });

  it('every multiplier rises from easy to brutal (buildings and time to prepare fall)', () => {
    const order = ['easy', 'normal', 'hard', 'brutal'] as const;
    for (let i = 1; i < order.length; i++) {
      const a = DIFFICULTY_MULTS[order[i - 1]];
      const b = DIFFICULTY_MULTS[order[i]];
      expect(b.crew, order[i]).toBeGreaterThan(a.crew);
      expect(b.enemyHp, order[i]).toBeGreaterThan(a.enemyHp);
      expect(b.enemyDmg, order[i]).toBeGreaterThan(a.enemyDmg);
      expect(b.buildingHp, order[i]).toBeLessThanOrEqual(a.buildingHp);
      expect(b.prep, order[i]).toBeLessThanOrEqual(a.prep);
    }
  });

  it('scales enemy durability and damage', () => {
    const mk = (d: 'easy' | 'normal' | 'hard') => createGame('foe-' + d, { map: parseMap(field(10, 6)), waves: [], difficulty: d });
    const se = mk('easy');
    const sn = mk('normal');
    const sh = mk('hard');
    const ee = createEnemySquad(se, at(se, 1, 1), { x: 0, y: 1 }, 3, -1);
    const en = createEnemySquad(sn, at(sn, 1, 1), { x: 0, y: 1 }, 3, -1);
    const eh = createEnemySquad(sh, at(sh, 1, 1), { x: 0, y: 1 }, 3, -1);
    expect(en.warriors[0].hp).toBe(Math.round(UNIT_STATS.raiders.hp * DIFFICULTY_MULTS.normal.enemyHp));
    expect(ee.warriors[0].hp).toBeLessThan(en.warriors[0].hp);
    expect(eh.warriors[0].hp).toBeGreaterThan(en.warriors[0].hp);
    const target = (s: typeof sn) => addPlayer(s, 'guard', at(s, 5, 1));
    const te = target(se);
    const tn = target(sn);
    const th = target(sh);
    for (const t of [te, tn, th]) for (const w of t.warriors) w.trait = 'none';
    const ae = addEnemy(se, at(se, 5, 3), 4);
    const an = addEnemy(sn, at(sn, 5, 3), 4);
    const ah = addEnemy(sh, at(sh, 5, 3), 4);
    const de = meleeStrike(se, ae, te).dmg;
    const dn = meleeStrike(sn, an, tn).dmg;
    const dh = meleeStrike(sh, ah, th).dmg;
    expect(de).toBeLessThan(dn);
    expect(dh).toBeGreaterThan(dn);
  });
});
