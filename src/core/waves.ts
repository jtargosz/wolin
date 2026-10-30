// Waves: preparation, seeded boat schedule, repelling, breaks, PERMADEATH, and mission outcome.

import { DIFFICULTY_MULTS, TICK_RATE, UNIT_STATS, WAVE_JITTER } from './config.ts';
import { nearestWalkable } from './map.ts';
import { setGoal } from './movement.ts';
import { randInt, randRange } from './rng.ts';
import type { GameEvent, GameState } from './types.ts';
import { aliveCount, onField } from './units.ts';
import { add, copy } from './vec.ts';

export function startWave(s: GameState, ev: GameEvent[]): void {
  const spec = s.waves[s.waveIndex];
  const crewMult = DIFFICULTY_MULTS[s.difficulty].crew;
  s.phase = 'wave';
  for (const b of spec.boats) {
    const jitter = randRange(s, -WAVE_JITTER, WAVE_JITTER);
    const lanes = s.map.lanes[b.dir];
    const lane = lanes[randInt(s, 0, lanes.length - 1)];
    if (!lane) continue;
    // boats of one wave split between the buildings instead of all taking the nearest one
    const index = spec.boats.indexOf(b);
    const preferred = b.target
      ? s.map.buildings.findIndex((d) => d.key === b.target)
      : s.map.buildings.length > 0
        ? (index + s.waveIndex) % s.map.buildings.length
        : -1;
    s.boats.push({
      id: s.nextId++,
      wave: s.waveIndex,
      dir: b.dir,
      state: 'waiting',
      spawnTick: s.tick + Math.max(0, Math.round((b.delay + jitter) * TICK_RATE)),
      start: copy(lane.start),
      landing: copy(lane.landing),
      shore: copy(lane.shore),
      pos: copy(lane.start),
      heading: { x: 0, y: 1 },
      speed: 0,
      crew: Math.max(1, Math.round(b.crew * crewMult)),
      kind: b.kind ?? 'raiders',
      squadId: -1,
      nextDisembark: 0,
      leaveTick: -1,
      preferredBuilding: preferred,
    });
  }
  ev.push({ t: 'waveStarted', wave: s.waveIndex });
}

export function updateWaves(s: GameState, ev: GameEvent[]): void {
  if (s.phase === 'prep' && s.tick >= s.phaseEnd) startWave(s, ev);
}

/** Survivors recover; with PERMADEATH off, the fallen return to their squads. */
export function restoreBetweenWaves(s: GameState): void {
  let k = 0;
  for (const sq of s.squads) {
    if (sq.side !== 'player') continue;
    for (const w of sq.warriors) {
      if (w.alive) w.hp = w.maxHp;
      else if (!s.rules.permadeath) {
        w.alive = true;
        w.hp = w.maxHp;
      }
    }
    if (aliveCount(sq) === 0) continue;
    if (sq.mode === 'dead') {
      const spot = nearestWalkable(s.map, add(s.map.rally, { x: (k % 3) * 2 - 2, y: 2 })) ?? copy(s.map.rally);
      sq.pos = spot;
      sq.home = copy(spot);
      k++;
    }
    if (sq.mode === 'dead' || sq.mode === 'routing') {
      sq.mode = 'ready';
      sq.order = { kind: 'hold' };
      sq.home = copy(sq.pos);
    }
    sq.vel = { x: 0, y: 0 };
    sq.targetId = -1;
    sq.morale = UNIT_STATS[sq.type].morale;
    setGoal(sq, sq.order.kind === 'move' ? sq.order.to : null);
  }
}

function playerAlive(s: GameState): boolean {
  return s.squads.some((q) => q.side === 'player' && aliveCount(q) > 0);
}

/** Wave repelled, move to a break or victory; defeat in any phase. */
export function checkProgress(s: GameState, ev: GameEvent[]): void {
  if (s.phase === 'won' || s.phase === 'lost') return;
  const allRuined = s.buildings.length > 0 && s.buildings.every((b) => b.hp <= 0);
  if (allRuined || !playerAlive(s)) {
    s.phase = 'lost';
    ev.push({ t: 'outcome', result: 'lost' });
    return;
  }
  if (s.phase !== 'wave') return;
  const boatsDone = s.boats.every((b) => b.wave !== s.waveIndex || b.state === 'leaving' || b.state === 'gone');
  const enemiesDone = !s.squads.some((q) => q.side === 'enemy' && onField(q));
  if (!boatsDone || !enemiesDone) return;
  ev.push({ t: 'waveCleared', wave: s.waveIndex });
  if (s.waveIndex >= s.waves.length - 1) {
    s.phase = 'won';
    ev.push({ t: 'outcome', result: 'won' });
    return;
  }
  s.waveIndex++;
  s.phase = 'prep';
  s.phaseEnd = s.tick + s.rules.breakTicks;
  s.squads = s.squads.filter((q) => q.side === 'player');
  s.boats = s.boats.filter((b) => b.state !== 'gone');
  s.projectiles = [];
  restoreBetweenWaves(s);
  ev.push({ t: 'wavePrep', wave: s.waveIndex });
}
