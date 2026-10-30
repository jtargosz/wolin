// Pure animation helpers (no three.js): attack cycle poses, the fall of the slain, building damage
// stages and the resting pose of a beached boat. Kept free of rendering so they can be unit tested.

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Smooth 0..1 ramp between a and b. */
export function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * Where a squad is in its attack cycle, 0..1. `cd` is the remaining cooldown (core `attackCd`, counting
 * down to the next blow), so 1 is the moment of the blow. `offset` shifts single warriors a little so
 * the squad does not move as one block.
 */
export function attackPhase(cd: number, cycle: number, offset = 0): number {
  const p = 1 - Math.min(Math.max(cd, 0), cycle) / cycle + offset;
  return p - Math.floor(p);
}

export type StrikeKind = 'chop' | 'thrust' | 'draw';

export interface StrikePose {
  /** Weapon rotation about the x axis (positive swings it forward). */
  weaponX: number;
  /** Body lunge forward, meters. */
  lunge: number;
  /** Body lean (positive forward, negative back), radians. */
  lean: number;
}

/**
 * Pose within one attack cycle. The weapon is raised during the first 70 % of the cycle, strikes
 * (chop, thrust) or is released (draw) between 70 % and 88 %, and eases back to the raised
 * start by the end of the cycle, so the loop has no jump.
 */
export function strikePose(phase: number, kind: StrikeKind): StrikePose {
  const p = phase - Math.floor(phase);
  const hit = smooth(0.7, 0.88, p) * (1 - smooth(0.9, 1, p));
  const windup = smooth(0.05, 0.7, p) * (1 - smooth(0.7, 0.88, p));
  if (kind === 'draw') {
    // nock and pull back, hold, release: the bow arm rises while drawing and drops on release
    const drawn = smooth(0.05, 0.85, p) * (1 - smooth(0.9, 1, p));
    return { weaponX: 0.35 + 0.6 * drawn, lunge: 0, lean: -0.14 * drawn };
  }
  if (kind === 'thrust') {
    let w: number;
    if (p < 0.7) w = 0.7 + (0.3 - 0.7) * smooth(0.05, 0.7, p);
    else if (p < 0.88) w = 0.3 + (1.35 - 0.3) * smooth(0.7, 0.88, p);
    else w = 1.35 + (0.7 - 1.35) * smooth(0.9, 1, p);
    return { weaponX: w, lunge: 0.4 * hit, lean: 0.2 * hit - 0.06 * windup };
  }
  let w: number;
  if (p < 0.7) w = 0.7 + (-1.1 - 0.7) * smooth(0.05, 0.7, p);
  else if (p < 0.88) w = -1.1 + (1.3 + 1.1) * smooth(0.7, 0.88, p);
  else w = 1.3 + (0.7 - 1.3) * smooth(0.9, 1, p);
  return { weaponX: w, lunge: 0.2 * hit, lean: 0.16 * hit - 0.08 * windup };
}

/** A warrior who fell: tips onto the side in 0.5 s, lies still, then shrinks away (done at t = 2.9). */
export function fallPose(t: number): { tilt: number; drop: number; scale: number } {
  const k = smooth(0, 0.5, t);
  return { tilt: (Math.PI / 2) * k, drop: -0.2 * k, scale: 1 - smooth(2.2, 2.9, t) };
}

export const FALL_DONE = 2.9;

/** 0 intact, 1 cracked, 2 burning, 3 ruin. */
export function buildingDamageStage(ratio: number): 0 | 1 | 2 | 3 {
  if (ratio <= 0) return 3;
  if (ratio < 0.33) return 2;
  if (ratio < 0.66) return 1;
  return 0;
}

/** Chimney smoke of a building by damage: a burning one smokes thicker and darker, a ruin not at all. */
export function smokeIntensity(stage: number): { size: number; dark: number } {
  if (stage >= 3) return { size: 0, dark: 0 };
  if (stage === 2) return { size: 1.7, dark: 0.7 };
  if (stage === 1) return { size: 1.2, dark: 0.25 };
  return { size: 1, dark: 0 };
}

/** The lowest point of a boat hull in its own frame (keel). */
export const BOAT_BOTTOM = -0.3;
/** Distance of the bow and stern ground samples from the middle, meters. */
export const BOAT_REST_Z = 2.2;
const SINK = 0.03;

/**
 * Resting pose of a beached boat: `pitch` lifts the bow (radians), `y` is the group height. The keel never
 * goes below the ground at the bow, middle and stern samples, and the boat never sits lower than it floats.
 */
export function restPose(waveY: number, groundBow: number, groundMid: number, groundStern: number): { y: number; pitch: number } {
  const raw = Math.atan2(groundBow - groundStern, 2 * BOAT_REST_Z);
  const pitch = Math.min(0.25, Math.max(-0.1, raw));
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  const need = (g: number, z: number) => g - SINK - BOAT_BOTTOM * cos - z * sin;
  const y = Math.max(waveY, need(groundBow, BOAT_REST_Z), need(groundMid, 0), need(groundStern, -BOAT_REST_Z));
  return { y, pitch };
}

/** Height of the keel at local z for a resting pose (used by tests and the gangway). */
export function keelHeight(y: number, pitch: number, z: number): number {
  return y + BOAT_BOTTOM * Math.cos(pitch) + z * Math.sin(pitch);
}
