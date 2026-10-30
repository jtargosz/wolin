// Boats, landing, and raider behavior.

import {
  BOARD_RADIUS,
  BOAT_DECEL,
  BOAT_LEAVE_DELAY,
  BOAT_SPEED,
  BUILDING_REACH,
  DISEMBARK_EVERY,
  DISEMBARK_FIRST,
  DISEMBARK_PAIR_CHANCE,
  DT,
  ENEMY_AGGRO,
  ARCHER_AGGRO_MULT,
  REGROUP_DIST,
  REGROUP_TICKS,
  SQUAD_RADIUS,
} from './config.ts';
import { arrowRange, inMelee, isArcher, squadById, targetable } from './combat.ts';
import { levelAtCell, passable, worldToCell } from './map.ts';
import { setGoal } from './movement.ts';
import { rand, randInt } from './rng.ts';
import type { Boat, BuildingDef, GameEvent, GameState, Squad } from './types.ts';
import { createEnemySquad, onField } from './units.ts';
import { add, copy, dist, distToRect, normalize, scale, sub } from './vec.ts';

export function boatById(s: GameState, id: number): Boat | undefined {
  return s.boats.find((b) => b.id === id);
}

export function updateBoats(s: GameState, ev: GameEvent[]): void {
  for (const b of s.boats) {
    switch (b.state) {
      case 'waiting':
        if (s.tick >= b.spawnTick) {
          b.state = 'sailing';
          b.pos = copy(b.start);
          b.heading = normalize(sub(b.landing, b.start));
          b.speed = BOAT_SPEED;
          ev.push({ t: 'boatSpawned', boatId: b.id, dir: b.dir, at: copy(b.pos), landing: copy(b.landing) });
        }
        break;
      case 'sailing': {
        const rem = dist(b.pos, b.landing);
        const target = Math.min(BOAT_SPEED, Math.sqrt(2 * BOAT_DECEL * rem));
        b.speed = target < b.speed ? Math.max(target, b.speed - BOAT_DECEL * DT) : Math.min(target, b.speed + BOAT_DECEL * DT);
        const stepLen = Math.min(b.speed * DT, rem);
        b.pos = add(b.pos, scale(b.heading, stepLen));
        if (rem - stepLen < 0.05) {
          b.pos = copy(b.landing);
          b.speed = 0;
          b.state = 'landed';
          const sq = createEnemySquad(s, b.shore, b.heading, b.crew, b.id, b.kind);
          sq.preferredBuilding = b.preferredBuilding;
          s.squads.push(sq);
          b.squadId = sq.id;
          b.nextDisembark = s.tick + randInt(s, DISEMBARK_FIRST[0], DISEMBARK_FIRST[1]);
          ev.push({ t: 'boatLanded', boatId: b.id, at: copy(b.pos) });
        }
        break;
      }
      case 'landed': {
        const sq = squadById(s, b.squadId);
        if (sq && onField(sq)) {
          const aboard = sq.warriors.filter((w) => w.alive && w.aboard);
          if (aboard.length > 0 && s.tick >= b.nextDisembark && sq.mode !== 'routing') {
            const count = Math.min(aboard.length, rand(s) < DISEMBARK_PAIR_CHANCE ? 2 : 1);
            for (let i = 0; i < count; i++) aboard[i].aboard = false;
            b.nextDisembark = s.tick + randInt(s, DISEMBARK_EVERY[0], DISEMBARK_EVERY[1]);
            ev.push({ t: 'disembark', boatId: b.id, squadId: sq.id, count, at: copy(sq.pos) });
            if (count === aboard.length && sq.mode === 'landing') sq.mode = 'ready';
          }
          break;
        }
        if (b.leaveTick < 0) b.leaveTick = s.tick + (sq && sq.mode === 'gone' ? 10 : BOAT_LEAVE_DELAY);
        if (s.tick >= b.leaveTick) {
          b.state = 'leaving';
          b.heading = normalize(sub(b.start, b.landing));
          ev.push({ t: 'boatLeaving', boatId: b.id });
        }
        break;
      }
      case 'leaving':
        b.speed = Math.min(BOAT_SPEED, b.speed + BOAT_DECEL * DT);
        b.pos = add(b.pos, scale(b.heading, b.speed * DT));
        if (dist(b.pos, b.landing) >= dist(b.start, b.landing)) b.state = 'gone';
        break;
      case 'gone':
        break;
    }
  }
}

function chooseBuilding(s: GameState, sq: Squad): number {
  const alive = (i: number) => i >= 0 && s.buildings[i].hp > 0;
  if (alive(sq.preferredBuilding)) return sq.preferredBuilding;
  if (alive(sq.buildingTarget)) return sq.buildingTarget;
  let best = -1;
  let bestD = Infinity;
  s.map.buildings.forEach((b, i) => {
    if (!alive(i)) return;
    const d = distToRect(sq.pos, b.min, b.max);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * Whether a squad should hold still at the foot of a ramp that leads up to its target's terrace.
 * It waits until a squad of the same wave stands nearby or is waiting too (both are released
 * together), until REGROUP_TICKS pass, or until it comes under fire. Once released on a terrace
 * it does not wait there again.
 */
function regroupAtRamp(s: GameState, sq: Squad, target: BuildingDef): boolean {
  const map = s.map;
  const c = worldToCell(map, sq.pos);
  const here = levelAtCell(map, c.cx, c.cy);
  const tc = worldToCell(map, { x: target.min.x + 0.1, y: target.min.y + 0.1 });
  const top = Math.floor(levelAtCell(map, tc.cx, tc.cy));
  if (here !== Math.floor(here) || here >= top || sq.waitLevel === here) {
    sq.waitSince = -1;
    return false;
  }
  let foot = false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (levelAtCell(map, c.cx + dx, c.cy + dy) === here + 0.5) foot = true;
  if (!foot) {
    sq.waitSince = -1;
    return false;
  }
  if (sq.waitSince < 0) sq.waitSince = s.tick;
  const wave = boatById(s, sq.boatId)?.wave ?? -1;
  const partners = s.squads.filter((o) => o !== sq && o.side === 'enemy' && o.mode === 'ready' && (boatById(s, o.boatId)?.wave ?? -1) === wave);
  const together = partners.some((o) => o.waitSince >= 0 || dist(o.pos, sq.pos) <= REGROUP_DIST);
  const underFire = s.tick - sq.lastCombatTick < REGROUP_TICKS / 3;
  if (together || underFire || s.tick - sq.waitSince >= REGROUP_TICKS) {
    sq.waitLevel = here;
    sq.waitSince = -1;
    // release the partners that were waiting for us
    for (const o of partners) {
      if (o.waitSince < 0) continue;
      const oc = worldToCell(map, o.pos);
      o.waitLevel = Math.floor(levelAtCell(map, oc.cx, oc.cy));
      o.waitSince = -1;
    }
    return false;
  }
  return true;
}

/** Raider decisions: flee to the boat, fight, chase nearby targets, march on a building. */
export function decideEnemy(s: GameState, sq: Squad, ev: GameEvent[]): void {
  if (sq.mode === 'routing') {
    const boat = boatById(s, sq.boatId);
    if (!boat) return;
    if (dist(sq.pos, boat.shore) <= BOARD_RADIUS) {
      sq.mode = 'gone';
      sq.vel = { x: 0, y: 0 };
      setGoal(sq, null);
      ev.push({ t: 'boarded', squadId: sq.id, boatId: boat.id });
    } else setGoal(sq, boat.shore);
    return;
  }
  if (sq.mode !== 'ready') return;
  sq.atBuilding = false;
  const archer = isArcher(sq);
  let contact = false;
  let near: Squad | null = null;
  let nearD = Infinity;
  let nearScore = Infinity;
  let nearRange = 0;
  for (const p of s.squads) {
    if (p.side !== 'player' || !targetable(p)) continue;
    const d = dist(sq.pos, p.pos);
    if (inMelee(s, sq, p)) contact = true;
    const range = archer ? arrowRange(s, sq, p) : 0;
    // melee raiders only turn on foes they can walk straight to; across a cliff they keep marching.
    // Player archers are noticed from further away and chosen first: they hold the high ground.
    const aggro = ENEMY_AGGRO * (p.type === 'archers' ? ARCHER_AGGRO_MULT : 1);
    const seen = archer ? d - SQUAD_RADIUS * 2 <= range : d - SQUAD_RADIUS * 2 <= aggro && passable(s.map, sq.pos, p.pos);
    const score = d - (p.type === 'archers' ? 3 : 0);
    if (seen && score < nearScore) {
      near = p;
      nearD = d;
      nearScore = score;
      nearRange = range;
    }
  }
  if (contact) {
    setGoal(sq, null);
    return;
  }
  if (near) {
    // enemy archers stop within range and shoot, the rest advance on the target (over ramps if needed)
    setGoal(sq, archer && nearD <= nearRange * 0.9 ? null : near.pos);
    return;
  }
  const bi = chooseBuilding(s, sq);
  sq.buildingTarget = bi;
  if (bi < 0) {
    setGoal(sq, null);
    return;
  }
  const def = s.map.buildings[bi];
  if (distToRect(sq.pos, def.min, def.max) <= BUILDING_REACH) {
    sq.atBuilding = true;
    setGoal(sq, null);
    return;
  }
  // joint assault: melee squads gather at the foot of a ramp before climbing it
  if (!archer && regroupAtRamp(s, sq, def)) {
    setGoal(sq, null);
    return;
  }
  let goal = def.approach[0];
  let bestD = Infinity;
  for (const a of def.approach) {
    const d = dist(sq.pos, a);
    if (d < bestD) {
      bestD = d;
      goal = a;
    }
  }
  setGoal(sq, goal);
}
