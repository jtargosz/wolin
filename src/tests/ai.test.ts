import indexHtml from '../../index.html?raw';
import { describe, expect, it } from 'vitest';
import { REGROUP_TICKS } from '../core/config.ts';
import { createGame, issueCommand, step } from '../core/game.ts';
import { worldToCell } from '../core/map.ts';
import { hpRatio } from '../core/units.ts';
import { addEnemy, addPlayer, at, field, miniGame, run } from './helpers.ts';

// a lower terrace on the left (level 0), a ramp in column 4, the upper terrace on the right with a building
const rows = ['::::::::::::', ':__________:', ':__________:', ':_____AA___:', ':__________:', ':__________:', '::::::::::::'];
const levels = ['000000000000', '0000a1111110', '0000a1111110', '0000a1111110', '0000a1111110', '0000a1111110', '000000000000'];

const col = (s: ReturnType<typeof miniGame>, sq: { pos: { x: number; y: number } }) => worldToCell(s.map, sq.pos).cx;

/** The game is lost as soon as no player squad lives, so every scenario keeps one guard far away. */
function ramp() {
  const s = miniGame(rows, levels);
  addPlayer(s, 'guard', at(s, 10, 1));
  return s;
}

describe('Raider AI', () => {
  it('boats of one wave head for different buildings', () => {
    const s = createGame('spread');
    issueCommand(s, { kind: 'callWave' });
    run(s, 2);
    const wave = s.boats.filter((b) => b.wave === 0);
    expect(wave.length).toBeGreaterThanOrEqual(2);
    const targets = wave.map((b) => b.preferredBuilding);
    expect(new Set(targets).size).toBe(targets.length);
    for (const t of targets) expect(t).toBeGreaterThanOrEqual(0);
  });

  it('a squad waits at the foot of a ramp for a distant partner, then goes on after the timeout', () => {
    const s = ramp();
    const a = addEnemy(s, at(s, 2, 3));
    addEnemy(s, at(s, 10, 5)); // same wave, but far away on the upper terrace
    run(s, 100);
    expect(col(s, a)).toBeLessThanOrEqual(3);
    expect(a.waitSince).toBeGreaterThanOrEqual(0);
    run(s, REGROUP_TICKS + 120);
    expect(col(s, a)).toBeGreaterThanOrEqual(4);
    expect(a.waitLevel).toBe(0);
  });

  it('a partner close by releases the wait at once', () => {
    const s = ramp();
    const a = addEnemy(s, at(s, 2, 3));
    addEnemy(s, at(s, 3, 5));
    run(s, 100);
    expect(col(s, a)).toBeGreaterThanOrEqual(4);
  });

  it('a squad under fire does not wait at the ramp', () => {
    const s = ramp();
    const a = addEnemy(s, at(s, 2, 3));
    a.lastCombatTick = 0;
    run(s, 80);
    expect(col(s, a)).toBeGreaterThanOrEqual(4);
  });

  it('raiders rout only when morale is low AND they are really losing; the player rule is unchanged', () => {
    const s = miniGame(field());
    addPlayer(s, 'guard', at(s, 28, 18)); // keeps the game running
    const foe = addEnemy(s, at(s, 10, 10), 4);
    foe.morale = 10;
    step(s);
    expect(foe.mode).toBe('ready');
    expect(hpRatio(foe)).toBe(1);
    for (const w of foe.warriors) w.hp = w.maxHp * 0.1;
    step(s);
    expect(foe.mode).toBe('routing');
    const mine = addPlayer(s, 'guard', at(s, 4, 4));
    mine.morale = 10;
    step(s);
    expect(mine.mode).toBe('routing');
  });

  it('melee raiders notice player archers from further away and pick them before nearer squads', () => {
    const s = miniGame(field(40, 20));
    const foe = addEnemy(s, at(s, 10, 10), 4);
    const archers = addPlayer(s, 'archers', { x: foe.pos.x + 12, y: foe.pos.y });
    step(s);
    // 12 m is beyond the plain aggro (6 m + the squad radii) but inside the archer aggro
    expect(foe.goal).not.toBeNull();
    expect(Math.hypot(foe.goal!.x - archers.pos.x, foe.goal!.y - archers.pos.y)).toBeLessThan(0.6);
    const s2 = miniGame(field(40, 20));
    const foe2 = addEnemy(s2, at(s2, 10, 10), 4);
    addPlayer(s2, 'guard', { x: foe2.pos.x + 12, y: foe2.pos.y });
    step(s2);
    expect(foe2.goal).toBeNull();
    const s3 = miniGame(field(40, 20));
    const foe3 = addEnemy(s3, at(s3, 10, 10), 4);
    addPlayer(s3, 'guard', { x: foe3.pos.x + 8, y: foe3.pos.y });
    const bow = addPlayer(s3, 'archers', { x: foe3.pos.x - 10, y: foe3.pos.y });
    step(s3);
    expect(Math.hypot(foe3.goal!.x - bow.pos.x, foe3.goal!.y - bow.pos.y)).toBeLessThan(0.6);
  });

  it('the title menu lists the brutal difficulty', () => {
    expect(indexHtml).toContain('<option value="brutal" data-i18n="difficulty.brutal">');
  });
});
