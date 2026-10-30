// Test helpers: small ASCII maps and hand-placed squads.

import { createGame, step } from '../core/game.ts';
import { cellCenter, parseMap } from '../core/map.ts';
import type { GameEvent, GameState, Squad, SquadType, Vec } from '../core/types.ts';
import { createEnemySquad, createPlayerSquad } from '../core/units.ts';

/** A game on a small map, without starting squads (unless the map has them) and without waves. */
export function miniGame(rows: string[], levels?: string[], seed = 'test'): GameState {
  return createGame(seed, { map: parseMap(rows, levels), waves: [], prepTicks: 1e9 });
}

/** An open grass field w x h surrounded by shallow water (for combat tests). */
export function field(w = 30, h = 20): string[] {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(y === 0 || y === h - 1 ? ':'.repeat(w) : ':' + '_'.repeat(w - 2) + ':');
  }
  return rows;
}

export function at(s: GameState, cx: number, cy: number): Vec {
  return cellCenter(s.map, cx, cy);
}

export function addPlayer(s: GameState, type: SquadType, pos: Vec, facing: Vec = { x: 0, y: 1 }): Squad {
  const sq = createPlayerSquad(s, type, pos, facing, new Set());
  s.squads.push(sq);
  return sq;
}

export function addEnemy(s: GameState, pos: Vec, crew = 4, facing: Vec = { x: 0, y: -1 }): Squad {
  const sq = createEnemySquad(s, pos, facing, crew, -1);
  for (const w of sq.warriors) w.aboard = false;
  sq.mode = 'ready';
  s.squads.push(sq);
  return sq;
}

export function run(s: GameState, ticks: number): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(s));
  return all;
}

export function runUntil(s: GameState, pred: () => boolean, maxTicks: number): number {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return i;
    step(s);
  }
  return -1;
}

export interface PassiveReport {
  phase: GameState['phase'];
  ticks: number;
  /** Wave index reached when the game ended (or after 15 minutes). */
  waveIndex: number;
  buildingHp: number[];
  squadsLost: number;
  enemyRouted: number;
  /** Wave 1 cost a building or a whole squad (or the game was lost during it). */
  wave1Cost: boolean;
}

/** Plays a game without a single order until it is won, lost, or 15 minutes pass. */
export function passiveReport(seed: string, opts: Parameters<typeof createGame>[1] = {}, maxMinutes = 15): PassiveReport {
  const s = createGame(seed, opts);
  let enemyRouted = 0;
  let wave1Cost: boolean | null = null;
  const cost = () => s.buildings.some((b) => b.hp <= 0) || s.squads.some((q) => q.side === 'player' && q.warriors.every((w) => !w.alive));
  for (let i = 0; i < 20 * 60 * maxMinutes && s.phase !== 'won' && s.phase !== 'lost'; i++) {
    for (const e of step(s)) {
      if (e.t === 'routed' && e.side === 'enemy') enemyRouted++;
      if (e.t === 'waveCleared' && e.wave === 0 && wave1Cost === null) wave1Cost = cost();
    }
  }
  if (wave1Cost === null) wave1Cost = s.phase === 'lost' || cost();
  return {
    phase: s.phase,
    ticks: s.tick,
    waveIndex: s.waveIndex,
    buildingHp: s.buildings.map((b) => Math.round(b.hp)),
    squadsLost: s.squads.filter((q) => q.side === 'player' && q.warriors.every((w) => !w.alive)).length,
    enemyRouted,
    wave1Cost,
  };
}
