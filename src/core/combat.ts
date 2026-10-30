// Combat: target selection, attack cycles, modifiers (flanking, terrain, traits, shield wall), projectiles,
// morale with routing and rallying, abilities, and player squad decisions.
// No randomness: the same setup always gives the same result.

import {
  ARMOR_MELEE,
  ARMOR_RANGED,
  ARMOR_RANGED_BACK,
  ARROW_CYCLE,
  ARROW_DMG,
  ARROW_DMG_ENEMY,
  ARROW_FLIGHT,
  ARROW_RANGE,
  AUTO_ENGAGE,
  BUILDING_DPS,
  CONTACT_MARGIN,
  DIFFICULTY_MULTS,
  DT,
  ENEMY_ROUT_HP,
  FIRST_STRIKE_MIN,
  FLANK_BACK,
  FLANK_DOT,
  FLANK_SIDE,
  HILL_ARROW_MULT,
  HILL_DEFENSE,
  HILL_RANGE_MULT,
  HOME_DRIFT,
  HORN_COOLDOWN,
  HORN_MORALE,
  HORN_RADIUS,
  LEASH,
  MELEE_CYCLE,
  MORALE_DEATH,
  MORALE_DEATH_NEARBY,
  MORALE_DMG_SCALE,
  MORALE_FLANK_HIT,
  MORALE_MAX,
  MORALE_NEARBY_R,
  MORALE_RALLY_REGEN,
  MORALE_REGEN,
  MORALE_REGEN_DELAY,
  RALLY_AT,
  RALLY_RADIUS,
  ROUT_BELOW,
  SHALLOW_ATTACKER,
  SHALLOW_DEFENDER,
  SHIELD_COOLDOWN,
  SHIELD_REDUCTION,
  SHIELD_TICKS,
  SPEAR_BEACH_MULT,
  SPEAR_PUSH,
  SQUAD_RADIUS,
  TOWER_ARROW_MULT,
  TOWER_RANGE_MULT,
  UNIT_STATS,
} from './config.ts';
import { heightLevel, isShore, nearestWalkable, passable, terrainAt } from './map.ts';
import { arrived, setGoal } from './movement.ts';
import type { Flank, GameEvent, GameState, Squad, Vec } from './types.ts';
import { T } from './types.ts';
import { aliveCount, calmMult, carefulMult, fighters, hpRatio, onField, strongMult } from './units.ts';
import { add, copy, dist, dot, len, normalize, scale, sub } from './vec.ts';

export const CONTACT_DIST = SQUAD_RADIUS * 2 + CONTACT_MARGIN;

export function squadById(s: GameState, id: number): Squad | undefined {
  return s.squads.find((q) => q.id === id);
}

/** A squad that can be attacked: on the field and with someone ashore. */
export function targetable(sq: Squad): boolean {
  return onField(sq) && sq.warriors.some((w) => w.alive && !w.aboard);
}

/** Target for arrows: also crews still aboard a boat (attacking boats). */
export function shootable(sq: Squad): boolean {
  return onField(sq) && sq.warriors.some((w) => w.alive);
}

export function isArcher(sq: Squad): boolean {
  return sq.type === 'archers' || sq.type === 'raiderArchers';
}

/** Armor of the "armored" class; spearmen (pierce) ignore it. */
function armorMult(d: Squad, flank: Flank, ranged: boolean, pierce: boolean): number {
  if (d.type !== 'armored' || pierce) return 1;
  if (ranged) return flank === 'back' ? ARMOR_RANGED_BACK : ARMOR_RANGED;
  return flank === 'back' ? 1 : ARMOR_MELEE;
}

export function shieldActive(s: GameState, sq: Squad): boolean {
  return sq.shieldUntil > s.tick;
}

/** How many terrace levels the shooter stands above the target (without a target: above the sea). */
function elevation(s: GameState, a: Squad, d?: Squad): number {
  return heightLevel(s.map, a.pos) - (d ? heightLevel(s.map, d.pos) : 0);
}

export function arrowRange(s: GameState, sq: Squad, target?: Squad): number {
  const h = elevation(s, sq, target);
  if (h >= 2) return ARROW_RANGE * TOWER_RANGE_MULT;
  if (h > 0) return ARROW_RANGE * HILL_RANGE_MULT;
  return ARROW_RANGE;
}

/** Melee needs contact on the same terrace (or across a ramp): no fighting over a cliff edge. */
export function inMelee(s: GameState, a: Squad, b: Squad): boolean {
  return dist(a.pos, b.pos) <= CONTACT_DIST && passable(s.map, a.pos, b.pos);
}

/** The side from which `attacker` hits `defender` (relative to the defender's facing). */
export function flankOf(attackerPos: Vec, defender: Squad): Flank {
  const d = normalize(sub(attackerPos, defender.pos), defender.facing);
  const k = dot(defender.facing, d);
  if (k > FLANK_DOT) return 'front';
  if (k < -FLANK_DOT) return 'back';
  return 'side';
}

const FLANK_MULT: Record<Flank, number> = { front: 1, side: FLANK_SIDE, back: FLANK_BACK };

function shieldMult(s: GameState, attackerPos: Vec, d: Squad): number {
  if (!shieldActive(s, d)) return 1;
  const dir = normalize(sub(attackerPos, d.pos), d.facing);
  return dot(d.shieldDir, dir) > FLANK_DOT ? SHIELD_REDUCTION : 1;
}

export interface Strike {
  dmg: number;
  flank: Flank;
  push: boolean;
}

export function meleeStrike(s: GameState, a: Squad, d: Squad): Strike {
  const n = fighters(a).length;
  const flank = flankOf(a.pos, d);
  let dmg = UNIT_STATS[a.type].dmg * n * strongMult(a) * FLANK_MULT[flank];
  if (a.side === 'enemy') dmg *= DIFFICULTY_MULTS[s.difficulty].enemyDmg;
  if (heightLevel(s.map, d.pos) > heightLevel(s.map, a.pos)) dmg *= HILL_DEFENSE;
  if (terrainAt(s.map, d.pos) === T.SHALLOW) dmg *= SHALLOW_DEFENDER;
  if (terrainAt(s.map, a.pos) === T.SHALLOW) dmg *= SHALLOW_ATTACKER;
  let push = false;
  if (a.type === 'spearmen' && (isShore(s.map, d.pos) || d.mode === 'landing')) {
    dmg *= SPEAR_BEACH_MULT;
    push = !shieldActive(s, d);
  }
  dmg *= shieldMult(s, a.pos, d) * carefulMult(d) * armorMult(d, flank, false, a.type === 'spearmen');
  return { dmg, flank, push };
}

export function arrowStrike(s: GameState, a: Squad, d: Squad): Strike {
  const n = fighters(a).length;
  const flank = flankOf(a.pos, d);
  let dmg = (a.side === 'enemy' ? ARROW_DMG_ENEMY : ARROW_DMG) * n * strongMult(a) * FLANK_MULT[flank];
  if (a.side === 'enemy') dmg *= DIFFICULTY_MULTS[s.difficulty].enemyDmg;
  const h = elevation(s, a, d);
  if (h >= 2) dmg *= TOWER_ARROW_MULT;
  else if (h > 0) dmg *= HILL_ARROW_MULT;
  dmg *= shieldMult(s, a.pos, d) * carefulMult(d) * armorMult(d, flank, true, false);
  return { dmg, flank, push: false };
}

function loseMorale(sq: Squad, amount: number): void {
  sq.morale = Math.max(0, sq.morale - amount * calmMult(sq));
}

/** Damage hits the first living warrior ashore; overflow carries over to the next. */
export function applyDamage(
  s: GameState,
  d: Squad,
  amount: number,
  flank: Flank,
  attackerId: number,
  ranged: boolean,
  ev: GameEvent[],
): void {
  ev.push({ t: 'hit', attacker: attackerId, target: d.id, amount, flank, ranged, at: copy(d.pos) });
  d.lastCombatTick = s.tick;
  // morale is computed from the blow before deaths (otherwise the last fallen warrior would not count)
  loseMorale(d, (amount / d.maxHp) * MORALE_DMG_SCALE);
  if (flank !== 'front') loseMorale(d, MORALE_FLANK_HIT);
  let rem = amount;
  // warriors ashore first; when nobody is ashore, arrows hit the crew aboard
  const ashore = d.warriors.some((w) => w.alive && !w.aboard);
  for (const w of d.warriors) {
    if (rem <= 1e-9) break;
    if (!w.alive || (ashore && w.aboard)) continue;
    const take = Math.min(w.hp, rem);
    w.hp -= take;
    rem -= take;
    if (w.hp <= 1e-9) {
      w.hp = 0;
      w.alive = false;
      ev.push({ t: 'fell', squadId: d.id, warriorId: w.id, side: d.side, at: copy(d.pos) });
      if (d.side === 'player') s.fallen.push({ name: w.name, type: d.type, wave: s.waveIndex });
      loseMorale(d, MORALE_DEATH);
      for (const o of s.squads) {
        if (o !== d && o.side === d.side && onField(o) && dist(o.pos, d.pos) <= MORALE_NEARBY_R) loseMorale(o, MORALE_DEATH_NEARBY);
      }
    }
  }
  if (aliveCount(d) === 0) {
    d.mode = 'dead';
    d.vel = { x: 0, y: 0 };
    d.targetId = -1;
    d.goal = null;
    ev.push({ t: 'squadLost', squadId: d.id, side: d.side });
  }
}

function tryPush(s: GameState, a: Squad, d: Squad, ev: GameEvent[]): void {
  if (!onField(d)) return;
  const dir = normalize(sub(d.pos, a.pos), d.facing);
  const np = add(d.pos, scale(dir, SPEAR_PUSH));
  if (!passable(s.map, d.pos, np)) return;
  for (const o of s.squads) {
    if (o === d || o === a || !onField(o)) continue;
    if (dist(np, o.pos) < SQUAD_RADIUS * 2 && dist(np, o.pos) < dist(d.pos, o.pos)) return;
  }
  d.pos = np;
  ev.push({ t: 'pushed', squadId: d.id, at: copy(np) });
}

function nearestEnemy(s: GameState, sq: Squad, pred: (e: Squad, d: number) => boolean, ok: (e: Squad) => boolean = targetable): Squad | null {
  let best: Squad | null = null;
  let bestD = Infinity;
  for (const e of s.squads) {
    if (e.side === sq.side || !ok(e)) continue;
    const d = dist(sq.pos, e.pos);
    if (d < bestD && pred(e, d)) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** Player squad decisions: orders, self-initiated combat, returning to position, routing. */
export function decidePlayer(s: GameState, sq: Squad): void {
  if (sq.mode === 'routing') {
    setGoal(sq, dist(sq.pos, s.map.rally) > 1 ? s.map.rally : null);
    return;
  }
  if (sq.mode !== 'ready') return;
  const o = sq.order;
  if (o.kind === 'move') {
    if (arrived(sq) && sq.goal && dist(sq.goal, o.to) < 0.01) {
      sq.order = { kind: 'hold' };
      sq.home = copy(sq.pos);
      if (o.facing) sq.holdFacing = copy(o.facing);
      else if (len(sq.facing) > 0) sq.holdFacing = copy(sq.facing);
      setGoal(sq, null);
    } else setGoal(sq, o.to);
    return;
  }
  if (o.kind === 'attack') {
    const t = squadById(s, o.target);
    if (!t || !(sq.type === 'archers' ? shootable(t) : targetable(t))) {
      sq.order = { kind: 'hold' };
      sq.home = copy(sq.pos);
      sq.holdFacing = copy(sq.facing);
      setGoal(sq, null);
      return;
    }
    const d = dist(sq.pos, t.pos);
    if (sq.type === 'archers' && d <= arrowRange(s, sq, t) * 0.95) setGoal(sq, null);
    else if (inMelee(s, sq, t)) setGoal(sq, null);
    else setGoal(sq, nearestWalkable(s.map, t.pos) ?? t.pos);
    return;
  }
  // hold: archers do not chase (they shoot), others engage nearby and return on a leash
  if (sq.type !== 'archers') {
    // only foes reachable in a straight line: defenders hold the terrace instead of running around a cliff
    const e = nearestEnemy(
      s,
      sq,
      (e, d) => d - SQUAD_RADIUS * 2 <= AUTO_ENGAGE && dist(sq.home, e.pos) <= LEASH && passable(s.map, sq.pos, e.pos),
    );
    if (e) {
      setGoal(sq, inMelee(s, sq, e) ? null : (nearestWalkable(s.map, e.pos) ?? e.pos));
      return;
    }
  }
  const returning = sq.goal !== null && dist(sq.goal, sq.home) < 0.01;
  const away = dist(sq.pos, sq.home);
  if (away > HOME_DRIFT || (returning && !arrived(sq))) setGoal(sq, sq.home);
  else setGoal(sq, null);
}

/** Projectiles, target selection, and attacks (squads and buildings). */
export function updateCombat(s: GameState, ev: GameEvent[]): void {
  // 1. arrows in flight
  const flying = [];
  for (const p of s.projectiles) {
    if (s.tick < p.hitTick) {
      flying.push(p);
      continue;
    }
    const t = squadById(s, p.target);
    if (t && shootable(t)) applyDamage(s, t, p.dmg, p.flank, p.source, true, ev);
  }
  s.projectiles = flying;

  // 2. contacts and targets
  for (const sq of s.squads) {
    if (!onField(sq)) continue;
    const melee = nearestEnemy(s, sq, (e) => inMelee(s, sq, e));
    sq.contact = melee !== null;
    let target = -1;
    if (sq.mode !== 'routing' && fighters(sq).length > 0) {
      if (melee) target = melee.id;
      else if (isArcher(sq) && sq.order.kind !== 'move' && len(sq.vel) < 0.2) {
        const inRange = (e: Squad, d: number) => d <= arrowRange(s, sq, e);
        const ordered = sq.order.kind === 'attack' ? squadById(s, sq.order.target) : undefined;
        if (ordered && shootable(ordered) && inRange(ordered, dist(sq.pos, ordered.pos))) target = ordered.id;
        else {
          // enemies ashore first, then boat crews (player archers only)
          // raider archers shoot the player's archers first: they are the ones holding the high ground
          const foe =
            (sq.side === 'enemy' ? nearestEnemy(s, sq, (e, d) => e.type === 'archers' && inRange(e, d)) : null) ??
            nearestEnemy(s, sq, inRange) ??
            (sq.side === 'player' ? nearestEnemy(s, sq, inRange, shootable) : null);
          target = foe?.id ?? -1;
        }
      }
    }
    if (target >= 0 && sq.targetId < 0) sq.attackCd = Math.max(sq.attackCd, FIRST_STRIKE_MIN + (sq.id % 8));
    sq.targetId = target;
  }

  // 3. attacks
  for (const sq of s.squads) {
    if (!onField(sq)) continue;
    if (sq.attackCd > 0) sq.attackCd--;
    if (sq.attackCd > 0 || sq.mode === 'routing' || fighters(sq).length === 0) continue;
    if (sq.targetId >= 0) {
      const t = squadById(s, sq.targetId);
      if (!t || !shootable(t)) continue;
      sq.lastCombatTick = s.tick;
      if (sq.contact) {
        const st = meleeStrike(s, sq, t);
        applyDamage(s, t, st.dmg, st.flank, sq.id, false, ev);
        if (st.push) tryPush(s, sq, t, ev);
        sq.attackCd = MELEE_CYCLE;
      } else {
        const st = arrowStrike(s, sq, t);
        // crew aboard: the arrow flies at the boat
        const boat = t.warriors.some((w) => w.alive && !w.aboard) ? undefined : s.boats.find((b) => b.id === t.boatId);
        const lead = boat ? copy(boat.pos) : add(t.pos, scale(t.vel, ARROW_FLIGHT * DT));
        s.projectiles.push({
          id: s.nextId++,
          from: copy(sq.pos),
          to: lead,
          source: sq.id,
          target: t.id,
          launchTick: s.tick,
          hitTick: s.tick + ARROW_FLIGHT,
          dmg: st.dmg,
          flank: st.flank,
        });
        ev.push({ t: 'shot', squadId: sq.id, at: copy(sq.pos) });
        sq.attackCd = ARROW_CYCLE;
      }
    } else if (sq.side === 'enemy' && sq.atBuilding && sq.buildingTarget >= 0) {
      const b = s.buildings[sq.buildingTarget];
      if (b.hp <= 0) continue;
      const def = s.map.buildings[sq.buildingTarget];
      const at = { x: (def.min.x + def.max.x) / 2, y: (def.min.y + def.max.y) / 2 };
      b.hp = Math.max(0, b.hp - BUILDING_DPS * MELEE_CYCLE * DT * fighters(sq).length * strongMult(sq) * DIFFICULTY_MULTS[s.difficulty].enemyDmg);
      sq.attackCd = MELEE_CYCLE;
      ev.push({ t: 'buildingHit', building: sq.buildingTarget, at });
      if (b.hp <= 0) {
        ev.push({ t: 'buildingDestroyed', building: sq.buildingTarget, at });
        for (const o of s.squads) {
          if (o.buildingTarget === sq.buildingTarget) {
            o.buildingTarget = -1;
            o.atBuilding = false;
            if (o.preferredBuilding === sq.buildingTarget) o.preferredBuilding = -1;
          }
        }
      }
    }
  }
}

/** Regeneration, routing, and rallying. */
export function updateMorale(s: GameState, ev: GameEvent[]): void {
  for (const sq of s.squads) {
    if (!onField(sq)) continue;
    if (s.tick - sq.lastCombatTick > MORALE_REGEN_DELAY) sq.morale += MORALE_REGEN * DT;
    if (sq.side === 'player' && sq.mode === 'routing' && dist(sq.pos, s.map.rally) <= RALLY_RADIUS) {
      sq.morale += MORALE_RALLY_REGEN * DT;
    }
    sq.morale = Math.min(MORALE_MAX, sq.morale);
    // raiders break only when they are really losing; the player's squads keep the plain morale rule
    const breaks = sq.morale < ROUT_BELOW && (sq.side === 'player' || hpRatio(sq) < ENEMY_ROUT_HP);
    if ((sq.mode === 'ready' || sq.mode === 'landing') && breaks) {
      sq.mode = 'routing';
      sq.order = { kind: 'hold' };
      sq.targetId = -1;
      sq.atBuilding = false;
      sq.shieldUntil = 0;
      setGoal(sq, null);
      ev.push({ t: 'routed', squadId: sq.id, side: sq.side, at: copy(sq.pos) });
    } else if (sq.mode === 'routing' && sq.side === 'player' && sq.morale >= RALLY_AT) {
      rally(sq);
      ev.push({ t: 'rallied', squadId: sq.id, at: copy(sq.pos) });
    }
  }
}

function rally(sq: Squad): void {
  sq.mode = 'ready';
  sq.order = { kind: 'hold' };
  sq.home = copy(sq.pos);
  sq.holdFacing = copy(sq.facing);
  setGoal(sq, null);
}

/** Shield wall: guard only, direction = current facing. */
export function useShieldWall(s: GameState, sq: Squad): boolean {
  if (sq.side !== 'player' || sq.type !== 'guard' || sq.mode !== 'ready') return false;
  if (s.tick < sq.shieldReady || fighters(sq).length === 0) return false;
  sq.shieldUntil = s.tick + SHIELD_TICKS;
  sq.shieldDir = copy(sq.facing);
  sq.shieldReady = s.tick + SHIELD_COOLDOWN;
  return true;
}

/** Horn signal: morale in a radius, stops routing. Returns the number of affected squads, or -1 (on cooldown). */
export function useHorn(s: GameState, at: Vec): number {
  if (s.tick < s.hornReady) return -1;
  s.hornReady = s.tick + HORN_COOLDOWN;
  let n = 0;
  for (const sq of s.squads) {
    if (sq.side !== 'player' || !onField(sq) || dist(sq.pos, at) > HORN_RADIUS) continue;
    sq.morale = Math.min(MORALE_MAX, sq.morale + HORN_MORALE);
    if (sq.mode === 'routing' && sq.morale >= ROUT_BELOW) rally(sq);
    n++;
  }
  return n;
}
