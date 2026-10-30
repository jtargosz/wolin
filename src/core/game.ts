// Logic facade: createGame, issueCommand (the only way to change state from outside), step (one tick).

import { BREAK_TICKS, BUILDING_HP, DIFFICULTY_MULTS, PERMADEATH, PREP_TICKS, WAVES } from './config.ts';
import { decidePlayer, shootable, squadById, targetable, updateCombat, updateMorale, useHorn, useShieldWall } from './combat.ts';
import { decideEnemy, updateBoats } from './enemy.ts';
import { clampToMap, nearestWalkable, wolinMap } from './map.ts';
import { setGoal, updateMovement } from './movement.ts';
import { hashSeed } from './rng.ts';
import type { Command, Difficulty, GameEvent, GameState, MapData, WaveSpec } from './types.ts';
import { createPlayerSquad, onField } from './units.ts';
import { len, normalize } from './vec.ts';
import { checkProgress, updateWaves } from './waves.ts';

export function isDifficulty(x: unknown): x is Difficulty {
  return x === 'easy' || x === 'normal' || x === 'hard' || x === 'brutal';
}

export interface GameOptions {
  map?: MapData;
  permadeath?: boolean;
  waves?: WaveSpec[];
  prepTicks?: number;
  breakTicks?: number;
  difficulty?: Difficulty;
}

export function createGame(seed: string, opts: GameOptions = {}): GameState {
  const map = opts.map ?? wolinMap();
  const difficulty = isDifficulty(opts.difficulty) ? opts.difficulty : 'normal';
  const mult = DIFFICULTY_MULTS[difficulty];
  const prepTicks = opts.prepTicks ?? Math.round(PREP_TICKS * mult.prep);
  const breakTicks = opts.breakTicks ?? Math.round(BREAK_TICKS * mult.break);
  const buildingHp = Math.round(BUILDING_HP * mult.buildingHp);
  const s: GameState = {
    seed,
    tick: 0,
    rng: hashSeed('wolin-' + seed) | 0,
    nextId: 1,
    map,
    rules: { permadeath: opts.permadeath ?? PERMADEATH, prepTicks, breakTicks },
    difficulty,
    waves: structuredClone(opts.waves ?? WAVES),
    phase: 'prep',
    waveIndex: 0,
    phaseEnd: prepTicks,
    squads: [],
    boats: [],
    buildings: map.buildings.map((b) => ({ key: b.key, hp: buildingHp, maxHp: buildingHp })),
    projectiles: [],
    hornReady: 0,
    fallen: [],
  };
  const used = new Set<string>();
  for (const st of map.starts) s.squads.push(createPlayerSquad(s, st.type, st.pos, st.facing, used));
  return s;
}

function ownSquad(s: GameState, id: number) {
  const sq = squadById(s, id);
  return sq && sq.side === 'player' && onField(sq) ? sq : undefined;
}

/** Validates and applies a command (also while paused). Returns false if the command was rejected. */
export function issueCommand(s: GameState, cmd: Command): boolean {
  if (s.phase === 'won' || s.phase === 'lost') return false;
  switch (cmd.kind) {
    case 'move': {
      const sq = ownSquad(s, cmd.squadId);
      if (!sq || sq.mode !== 'ready') return false;
      if (!Number.isFinite(cmd.to.x) || !Number.isFinite(cmd.to.y)) return false;
      const to = nearestWalkable(s.map, clampToMap(s.map, cmd.to));
      if (!to) return false;
      const f = cmd.facing && len(cmd.facing) > 0.01 ? normalize(cmd.facing) : null;
      sq.order = { kind: 'move', to, facing: f };
      setGoal(sq, to);
      return true;
    }
    case 'attack': {
      const sq = ownSquad(s, cmd.squadId);
      const t = squadById(s, cmd.targetId);
      if (!sq || sq.mode !== 'ready' || !t || t.side === 'player' || !(sq.type === 'archers' ? shootable(t) : targetable(t))) return false;
      sq.order = { kind: 'attack', target: t.id };
      return true;
    }
    case 'shieldWall': {
      const sq = ownSquad(s, cmd.squadId);
      return sq ? useShieldWall(s, sq) : false;
    }
    case 'horn':
      if (!Number.isFinite(cmd.at.x) || !Number.isFinite(cmd.at.y)) return false;
      return useHorn(s, cmd.at) >= 0;
    case 'callWave':
      if (s.phase !== 'prep') return false;
      s.phaseEnd = s.tick;
      return true;
  }
}

/** One simulation step (1/20 s). Fixed system order. */
export function step(s: GameState): GameEvent[] {
  if (s.phase === 'won' || s.phase === 'lost') return [];
  const ev: GameEvent[] = [];
  s.tick++;
  updateWaves(s, ev);
  updateBoats(s, ev);
  for (const sq of s.squads) {
    if (!onField(sq)) continue;
    if (sq.side === 'player') decidePlayer(s, sq);
    else decideEnemy(s, sq, ev);
  }
  updateMovement(s);
  updateCombat(s, ev);
  updateMorale(s, ev);
  checkProgress(s, ev);
  return ev;
}
