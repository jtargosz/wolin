// Squad creation, seeded names and traits, trait modifiers.

import { DIFFICULTY_MULTS, TRAIT_CALM, TRAIT_CAREFUL, TRAIT_FAST, TRAIT_STRONG, UNIT_STATS } from './config.ts';
import { pick, rand } from './rng.ts';
import type { GameState, Squad, SquadType, Trait, Vec, Warrior } from './types.ts';

// Multicultural town: Slavic, Norse, Saxon, and Baltic names.
export const NAME_POOLS: string[][] = [
  ['Bogusz', 'Dobrosz', 'Mścisław', 'Radek', 'Sulisław', 'Wszebor', 'Żelisław', 'Budziwoj', 'Chwalisz', 'Gniewko', 'Jarosz', 'Ludek', 'Dobrawa', 'Sobiebor', 'Świętosz', 'Milena'],
  ['Ketil', 'Toke', 'Asbjorn', 'Halvard', 'Ulf', 'Orm', 'Thorkel', 'Eskil', 'Bjarni', 'Frode', 'Hakon', 'Sigrid', 'Astrid', 'Gudrun', 'Ragnvald'],
  ['Ecbert', 'Wulfric', 'Oswin', 'Aldric', 'Leofwin', 'Godric', 'Edwin', 'Wynstan', 'Osric', 'Hilda', 'Edith', 'Wigmund', 'Aelfwin', 'Cyneric', 'Beorn'],
  ['Kantis', 'Skalwis', 'Girdas', 'Tautwil', 'Nalbis', 'Sirtis', 'Dargis', 'Mantas', 'Glandis', 'Warpis', 'Nameda', 'Rasa', 'Austeja', 'Kukis', 'Wissebut'],
];

export const TRAITS: Trait[] = ['fast', 'strong', 'careful', 'calm'];

function uniqueName(s: GameState, used: Set<string>): string {
  for (let tries = 0; tries < 50; tries++) {
    const name = pick(s, pick(s, NAME_POOLS));
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // all picks taken: append a number (deterministic)
  const base = NAME_POOLS[0][0];
  let k = 2;
  while (used.has(`${base} ${k}`)) k++;
  used.add(`${base} ${k}`);
  return `${base} ${k}`;
}

function baseSquad(s: GameState, side: Squad['side'], type: SquadType, pos: Vec, facing: Vec): Squad {
  return {
    id: s.nextId++,
    side,
    type,
    pos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 0 },
    facing: { x: facing.x, y: facing.y },
    holdFacing: { x: facing.x, y: facing.y },
    home: { x: pos.x, y: pos.y },
    mode: 'ready',
    order: { kind: 'hold' },
    warriors: [],
    morale: UNIT_STATS[type].morale,
    maxHp: 0,
    goal: null,
    path: [],
    pathIdx: 0,
    pathGoal: null,
    repathTick: 0,
    progressDist: Infinity,
    progressTick: 0,
    ghostUntil: 0,
    targetId: -1,
    buildingTarget: -1,
    preferredBuilding: -1,
    atBuilding: false,
    attackCd: 0,
    contact: false,
    lastCombatTick: -1000,
    shieldUntil: 0,
    shieldDir: { x: facing.x, y: facing.y },
    shieldReady: 0,
    boatId: -1,
    waitSince: -1,
    waitLevel: -1,
  };
}

export function createPlayerSquad(s: GameState, type: SquadType, pos: Vec, facing: Vec, usedNames: Set<string>): Squad {
  const sq = baseSquad(s, 'player', type, pos, facing);
  const st = UNIT_STATS[type];
  for (let i = 0; i < st.count; i++) {
    const w: Warrior = {
      id: s.nextId++,
      name: uniqueName(s, usedNames),
      trait: pick(s, TRAITS),
      hp: st.hp,
      maxHp: st.hp,
      alive: true,
      aboard: false,
    };
    sq.warriors.push(w);
  }
  sq.maxHp = st.count * st.hp;
  return sq;
}

export function createEnemySquad(s: GameState, pos: Vec, facing: Vec, crew: number, boatId: number, kind: SquadType = 'raiders'): Squad {
  const sq = baseSquad(s, 'enemy', kind, pos, facing);
  const st = UNIT_STATS[kind];
  const hp = Math.max(1, Math.round(st.hp * DIFFICULTY_MULTS[s.difficulty].enemyHp));
  for (let i = 0; i < crew; i++) {
    sq.warriors.push({ id: s.nextId++, name: '', trait: 'none', hp, maxHp: hp, alive: true, aboard: true });
  }
  sq.maxHp = crew * hp;
  sq.mode = 'landing';
  sq.boatId = boatId;
  // slight attack phase variation so boats do not strike in the same rhythm
  sq.attackCd = Math.floor(rand(s) * 6);
  return sq;
}

/** Warriors able to fight (alive, ashore). */
export function fighters(sq: Squad): Warrior[] {
  return sq.warriors.filter((w) => w.alive && !w.aboard);
}

/** Share of the squad's full HP still alive (0..1). */
export function hpRatio(sq: Squad): number {
  let hp = 0;
  for (const w of sq.warriors) if (w.alive) hp += w.hp;
  return sq.maxHp <= 0 ? 0 : hp / sq.maxHp;
}

export function aliveCount(sq: Squad): number {
  let n = 0;
  for (const w of sq.warriors) if (w.alive) n++;
  return n;
}

/** Share of fighters with the given trait (0..1). */
export function traitShare(sq: Squad, trait: Trait): number {
  let n = 0;
  let k = 0;
  for (const w of sq.warriors) {
    if (!w.alive || w.aboard) continue;
    n++;
    if (w.trait === trait) k++;
  }
  return n === 0 ? 0 : k / n;
}

export const fastMult = (sq: Squad): number => 1 + TRAIT_FAST * traitShare(sq, 'fast');
export const strongMult = (sq: Squad): number => 1 + TRAIT_STRONG * traitShare(sq, 'strong');
export const carefulMult = (sq: Squad): number => 1 - TRAIT_CAREFUL * traitShare(sq, 'careful');
export const calmMult = (sq: Squad): number => 1 - TRAIT_CALM * traitShare(sq, 'calm');

/** A squad present on the field (takes part in collisions and combat). */
export function onField(sq: Squad): boolean {
  return sq.mode !== 'gone' && sq.mode !== 'dead';
}
