// All simulation and balance constants in one place.
// Simulation time is counted in ticks (TICK_RATE per second); per-second values are converted via DT.

import type { Difficulty, SquadType, WaveSpec } from './types.ts';

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

/** Permadeath: fallen warriors do not return in later waves. false = squads are refilled between waves. */
export const PERMADEATH = true;

// Loop
export const MAX_STEPS_PER_FRAME = 8;
export const MAX_FRAME_DT = 0.25;
export const SPEEDS = [0.5, 1, 2] as const;

// Map
export const CELL = 1.5;

// Movement
export const SQUAD_RADIUS = 1.8;
export const CONTACT_MARGIN = 0.4;
export const ACCEL = 0.8; // m/s²
export const WAYPOINT_REACH = 1.0;
export const ARRIVE_EPS = 0.1;
export const SHALLOW_SPEED = 0.6;
export const TURN_RATE = 0.12; // nlerp fraction per tick
export const HOME_DRIFT = 1.2; // a squad pushed further than this returns to its spot
export const STUCK_WINDOW = 40; // ticks
export const REPATH_TICKS = 20;
export const ALLY_PUSH = 0.1;

// Pathfinding costs
export const COST_SHALLOW = 2.0;
export const COST_RAMP = 1.4;

// Ramps between terrace levels are slower to walk.
export const RAMP_SPEED = 0.7;

export interface UnitStats {
  count: number;
  hp: number;
  dmg: number; // per warrior per melee cycle
  speed: number; // m/s
  morale: number;
}

export const UNIT_STATS: Record<SquadType, UnitStats> = {
  guard: { count: 5, hp: 40, dmg: 2.0, speed: 1.3, morale: 70 },
  archers: { count: 4, hp: 18, dmg: 0.6, speed: 1.5, morale: 70 },
  spearmen: { count: 5, hp: 26, dmg: 1.6, speed: 1.35, morale: 70 },
  raiders: { count: 4, hp: 24, dmg: 1.8, speed: 1.45, morale: 75 },
  raiderArchers: { count: 3, hp: 16, dmg: 0.5, speed: 1.4, morale: 60 },
  armored: { count: 3, hp: 60, dmg: 2.6, speed: 1.05, morale: 95 },
};

// Armor (the "armored" class): fire from the front/side barely hurts, melee hits somewhat less; the back is weaker.
// Spearmen pierce armor.
export const ARMOR_RANGED = 0.35;
export const ARMOR_RANGED_BACK = 0.7;
export const ARMOR_MELEE = 0.7;
export const ARROW_DMG_ENEMY = 1.5; // per enemy archer

// Combat
export const MELEE_CYCLE = 24; // 1.2 s
export const FIRST_STRIKE_MIN = 8; // delay of the first blow after contact
export const ARROW_CYCLE = 30; // 1.5 s
export const ARROW_DMG = 2.0; // per archer
export const ARROW_RANGE = 14;
export const ARROW_FLIGHT = 12; // 0.6 s
export const HILL_RANGE_MULT = 1.3;
export const HILL_ARROW_MULT = 1.25;
export const TOWER_RANGE_MULT = 1.3;
export const TOWER_ARROW_MULT = 1.25;

// Difficulty: scales enemy strength and the time the player gets to prepare.
export interface DifficultyMults {
  crew: number;
  enemyHp: number;
  enemyDmg: number;
  buildingHp: number;
  prep: number;
  break: number;
}

export const DIFFICULTY_MULTS: Record<Difficulty, DifficultyMults> = {
  easy: { crew: 0.8, enemyHp: 0.9, enemyDmg: 0.85, buildingHp: 1.2, prep: 1.3, break: 1.3 },
  normal: { crew: 1.1, enemyHp: 1.2, enemyDmg: 1.15, buildingHp: 1, prep: 1, break: 1 },
  hard: { crew: 1.3, enemyHp: 1.3, enemyDmg: 1.3, buildingHp: 0.8, prep: 0.8, break: 0.8 },
  brutal: { crew: 1.5, enemyHp: 1.45, enemyDmg: 1.45, buildingHp: 0.7, prep: 0.7, break: 0.7 },
};
export const FLANK_SIDE = 1.3;
export const FLANK_BACK = 1.6;
export const FLANK_DOT = 0.5;
export const HILL_DEFENSE = 0.85;
export const SHALLOW_DEFENDER = 1.25;
export const SHALLOW_ATTACKER = 0.75;
export const SPEAR_BEACH_MULT = 1.8;
export const SPEAR_PUSH = 0.8;
export const AUTO_ENGAGE = 4; // m
export const LEASH = 8; // m from the "home" position
export const ENEMY_AGGRO = 6; // m
export const ARCHER_AGGRO_MULT = 1.6; // melee raiders notice player archers from this much further
export const REGROUP_TICKS = 8 * TICK_RATE; // how long a squad waits at a ramp foot for the rest of its wave
export const REGROUP_DIST = 10; // m: a partner this close counts as arrived
export const BUILDING_REACH = 2.2; // m from the building edge
export const BUILDING_DPS = 1.5; // per raider per second
export const BUILDING_HP = 300;

// Morale
export const MORALE_MAX = 100;
export const ROUT_BELOW = 20;
/** Raiders break only when they are really losing: low morale AND less than this share of HP left. */
export const ENEMY_ROUT_HP = 0.4;
export const RALLY_AT = 50;
export const MORALE_DMG_SCALE = 60;
export const MORALE_DEATH = 8;
export const MORALE_DEATH_NEARBY = 3;
export const MORALE_NEARBY_R = 8;
export const MORALE_FLANK_HIT = 2;
export const MORALE_REGEN = 2; // /s
export const MORALE_REGEN_DELAY = 60; // ticks without combat
export const MORALE_RALLY_REGEN = 5; // /s at the rally point
export const RALLY_RADIUS = 4;
export const ROUT_SPEED = 1.1;
export const BOARD_RADIUS = 2.5;

// Traits
export const TRAIT_FAST = 0.08;
export const TRAIT_STRONG = 0.15;
export const TRAIT_CAREFUL = 0.1;
export const TRAIT_CALM = 0.25;

// Abilities
export const SHIELD_TICKS = 12 * TICK_RATE;
export const SHIELD_COOLDOWN = 45 * TICK_RATE;
export const SHIELD_REDUCTION = 0.4; // damage multiplier from the front
export const SHIELD_SPEED = 0.5;
export const HORN_RADIUS = 12;
export const HORN_MORALE = 25;
export const HORN_COOLDOWN = 60 * TICK_RATE;

// Boats and landing
export const BOAT_SPEED = 2.2;
export const BOAT_DECEL = 0.5;
export const BOAT_SPAWN_DIST = 40; // m from the landing spot, in the fog
// a longer landing window: player archers get time to shoot the crew aboard
export const DISEMBARK_FIRST: [number, number] = [30, 50]; // 1.5-2.5 s after landing
export const DISEMBARK_EVERY: [number, number] = [24, 40]; // 1.2-2 s
export const DISEMBARK_PAIR_CHANCE = 0.35;
export const BOAT_LEAVE_DELAY = 5 * TICK_RATE;

// Waves
export const PREP_TICKS = 70 * TICK_RATE;
export const BREAK_TICKS = 55 * TICK_RATE;
export const WAVE_JITTER = 3; // s

export const WAVES: WaveSpec[] = [
  {
    // three boats at once: waiting inside the palisade costs a building or a squad
    boats: [
      { dir: 'S', crew: 5, delay: 0 },
      { dir: 'E', crew: 5, delay: 5 },
      { dir: 'W', crew: 4, delay: 10 },
    ],
  },
  {
    boats: [
      { dir: 'E', crew: 4, delay: 0 },
      { dir: 'W', crew: 3, delay: 8, kind: 'raiderArchers' },
      { dir: 'S', crew: 3, delay: 14 },
    ],
  },
  {
    boats: [
      { dir: 'S', crew: 3, delay: 0, kind: 'armored' },
      { dir: 'E', crew: 4, delay: 6 },
      { dir: 'N', crew: 4, delay: 14, kind: 'raiderArchers', target: 'lighthouse' },
    ],
  },
];
