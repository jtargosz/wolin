// Effects from GameEvents: soft and short, panned by position, with a cap on simultaneous voices.

import type { GameEvent, Vec } from '../core/types.ts';

type Kind = 'hit' | 'shot' | 'order' | 'splash' | 'fell' | 'horn' | 'shield' | 'building' | 'collapse';
const LIMIT: Record<Kind, number> = { hit: 6, shot: 4, order: 2, splash: 3, fell: 3, horn: 1, shield: 2, building: 2, collapse: 1 };

export type Locate = (p: Vec) => { pan: number; gain: number };

export class Sfx {
  private readonly active: Record<Kind, number> = { hit: 0, shot: 0, order: 0, splash: 0, fell: 0, horn: 0, shield: 0, building: 0, collapse: 0 };

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly noise: AudioBuffer,
  ) {}

  private voice(kind: Kind, at: Vec | null, locate: Locate | null, dur: number): GainNode | null {
    if (this.active[kind] >= LIMIT[kind]) return null;
    const loc = at && locate ? locate(at) : { pan: 0, gain: 1 };
    if (loc.gain < 0.03) return null;
    this.active[kind]++;
    const g = this.ctx.createGain();
    g.gain.value = loc.gain;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, loc.pan));
    g.connect(p).connect(this.out);
    setTimeout(() => {
      this.active[kind]--;
      p.disconnect();
    }, (dur + 0.1) * 1000);
    return g;
  }

  private tone(out: AudioNode, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, dur: number, t = this.ctx.currentTime): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(out: AudioNode, type: BiquadFilterType, freq: number, peak: number, dur: number, t = this.ctx.currentTime): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    n.connect(f).connect(g).connect(out);
    n.start(t, Math.random() * 1.5, dur + 0.05);
  }

  play(kind: Kind, at: Vec | null = null, locate: Locate | null = null): void {
    const durs: Record<Kind, number> = { hit: 0.3, shot: 0.4, order: 0.15, splash: 0.6, fell: 0.9, horn: 2.6, shield: 0.4, building: 0.5, collapse: 1.6 };
    const g = this.voice(kind, at, locate, durs[kind]);
    if (!g) return;
    const t = this.ctx.currentTime;
    switch (kind) {
      case 'hit': // soft wood-on-wood thud
        this.tone(g, 'sine', 170 + Math.random() * 40, 70, 0.22, 0.004, 0.25);
        this.hiss(g, 'bandpass', 1200, 0.05, 0.08);
        break;
      case 'shot': // bowstring + whistle
        this.tone(g, 'triangle', 320, 180, 0.08, 0.003, 0.12);
        this.hiss(g, 'highpass', 2500, 0.04, 0.35, t + 0.03);
        break;
      case 'order':
        this.tone(g, 'sine', 620, 540, 0.08, 0.003, 0.12);
        break;
      case 'splash':
        this.hiss(g, 'lowpass', 900, 0.12, 0.55);
        break;
      case 'fell': // low, soft thud
        this.tone(g, 'sine', 110, 55, 0.2, 0.03, 0.85);
        break;
      case 'horn': {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 700;
        f.connect(g);
        this.tone(f, 'sawtooth', 146.8, 146.8, 0.16, 0.5, 2.4);
        this.tone(f, 'sawtooth', 220, 218, 0.07, 0.7, 2.2);
        break;
      }
      case 'shield':
        for (let i = 0; i < 3; i++) this.tone(g, 'sine', 210 + i * 15, 90, 0.12, 0.004, 0.15, t + i * 0.08);
        break;
      case 'building':
        this.tone(g, 'sine', 95, 60, 0.18, 0.005, 0.4);
        break;
      case 'collapse':
        this.tone(g, 'sine', 70, 35, 0.25, 0.2, 1.5);
        this.hiss(g, 'lowpass', 400, 0.08, 1.4);
        break;
    }
  }

  onEvents(ev: GameEvent[], locate: Locate): void {
    for (const e of ev) {
      if (e.t === 'hit') this.play('hit', e.at, locate);
      else if (e.t === 'shot') this.play('shot', e.at, locate);
      else if (e.t === 'disembark' || e.t === 'boatLanded') this.play('splash', e.at, locate);
      else if (e.t === 'fell') this.play('fell', e.at, locate);
      else if (e.t === 'buildingHit') this.play('building', e.at, locate);
      else if (e.t === 'buildingDestroyed') this.play('collapse', e.at, locate);
    }
  }
}
