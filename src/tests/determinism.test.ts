import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../core/config.ts';
import { createGame, issueCommand, step } from '../core/game.ts';
import type { Command, GameState } from '../core/types.ts';

// Scripted defense: guard at the gate, archers on the hill, spearmen on the landing beaches.
type Script = { tick: number; cmd: (s: GameState) => Command | null }[];

const squad = (s: GameState, type: string) => s.squads.find((q) => q.side === 'player' && q.type === type)!;

function defense(): Script {
  return [
    { tick: 0, cmd: (s) => ({ kind: 'move', squadId: squad(s, 'guard').id, to: { x: 1.5, y: 1.5 }, facing: { x: 0, y: 1 } }) },
    { tick: 0, cmd: (s) => ({ kind: 'move', squadId: squad(s, 'archers').id, to: { x: -11, y: 6 }, facing: { x: 0, y: 1 } }) },
    { tick: 0, cmd: (s) => ({ kind: 'move', squadId: squad(s, 'spearmen').id, to: { x: 1, y: 7 }, facing: { x: 0, y: 1 } }) },
  ];
}

/** Every second: spearmen and guard attack the nearest enemy ashore (a simple "player"). */
function autoplay(s: GameState): void {
  if (s.tick % TICK_RATE !== 0) return;
  const foes = s.squads.filter((q) => q.side === 'enemy' && (q.mode === 'ready' || q.mode === 'landing') && q.warriors.some((w) => w.alive && !w.aboard));
  for (const p of s.squads) {
    if (p.side !== 'player' || p.mode !== 'ready' || p.type === 'archers') continue;
    let best = null;
    let bd = Infinity;
    for (const f of foes) {
      const d = Math.hypot(f.pos.x - p.pos.x, f.pos.y - p.pos.y);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (best && (p.order.kind !== 'attack' || p.order.target !== best.id)) issueCommand(s, { kind: 'attack', squadId: p.id, targetId: best.id });
  }
  for (const p of s.squads) {
    if (p.side === 'player' && p.type === 'guard' && p.contact) issueCommand(s, { kind: 'shieldWall', squadId: p.id });
    if (p.side === 'player' && p.morale < 30 && s.tick >= s.hornReady) issueCommand(s, { kind: 'horn', at: p.pos });
  }
}

function play(seed: string, script: Script, maxTicks: number, auto: boolean): GameState {
  const s = createGame(seed);
  const due = [...script];
  for (let i = 0; i < maxTicks && s.phase !== 'won' && s.phase !== 'lost'; i++) {
    while (due.length && due[0].tick <= s.tick) {
      const c = due.shift()!.cmd(s);
      if (c) issueCommand(s, c);
    }
    if (auto) autoplay(s);
    step(s);
  }
  return s;
}

describe('Determinism', () => {
  it('the same seed and the same orders give an identical run', () => {
    const a = play('powtorka', defense(), TICK_RATE * 200, true);
    const b = play('powtorka', defense(), TICK_RATE * 200, true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = play('inna', defense(), TICK_RATE * 200, true);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('an active defense wins the mission in 5-10 minutes', () => {
    const s = play('wolin', defense(), TICK_RATE * 60 * 15, true);
    const minutes = s.tick / TICK_RATE / 60;
    expect(s.phase).toBe('won');
    expect(minutes).toBeGreaterThanOrEqual(5);
    expect(minutes).toBeLessThanOrEqual(10);
    expect(s.buildings.some((b) => b.hp > 0)).toBe(true);
  });
});
