// Audio engine: AudioContext after a player gesture, buses (music/effects/ambience) to master to limiter.

import type { GameEvent, GameState, Vec } from '../core/types.ts';
import { Ambient } from './ambient.ts';
import { Music } from './music.ts';
import { Sfx, type Locate } from './sfx.ts';

export interface Volumes {
  music: number;
  sfx: number;
  ambient: number;
  muted: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: { music: GainNode; sfx: GainNode; ambient: GainNode };
  private music!: Music;
  private ambient!: Ambient;
  sfx: Sfx | null = null;
  private vol: Volumes = { music: 0.6, sfx: 0.8, ambient: 0.7, muted: false };

  /** Must be called from a gesture handler (clicking "Start"). */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(limiter);
    const mk = () => {
      const g = ctx.createGain();
      g.connect(this.master);
      return g;
    };
    this.bus = { music: mk(), sfx: mk(), ambient: mk() };
    // shared noise buffer (2 s) for all sources
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.music = new Music(ctx, this.bus.music, noise);
    this.ambient = new Ambient(ctx, this.bus.ambient, noise);
    this.sfx = new Sfx(ctx, this.bus.sfx, noise);
    this.setVolumes(this.vol);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });
  }

  setVolumes(v: Volumes): void {
    this.vol = { ...v };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bus.music.gain.setTargetAtTime(v.music * 0.8, t, 0.1);
    this.bus.sfx.gain.setTargetAtTime(v.sfx, t, 0.1);
    this.bus.ambient.gain.setTargetAtTime(v.ambient * 0.8, t, 0.1);
    // Mute: a gentle fade instead of a hard cut
    this.master.gain.setTargetAtTime(v.muted ? 0 : 0.9, t, v.muted ? 0.15 : 0.6);
  }

  /** Threat for the music: boats at sea with crew, or enemies ashore. */
  static threat(s: GameState): boolean {
    if (s.phase !== 'wave') return false;
    if (s.boats.some((b) => b.wave === s.waveIndex && b.state === 'sailing')) return true;
    return s.squads.some((q) => q.side === 'enemy' && (q.mode === 'ready' || q.mode === 'landing'));
  }

  update(s: GameState, ev: GameEvent[], dt: number, locate: Locate): void {
    if (!this.ctx) return;
    this.music.update(AudioEngine.threat(s), dt);
    // ambience yields to the music as tension rises
    this.bus.ambient.gain.setTargetAtTime(this.vol.ambient * 0.8 * (1 - 0.5 * this.music.level), this.ctx.currentTime, 0.5);
    this.ambient.update();
    this.sfx?.onEvents(ev, locate);
  }

  ui(kind: 'order' | 'horn' | 'shield', at: Vec | null = null, locate: Locate | null = null): void {
    this.sfx?.play(kind, at, locate);
  }
}
