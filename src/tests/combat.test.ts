import { describe, expect, it } from 'vitest';
import {
  ARROW_DMG,
  DIFFICULTY_MULTS,
  FLANK_BACK,
  FLANK_SIDE,
  HILL_ARROW_MULT,
  HILL_DEFENSE,
  HORN_RADIUS,
  RALLY_AT,
  ROUT_BELOW,
  SHIELD_REDUCTION,
  SHIELD_TICKS,
  SPEAR_BEACH_MULT,
  UNIT_STATS,
} from '../core/config.ts';
import { applyDamage, arrowRange, arrowStrike, flankOf, meleeStrike, useHorn } from '../core/combat.ts';
import { issueCommand, step } from '../core/game.ts';
import type { Trait } from '../core/types.ts';
import { addEnemy, addPlayer, at, field, miniGame, run, runUntil } from './helpers.ts';

const noTraits = (sq: { warriors: { trait: Trait }[] }) => sq.warriors.forEach((w) => (w.trait = 'none'));

describe('Damage and position', () => {
  it('base melee damage = count x unit damage', () => {
    const s = miniGame(field());
    const e = addEnemy(s, at(s, 10, 10), 4);
    const p = addPlayer(s, 'guard', at(s, 10, 7), { x: 0, y: 1 });
    noTraits(p);
    const st = meleeStrike(s, e, p);
    expect(st.flank).toBe('front');
    expect(st.dmg).toBeCloseTo(4 * UNIT_STATS.raiders.dmg * DIFFICULTY_MULTS.normal.enemyDmg, 9);
  });

  it('front < side < back', () => {
    const s = miniGame(field());
    const p = addPlayer(s, 'guard', at(s, 10, 10), { x: 0, y: 1 });
    noTraits(p);
    const front = addEnemy(s, at(s, 10, 13));
    const side = addEnemy(s, at(s, 13, 10));
    const back = addEnemy(s, at(s, 10, 7));
    expect(flankOf(front.pos, p)).toBe('front');
    expect(flankOf(side.pos, p)).toBe('side');
    expect(flankOf(back.pos, p)).toBe('back');
    const f = meleeStrike(s, front, p).dmg;
    expect(meleeStrike(s, side, p).dmg).toBeCloseTo(f * FLANK_SIDE, 9);
    expect(meleeStrike(s, back, p).dmg).toBeCloseTo(f * FLANK_BACK, 9);
  });

  it('hill: the defender takes less, archers shoot farther and harder', () => {
    // a 4x4 terrace one level up, cliffs all around
    const levels = field(20, 12).map((_r, y) => (y >= 3 && y <= 6 ? '000' + '1111' + '0'.repeat(13) : '0'.repeat(20)));
    const s = miniGame(field(20, 12), levels);
    const high = addPlayer(s, 'archers', at(s, 4, 4), { x: 0, y: 1 });
    const low = addPlayer(s, 'archers', at(s, 14, 4), { x: 0, y: 1 });
    noTraits(high);
    noTraits(low);
    const e = addEnemy(s, at(s, 4, 9));
    const e2 = addEnemy(s, at(s, 14, 9));
    expect(arrowRange(s, high)).toBeGreaterThan(arrowRange(s, low));
    expect(arrowStrike(s, high, e).dmg).toBeCloseTo(4 * ARROW_DMG * HILL_ARROW_MULT, 9);
    expect(arrowStrike(s, low, e2).dmg).toBeCloseTo(4 * ARROW_DMG, 9);
    const d = addPlayer(s, 'guard', at(s, 5, 6), { x: 0, y: 1 });
    noTraits(d);
    const base = 4 * UNIT_STATS.raiders.dmg * DIFFICULTY_MULTS.normal.enemyDmg;
    expect(meleeStrike(s, e, d).dmg).toBeCloseTo(base * HILL_DEFENSE, 9);
  });

  it('shallows: an attacker in the water deals less', () => {
    const s = miniGame(field());
    const d = addPlayer(s, 'guard', at(s, 1, 10), { x: 0, y: 1 });
    noTraits(d);
    const inWater = addEnemy(s, at(s, 0, 10));
    const onLand = addEnemy(s, at(s, 3, 10));
    // d stands on grass (column 1), so the penalty applies only to the attacker in the shallows
    expect(meleeStrike(s, inWater, d).dmg).toBeLessThan(meleeStrike(s, onLand, d).dmg);
  });

  it('spearmen: bonus and push against a target on the beach', () => {
    const rows = field(20, 12).map((r, y) => (y >= 6 ? ':' + '.'.repeat(18) + ':' : r));
    rows[11] = ':'.repeat(20);
    const s = miniGame(rows);
    const sp = addPlayer(s, 'spearmen', at(s, 10, 5), { x: 0, y: 1 });
    noTraits(sp);
    const e = addEnemy(s, at(s, 10, 8));
    const grass = addEnemy(s, at(s, 3, 3));
    const beach = meleeStrike(s, sp, e);
    expect(beach.push).toBe(true);
    expect(beach.dmg).toBeCloseTo(5 * UNIT_STATS.spearmen.dmg * SPEAR_BEACH_MULT, 9);
    expect(meleeStrike(s, sp, grass).push).toBe(false);
  });

  it('archers are weak in melee', () => {
    const s = miniGame(field());
    const a = addPlayer(s, 'archers', at(s, 10, 7));
    const d = addPlayer(s, 'guard', at(s, 3, 3));
    noTraits(a);
    noTraits(d);
    const e = addEnemy(s, at(s, 10, 10));
    expect(meleeStrike(s, a, e).dmg).toBeLessThan(meleeStrike(s, d, e).dmg / 3);
  });

  it('warriors fall one by one, the fallen go to the list', () => {
    const s = miniGame(field());
    const p = addPlayer(s, 'guard', at(s, 10, 7));
    noTraits(p);
    applyDamage(s, p, 45, 'front', -1, false, []);
    expect(p.warriors[0].alive).toBe(false);
    expect(p.warriors[1].hp).toBe(35);
    expect(p.warriors.slice(2).every((w) => w.hp === 40)).toBe(true);
    expect(s.fallen.length).toBe(1);
  });
});

describe('Morale', () => {
  it('low morale leads to a retreat to town; at the rally point they rally', () => {
    const s = miniGame(field());
    s.map.rally = at(s, 3, 3);
    const p = addPlayer(s, 'spearmen', at(s, 20, 10));
    noTraits(p);
    p.morale = ROUT_BELOW - 1;
    const ev = run(s, 1);
    expect(p.mode).toBe('routing');
    expect(ev.some((e) => e.t === 'routed')).toBe(true);
    expect(issueCommand(s, { kind: 'move', squadId: p.id, to: at(s, 25, 10) })).toBe(false);
    const n = runUntil(s, () => p.mode === 'ready', 20 * 60);
    expect(n).toBeGreaterThan(0);
    expect(p.morale).toBeGreaterThanOrEqual(RALLY_AT);
    // rallies on the way or in town - in any case clearly closer to the rally point
    expect(Math.hypot(p.pos.x - s.map.rally.x, p.pos.y - s.map.rally.y)).toBeLessThan(10);
  });

  it('a decisive clash breaks the raiders, who flee to their boats', () => {
    const s = miniGame(field());
    const p1 = addPlayer(s, 'guard', at(s, 10, 8), { x: 0, y: 1 });
    const p2 = addPlayer(s, 'spearmen', at(s, 13, 10), { x: -1, y: 0 });
    p1.morale = p2.morale = 100;
    const e = addEnemy(s, at(s, 10, 11), 4);
    e.goal = null;
    const n = runUntil(s, () => e.mode !== 'ready', 20 * 40);
    expect(n).toBeGreaterThan(0);
    expect(['routing', 'dead']).toContain(e.mode);
    expect(p1.warriors.some((w) => w.alive)).toBe(true);
  });
});

describe('Abilities', () => {
  it('shield wall cuts frontal damage, not from behind, and expires', () => {
    const s = miniGame(field());
    const p = addPlayer(s, 'guard', at(s, 10, 10), { x: 0, y: 1 });
    noTraits(p);
    const front = addEnemy(s, at(s, 10, 13));
    const back = addEnemy(s, at(s, 10, 7));
    const f0 = meleeStrike(s, front, p).dmg;
    const b0 = meleeStrike(s, back, p).dmg;
    expect(issueCommand(s, { kind: 'shieldWall', squadId: p.id })).toBe(true);
    expect(s.tick).toBe(0); // time stands still while paused
    expect(meleeStrike(s, front, p).dmg).toBeCloseTo(f0 * SHIELD_REDUCTION, 9);
    expect(meleeStrike(s, back, p).dmg).toBeCloseTo(b0, 9);
    expect(issueCommand(s, { kind: 'shieldWall', squadId: p.id })).toBe(false); // cooldown
    s.tick += SHIELD_TICKS;
    expect(meleeStrike(s, front, p).dmg).toBeCloseTo(f0, 9);
  });

  it('shield wall is guard-only', () => {
    const s = miniGame(field());
    const a = addPlayer(s, 'archers', at(s, 5, 5));
    expect(issueCommand(s, { kind: 'shieldWall', squadId: a.id })).toBe(false);
  });

  it('horn works in a radius, stops routing, and has a cooldown', () => {
    const s = miniGame(field());
    const near = addPlayer(s, 'guard', at(s, 5, 5));
    const far = addPlayer(s, 'archers', at(s, 5, 5));
    far.pos = { x: near.pos.x + HORN_RADIUS + 5, y: near.pos.y };
    near.morale = 10;
    near.mode = 'routing';
    far.morale = 30;
    expect(useHorn(s, near.pos)).toBe(1);
    expect(near.mode).toBe('ready');
    expect(near.morale).toBe(35);
    expect(far.morale).toBe(30);
    expect(issueCommand(s, { kind: 'horn', at: near.pos })).toBe(false);
    step(s);
  });
});
