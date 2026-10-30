import { describe, expect, it } from 'vitest';
import { BAR_SECONDS, Music, nextMood, type Mood } from '../audio/music.ts';

function runMood(m: Mood, threat: boolean, until: (m: Mood) => boolean, dt = 0.05): number {
  let t = 0;
  while (!until(m) && t < 60) {
    m = nextMood(m, threat, dt);
    t += dt;
  }
  return t;
}

describe('Adaptive music', () => {
  it('rises from calm to tension in 5-10 s, without jumps', () => {
    let m: Mood = { level: 0, hold: 0 };
    const t = runMood(m, true, (x) => x.level >= 1);
    expect(t).toBeGreaterThanOrEqual(5);
    expect(t).toBeLessThanOrEqual(10);
    m = nextMood(m, true, 0.05);
    expect(m.level).toBeLessThan(0.02);
  });

  it('returns to calm in 4-6 s (after a short hold)', () => {
    const t = runMood({ level: 1, hold: 0 }, false, (x) => x.level <= 0);
    expect(t).toBeGreaterThanOrEqual(4);
    expect(t).toBeLessThanOrEqual(6.1);
  });

  it('the hold absorbs short gaps in the threat', () => {
    let m: Mood = { level: 0.8, hold: 2 };
    for (let i = 0; i < 20; i++) m = nextMood(m, false, 0.05); // 1 s without threat
    expect(m.level).toBe(0.8);
  });
});

// Minimal AudioContext stub: records scheduled note/beat start times.
function stubContext(starts: number[]): {
  ctx: AudioContext;
  tick: (dt: number) => void;
  now: () => number;
} {
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  });
  const node = (): unknown => ({
    gain: param(),
    frequency: param(),
    detune: { value: 0 },
    Q: { value: 0 },
    connect(dest: unknown) {
      return dest ?? node;
    },
    start(t?: number) {
      if (typeof t === 'number') starts.push(t);
    },
    stop() {},
  });
  let time = 1000;
  const bufNode = (): unknown => ({
    buffer: null,
    connect(dest: unknown) {
      return dest;
    },
    start(t?: number) {
      if (typeof t === 'number') starts.push(t);
    },
    stop() {},
  });
  const ctx = {
    get currentTime() {
      return time;
    },
    sampleRate: 44100,
    createGain: node,
    createOscillator: node,
    createBiquadFilter: node,
    createBufferSource: bufNode,
    createConvolver: node,
    createBuffer: (_channels: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) }),
  };
  return { ctx: ctx as unknown as AudioContext, tick: (dt: number) => (time += dt), now: () => time };
}

/** The most voices one bar may start: pad, bass, harp, flute notes, ostinato, swell and drums at full tension. */
const MAX_STARTS_PER_BAR = 90;

describe('Music scheduler', () => {
  const out = { connect() {} } as unknown as AudioNode;

  it('never schedules in the past and never bursts after a frame hitch', () => {
    const starts: number[] = [];
    const { ctx, tick, now } = stubContext(starts);
    const music = new Music(ctx, out, {} as AudioBuffer);
    starts.length = 0; // ignore constructor drones (started with no timestamp)
    // a minute of normal frames under threat (everything on): all in time, at most one bar queued per step
    for (let i = 0; i < 3600; i++) {
      tick(1 / 60);
      const n = starts.length;
      music.update(true, 1 / 60);
      expect(starts.length - n).toBeLessThanOrEqual(MAX_STARTS_PER_BAR);
      for (let k = n; k < starts.length; k++) expect(starts[k]).toBeGreaterThanOrEqual(now() - 1e-9);
    }
    // a 5 s hitch with no update calls (GC pause, shader compile, heavy scene)
    tick(5);
    const before = starts.length;
    music.update(true, 1 / 60);
    const fresh = starts.slice(before);
    // the missed bars are skipped, not stacked: one bar's worth, all in the future and inside that one bar
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.length).toBeLessThanOrEqual(MAX_STARTS_PER_BAR);
    for (const t of fresh) {
      expect(t).toBeGreaterThanOrEqual(now() - 1e-9);
      expect(t).toBeLessThan(now() + BAR_SECONDS + 0.5);
    }
  });

  it('queues the tension voices only when there is a threat', () => {
    const run = (threat: boolean): number => {
      const starts: number[] = [];
      const { ctx, tick } = stubContext(starts);
      const music = new Music(ctx, out, {} as AudioBuffer);
      starts.length = 0;
      for (let i = 0; i < 60 * 40; i++) {
        tick(1 / 60);
        music.update(threat, 1 / 60);
      }
      return starts.length;
    };
    const calm = run(false);
    const tense = run(true);
    expect(calm).toBeGreaterThan(0); // pad, bass, harp and flute keep playing
    expect(tense).toBeGreaterThan(calm * 1.5);
  });
});
