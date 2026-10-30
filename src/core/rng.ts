// Deterministic RNG: FNV-1a (seed hash) + mulberry32. State is kept in GameState.rng,
// so a state snapshot also contains the generator position.

export interface RngHolder {
  rng: number;
}

/** 32-bit FNV-1a over UTF-16 code units. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Number in [0, 1). Advances the generator state. */
export function rand(s: RngHolder): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max] (inclusive). */
export function randInt(s: RngHolder, min: number, max: number): number {
  return min + Math.floor(rand(s) * (max - min + 1));
}

export function randRange(s: RngHolder, min: number, max: number): number {
  return min + rand(s) * (max - min);
}

export function pick<T>(s: RngHolder, items: readonly T[]): T {
  return items[Math.floor(rand(s) * items.length)];
}
