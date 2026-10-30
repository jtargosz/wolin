import { describe, expect, it } from 'vitest';
import { ARMOR_MELEE, ARMOR_RANGED, ARMOR_RANGED_BACK, ARROW_RANGE } from '../core/config.ts';
import { arrowStrike, meleeStrike } from '../core/combat.ts';
import { createGame, issueCommand, step } from '../core/game.ts';
import type { GameEvent, GameState, SquadType, Vec } from '../core/types.ts';
import { createEnemySquad } from '../core/units.ts';
import { addPlayer, at, field, miniGame, run } from './helpers.ts';

function enemyOf(s: GameState, kind: SquadType, pos: Vec, crew = 3) {
  const sq = createEnemySquad(s, pos, { x: 0, y: -1 }, crew, -1, kind);
  for (const w of sq.warriors) w.aboard = false;
  sq.mode = 'ready';
  s.squads.push(sq);
  return sq;
}

const plain = (sq: { warriors: { trait: string }[] }) => sq.warriors.forEach((w) => (w.trait = 'none'));

describe('Armored', () => {
  it('arrows: x ARMOR_RANGED from the front, weaker armor from behind', () => {
    const s = miniGame(field());
    const atk = addPlayer(s, 'archers', at(s, 10, 5));
    plain(atk);
    const norm = enemyOf(s, 'raiders', at(s, 10, 10));
    const heavy = enemyOf(s, 'armored', at(s, 10, 10));
    const front = arrowStrike(s, atk, heavy).dmg / arrowStrike(s, atk, norm).dmg;
    expect(front).toBeCloseTo(ARMOR_RANGED, 9);
    atk.pos = at(s, 10, 15); // behind the back (armored face north)
    const back = arrowStrike(s, atk, heavy).dmg / arrowStrike(s, atk, norm).dmg;
    expect(back).toBeCloseTo(ARMOR_RANGED_BACK, 9);
  });

  it('melee: armor cuts a frontal blow; spearmen pierce it; no armor from behind', () => {
    const s = miniGame(field());
    const dr = addPlayer(s, 'guard', at(s, 10, 6));
    const sp = addPlayer(s, 'spearmen', at(s, 10, 6));
    plain(dr);
    plain(sp);
    const norm = enemyOf(s, 'raiders', at(s, 10, 10));
    const heavy = enemyOf(s, 'armored', at(s, 10, 10));
    expect(meleeStrike(s, dr, heavy).dmg / meleeStrike(s, dr, norm).dmg).toBeCloseTo(ARMOR_MELEE, 9);
    expect(meleeStrike(s, sp, heavy).dmg / meleeStrike(s, sp, norm).dmg).toBeCloseTo(1, 9);
    dr.pos = at(s, 10, 14);
    expect(meleeStrike(s, dr, heavy).dmg / meleeStrike(s, dr, norm).dmg).toBeCloseTo(1, 9);
  });
});

describe('Raider archers', () => {
  it('stop within range and shoot, never closing to melee', () => {
    const s = miniGame(field());
    const p = addPlayer(s, 'guard', at(s, 16, 10));
    plain(p);
    const a = enemyOf(s, 'raiderArchers', at(s, 6, 10));
    const hp0 = p.warriors.reduce((n, w) => n + w.hp, 0);
    const ev = run(s, 20 * 15);
    const d = Math.hypot(a.pos.x - p.pos.x, a.pos.y - p.pos.y);
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThanOrEqual(ARROW_RANGE + 0.5);
    expect(ev.some((e) => e.t === 'shot' && e.squadId === a.id)).toBe(true);
    expect(p.warriors.reduce((n, w) => n + w.hp, 0)).toBeLessThan(hp0);
  });
});

describe('Attacking boats', () => {
  function setup() {
    const s = createGame('lodz', { waves: [{ boats: [{ dir: 'S', crew: 3, delay: 0 }] }], prepTicks: 1 });
    step(s);
    const boat = s.boats[0];
    const archers = s.squads.find((q) => q.type === 'archers')!;
    const spears = s.squads.find((q) => q.type === 'spearmen')!;
    archers.pos = { x: boat.shore.x, y: boat.shore.y - 7 };
    archers.home = { ...archers.pos };
    return { s, boat, archers, spears };
  }

  it('player archers shoot the crew aboard before they disembark', () => {
    const { s, boat } = setup();
    const events: { t: number; e: GameEvent }[] = [];
    for (let i = 0; i < 20 * 60; i++) {
      for (const e of step(s)) events.push({ t: s.tick, e });
      if (boat.state === 'leaving' || boat.state === 'gone') break;
    }
    const sqId = boat.squadId;
    const firstHit = events.find((x) => x.e.t === 'hit' && x.e.target === sqId);
    const firstDis = events.find((x) => x.e.t === 'disembark');
    expect(firstHit).toBeDefined();
    expect(firstDis).toBeDefined();
    expect(firstHit!.t).toBeLessThanOrEqual(firstDis!.t);
  });

  it('attack order on a boat: archers only', () => {
    const { s, boat, archers, spears } = setup();
    for (let i = 0; i < 20 * 40 && boat.state !== 'landed'; i++) step(s);
    expect(boat.state).toBe('landed');
    const sq = s.squads.find((q) => q.id === boat.squadId)!;
    expect(sq.warriors.every((w) => w.aboard)).toBe(true);
    expect(issueCommand(s, { kind: 'attack', squadId: archers.id, targetId: sq.id })).toBe(true);
    expect(issueCommand(s, { kind: 'attack', squadId: spears.id, targetId: sq.id })).toBe(false);
  });
});
