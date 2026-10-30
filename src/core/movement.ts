// Squad movement: arrive (gentle start and braking), paths, collisions, turning the facing.
// The squad is simulated as a whole; individual figures are cosmetic in the render layer.

import {
  ACCEL,
  ALLY_PUSH,
  DT,
  REPATH_TICKS,
  ROUT_SPEED,
  SHALLOW_SPEED,
  SHIELD_SPEED,
  SQUAD_RADIUS,
  STUCK_WINDOW,
  TURN_RATE,
  UNIT_STATS,
  RAMP_SPEED,
  WAYPOINT_REACH,
} from './config.ts';
import { isRampLevel, levelAtCell, nearestWalkable, passable, terrainAt, worldToCell } from './map.ts';
import { findPath, lineClear } from './path.ts';
import type { GameState, Squad, Vec } from './types.ts';
import { T } from './types.ts';
import { fastMult, onField } from './units.ts';
import { add, clampLen, dist, len, normalize, scale, sub, turnToward } from './vec.ts';

export const ARRIVE_DIST = 0.3;
export const ARRIVE_SPEED = 0.25;

export function speedOf(s: GameState, sq: Squad): number {
  let v = UNIT_STATS[sq.type].speed * fastMult(sq);
  if (terrainAt(s.map, sq.pos) === T.SHALLOW) v *= SHALLOW_SPEED;
  if (sq.shieldUntil > s.tick) v *= SHIELD_SPEED;
  if (sq.mode === 'routing') v *= ROUT_SPEED;
  // ramps between terraces are slow to walk
  const c = worldToCell(s.map, sq.pos);
  if (isRampLevel(levelAtCell(s.map, c.cx, c.cy))) v *= RAMP_SPEED;
  return v;
}

/** Whether the squad has reached its current goal and is practically standing still. */
export function arrived(sq: Squad): boolean {
  return sq.goal !== null && dist(sq.pos, sq.goal) < ARRIVE_DIST && len(sq.vel) < ARRIVE_SPEED;
}

/** Sets the movement goal. A new, distant goal forces an immediate path recalculation. */
export function setGoal(sq: Squad, goal: Vec | null): void {
  if (goal === null) {
    sq.goal = null;
    return;
  }
  if (sq.goal === null || dist(sq.goal, goal) > 4) {
    sq.pathGoal = null;
    sq.progressDist = Infinity;
  }
  sq.goal = { x: goal.x, y: goal.y };
}

function ensurePath(s: GameState, sq: Squad): void {
  const goal = sq.goal;
  if (!goal) return;
  const fresh = sq.pathGoal === null || sq.path.length === 0;
  const drifted = sq.pathGoal !== null && dist(sq.pathGoal, goal) > 0.5 && s.tick >= sq.repathTick;
  if (!fresh && !drifted) return;
  sq.repathTick = s.tick + REPATH_TICKS;
  sq.pathGoal = { x: goal.x, y: goal.y };
  sq.pathIdx = 0;
  if (lineClear(s.map, sq.pos, goal)) {
    sq.path = [{ x: goal.x, y: goal.y }];
    return;
  }
  const target = nearestWalkable(s.map, goal) ?? goal;
  sq.path = findPath(s.map, sq.pos, target) ?? [];
}

function remaining(sq: Squad): number {
  if (sq.path.length === 0) return 0;
  let d = dist(sq.pos, sq.path[sq.pathIdx]);
  for (let i = sq.pathIdx; i < sq.path.length - 1; i++) d += dist(sq.path[i], sq.path[i + 1]);
  return d;
}

function steer(s: GameState, sq: Squad): void {
  let desired: Vec = { x: 0, y: 0 };
  if (sq.goal) {
    ensurePath(s, sq);
    if (sq.path.length > 0) {
      while (sq.pathIdx < sq.path.length - 1 && dist(sq.pos, sq.path[sq.pathIdx]) < WAYPOINT_REACH) sq.pathIdx++;
      const wp = sq.path[sq.pathIdx];
      const rem = remaining(sq);
      const vmax = speedOf(s, sq);
      const vt = Math.min(vmax, Math.sqrt(2 * ACCEL * rem));
      desired = scale(normalize(sub(wp, sq.pos), sq.facing), vt);
      // stuck detection: no progress means allies may briefly pass through each other
      if (s.tick - sq.progressTick >= STUCK_WINDOW) {
        if (sq.progressDist - rem < 0.3 && rem > 1.5) sq.ghostUntil = s.tick + STUCK_WINDOW;
        sq.progressDist = rem;
        sq.progressTick = s.tick;
      }
    }
  }
  sq.vel = add(sq.vel, clampLen(sub(desired, sq.vel), ACCEL * DT));
}

function integrate(s: GameState, sq: Squad): void {
  if (len(sq.vel) < 1e-6) {
    sq.vel = { x: 0, y: 0 };
    return;
  }
  const map = s.map;
  let np = add(sq.pos, scale(sq.vel, DT));
  if (!passable(map, sq.pos, np)) {
    const nx = { x: np.x, y: sq.pos.y };
    const ny = { x: sq.pos.x, y: np.y };
    if (passable(map, sq.pos, nx)) {
      np = nx;
      sq.vel = { x: sq.vel.x, y: 0 };
    } else if (passable(map, sq.pos, ny)) {
      np = ny;
      sq.vel = { x: 0, y: sq.vel.y };
    } else {
      sq.vel = { x: 0, y: 0 };
      return;
    }
  }
  // hard contact with enemies: squads may not get closer than the sum of radii
  const minD = SQUAD_RADIUS * 2;
  for (const e of s.squads) {
    if (e.side === sq.side || !onField(e)) continue;
    const dn = dist(np, e.pos);
    // a squad on another terrace (across a cliff) does not block the way
    if (dn < minD && dn < dist(sq.pos, e.pos) && passable(map, np, e.pos)) {
      sq.vel = { x: 0, y: 0 };
      return;
    }
  }
  sq.pos = np;
}

function isMoving(sq: Squad): boolean {
  return sq.goal !== null || len(sq.vel) > 0.1;
}

function separateAllies(s: GameState): void {
  const minD = SQUAD_RADIUS * 2;
  const list = s.squads.filter(onField);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.ghostUntil > s.tick) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (a.side !== b.side || b.ghostUntil > s.tick) continue;
      if (a.mode === 'landing' || b.mode === 'landing') continue;
      const d = dist(a.pos, b.pos);
      if (d >= minD || !passable(s.map, a.pos, b.pos)) continue;
      const n = d > 1e-6 ? scale(sub(a.pos, b.pos), 1 / d) : { x: 1, y: 0 };
      const push = (minD - d) * ALLY_PUSH;
      let wa = 0.5;
      const am = isMoving(a);
      const bm = isMoving(b);
      if (am && !bm) wa = 0.2;
      else if (!am && bm) wa = 0.8;
      const na = add(a.pos, scale(n, push * wa));
      const nb = sub(b.pos, scale(n, push * (1 - wa)));
      if (passable(s.map, a.pos, na)) a.pos = na;
      if (passable(s.map, b.pos, nb)) b.pos = nb;
    }
  }
}

function desiredFacing(s: GameState, sq: Squad): Vec {
  if (sq.targetId >= 0) {
    const t = s.squads.find((o) => o.id === sq.targetId);
    if (t) return normalize(sub(t.pos, sq.pos), sq.facing);
  }
  if (sq.atBuilding && sq.buildingTarget >= 0) {
    const b = s.map.buildings[sq.buildingTarget];
    const c = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
    return normalize(sub(c, sq.pos), sq.facing);
  }
  if (len(sq.vel) > 0.15) return normalize(sq.vel, sq.facing);
  return sq.holdFacing;
}

export function updateMovement(s: GameState): void {
  for (const sq of s.squads) {
    if (!onField(sq)) continue;
    if (sq.mode === 'landing') {
      sq.vel = { x: 0, y: 0 };
      continue;
    }
    steer(s, sq);
  }
  for (const sq of s.squads) if (onField(sq)) integrate(s, sq);
  separateAllies(s);
  for (const sq of s.squads) {
    if (!onField(sq)) continue;
    sq.facing = turnToward(sq.facing, desiredFacing(s, sq), TURN_RATE);
  }
}
