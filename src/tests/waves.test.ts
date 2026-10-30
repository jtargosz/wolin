import { describe, expect, it } from 'vitest';
import { createGame, issueCommand, step } from '../core/game.ts';
import type { GameState } from '../core/types.ts';
import { aliveCount } from '../core/units.ts';
import { addEnemy, addPlayer, at, field, miniGame, passiveReport, run, runUntil } from './helpers.ts';

const boatTicks = (s: GameState) => s.boats.map((b) => [b.spawnTick, b.landing.x, b.landing.y]);

describe('Boats and landing', () => {
  it('the same seed gives the same boats; a different seed gives a different spread within bounds', () => {
    const a = createGame('wave');
    const b = createGame('wave');
    issueCommand(a, { kind: 'callWave' });
    issueCommand(b, { kind: 'callWave' });
    step(a);
    step(b);
    expect(boatTicks(a)).toEqual(boatTicks(b));
    const spawns = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const g = createGame('s' + i);
      issueCommand(g, { kind: 'callWave' });
      step(g);
      const t = g.boats[0].spawnTick - 1;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(3 * 20 + 1);
      spawns.add(t);
    }
    expect(spawns.size).toBeGreaterThan(3);
  });

  it('the landing party disembarks in several batches and the boat leaves empty', () => {
    const s = createGame('desant');
    issueCommand(s, { kind: 'callWave' });
    const ev = run(s, 20 * 60);
    const dis = ev.filter((e) => e.t === 'disembark');
    expect(dis.length).toBeGreaterThanOrEqual(2);
    const crew = s.boats.reduce((n, b) => n + b.crew, 0);
    expect(dis.reduce((n, e) => n + (e.t === 'disembark' ? e.count : 0), 0)).toBe(crew);
    expect(ev.some((e) => e.t === 'boatLanded')).toBe(true);
  });

  it('raiders without defenders destroy the nearest building and switch targets', () => {
    const rows = field(30, 16);
    rows[4] = ':__AA________________BB______:';
    rows[5] = ':__AA________________BB______:';
    const s = miniGame(rows);
    const guard = addPlayer(s, 'guard', at(s, 27, 14)); // far away, in hold mode, will not engage
    guard.home = { ...guard.pos };
    const e = addEnemy(s, at(s, 5, 10), 4);
    const n = runUntil(s, () => s.buildings[0].hp <= 0, 20 * 200);
    expect(n).toBeGreaterThan(0);
    expect(s.buildings[1].hp).toBe(s.buildings[1].maxHp);
    run(s, 20 * 30);
    expect(e.buildingTarget).toBe(1);
    expect(s.buildings[1].hp).toBeLessThan(s.buildings[1].maxHp);
  });
});

describe('Mission flow', () => {
  it('without a single order the first wave already costs something and the mission is lost, never won', () => {
    const seeds = ['wolin', 'bierny', ...Array.from({ length: 10 }, (_, i) => 'p-' + i)];
    for (const seed of seeds) {
      const r = passiveReport(seed);
      expect(r.wave1Cost, `${seed} wave 1 cost`).toBe(true);
      expect(r.phase, `${seed} phase`).toBe('lost');
      expect(r.waveIndex, `${seed} lost no later than the third wave`).toBeLessThanOrEqual(2);
    }
  });

  it('defeat after losing all squads', () => {
    const s = createGame('straty');
    for (const q of s.squads) for (const w of q.warriors) w.alive = false;
    const ev = run(s, 1);
    expect(s.phase).toBe('lost');
    expect(ev.some((e) => e.t === 'outcome' && e.result === 'lost')).toBe(true);
  });

  it('defeat after all buildings are destroyed', () => {
    const s = createGame('ruiny');
    for (const b of s.buildings) b.hp = 0;
    run(s, 1);
    expect(s.phase).toBe('lost');
  });

  it('a repelled wave gives a break and healing; PERMADEATH decides about the fallen', () => {
    for (const permadeath of [true, false]) {
      const s = createGame('przerwa', { permadeath });
      const sq = s.squads[0];
      sq.warriors[0].alive = false;
      sq.warriors[0].hp = 0;
      sq.warriors[1].hp = 3;
      issueCommand(s, { kind: 'callWave' });
      step(s);
      // instant repel: boats sail away without landing
      for (const b of s.boats) b.state = 'gone';
      const ev = run(s, 1);
      expect(ev.some((e) => e.t === 'waveCleared')).toBe(true);
      expect(ev.some((e) => e.t === 'wavePrep' && e.wave === 1)).toBe(true);
      expect(s.phase).toBe('prep');
      expect(sq.warriors[1].hp).toBe(sq.warriors[1].maxHp);
      expect(sq.warriors[0].alive).toBe(!permadeath);
      expect(aliveCount(sq)).toBe(permadeath ? sq.warriors.length - 1 : sq.warriors.length);
    }
  });

  it('victory after the last wave while a building stands', () => {
    const s = createGame('wygrana');
    s.waveIndex = s.waves.length - 1;
    issueCommand(s, { kind: 'callWave' });
    step(s);
    for (const b of s.boats) b.state = 'gone';
    const ev = run(s, 1);
    expect(s.phase).toBe('won');
    expect(ev.some((e) => e.t === 'outcome' && e.result === 'won')).toBe(true);
  });

  it('undoing a wave: a snapshot replays an identical run', () => {
    const s = createGame('cofnij');
    issueCommand(s, { kind: 'callWave' });
    run(s, 10);
    const snap = structuredClone(s);
    run(s, 20 * 60);
    const replay = structuredClone(snap);
    run(replay, 20 * 60);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(s));
    expect(runUntil(structuredClone(snap), () => false, 5)).toBe(-1);
  });
});
